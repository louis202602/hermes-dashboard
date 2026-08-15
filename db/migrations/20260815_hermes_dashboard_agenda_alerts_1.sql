-- DASH-2 — Agenda du jour + prochain événement + alertes/priorités unifiées.
-- (project smubxqorirlfldatzmym)
--
-- Two read-only, tenant-scoped SECURITY DEFINER facades that AGGREGATE signals
-- ALREADY present in hermes_os — no new business system, no LLM, no external API.
--   * public.get_dashboard_agenda()  — dated events (BTP phases, project start/end,
--     approval expiries) bucketed "today/upcoming/overdue" IN THE TENANT TIMEZONE
--     (DASH-1 canonical `dashboard_context_settings.iana_timezone`, DST-safe).
--   * public.get_unified_alerts()     — actionable state signals (pending approvals,
--     open incidents, resolver circuit OPEN, budget threshold, quota blocks today,
--     late chantiers, dead-letters) normalised to INFO/WARNING/HIGH/CRITICAL.
--
-- Both: caller's tenant only (resolve_active_tenant — never a client id), FAIL-SOFT
-- per source (one broken source never blanks the panel), REVOKE PUBLIC / GRANT
-- authenticated. No PII beyond the human labels the dashboard already shows.
begin;

-- =====================================================================
-- Agenda
-- =====================================================================
create or replace function public.get_dashboard_agenda()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_tz text := 'UTC';
  v_today date;
  v_events jsonb := '[]'::jsonb;
  v_part jsonb;
  v_unavail text[] := '{}';
  v_sorted jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED','events','[]'::jsonb);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),
      'tenant_id', v_tenant, 'events','[]'::jsonb);
  end if;

  -- Canonical tenant timezone (DASH-1). Fallback UTC. "Today" is local, DST-safe.
  select coalesce(iana_timezone,'UTC') into v_tz
    from hermes_os.dashboard_context_settings where tenant_id = v_tenant;
  if v_tz is null then v_tz := 'UTC'; end if;
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_tz := 'UTC'; v_today := (now() at time zone 'UTC')::date;
  end;

  -- BTP planning phases (planned start/end), not done/cancelled.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','BTP_PHASE:'||p.id::text, 'kind','phase', 'title', coalesce(p.phase_name,'Phase'),
        'subtitle', ch.chantier_name, 'source','BTP_PHASE', 'source_id', p.id::text,
        'starts_at', (coalesce(p.date_debut_planifie,p.date_fin_planifiee)::timestamp at time zone v_tz),
        'ends_at', case when p.date_fin_planifiee is not null
                        then (p.date_fin_planifiee::timestamp at time zone v_tz) else null end,
        'is_all_day', true, 'status', coalesce(p.status,'PLANNED'),
        'event_date', coalesce(p.date_debut_planifie,p.date_fin_planifiee),
        'day_bucket', case when coalesce(p.date_debut_planifie,p.date_fin_planifiee) = v_today then 'today'
                           when coalesce(p.date_debut_planifie,p.date_fin_planifiee) > v_today then 'upcoming'
                           else 'overdue' end,
        'provenance','REAL')), '[]'::jsonb)
      into v_part
      from hermes_os.btp_planning p
      left join hermes_os.btp_chantiers ch on ch.id = p.chantier_id
      where p.tenant_id = v_tenant
        and upper(coalesce(p.status,'')) not in ('DONE','TERMINE','TERMINÉ','FINI','CANCELLED','ANNULE','ANNULÉ')
        and coalesce(p.date_debut_planifie,p.date_fin_planifiee) is not null;
    v_events := v_events || v_part;
  exception when others then v_unavail := array_append(v_unavail,'BTP_PHASE'); end;

  -- Project start / end milestones.
  begin
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_part from (
      select jsonb_build_object(
        'id','PROJECT_START:'||ch.id::text,'kind','project_start','title','Début chantier',
        'subtitle',ch.chantier_name,'source','PROJECT_START','source_id',ch.id::text,
        'starts_at',(ch.date_debut_planifie::timestamp at time zone v_tz),'ends_at',null,
        'is_all_day',true,'status',coalesce(ch.status,''),'event_date',ch.date_debut_planifie,
        'day_bucket', case when ch.date_debut_planifie = v_today then 'today'
                           when ch.date_debut_planifie > v_today then 'upcoming' else 'overdue' end,
        'provenance','REAL') e
        from hermes_os.btp_chantiers ch
        where ch.tenant_id = v_tenant and ch.date_debut_planifie is not null
          and upper(coalesce(ch.status,'')) not in ('CANCELLED','ANNULE','ANNULÉ','TERMINE','TERMINÉ','DONE')
      union all
      select jsonb_build_object(
        'id','PROJECT_END:'||ch.id::text,'kind','project_end','title','Fin chantier prévue',
        'subtitle',ch.chantier_name,'source','PROJECT_END','source_id',ch.id::text,
        'starts_at',(ch.date_fin_planifiee::timestamp at time zone v_tz),'ends_at',null,
        'is_all_day',true,'status',coalesce(ch.status,''),'event_date',ch.date_fin_planifiee,
        'day_bucket', case when ch.date_fin_planifiee = v_today then 'today'
                           when ch.date_fin_planifiee > v_today then 'upcoming' else 'overdue' end,
        'provenance','REAL')
        from hermes_os.btp_chantiers ch
        where ch.tenant_id = v_tenant and ch.date_fin_planifiee is not null
          and upper(coalesce(ch.status,'')) not in ('CANCELLED','ANNULE','ANNULÉ','TERMINE','TERMINÉ','DONE')
    ) s;
    v_events := v_events || v_part;
  exception when others then v_unavail := array_append(v_unavail,'PROJECT_MILESTONE'); end;

  -- Approval expiries (real timestamptz deadline for a pending approval).
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','APPROVAL_EXPIRY:'||sar.approval_request_id::text,'kind','approval',
        'title','Approbation à échéance','subtitle', coalesce(cat.display_name, ar.action_key),
        'source','APPROVAL_EXPIRY','source_id', sar.approval_request_id::text,
        'starts_at', sar.expires_at, 'ends_at', null, 'is_all_day', false,
        'status', ar.status, 'event_date', (sar.expires_at at time zone v_tz)::date,
        'day_bucket', case when (sar.expires_at at time zone v_tz)::date = v_today then 'today'
                           when (sar.expires_at at time zone v_tz)::date > v_today then 'upcoming'
                           else 'overdue' end,
        'provenance','REAL')), '[]'::jsonb)
      into v_part
      from hermes_os.agent_action_requests ar
      join hermes_os.sw15_approval_requests sar on sar.approval_request_id = ar.approval_request_id
      left join hermes_os.agent_action_catalog cat on cat.action_key = ar.action_key
      where ar.tenant_id = v_tenant and ar.status = 'PENDING_APPROVAL' and sar.expires_at is not null;
    v_events := v_events || v_part;
  exception when others then v_unavail := array_append(v_unavail,'APPROVAL_EXPIRY'); end;

  -- Stable order: soonest first.
  select coalesce(jsonb_agg(e order by (e->>'starts_at')), '[]'::jsonb)
    into v_sorted from jsonb_array_elements(v_events) e;

  return jsonb_build_object(
    'resolution_status','OK','tenant_id',v_tenant,'timezone',v_tz,'today_local',v_today,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_sorted),
      'today', (select count(*) from jsonb_array_elements(v_sorted) e where e->>'day_bucket'='today'),
      'overdue', (select count(*) from jsonb_array_elements(v_sorted) e where e->>'day_bucket'='overdue')),
    'events', v_sorted,
    'unavailable', to_jsonb(v_unavail));
