-- Migration: hermes_resolver_execution_safety (project smubxqorirlfldatzmym)
-- Semantic Resolver / execution continuity — control-plane hardening.
--
-- Fix A — Completion ownership fencing. `complete_agent_action` previously
--   updated `where id = p_id` with NO fence, so a worker whose lease had expired
--   (and whose request was reclaimed by another worker) could overwrite the
--   fresh result. A bare `status='RUNNING'` guard is NOT enough (the reclaiming
--   worker also holds status RUNNING). We add a real ownership token: `claim`
--   stamps a fresh `lease_token` per (re)claim and returns it; `complete` accepts
--   the token and only writes if it still matches (and the row is RUNNING).
--
-- Fix B — Bounded reclaim / dead-letter. Add `max_attempts` (default 5). `claim`
--   no longer reclaims a RUNNING+expired row once `attempts >= max_attempts`;
--   the additive `reap_dead_letter_agent_actions()` reaper (called by the driver
--   each tick, BEFORE claim) moves such rows to terminal FAILED with a
--   DEAD_LETTER error + audit. No infinite reclaim; request_id preserved.
--
-- Backward-compatible & non-destructive:
--   * new columns are additive with defaults;
--   * `complete_agent_action` gains a trailing `p_lease_token uuid default null`,
--     so existing 5-arg callers still resolve (they get the status fence only —
--     adequate while consumers run one-at-a-time; the resolver driver will pass
--     the token at go-live for full fencing);
--   * `claim_agent_action` only ADDS fields to its returned jsonb (ignored by
--     current consumers) and a new column write.
--   * All gateway consumers are INACTIVE at apply time → no live traffic.
-- Reversible: see 20260813_hermes_resolver_execution_safety_9_rollback.sql.

begin;

-- Fix A.1 — ownership token; Fix B.1 — attempt cap. Additive columns.
alter table hermes_os.agent_action_requests
  add column if not exists lease_token uuid;
alter table hermes_os.agent_action_requests
  add column if not exists max_attempts integer not null default 5;

-- Fix A.2 + Fix B (claim side): stamp a fresh lease_token per (re)claim, return
-- it, and stop reclaiming once the attempt cap is reached.
create or replace function hermes_os.claim_agent_action(p_action_key text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
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

revoke all on function hermes_os.claim_agent_action(text,integer) from public;
grant execute on function hermes_os.claim_agent_action(text,integer) to service_role;
grant execute on function hermes_os.claim_agent_action(text,integer) to postgres;

-- Fix A.3 — fenced completion. Replace the 5-arg function with a 6-arg version
-- whose trailing token defaults to null (existing 5-arg callers keep working).
drop function if exists hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text);
create or replace function hermes_os.complete_agent_action(
  p_id uuid, p_status text, p_result jsonb default null, p_error jsonb default null,
  p_execution_id text default null, p_lease_token uuid default null)
returns void
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_row hermes_os.agent_action_requests%rowtype;
begin
  if p_status not in ('SUCCEEDED','FAILED') then
    raise exception 'complete_agent_action: invalid terminal status %', p_status;
  end if;
  update hermes_os.agent_action_requests
    set status = p_status, result = p_result, error = p_error,
        workflow_execution_id = coalesce(p_execution_id, workflow_execution_id),
        finished_at = now(), lease_expires_at = null, updated_at = now()
  where id = p_id
    and status = 'RUNNING'
    and (p_lease_token is null or lease_token is not distinct from p_lease_token)
  returning * into v_row;
  if v_row.id is null then
    -- stale/duplicate completion: row already terminal, or reclaimed by another
    -- worker (lease token mismatch). No-op, audited, never fatal.
    perform hermes_os._agent_action_audit(null,null,null,null,null,
      'COMPLETE_IGNORED', jsonb_build_object('id', p_id, 'attempted_status', p_status,
        'execution_id', p_execution_id, 'reason', 'not RUNNING or lease token mismatch'));
    return;
  end if;
  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
    v_row.correlation_id, p_status, jsonb_build_object('execution_id', p_execution_id));
end;
$function$;

revoke all on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text,uuid) from public;
grant execute on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text,uuid) to service_role;
grant execute on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text,uuid) to postgres;

-- Fix B.2 — dead-letter reaper. Additive; dormant until called. The bounded
-- driver calls this each tick BEFORE claim; it parks RUNNING rows whose lease
-- expired AND whose attempts reached the cap as terminal FAILED (no infinite
-- reclaim). Action-scoped, skip-locked, bounded batch.
create or replace function hermes_os.reap_dead_letter_agent_actions(p_action_key text, p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_row hermes_os.agent_action_requests%rowtype; v_n integer := 0;
begin
  for v_row in
    select * from hermes_os.agent_action_requests
    where action_key = p_action_key
      and status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now()
      and attempts >= max_attempts
    order by created_at
    for update skip locked
    limit greatest(p_limit, 1)
  loop
    update hermes_os.agent_action_requests
      set status='FAILED',
          error = jsonb_build_object('code','DEAD_LETTER','message','max attempts reached',
            'attempts', v_row.attempts, 'max_attempts', v_row.max_attempts),
          finished_at = now(), lease_expires_at = null, updated_at = now()
    where id = v_row.id;
    perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
      v_row.correlation_id, 'DEAD_LETTER', jsonb_build_object('attempts', v_row.attempts, 'max_attempts', v_row.max_attempts));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke all on function hermes_os.reap_dead_letter_agent_actions(text,integer) from public;
grant execute on function hermes_os.reap_dead_letter_agent_actions(text,integer) to service_role;
grant execute on function hermes_os.reap_dead_letter_agent_actions(text,integer) to postgres;

commit;
