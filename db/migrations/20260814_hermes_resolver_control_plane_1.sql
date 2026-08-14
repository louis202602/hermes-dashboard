-- Migration: hermes_resolver_control_plane (project smubxqorirlfldatzmym)
-- =====================================================================
-- E2.3 — operator CONTROL PLANE for the semantic resolver. DORMANT: this
-- migration ACTIVATES NOTHING. It adds the fail-closed machinery an operator
-- would use to enable/disable/reset/reap the resolver LATER, plus an audit
-- trail. After this migration the resolver stays enabled=false, circuit CLOSED.
--
--   1. resolver_operator_audit — append-only trace of operator actions.
--   2. resolver_enable_preflight(action_key) — FAIL-CLOSED readiness gate. Returns
--      ready=true only when EVERY safety condition holds (circuit CLOSED, a
--      hard-stop budget configured and not exceeded, sane batch/concurrency/cadence,
--      no parasite RUNNING lease, protected claim-exclusions present). Otherwise
--      ready=false + denied_reasons[]. Never trusts the UI.
--   3. resolver_apply_set_enabled / _circuit_reset / _reap — INTERNAL (service_role)
--      appliers. set_enabled(true) runs the preflight and REFUSES if not ready
--      (ACTIVATION_DENIED). circuit_reset sets CLOSED but leaves enabled=false
--      (reset != activation). reap is bounded + action-scoped (never touches the
--      protected head-of-line rows: they are QUEUED, not RUNNING, and claim-excluded).
--   4. public.resolver_operator_* — AUTHENTICATED, permission-gated ('resolver.operate')
--      operator RPCs the dashboard calls. REVOKE PUBLIC; GRANT authenticated. Every
--      call is audited. Fail-closed: no permission => UNAUTHORIZED, nothing happens.
--
-- The public enable RPC is HARD-WIRED to 'hermes.intent.resolve'. This migration
-- does NOT call it on the real resolver.
--
-- Reversible: ..._9_rollback.sql.
-- =====================================================================

begin;