end;
$function$;

revoke all on function public.get_dashboard_agenda() from public;
grant execute on function public.get_dashboard_agenda() to authenticated;

-- =====================================================================
-- Unified alerts
-- =====================================================================
create or replace function public.get_unified_alerts()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_alerts jsonb := '[]'::jsonb;
  v_part jsonb;
  v_unavail text[] := '{}';
  v_sorted jsonb;
  -- budget
  v_month_budget numeric; v_alert_pct numeric; v_hard boolean;
  v_month_exp numeric; v_ratio numeric; v_sev text;
  v_month_key text := to_char(now() at time zone 'UTC','YYYY-MM');
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED','alerts','[]'::jsonb,
      'summary', jsonb_build_object('total',0,'critical',0,'high',0,'warning',0));
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'),'tenant_id',v_tenant,
      'alerts','[]'::jsonb, 'summary', jsonb_build_object('total',0,'critical',0,'high',0,'warning',0));
  end if;

  -- Pending approvals (HIGH — a human must act).
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','APPROVAL_PENDING:'||ar.id::text,'severity','HIGH','kind','approval',
        'title','Approbation requise','detail', coalesce(cat.display_name, ar.action_key),
        'source','APPROVAL_PENDING','source_id',ar.id::text,'ts',ar.created_at,'provenance','REAL')
      order by ar.created_at asc),'[]'::jsonb) into v_part
      from hermes_os.agent_action_requests ar
      left join hermes_os.agent_action_catalog cat on cat.action_key = ar.action_key
      where ar.tenant_id = v_tenant and ar.status = 'PENDING_APPROVAL';
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'APPROVAL_PENDING'); end;

  -- Open quality incidents (severity mapped from the incident row).
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','INCIDENT_OPEN:'||i.id::text,
        'severity', case when upper(coalesce(i.severity,'')) in ('CRITICAL','CRITIQUE') then 'CRITICAL'
                         when upper(coalesce(i.severity,'')) in ('MAJOR','MAJEUR','HIGH','ELEVE','ÉLEVÉ') then 'HIGH'
                         else 'WARNING' end,
        'kind','incident','title','Incident qualité ouvert',
        'detail', coalesce(i.type_incident,'incident')||coalesce(' — '||ch.chantier_name,''),
        'source','INCIDENT_OPEN','source_id',i.id::text,'ts',i.created_at,'provenance','REAL')
      order by i.created_at asc),'[]'::jsonb) into v_part
      from hermes_os.btp_incidents_qualite i
      left join hermes_os.btp_chantiers ch on ch.id = i.chantier_id
      where i.tenant_id = v_tenant and upper(coalesce(i.status,'')) in ('OUVERT','OPEN');
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'INCIDENT_OPEN'); end;

  -- Resolver circuit breaker OPEN (CRITICAL — automation halted).
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','CIRCUIT_OPEN:'||c.action_key,'severity','CRITICAL','kind','circuit',
        'title','Circuit résolveur ouvert','detail', coalesce(c.circuit_reason, c.action_key),
        'source','CIRCUIT_OPEN','source_id',c.action_key,'ts', c.circuit_opened_at,'provenance','REAL')),'[]'::jsonb)
      into v_part
      from hermes_os.resolver_runtime_config c
      where upper(coalesce(c.circuit_state,'CLOSED')) = 'OPEN';
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'CIRCUIT_OPEN'); end;

  -- Budget threshold on the current month (WARNING / HIGH / CRITICAL).
  begin
    select monthly_budget_usd, alert_threshold_pct, hard_stop
      into v_month_budget, v_alert_pct, v_hard
      from hermes_os.sw23_tenant_budget_config where tenant_id = v_tenant;
    if v_month_budget is not null and v_month_budget > 0 then
      select coalesce(sum(reserved_usd) filter (where status in ('reserved','committed')),0)
        into v_month_exp
        from hermes_os.sw23_budget_ledger
        where tenant_id = v_tenant and period_type = 'month' and period_key = v_month_key;
      v_ratio := v_month_exp / v_month_budget;
      v_sev := null;
      if v_ratio >= 1 then v_sev := case when v_hard then 'CRITICAL' else 'HIGH' end;
      elsif v_ratio >= coalesce(v_alert_pct,80)/100.0 then v_sev := 'WARNING';
      end if;
      if v_sev is not null then
        v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
          'id','BUDGET_MONTH:'||v_month_key,'severity',v_sev,'kind','budget',
          'title', case when v_ratio >= 1 then 'Budget mensuel atteint' else 'Budget mensuel proche de la limite' end,
          'detail', round(v_ratio*100)::text||'% du budget mensuel',
          'source','BUDGET','source_id',v_month_key,'ts', now(),'provenance','REAL'));
      end if;
    end if;
  exception when others then v_unavail := array_append(v_unavail,'BUDGET'); end;

  -- Quota blocks today (HIGH — a provider/service was throttled).
  begin
    select case when count(*) > 0 then jsonb_build_array(jsonb_build_object(
        'id','QUOTA_BLOCK:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),'severity','HIGH','kind','quota',
        'title','Quota atteint aujourd''hui','detail', count(*)::text||' blocage(s)',
        'source','QUOTA_BLOCK','source_id', to_char(now() at time zone 'UTC','YYYY-MM-DD'),
        'ts', max(blocked_at),'provenance','REAL')) else '[]'::jsonb end
      into v_part
      from hermes_os.sw9_quota_block_log
      where tenant_id = v_tenant and blocked_at >= date_trunc('day', now());
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'QUOTA_BLOCK'); end;

  -- Late chantiers (HIGH) — latest suivi row per chantier with retards_jours > 0.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','LATE_ITEM:'||sv.chantier_id::text,'severity','HIGH','kind','late',
        'title','Chantier en retard','detail', coalesce(ch.chantier_name,'?')||' ('||sv.retards_jours||' j)',
        'source','LATE_ITEM','source_id',sv.chantier_id::text,'ts',sv.created_at,'provenance','REAL')
      order by sv.retards_jours desc),'[]'::jsonb) into v_part
      from (
        select distinct on (chantier_id) chantier_id, retards_jours, created_at
          from hermes_os.btp_suivi_avancement
          where tenant_id = v_tenant
          order by chantier_id, created_at desc
      ) sv
      left join hermes_os.btp_chantiers ch on ch.id = sv.chantier_id
      where coalesce(sv.retards_jours,0) > 0;
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'LATE_ITEM'); end;

  -- Dead-letter actions (HIGH) — exhausted retries, need attention.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id','DEAD_LETTER:'||ar.id::text,'severity','HIGH','kind','dead_letter',
        'title','Action en échec définitif','detail', ar.action_key,
        'source','DEAD_LETTER','source_id',ar.id::text,'ts',ar.updated_at,'provenance','REAL')
      order by ar.updated_at desc),'[]'::jsonb) into v_part
      from hermes_os.agent_action_requests ar
      where ar.tenant_id = v_tenant and upper(coalesce(ar.status,'')) = 'DEAD_LETTER';
    v_alerts := v_alerts || v_part;
  exception when others then v_unavail := array_append(v_unavail,'DEAD_LETTER'); end;

  -- Order: CRITICAL → HIGH → WARNING → INFO, then most recent.
  select coalesce(jsonb_agg(e order by
      case e->>'severity' when 'CRITICAL' then 0 when 'HIGH' then 1 when 'WARNING' then 2 else 3 end,
      (e->>'ts') desc nulls last), '[]'::jsonb)
    into v_sorted from jsonb_array_elements(v_alerts) e;

  return jsonb_build_object('resolution_status','OK','tenant_id',v_tenant,
    'alerts', v_sorted,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_sorted),
      'critical', (select count(*) from jsonb_array_elements(v_sorted) e where e->>'severity'='CRITICAL'),
      'high', (select count(*) from jsonb_array_elements(v_sorted) e where e->>'severity'='HIGH'),
      'warning', (select count(*) from jsonb_array_elements(v_sorted) e where e->>'severity'='WARNING')),
    'unavailable', to_jsonb(v_unavail));
end;
$function$;

revoke all on function public.get_unified_alerts() from public;
grant execute on function public.get_unified_alerts() to authenticated;

commit;
