-- Migration: hermes_cost_governance_snapshot (project smubxqorirlfldatzmym)
-- =====================================================================
-- Canonical, READ-ONLY tenant cost/budget/quota snapshot for the dashboard.
-- This does NOT create a second cost engine: the SW23 write-side already exists
-- (sw23_route_and_reserve / sw23_reserve_budget / sw23_commit_budget /
-- sw23_release_budget, sw9_quota_check_and_increment). This migration only adds
-- a tenant-scoped reader over the REAL SW23/SW9 tables, plus a pure limit-state
-- helper. Fail-closed. SECURITY DEFINER, search_path locked, granted to
-- `authenticated` only.
--
-- Provenance (never fabricated):
--   budget            REAL from sw23_tenant_budget_config, or NOT_CONFIGURED when
--                     the tenant has no budget row (no invented budget).
--   period exposure   REAL from sw23_budget_ledger (reserved + committed), using
--                     the SAME basis the reserve function enforces against
--                     (SUM(reserved_usd) where status in reserved|committed).
--   committed_actual  REAL committed actual_usd (may be null until committed).
--   cost_events       REAL from sw19_cost_events, or UNAVAILABLE when empty
--                     (per-request cost is not yet emitted in this project).
--   quota usage       REAL from sw9_quota_counters (recorded provider-call
--                     counters — includes dev/test providers; cost may be ~0).
--   quota blocks      REAL from sw9_quota_block_log (QUOTA_EXCEEDED/RATE_LIMITED).
--   models            REAL from sw23_model_catalog, carrying each row's own
--                     cost_status (real/unknown) — pricing is not re-invented.
--   phone_minutes /   NOT stored in this project -> reported UNAVAILABLE, never
--   voice_cost        fabricated (browser Web Speech emits no usable metric).
-- No secrets / payloads / internal ids exposed.
--
-- Limit-behaviour rule (documented, enforced by the write engine — this reader
-- only reports): a financial quota may BLOCK non-critical actions at HARD_LIMIT
-- (hard_stop = true). Critical / safety actions must not be broken by a mere
-- budget quota; the reader surfaces SOFT_LIMIT for them instead so operations
-- are never silently degraded by cost alone. hard_stop is a per-tenant config.
-- =====================================================================

-- Pure, immutable helper: map exposure vs budget to a canonical limit state.
-- Uses the tenant's own alert_threshold_pct (no hard-coded 80/90/100). When no
-- budget is configured the state is NORMAL (spend is unmetered, not "over").
create or replace function public.sw_cost_limit_state(
  p_exposure_usd numeric,
  p_budget_usd numeric,
  p_alert_threshold_pct numeric,
  p_hard_stop boolean
)
returns text
language sql
immutable
as $function$
  select case
    when p_budget_usd is null or p_budget_usd <= 0 then 'NORMAL'
    when coalesce(p_exposure_usd,0) >= p_budget_usd and coalesce(p_hard_stop,false) then 'HARD_LIMIT'
    when coalesce(p_exposure_usd,0) >= p_budget_usd then 'SOFT_LIMIT'
    when coalesce(p_exposure_usd,0) >= p_budget_usd * coalesce(p_alert_threshold_pct,80) / 100.0 then 'WARNING'
    else 'NORMAL'
  end;
$function$;