-- 1. Operator audit trail (append-only; hermes_os internal; RLS on, no policy).
create table if not exists hermes_os.resolver_operator_audit (
  id          bigint generated always as identity primary key,
  event       text not null,
  actor       uuid,
  action_key  text not null default 'hermes.intent.resolve',
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
comment on table hermes_os.resolver_operator_audit is
  'Append-only trace of resolver operator actions (ENABLE_REQUEST/ENABLE_DENIED/ENABLED/DISABLED/CIRCUIT_RESET/REAPER_REQUEST/REAPER_RESULT). No PII, no secrets.';
alter table hermes_os.resolver_operator_audit enable row level security;
create index if not exists resolver_operator_audit_recent_idx
  on hermes_os.resolver_operator_audit (created_at desc);
revoke all on table hermes_os.resolver_operator_audit from public;

create or replace function hermes_os._resolver_operator_audit(
  p_event text, p_actor uuid, p_action_key text, p_detail jsonb)
returns void language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
begin
  insert into hermes_os.resolver_operator_audit(event, actor, action_key, detail)
  values (p_event, p_actor, coalesce(p_action_key,'hermes.intent.resolve'), coalesce(p_detail,'{}'::jsonb));
end $fn$;

-- ---------------------------------------------------------------------------
-- 2. FAIL-CLOSED enable preflight. ready=true only if all checks pass.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.resolver_enable_preflight(
  p_action_key text default 'hermes.intent.resolve')
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare
  v_cfg      hermes_os.resolver_runtime_config%rowtype;
  v_reasons  text[] := '{}';
  v_running  integer := 0;
  v_excl     integer := 0;
  v_prot     integer := 0;
  v_budget_ok boolean := false;
  v_day_key  text := to_char(now(),'YYYY-MM-DD');
  c_config boolean := false; c_circuit boolean := false; c_batch boolean := false;
  c_conc boolean := false; c_cadence boolean := false; c_running boolean := false;
  c_excl boolean := false; c_budget boolean := false;
begin
  select * into v_cfg from hermes_os.resolver_runtime_config where action_key = p_action_key;
  c_config := found;
  if not c_config then v_reasons := array_append(v_reasons,'NO_RUNTIME_CONFIG'); end if;

  c_circuit := coalesce(v_cfg.circuit_state,'OPEN') = 'CLOSED';
  if not c_circuit then v_reasons := array_append(v_reasons,'CIRCUIT_NOT_CLOSED'); end if;

  c_batch := coalesce(v_cfg.max_batch,0) between 1 and 50;
  if not c_batch then v_reasons := array_append(v_reasons,'MAX_BATCH_INVALID'); end if;

  c_conc := coalesce(v_cfg.max_concurrency,0) between 1 and 20;
  if not c_conc then v_reasons := array_append(v_reasons,'MAX_CONCURRENCY_INVALID'); end if;

  c_cadence := coalesce(v_cfg.cadence_seconds,0) between 10 and 3600;
  if not c_cadence then v_reasons := array_append(v_reasons,'CADENCE_INVALID'); end if;

  -- no parasite RUNNING (live lease) for this action
  select count(*) into v_running from hermes_os.agent_action_requests
   where action_key = p_action_key and status = 'RUNNING'
     and lease_expires_at is not null and lease_expires_at > now();
  c_running := v_running = 0;
  if not c_running then v_reasons := array_append(v_reasons,'RUNNING_PRESENT'); end if;

  -- protected claim-exclusions present: every currently-QUEUED row for this action
  -- must be claim-excluded (fail-closed: if there are QUEUED rows and any is not
  -- excluded, activation could process a protected row).
  select count(*) into v_prot from hermes_os.agent_action_requests
   where action_key = p_action_key and status = 'QUEUED';
  select count(*) into v_excl from hermes_os.agent_action_requests r
   where r.action_key = p_action_key and r.status = 'QUEUED'
     and exists (select 1 from hermes_os.agent_action_claim_exclusions x
                 where x.action_request_id = r.id and (x.expires_at is null or x.expires_at > now()));
  c_excl := (v_prot = v_excl);   -- all queued rows excluded (or none queued)
  if not c_excl then v_reasons := array_append(v_reasons,'PROTECTED_EXCLUSIONS_MISSING'); end if;

  -- a hard-stop budget must exist and not be exceeded today
  select exists (
    select 1 from hermes_os.sw23_tenant_budget_config b
    where b.hard_stop = true and b.daily_budget_usd is not null
      and b.daily_budget_usd > (
        select coalesce(sum(reserved_usd) filter (where status='reserved'),0)
             + coalesce(sum(actual_usd)   filter (where status='committed'),0)
        from hermes_os.sw23_budget_ledger l
        where l.tenant_id = b.tenant_id and l.period_type='day' and l.period_key = v_day_key
      )
  ) into v_budget_ok;
  c_budget := v_budget_ok;
  if not c_budget then v_reasons := array_append(v_reasons,'BUDGET_NOT_READY'); end if;

  return jsonb_build_object(
    'action_key', p_action_key,
    'ready', (array_length(v_reasons,1) is null),
    'denied_reasons', to_jsonb(v_reasons),
    'checks', jsonb_build_object(
      'config_exists', c_config, 'circuit_closed', c_circuit,
      'max_batch_valid', c_batch, 'max_concurrency_valid', c_conc, 'cadence_valid', c_cadence,
      'no_parasite_running', c_running, 'protected_exclusions_present', c_excl,
      'budget_ready', c_budget),
    'protected_exclusions_count', v_excl,
    'queued_count', v_prot,
    'running_count', v_running);
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. INTERNAL appliers (service_role). Never assume the caller is trusted UI.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.resolver_apply_set_enabled(
  p_action_key text, p_enabled boolean, p_actor uuid)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_pre jsonb; v_cfg hermes_os.resolver_runtime_config%rowtype;
begin
  if p_enabled then
    perform hermes_os._resolver_operator_audit('ENABLE_REQUEST', p_actor, p_action_key, '{}'::jsonb);
    v_pre := hermes_os.resolver_enable_preflight(p_action_key);
    if coalesce((v_pre->>'ready')::boolean, false) is not true then
      perform hermes_os._resolver_operator_audit('ENABLE_DENIED', p_actor, p_action_key,
        jsonb_build_object('denied_reasons', v_pre->'denied_reasons'));
      return jsonb_build_object('ok', false, 'status','ACTIVATION_DENIED', 'preflight', v_pre);
    end if;
    update hermes_os.resolver_runtime_config
       set enabled = true, updated_at = now(), updated_by = 'operator:'||coalesce(p_actor::text,'unknown')
     where action_key = p_action_key returning * into v_cfg;
    if not found then return jsonb_build_object('ok', false, 'status','NO_CONFIG'); end if;
    perform hermes_os._resolver_operator_audit('ENABLED', p_actor, p_action_key, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'status','ENABLED', 'enabled', v_cfg.enabled);
  else
    update hermes_os.resolver_runtime_config
       set enabled = false, updated_at = now(), updated_by = 'operator:'||coalesce(p_actor::text,'unknown')
     where action_key = p_action_key returning * into v_cfg;
    if not found then return jsonb_build_object('ok', false, 'status','NO_CONFIG'); end if;
    perform hermes_os._resolver_operator_audit('DISABLED', p_actor, p_action_key, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'status','DISABLED', 'enabled', v_cfg.enabled);
  end if;
end $fn$;

create or replace function hermes_os.resolver_apply_circuit_reset(
  p_action_key text, p_actor uuid)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_cfg hermes_os.resolver_runtime_config%rowtype;
begin
  -- reset circuit to CLOSED but NEVER touch enabled (reset != activation)
  update hermes_os.resolver_runtime_config
     set circuit_state='CLOSED', circuit_opened_at=null, circuit_reason=null,
         updated_at=now(), updated_by='operator_reset:'||coalesce(p_actor::text,'unknown')
   where action_key = p_action_key returning * into v_cfg;
  if not found then return jsonb_build_object('ok', false, 'status','NO_CONFIG'); end if;
  perform hermes_os._resolver_operator_audit('CIRCUIT_RESET', p_actor, p_action_key,
    jsonb_build_object('enabled_after', v_cfg.enabled));
  return jsonb_build_object('ok', true, 'circuit_state', v_cfg.circuit_state, 'enabled', v_cfg.enabled,
    'note','circuit re-armed; resolver stays disabled until explicit enable');
end $fn$;

create or replace function hermes_os.resolver_apply_reap(
  p_action_key text, p_limit integer, p_actor uuid)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_n integer; v_lim integer := least(greatest(coalesce(p_limit,50),1),200);
begin
  perform hermes_os._resolver_operator_audit('REAPER_REQUEST', p_actor, p_action_key,
    jsonb_build_object('limit', v_lim));
  -- bounded, action-scoped, skip-locked, idempotent. Only moves RUNNING+expired+
  -- attempts>=max to DEAD_LETTER. The protected head-of-line rows are QUEUED (not
  -- RUNNING) and claim-excluded => never touched.
  v_n := hermes_os.reap_dead_letter_agent_actions(p_action_key, v_lim);
  perform hermes_os._resolver_operator_audit('REAPER_RESULT', p_actor, p_action_key,
    jsonb_build_object('reaped', v_n));
  return jsonb_build_object('ok', true, 'reaped', v_n, 'limit', v_lim);
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. PUBLIC operator RPCs — authenticated + 'resolver.operate' permission.
--    Hard-wired to 'hermes.intent.resolve'. REVOKE PUBLIC; GRANT authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.resolver_operator_get_control()
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare
  v_uid uuid := auth.uid(); v_ak text := 'hermes.intent.resolve';
  v_authorized boolean := false; v_cfg hermes_os.resolver_runtime_config%rowtype;
  v_queue integer; v_running integer; v_pre jsonb; v_audit jsonb;
begin
  if v_uid is null then return jsonb_build_object('authorized', false, 'reason','UNAUTHENTICATED'); end if;
  select exists (select 1 from hermes_os.user_tenant_permissions
                 where user_id = v_uid and permission = 'resolver.operate') into v_authorized;
  select * into v_cfg from hermes_os.resolver_runtime_config where action_key = v_ak;
  select count(*) into v_queue from hermes_os.agent_action_requests where action_key=v_ak and status='QUEUED';
  select count(*) into v_running from hermes_os.agent_action_requests
    where action_key=v_ak and status='RUNNING' and lease_expires_at is not null and lease_expires_at > now();
  v_pre := hermes_os.resolver_enable_preflight(v_ak);
  if v_authorized then
    select coalesce(jsonb_agg(jsonb_build_object('event',event,'at',created_at,'detail',detail) order by created_at desc), '[]'::jsonb)
      into v_audit from (
        select event, created_at, detail from hermes_os.resolver_operator_audit
        where action_key = v_ak order by created_at desc limit 10) t;
  else
    v_audit := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'authorized', v_authorized,
    'action_key', v_ak,
    'enabled', coalesce(v_cfg.enabled,false),
    'circuit_state', coalesce(v_cfg.circuit_state,'CLOSED'),
    'circuit_reason', v_cfg.circuit_reason,
    'max_batch', v_cfg.max_batch, 'max_concurrency', v_cfg.max_concurrency,
    'cadence_seconds', v_cfg.cadence_seconds,
    'queue_depth', coalesce(v_queue,0), 'running_count', coalesce(v_running,0),
    'protected_exclusions_count', v_pre->'protected_exclusions_count',
    'preflight', v_pre,
    'recent_audit', v_audit);
