-- DASH-3 — État global Hermès + Activité récente + Activité commerciale.
-- (project smubxqorirlfldatzmym)
--
-- Two small, read-only, tenant-scoped SECURITY DEFINER facades. No new business
-- system, no LLM, no external API. The "system health" panel is composed on the
-- server from signals ALREADY fetched (KPIs, observability, resolver, cost) PLUS
-- the pre-existing public.get_platform_health() (now wired) and these two:
--   * public.get_agent_action_stats()  — the caller-tenant's agent_action_requests
--     counts by status (queued/running/succeeded/failed/dead_letter/pending).
--   * public.get_dashboard_commercial() — real btp_devis aggregates (EUR): sent /
--     to-follow-up / accepted + TTC amounts. Invoices/prospects/contracts are ABSENT
--     and are NOT fabricated.
--
-- Both: caller's tenant only (resolve_active_tenant — never a client id), bounded
-- (aggregate counts, no row dumps, no PII), REVOKE PUBLIC / GRANT authenticated.
begin;

create or replace function public.get_agent_action_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),'tenant_id',v_tenant);
  end if;
  return (
    select jsonb_build_object(
      'resolution_status','OK','tenant_id',v_tenant,
      'queued',           count(*) filter (where upper(coalesce(status,''))='QUEUED'),
      'running',          count(*) filter (where upper(coalesce(status,''))='RUNNING'),
      'succeeded',        count(*) filter (where upper(coalesce(status,''))='SUCCEEDED'),
      'failed',           count(*) filter (where upper(coalesce(status,''))='FAILED'),
      'dead_letter',      count(*) filter (where upper(coalesce(status,''))='DEAD_LETTER'),
      'pending_approval', count(*) filter (where upper(coalesce(status,''))='PENDING_APPROVAL'))
    from hermes_os.agent_action_requests
    where tenant_id = v_tenant
  );
end;
$function$;

revoke all on function public.get_agent_action_stats() from public;
grant execute on function public.get_agent_action_stats() to authenticated;

create or replace function public.get_dashboard_commercial()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_today date := (now() at time zone 'UTC')::date;
  v_accepted text[] := array['ACCEPTE','ACCEPTÉ','ACCEPTED','GAGNE','GAGNÉ','WON','SIGNE','SIGNÉ'];
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),'tenant_id',v_tenant);
  end if;
  return (
    select jsonb_build_object(
      'resolution_status','OK','tenant_id',v_tenant,'currency','EUR',
      'total', count(*),
      'sent', count(*) filter (where sent_date is not null),
      'to_follow_up', count(*) filter (
        where sent_date is not null and response_date is null
          and date_validite_fin is not null and date_validite_fin < v_today),
      'accepted', count(*) filter (where upper(coalesce(status,'')) = any(v_accepted)),
      'amount_sent_ttc_eur', coalesce(sum(total_ttc_eur) filter (where sent_date is not null),0),
      'amount_accepted_ttc_eur', coalesce(sum(total_ttc_eur)
        filter (where upper(coalesce(status,'')) = any(v_accepted)),0))
    from hermes_os.btp_devis
    where tenant_id = v_tenant
  );
end;
$function$;

revoke all on function public.get_dashboard_commercial() from public;
grant execute on function public.get_dashboard_commercial() to authenticated;

commit;