create or replace function public.get_cost_governance_snapshot(p_limit integer default 8)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_limit int;
  v_day_key text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_month_key text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  -- budget config
  v_daily numeric; v_monthly numeric; v_per_req numeric; v_alert numeric; v_hard boolean; v_has_budget boolean;
  -- ledger exposure
  v_day_exp numeric; v_day_committed numeric; v_month_exp numeric; v_month_committed numeric;
  v_day_state text; v_month_state text; v_overall text;
  -- cost events
  v_ce_count int; v_ce_total numeric; v_ce_by jsonb;
  -- quota
  v_q_calls bigint; v_q_cost numeric; v_q_by jsonb; v_q_blocks jsonb; v_day_blocks int;
  -- models
  v_models jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  v_limit := least(greatest(coalesce(p_limit,8),1),25);

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;

  if v_status is distinct from 'OK' then
    -- No tenant resolved: return the resolution outcome, no cross-tenant data.
    return jsonb_build_object(
      'resolution_status', coalesce(v_status,'NO_TENANT'),
      'tenant_id', v_tenant
    );
  end if;

  -- Budget config (REAL or NOT_CONFIGURED).
  select daily_budget_usd, monthly_budget_usd, per_request_budget_usd,
         alert_threshold_pct, hard_stop
    into v_daily, v_monthly, v_per_req, v_alert, v_hard
    from hermes_os.sw23_tenant_budget_config where tenant_id = v_tenant;
  v_has_budget := found;

  -- Ledger exposure for the current day / month (engine-consistent basis).
  select coalesce(sum(reserved_usd) filter (where status in ('reserved','committed')),0),
         coalesce(sum(actual_usd) filter (where status = 'committed'),0)
    into v_day_exp, v_day_committed
    from hermes_os.sw23_budget_ledger
    where tenant_id = v_tenant and period_type = 'day' and period_key = v_day_key;

  select coalesce(sum(reserved_usd) filter (where status in ('reserved','committed')),0),
         coalesce(sum(actual_usd) filter (where status = 'committed'),0)
    into v_month_exp, v_month_committed
    from hermes_os.sw23_budget_ledger
    where tenant_id = v_tenant and period_type = 'month' and period_key = v_month_key;

  v_day_state := public.sw_cost_limit_state(v_day_exp, v_daily, v_alert, v_hard);
  v_month_state := public.sw_cost_limit_state(v_month_exp, v_monthly, v_alert, v_hard);

  -- Cost events (REAL per-request cost) — UNAVAILABLE when none recorded.
  select count(*), coalesce(sum(total_cost),0) into v_ce_count, v_ce_total
    from hermes_os.sw19_cost_events where tenant_id = v_tenant;
  select coalesce(jsonb_agg(x order by (x->>'total_usd')::numeric desc), '[]'::jsonb) into v_ce_by
    from (
      select jsonb_build_object(
               'provider', provider, 'model_or_service', model_or_service,
               'total_usd', round(sum(total_cost)::numeric, 6),
               'requests', count(*),
               'measurement_status', min(measurement_status)
             ) x
        from hermes_os.sw19_cost_events where tenant_id = v_tenant
        group by provider, model_or_service
    ) s;

  -- Quota usage (REAL recorded provider-call counters).
  select coalesce(sum(call_count),0), coalesce(sum(cost_accumulated),0)
    into v_q_calls, v_q_cost
    from hermes_os.sw9_quota_counters where tenant_id = v_tenant;

  select coalesce(jsonb_agg(x order by (x->>'calls')::bigint desc), '[]'::jsonb) into v_q_by
    from (
      select jsonb_build_object(
               'provider', provider, 'service', service,
               'calls', sum(call_count),
               'cost_accumulated', round(sum(cost_accumulated)::numeric, 6)
             ) x
        from hermes_os.sw9_quota_counters where tenant_id = v_tenant
        group by provider, service
        order by sum(call_count) desc
        limit v_limit
    ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', provider, 'service', service, 'reason', reason,
           'call_count_at_block', call_count_at_block, 'blocked_at', blocked_at
         ) order by blocked_at desc), '[]'::jsonb)
    into v_q_blocks
    from (select * from hermes_os.sw9_quota_block_log
            where tenant_id = v_tenant order by blocked_at desc limit v_limit) b;

  select count(*) into v_day_blocks
    from hermes_os.sw9_quota_block_log
    where tenant_id = v_tenant and blocked_at >= (now() at time zone 'UTC')::date;

  -- Model catalog (REAL pricing reference, each row carries its own cost_status).
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', provider, 'model_id', model_id, 'enabled', enabled,
           'input_cost', input_cost, 'output_cost', output_cost,
           'currency', currency, 'pricing_unit', pricing_unit,
           'cost_status', cost_status
         ) order by enabled desc, provider, model_id), '[]'::jsonb)
    into v_models
    from hermes_os.sw23_model_catalog
    where tenant_scope is null or tenant_scope = v_tenant;

  -- Overall governance state: worst of day/month, escalated to BLOCKED when the
  -- tenant has real quota blocks today.
  v_overall := (select case
      when v_day_blocks > 0 then 'BLOCKED'
      when 'HARD_LIMIT' in (v_day_state, v_month_state) then 'HARD_LIMIT'
      when 'SOFT_LIMIT' in (v_day_state, v_month_state) then 'SOFT_LIMIT'
      when 'WARNING' in (v_day_state, v_month_state) then 'WARNING'
      else 'NORMAL' end);

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_tenant,
    'as_of', now(),
    'governance_state', v_overall,
    'budget', case when v_has_budget then jsonb_build_object(
        'provenance','REAL',
        'daily_budget_usd', v_daily, 'monthly_budget_usd', v_monthly,
        'per_request_budget_usd', v_per_req,
        'alert_threshold_pct', v_alert, 'hard_stop', v_hard
      ) else jsonb_build_object('provenance','NOT_CONFIGURED') end,
    'period', jsonb_build_object(
      'day', jsonb_build_object(
        'period_key', v_day_key,
        'exposure_usd', round(v_day_exp,6), 'committed_actual_usd', round(v_day_committed,6),
        'budget_usd', v_daily,
        'remaining_usd', case when v_daily is not null then round(v_daily - v_day_exp,6) else null end,
        'usage_ratio', case when v_daily is not null and v_daily > 0 then round((v_day_exp / v_daily)::numeric,4) else null end,
        'limit_state', v_day_state,
        'provenance', case when v_daily is not null then 'REAL' else 'NOT_CONFIGURED' end
      ),
      'month', jsonb_build_object(
        'period_key', v_month_key,
        'exposure_usd', round(v_month_exp,6), 'committed_actual_usd', round(v_month_committed,6),
        'budget_usd', v_monthly,
        'remaining_usd', case when v_monthly is not null then round(v_monthly - v_month_exp,6) else null end,
        'usage_ratio', case when v_monthly is not null and v_monthly > 0 then round((v_month_exp / v_monthly)::numeric,4) else null end,
        'limit_state', v_month_state,
        'provenance', case when v_monthly is not null then 'REAL' else 'NOT_CONFIGURED' end
      )
    ),
    'cost_events', case when v_ce_count > 0 then jsonb_build_object(
        'provenance','REAL', 'requests', v_ce_count,
        'total_usd', round(v_ce_total,6), 'by_provider', v_ce_by
      ) else jsonb_build_object('provenance','UNAVAILABLE') end,
    'quota', jsonb_build_object(
      'provenance','REAL',
      'total_calls', v_q_calls,
      'total_cost_accumulated', round(v_q_cost,6),
      'blocks_today', v_day_blocks,
      'by_provider', v_q_by,
      'recent_blocks', v_q_blocks
    ),
    'models', v_models,
    'unavailable', to_jsonb(array_remove(array[
      case when v_ce_count = 0 then 'per_request_cost_events' end,
      'phone_minutes_cost',
      'voice_web_speech_cost'
    ]::text[], null))
  );
end;
$function$;

revoke all on function public.sw_cost_limit_state(numeric, numeric, numeric, boolean) from public;
grant execute on function public.sw_cost_limit_state(numeric, numeric, numeric, boolean) to authenticated;
revoke all on function public.get_cost_governance_snapshot(integer) from public;
grant execute on function public.get_cost_governance_snapshot(integer) to authenticated;