end $fn$;

create or replace function public.resolver_operator_enable()
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_ak text := 'hermes.intent.resolve';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'status','UNAUTHENTICATED'); end if;
  if not exists (select 1 from hermes_os.user_tenant_permissions
                 where user_id=v_uid and permission='resolver.operate') then
    perform hermes_os._resolver_operator_audit('ENABLE_DENIED', v_uid, v_ak, jsonb_build_object('reason','UNAUTHORIZED'));
    return jsonb_build_object('ok', false, 'status','UNAUTHORIZED');
  end if;
  return hermes_os.resolver_apply_set_enabled(v_ak, true, v_uid);
end $fn$;

create or replace function public.resolver_operator_disable()
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_ak text := 'hermes.intent.resolve';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'status','UNAUTHENTICATED'); end if;
  if not exists (select 1 from hermes_os.user_tenant_permissions
                 where user_id=v_uid and permission='resolver.operate') then
    return jsonb_build_object('ok', false, 'status','UNAUTHORIZED');
  end if;
  return hermes_os.resolver_apply_set_enabled(v_ak, false, v_uid);
end $fn$;

create or replace function public.resolver_operator_reset_circuit()
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_ak text := 'hermes.intent.resolve';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'status','UNAUTHENTICATED'); end if;
  if not exists (select 1 from hermes_os.user_tenant_permissions
                 where user_id=v_uid and permission='resolver.operate') then
    return jsonb_build_object('ok', false, 'status','UNAUTHORIZED');
  end if;
  return hermes_os.resolver_apply_circuit_reset(v_ak, v_uid);
