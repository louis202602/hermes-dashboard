-- Migration: hermes_resolver_observability (project smubxqorirlfldatzmym)
-- =====================================================================
-- E2.2 — operational safety for the (still INACTIVE) Semantic Resolver:
-- observability metrics, a canonical circuit breaker, and a bounded dead-letter
-- reaper wrapper. DORMANT: activates nothing, changes no resolver runtime state
-- (kill-switch stays OFF, circuit stays CLOSED), touches no real QUEUED row.
--
--   1. resolver_runtime_config gains circuit-breaker columns (state + thresholds).
--      The circuit acts on the SAME canonical control as the kill-switch: when it
--      trips it sets `enabled=false` — it is NOT a second, contradictory switch.
--   2. public.get_resolver_observability() — TENANT-SCOPED, read-only metrics with
--      honest REAL / DERIVED / UNAVAILABLE provenance (no fabricated numbers).
--   3. hermes_os.resolver_circuit_evaluate() — PLATFORM-level breaker: trips the
--      kill-switch off + records OPEN when recent failure/dead-letter thresholds
--      are exceeded. Runs only when called (no auto worker in E2.2).
--   4. hermes_os.resolver_circuit_reset() — MANUAL operator re-arm: CLOSED again
--      but `enabled` stays false (reset ≠ activation).
--   5. hermes_os.reap_resolver_dead_letters() — thin, action-scoped wrapper over
--      the existing reap_dead_letter_agent_actions (no second dead-letter system).
--
-- Reversible: ..._9_rollback.sql.
-- =====================================================================

begin;

-- 1. Circuit-breaker columns on the canonical runtime config (conservative).
alter table hermes_os.resolver_runtime_config
  add column if not exists circuit_state            text not null default 'CLOSED'
    check (circuit_state in ('CLOSED', 'OPEN')),
  add column if not exists circuit_opened_at        timestamptz,
  add column if not exists circuit_reason           text,
  add column if not exists circuit_error_threshold      integer not null default 5
    check (circuit_error_threshold between 1 and 1000),
  add column if not exists circuit_deadletter_threshold integer not null default 3
    check (circuit_deadletter_threshold between 1 and 1000),
  add column if not exists circuit_window_minutes       integer not null default 15
    check (circuit_window_minutes between 1 and 1440);

