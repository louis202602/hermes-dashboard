-- Migration: agent_action_claim_exclusions (project smubxqorirlfldatzmym)
-- =====================================================================
-- Head-of-line protection for the agent-action queue.
--
-- Problem (HEAD_OF_LINE_BLOCKING): claim_agent_action selects the OLDEST
-- eligible action for an action_key (FIFO by created_at, FOR UPDATE SKIP LOCKED).
-- Some legacy `hermes.intent.resolve` QUEUED rows are the oldest in the queue AND
-- are explicitly protected (must never be drained/processed/mutated). The canonical
-- consumer therefore cannot claim a newer request without first attempting to claim
-- a protected head-of-line row.
--
-- Solution: an EXPLICIT, canonical claim-exclusion (quarantine) list. Listing a
-- row here makes it NON-CLAIMABLE by claim_agent_action WITHOUT modifying the
-- original request row (no status / created_at / lease / attempts change, no delete).
-- claim_agent_action now selects the OLDEST ELIGIBLE NON-EXCLUDED action.
--
-- Design guarantees:
--   * Explicit only — never an age-based silent skip.
--   * Never auto-delete, never auto FAILED/CANCELLED.
--   * Exclusions are per-row (agent_action_requests.id), not per-tenant.
--   * With zero exclusions, claim behaviour is byte-identical to before.
--   * expires_at NULL = permanent quarantine; a future timestamp = temporary.
--
-- Reversible: ..._9_rollback.sql (restores the original claim functions verbatim).
-- =====================================================================

begin;

create table if not exists hermes_os.agent_action_claim_exclusions (
  action_request_id uuid primary key,   -- = agent_action_requests.id
  reason      text not null,
  created_by  text not null default 'operator',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz                -- NULL = permanent quarantine
);
comment on table hermes_os.agent_action_claim_exclusions is
  'Canonical, EXPLICIT claim-exclusion (quarantine) list. A row here makes the referenced agent_action_requests.id NON-CLAIMABLE by claim_agent_action, WITHOUT modifying the original request row (no status/created_at/lease change, no delete). Protects head-of-line rows so newer requests can be claimed while the protected rows stay bit-for-bit unchanged. Explicit only: never an age-based silent skip, never auto-delete, never an auto FAILED/CANCELLED. expires_at NULL = permanent.';

-- hermes_os internal table: reached only via SECURITY DEFINER functions or BYPASSRLS
-- backend roles. RLS enabled (no policy) as defense-in-depth, matching sibling tables.
alter table hermes_os.agent_action_claim_exclusions enable row level security;

create index if not exists agent_action_claim_exclusions_active_idx
  on hermes_os.agent_action_claim_exclusions (action_request_id) where expires_at is null;

revoke all on table hermes_os.agent_action_claim_exclusions from public;

-- Register / update an exclusion (idempotent). service_role only.
create or replace function hermes_os.exclude_agent_action_from_claim(
  p_id uuid, p_reason text, p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
begin
  if p_id is null or coalesce(btrim(p_reason),'') = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ARGS');
  end if;
  insert into hermes_os.agent_action_claim_exclusions(action_request_id, reason, created_by, expires_at)
    values (p_id, left(p_reason,500), 'operator', p_expires_at)
  on conflict (action_request_id) do update
    set reason = excluded.reason, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'action_request_id', p_id, 'expires_at', p_expires_at);
end $fn$;

-- Lift an exclusion. service_role only.
create or replace function hermes_os.release_agent_action_claim_exclusion(p_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v int;
begin
  delete from hermes_os.agent_action_claim_exclusions where action_request_id = p_id;
  get diagnostics v = row_count;
  return jsonb_build_object('ok', true, 'removed', v);
end $fn$;

revoke all on function hermes_os.exclude_agent_action_from_claim(uuid,text,timestamptz) from public;
revoke all on function hermes_os.release_agent_action_claim_exclusion(uuid) from public;
grant execute on function hermes_os.exclude_agent_action_from_claim(uuid,text,timestamptz) to service_role;
grant execute on function hermes_os.release_agent_action_claim_exclusion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- claim_agent_action (2-arg, action-scoped, lease_token) — add the exclusion
-- filter. ONLY the `and not exists (...)` clause is added; everything else is
-- byte-identical to the prior definition.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.claim_agent_action(p_action_key text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $function$
declare
  v_row hermes_os.agent_action_requests%rowtype;
  v_cat hermes_os.agent_action_catalog%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_row from hermes_os.agent_action_requests
  where action_key = p_action_key
    and (status = 'QUEUED'
         or (status = 'RUNNING' and lease_expires_at is not null
             and lease_expires_at < now() and attempts < max_attempts))
    and not exists (
      select 1 from hermes_os.agent_action_claim_exclusions x
      where x.action_request_id = agent_action_requests.id
        and (x.expires_at is null or x.expires_at > now()))
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update hermes_os.agent_action_requests
    set status='RUNNING', attempts = attempts + 1, started_at = coalesce(started_at, now()),
        lease_token = v_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  select * into v_cat from hermes_os.agent_action_catalog where action_key = v_row.action_key;

  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
    v_row.correlation_id, 'CLAIMED', jsonb_build_object('attempt', v_row.attempts, 'scoped', p_action_key));

  return jsonb_build_object('claimed', true,
    'id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id,
    'action_key', v_row.action_key, 'request_id', v_row.request_id,
    'correlation_id', v_row.correlation_id, 'payload', v_row.payload,
    'lease_token', v_token, 'attempts', v_row.attempts, 'max_attempts', v_row.max_attempts,
    'target_kind', v_cat.target_kind, 'target_workflow_id', v_cat.target_workflow_id,
    'target_agent', v_cat.target_agent);
end;
$function$;

-- ---------------------------------------------------------------------------
-- claim_agent_action (1-arg, legacy all-actions) — same exclusion filter added.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.claim_agent_action(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $function$
declare v_row hermes_os.agent_action_requests%rowtype; v_cat hermes_os.agent_action_catalog%rowtype;
begin
  select * into v_row from hermes_os.agent_action_requests
  where (status = 'QUEUED'
     or (status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now()))
    and not exists (
      select 1 from hermes_os.agent_action_claim_exclusions x
      where x.action_request_id = agent_action_requests.id
        and (x.expires_at is null or x.expires_at > now()))
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update hermes_os.agent_action_requests
    set status='RUNNING', attempts = attempts + 1, started_at = coalesce(started_at, now()),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  select * into v_cat from hermes_os.agent_action_catalog where action_key = v_row.action_key;

  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
    v_row.correlation_id, 'CLAIMED', jsonb_build_object('attempt', v_row.attempts));

  return jsonb_build_object('claimed', true,
    'id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id,
    'action_key', v_row.action_key, 'request_id', v_row.request_id,
    'correlation_id', v_row.correlation_id, 'payload', v_row.payload,
    'target_kind', v_cat.target_kind, 'target_workflow_id', v_cat.target_workflow_id,
    'target_agent', v_cat.target_agent, 'attempts', v_row.attempts);
end;
$function$;

commit;