end $fn$;

create or replace function public.resolver_operator_reap(p_limit integer default 50)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $fn$
declare v_uid uuid := auth.uid(); v_ak text := 'hermes.intent.resolve';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'status','UNAUTHENTICATED'); end if;
  if not exists (select 1 from hermes_os.user_tenant_permissions
                 where user_id=v_uid and permission='resolver.operate') then
    return jsonb_build_object('ok', false, 'status','UNAUTHORIZED');
  end if;
  return hermes_os.resolver_apply_reap(v_ak, p_limit, v_uid);
end $fn$;

-- grants: internal appliers = service_role only; public operator RPCs = authenticated.
revoke all on function hermes_os.resolver_enable_preflight(text) from public;
revoke all on function hermes_os.resolver_apply_set_enabled(text,boolean,uuid) from public;
revoke all on function hermes_os.resolver_apply_circuit_reset(text,uuid) from public;
revoke all on function hermes_os.resolver_apply_reap(text,integer,uuid) from public;
grant execute on function hermes_os.resolver_enable_preflight(text) to service_role;
grant execute on function hermes_os.resolver_apply_set_enabled(text,boolean,uuid) to service_role;
grant execute on function hermes_os.resolver_apply_circuit_reset(text,uuid) to service_role;
grant execute on function hermes_os.resolver_apply_reap(text,integer,uuid) to service_role;

revoke all on function public.resolver_operator_get_control() from public;
revoke all on function public.resolver_operator_enable() from public;
revoke all on function public.resolver_operator_disable() from public;
revoke all on function public.resolver_operator_reset_circuit() from public;
revoke all on function public.resolver_operator_reap(integer) from public;
grant execute on function public.resolver_operator_get_control() to authenticated;
grant execute on function public.resolver_operator_enable() to authenticated;
grant execute on function public.resolver_operator_disable() to authenticated;
grant execute on function public.resolver_operator_reset_circuit() to authenticated;
grant execute on function public.resolver_operator_reap(integer) to authenticated;

commit;