-- ---------------------------------------------------------------------------
-- 2. Tenant-scoped resolver observability. Metrics (queue/running/failed/cost)
--    are the CALLER'S TENANT only (via resolve_active_tenant — never a client id).
--    The runtime/circuit config is platform-level and shown read-only. Every
--    section carries an honest provenance; latencies/error-rate are UNAVAILABLE
--    when there is no completed data rather than invented.
-- ---------------------------------------------------------------------------
create or replace function public.get_resolver_observability()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant text;
  v_status text;
  v_ak     text := 'hermes.intent.resolve';
  v_cfg    hermes_os.resolver_runtime_config%rowtype;
  v_win    interval := interval '24 hours';
  v_queue  integer; v_oldest numeric; v_running integer;
  v_succ integer; v_failed integer; v_dead integer; v_completed integer;
  v_err numeric;
  v_q_lat numeric; v_x_lat numeric; v_e2e_lat numeric;
  v_attempts jsonb;
  v_day_key text := to_char(now(),'YYYY-MM-DD');
  v_mon_key text := to_char(now(),'YYYY-MM');
  v_day_spend numeric; v_mon_spend numeric;
  v_budget hermes_os.sw23_tenant_budget_config%rowtype;
  v_state text;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'), 'tenant_id', v_tenant);
  end if;

  select * into v_cfg from hermes_os.resolver_runtime_config where action_key = v_ak;

  -- Queue / running (point-in-time, tenant-scoped).
  select count(*), extract(epoch from (now() - min(created_at)))::numeric
    into v_queue, v_oldest
    from hermes_os.agent_action_requests
   where tenant_id = v_tenant and action_key = v_ak and status = 'QUEUED';
  select count(*) into v_running
    from hermes_os.agent_action_requests
   where tenant_id = v_tenant and action_key = v_ak and status = 'RUNNING'
     and lease_expires_at is not null and lease_expires_at > now();

  -- Outcomes over the last 24h (tenant-scoped).
  select
    count(*) filter (where status in ('SUCCEEDED','SUCCESS','DONE')),
    count(*) filter (where status = 'FAILED'),
    count(*) filter (where status = 'FAILED' and error->>'code' = 'DEAD_LETTER')
    into v_succ, v_failed, v_dead
    from hermes_os.agent_action_requests
   where tenant_id = v_tenant and action_key = v_ak
     and finished_at is not null and finished_at > now() - v_win;
  v_completed := coalesce(v_succ,0) + coalesce(v_failed,0);
  v_err := case when v_completed > 0 then round(v_failed::numeric / v_completed, 4) else null end;

  -- Latencies (median seconds) over completed rows with real timestamps.
  select
    percentile_cont(0.5) within group (order by extract(epoch from (started_at - created_at)))
      filter (where started_at is not null),
    percentile_cont(0.5) within group (order by extract(epoch from (finished_at - started_at)))
      filter (where started_at is not null and finished_at is not null),
    percentile_cont(0.5) within group (order by extract(epoch from (finished_at - created_at)))
      filter (where finished_at is not null)
    into v_q_lat, v_x_lat, v_e2e_lat
    from hermes_os.agent_action_requests
   where tenant_id = v_tenant and action_key = v_ak
     and finished_at is not null and finished_at > now() - v_win;

  -- Attempts distribution (tenant-scoped, current non-terminal + recent).
  select coalesce(jsonb_object_agg(attempts::text, c), '{}'::jsonb) into v_attempts
    from (
      select attempts, count(*) c
        from hermes_os.agent_action_requests
       where tenant_id = v_tenant and action_key = v_ak
         and (status in ('QUEUED','RUNNING') or (finished_at is not null and finished_at > now() - v_win))
       group by attempts
    ) a;

  -- SW23 cost (tenant-scoped; canonical ledger). Exposure = reserved + committed.
  select coalesce(sum(reserved_usd) filter (where status = 'reserved'),0)
       + coalesce(sum(actual_usd)   filter (where status = 'committed'),0)
    into v_day_spend
    from hermes_os.sw23_budget_ledger
   where tenant_id = v_tenant and period_type = 'day' and period_key = v_day_key;
  select coalesce(sum(reserved_usd) filter (where status = 'reserved'),0)
       + coalesce(sum(actual_usd)   filter (where status = 'committed'),0)
    into v_mon_spend
    from hermes_os.sw23_budget_ledger
   where tenant_id = v_tenant and period_type = 'day' and period_key like v_mon_key || '%';
  select * into v_budget from hermes_os.sw23_tenant_budget_config where tenant_id = v_tenant;

  -- Derived resolver state (config-level, read-only).
  v_state := case
    when v_cfg.action_key is null then 'NOT_CONFIGURED'
    when v_cfg.circuit_state = 'OPEN' then 'CIRCUIT_OPEN'
    when v_cfg.enabled then 'READY'
    else 'DISABLED'
  end;

  return jsonb_build_object(
    'resolution_status','OK',
    'tenant_id', v_tenant,
    'as_of', now(),
    'resolver_state', v_state,
    'control', jsonb_build_object(
      'enabled', coalesce(v_cfg.enabled,false),
      'circuit_state', coalesce(v_cfg.circuit_state,'CLOSED'),
      'circuit_opened_at', v_cfg.circuit_opened_at,
      'circuit_reason', v_cfg.circuit_reason,
      'max_batch', v_cfg.max_batch,
      'max_concurrency', v_cfg.max_concurrency,
      'cadence_seconds', v_cfg.cadence_seconds,
      'provenance','REAL'),
    'queue', jsonb_build_object(
      'queue_depth', coalesce(v_queue,0),
      'oldest_queued_age_seconds', v_oldest,
      'running_count', coalesce(v_running,0),
      'provenance','REAL'),
    'outcomes', jsonb_build_object(
      'window_hours', 24,
      'success_count', coalesce(v_succ,0),
      'failed_count', coalesce(v_failed,0),
      'dead_letter_count', coalesce(v_dead,0),
      'completed_count', v_completed,
      'error_rate', v_err,
      'attempts_distribution', v_attempts,
      'provenance', case when v_completed > 0 then 'REAL' else 'UNAVAILABLE' end),
    'latency', jsonb_build_object(
      'queue_latency_s_median', v_q_lat,
      'execution_latency_s_median', v_x_lat,
      'e2e_latency_s_median', v_e2e_lat,
      'provenance', case when v_e2e_lat is not null then 'REAL' else 'UNAVAILABLE' end),
    'cost', jsonb_build_object(
      'day_spend_usd', round(coalesce(v_day_spend,0),6),
      'month_spend_usd', round(coalesce(v_mon_spend,0),6),
      'daily_budget_usd', v_budget.daily_budget_usd,
      'monthly_budget_usd', v_budget.monthly_budget_usd,
      'daily_remaining_usd', case when v_budget.daily_budget_usd is not null
        then round(v_budget.daily_budget_usd - coalesce(v_day_spend,0),6) else null end,
      'monthly_remaining_usd', case when v_budget.monthly_budget_usd is not null
        then round(v_budget.monthly_budget_usd - coalesce(v_mon_spend,0),6) else null end,
      'hard_stop', v_budget.hard_stop,
      'provenance', case when v_budget.tenant_id is not null then 'REAL' else 'NOT_CONFIGURED' end,
      'month_provenance','DERIVED'))
  ;
