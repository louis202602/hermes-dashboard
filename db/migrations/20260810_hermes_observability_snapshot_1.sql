-- Migration: hermes_observability_snapshot (project smubxqorirlfldatzmym)
-- =====================================================================
-- Real observability snapshot for the dashboard SystemStatus panel. REAL
-- platform aggregates + non-identifying execution telemetry, plus tenant-scoped
-- gateway activity and quality incidents. Fail-closed. SECURITY DEFINER,
-- search_path locked, granted to `authenticated` only.
--
-- Provenance:
--   platform.*             REAL (component_registry + execution_logs aggregates)
--   platform.median_latency REAL — MEDIAN of measured latency_ms (robust; a raw
--                          mean is intentionally NOT used, it is skewed by a few
--                          multi-hour outliers in the telemetry).
--   executions[]           REAL platform telemetry — NO tenant_id / user_id /
--                          payload / scores / cost exposed (non-identifying).
--   gateway[] / incidents[] REAL, caller's tenant only.
--   heartbeat / SLA / uptime  NOT stored -> the frontend shows UNAVAILABLE
--                          ("Non mesuré"); never fabricated.
-- No secrets / payloads / stack traces / internal ids exposed.
-- =====================================================================
create or replace function public.get_observability_snapshot(p_limit integer default 6)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_limit int;
  v_reg int; v_active int; v_total int; v_degraded int; v_withlat int; v_medlat int; v_last timestamptz;
  v_by_status jsonb; v_exec jsonb; v_gw jsonb; v_inc jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  v_limit := least(greatest(coalesce(p_limit,6),1),20);

  select count(*), count(*) filter (where n8n_active) into v_reg, v_active from hermes_os.component_registry;
  select count(*), count(*) filter (where degraded), count(*) filter (where latency_ms is not null),
         percentile_cont(0.5) within group (order by latency_ms)::int, max(created_at)
    into v_total, v_degraded, v_withlat, v_medlat, v_last
    from hermes_os.execution_logs;
  select coalesce(jsonb_object_agg(execution_status, c), '{}'::jsonb) into v_by_status
    from (select execution_status, count(*) c from hermes_os.execution_logs group by execution_status) s;

  -- Recent executions: platform telemetry, NO tenant/user/payload identifiers.
  select coalesce(jsonb_agg(jsonb_build_object(
      'domain', e.domain, 'status', e.execution_status,
      'latency_ms', e.latency_ms, 'degraded', e.degraded,
      'finished_at', coalesce(e.execution_finished_at, e.created_at)
    ) order by coalesce(e.execution_finished_at, e.created_at) desc), '[]'::jsonb)
    into v_exec
    from (select * from hermes_os.execution_logs order by coalesce(execution_finished_at, created_at) desc limit v_limit) e;

  -- Tenant-scoped detail (empty unless tenant resolves OK).
  select r.tenant_id, r.resolution_status into v_tenant, v_status from hermes_os.resolve_active_tenant(null) r;
  if v_status = 'OK' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'action_key', r.action_key, 'status', r.status,
        'policy_decision', r.policy_decision, 'error_code', r.error->>'code',
        'created_at', r.created_at
      ) order by r.created_at desc), '[]'::jsonb)
      into v_gw
      from (select * from hermes_os.agent_action_requests
            where tenant_id = v_tenant and action_key <> 'hermes.intent.resolve'
            order by created_at desc limit v_limit) r;

    select coalesce(jsonb_agg(jsonb_build_object(
        'type', i.type_incident, 'severity', i.severity, 'status', i.status,
        'chantier', ch.chantier_name, 'created_at', i.created_at, 'resolved_at', i.resolved_at
      ) order by i.created_at desc), '[]'::jsonb)
      into v_inc
      from (select * from hermes_os.btp_incidents_qualite where tenant_id = v_tenant order by created_at desc limit v_limit) i
      left join hermes_os.btp_chantiers ch on ch.id = i.chantier_id;
  else
    v_gw := '[]'::jsonb; v_inc := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_resolution', v_status,
    'tenant_id', case when v_status='OK' then v_tenant else null end,
    'platform', jsonb_build_object(
      'components_registered', coalesce(v_reg,0),
      'components_active', coalesce(v_active,0),
      'executions_total', coalesce(v_total,0),
      'executions_degraded', coalesce(v_degraded,0),
      'executions_with_latency', coalesce(v_withlat,0),
      'median_latency_ms', v_medlat,
      'last_execution_at', v_last,
      'by_status', v_by_status
    ),
    'executions', coalesce(v_exec,'[]'::jsonb),
    'gateway', coalesce(v_gw,'[]'::jsonb),
    'incidents', coalesce(v_inc,'[]'::jsonb)
  );
end;
$function$;
revoke all on function public.get_observability_snapshot(integer) from public;
grant execute on function public.get_observability_snapshot(integer) to authenticated;
