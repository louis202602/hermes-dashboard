-- Migration: hermes_dashboard_panel_readers (project smubxqorirlfldatzmym)
-- =====================================================================
-- Removes the last dashboard mocks by giving the QuickActions, Tasks and
-- SystemStatus panels REAL, read-only sources. All SECURITY DEFINER,
-- search_path locked, fail-closed, granted to `authenticated` only (unreachable
-- by `anon` / `service_role`). No secrets / internal ids exposed.
-- =====================================================================

-- (1) QuickActions: the capabilities the caller is actually permitted to run.
--     Source of truth = agent_action_catalog ⋈ user_tenant_permissions. A member
--     without a permission never sees that capability; unknown actions can't appear.
create or replace function public.get_available_capabilities()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_caps jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED','tenant_id',null,'capabilities','[]'::jsonb);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status',v_status,'tenant_id',null,'capabilities','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'action_key', c.action_key,
      'display_name', c.display_name,
      'description', c.description,
      'is_sensitive', c.is_sensitive
    ) order by c.display_name), '[]'::jsonb)
    into v_caps
    from hermes_os.agent_action_catalog c
    where c.enabled = true and c.nl_enabled = true
      and exists (select 1 from hermes_os.user_tenant_permissions p
                  where p.user_id = v_uid and p.tenant_id = v_tenant and p.permission = c.required_permission);

  return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,'capabilities',coalesce(v_caps,'[]'::jsonb));
end;
$function$;
revoke all on function public.get_available_capabilities() from public;
grant execute on function public.get_available_capabilities() to authenticated;

-- (2) TasksPanel: operational priorities DERIVED from REAL signals only
--     (pending approvals, open quality incidents, chantiers to qualify, late
--     chantiers). Each item maps to a real row. Tenant-scoped, fail-closed.
create or replace function public.get_operational_priorities()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_pending int; v_incidents int; v_qualify int; v_late int; v_items jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED','tenant_id',null,
      'summary', jsonb_build_object('pending_approvals',0,'open_incidents',0,'to_qualify',0,'late',0),
      'items','[]'::jsonb);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status',v_status,'tenant_id',null,
      'summary', jsonb_build_object('pending_approvals',0,'open_incidents',0,'to_qualify',0,'late',0),
      'items','[]'::jsonb);
  end if;

  select count(*) into v_pending from hermes_os.agent_action_requests
    where tenant_id = v_tenant and status = 'PENDING_APPROVAL';
  select count(*) into v_incidents from hermes_os.btp_incidents_qualite
    where tenant_id = v_tenant and upper(status) in ('OUVERT','OPEN');
  select count(*) into v_qualify from hermes_os.btp_chantiers
    where tenant_id = v_tenant and upper(status) = 'QUALIFICATION';
  select count(*) into v_late from hermes_os.btp_suivi_avancement
    where tenant_id = v_tenant and coalesce(retards_jours,0) > 0;

  with items as (
    select 'approval'::text kind, 'critical'::text severity,
           'Demande en attente d''approbation'::text label,
           coalesce(c.display_name, r.action_key) detail, r.created_at ts
      from hermes_os.agent_action_requests r
      left join hermes_os.agent_action_catalog c on c.action_key = r.action_key
      where r.tenant_id = v_tenant and r.status = 'PENDING_APPROVAL'
    union all
    select 'incident', 'urgent',
           'Incident qualité ouvert',
           coalesce(i.type_incident,'incident')||coalesce(' — '||ch.chantier_name,''), i.created_at
      from hermes_os.btp_incidents_qualite i
      left join hermes_os.btp_chantiers ch on ch.id = i.chantier_id
      where i.tenant_id = v_tenant and upper(i.status) in ('OUVERT','OPEN')
    union all
    select 'qualify', 'normal',
           'Chantier à qualifier',
           ch.chantier_name, ch.created_at
      from hermes_os.btp_chantiers ch
      where ch.tenant_id = v_tenant and upper(ch.status) = 'QUALIFICATION'
    union all
    select 'late', 'urgent',
           'Chantier en retard',
           coalesce(ch.chantier_name,'?')||' ('||sv.retards_jours||' j)', sv.created_at
      from hermes_os.btp_suivi_avancement sv
      left join hermes_os.btp_chantiers ch on ch.id = sv.chantier_id
      where sv.tenant_id = v_tenant and coalesce(sv.retards_jours,0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'severity', severity, 'label', label, 'detail', detail
    ) order by case severity when 'critical' then 0 when 'urgent' then 1 else 2 end, ts desc), '[]'::jsonb)
    into v_items
    from (select * from items order by case severity when 'critical' then 0 when 'urgent' then 1 else 2 end, ts desc limit 8) x;

  return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,
    'summary', jsonb_build_object('pending_approvals',v_pending,'open_incidents',v_incidents,'to_qualify',v_qualify,'late',v_late),
    'items', coalesce(v_items,'[]'::jsonb));
end;
$function$;
revoke all on function public.get_operational_priorities() from public;
grant execute on function public.get_operational_priorities() to authenticated;

-- (3) SystemStatus: only REAL, measured platform facts (component registry counts
--     + last recorded execution). Infra SLA / latency / uptime are NOT measured
--     from the dashboard and are surfaced as UNAVAILABLE by the frontend (no fake
--     numbers). Requires auth; platform-level (same posture as public KPIs).
create or replace function public.get_platform_health()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_registered int; v_active int; v_last timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  select count(*) , count(*) filter (where n8n_active = true) into v_registered, v_active
    from hermes_os.component_registry;
  select max(created_at) into v_last from hermes_os.execution_logs;
  return jsonb_build_object(
    'resolution_status','OK',
    'components_registered', coalesce(v_registered,0),
    'components_active', coalesce(v_active,0),
    'last_execution_at', v_last
  );
end;
$function$;
revoke all on function public.get_platform_health() from public;
grant execute on function public.get_platform_health() to authenticated;