end;
$function$;

revoke all on function public.get_resolver_observability() from public;
grant execute on function public.get_resolver_observability() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Circuit breaker (PLATFORM-level, action-scoped). Trips the canonical
--    kill-switch OFF and records OPEN when recent failures or dead-letters cross
--    the configured thresholds. Fail-closed: on trip the resolver is disabled.
--    Runs only when called (no auto worker in E2.2). service_role only.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.resolver_circuit_evaluate(
  p_action_key text default 'hermes.intent.resolve'
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cfg    hermes_os.resolver_runtime_config%rowtype;
  v_failed integer; v_dead integer;
  v_trip   boolean;
  v_reason text;
begin
  select * into v_cfg from hermes_os.resolver_runtime_config where action_key = p_action_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_CONFIG');
  end if;

  select count(*) filter (where error->>'code' is distinct from 'DEAD_LETTER'),
         count(*) filter (where error->>'code' = 'DEAD_LETTER')
    into v_failed, v_dead
    from hermes_os.agent_action_requests
   where action_key = p_action_key and status = 'FAILED'
     and finished_at is not null
     and finished_at > now() - make_interval(mins => v_cfg.circuit_window_minutes);

  v_trip := coalesce(v_failed,0) >= v_cfg.circuit_error_threshold
         or coalesce(v_dead,0)  >= v_cfg.circuit_deadletter_threshold;

  if v_trip and v_cfg.circuit_state <> 'OPEN' then
    v_reason := format('failed=%s (thr %s), dead_letter=%s (thr %s) in %s min',
      v_failed, v_cfg.circuit_error_threshold, v_dead, v_cfg.circuit_deadletter_threshold,
      v_cfg.circuit_window_minutes);
    update hermes_os.resolver_runtime_config
       set enabled = false, circuit_state = 'OPEN', circuit_opened_at = now(),
           circuit_reason = v_reason, updated_at = now(), updated_by = 'circuit_breaker'
     where action_key = p_action_key;
  end if;

  return jsonb_build_object(
    'ok', true, 'action_key', p_action_key,
    'window_minutes', v_cfg.circuit_window_minutes,
    'failed', coalesce(v_failed,0), 'dead_letter', coalesce(v_dead,0),
    'error_threshold', v_cfg.circuit_error_threshold,
    'dead_letter_threshold', v_cfg.circuit_deadletter_threshold,
    'tripped', v_trip,
    'circuit_state', case when v_trip then 'OPEN' else v_cfg.circuit_state end,
    'enabled', case when v_trip then false else v_cfg.enabled end);
end;
$function$;

revoke all on function hermes_os.resolver_circuit_evaluate(text) from public;
grant execute on function hermes_os.resolver_circuit_evaluate(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Manual circuit re-arm. Sets CLOSED again but DELIBERATELY leaves `enabled`
--    false — re-arming the breaker is NOT re-activating the resolver (that stays
--    an explicit, separate operator action). service_role only.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.resolver_circuit_reset(
  p_action_key text default 'hermes.intent.resolve'
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_cfg hermes_os.resolver_runtime_config%rowtype;
begin
  update hermes_os.resolver_runtime_config
     set circuit_state = 'CLOSED', circuit_opened_at = null, circuit_reason = null,
         updated_at = now(), updated_by = 'operator_reset'
   where action_key = p_action_key
   returning * into v_cfg;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_CONFIG');
  end if;
  return jsonb_build_object('ok', true, 'action_key', p_action_key,
    'circuit_state', v_cfg.circuit_state, 'enabled', v_cfg.enabled,
    'note', 'circuit re-armed; resolver remains disabled until explicit activation');
end;
$function$;

revoke all on function hermes_os.resolver_circuit_reset(text) from public;
grant execute on function hermes_os.resolver_circuit_reset(text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Reaper wrapper — reuse the existing bounded, skip-locked, idempotent
--    reap_dead_letter_agent_actions for the resolver action. No second
--    dead-letter system. service_role only. Not scheduled in E2.2.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.reap_resolver_dead_letters(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  return hermes_os.reap_dead_letter_agent_actions(
    'hermes.intent.resolve', least(greatest(coalesce(p_limit, 50), 1), 500));
end;
$function$;

revoke all on function hermes_os.reap_resolver_dead_letters(integer) from public;
grant execute on function hermes_os.reap_resolver_dead_letters(integer) to service_role;

commit;
