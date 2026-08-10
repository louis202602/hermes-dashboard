-- Migration: hermes_btp_suivi_canonical_service (project smubxqorirlfldatzmym)
-- =====================================================================
-- Architectural convergence (post-review of PR #12): extract a SINGLE
-- canonical business service for recording a BTP suivi (progress report) plus
-- an optional quality incident. This removes the two previously-divergent inline
-- copies of the write logic:
--   (a) Agent BTP-Suivi (n8n O9BLGvhAGjd8oiv3, called by SW4) — inline INSERTs;
--   (b) GW Consumer — BTP Suivi (n8n 1xCiexp3oVj0R8Tk) — inline INSERT.
-- Both callers now invoke this one function, so there is exactly ONE business
-- implementation. Idempotent by (tenant_id, chantier_id, date_rapport); the
-- optional incident is created only on a newly-inserted suivi row, exactly as
-- Agent BTP-Suivi did. Fail-closed on missing tenant / chantier / date.
--
-- Behaviour is identical to the previous Agent BTP-Suivi inline logic (same
-- columns, same ON CONFLICT DO NOTHING, same "incident only on new row when
-- incident.type present"), so SW4 is unaffected. The gateway consumer calls it
-- with request_id=null and incident=null (a deliberate progress-only subset).
-- =====================================================================

create or replace function hermes_os.record_btp_suivi_progress(
  p_tenant_id text,
  p_chantier_id uuid,
  p_date date,
  p_phase text,
  p_pct integer,
  p_notes text default null,
  p_request_id text default null,
  p_incident jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_id uuid; v_code text; v_inc uuid;
begin
  if p_tenant_id is null or length(trim(p_tenant_id)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'TENANT_MISSING');
  end if;
  if p_chantier_id is null then
    return jsonb_build_object('ok', false, 'code', 'CHANTIER_MISSING');
  end if;
  if p_date is null then
    return jsonb_build_object('ok', false, 'code', 'DATE_MISSING');
  end if;

  insert into hermes_os.btp_suivi_avancement
    (tenant_id, chantier_id, date_rapport, phase_en_cours, pct_global, observations)
  values
    (p_tenant_id, p_chantier_id, p_date, coalesce(p_phase, ''), coalesce(p_pct, 0), coalesce(p_notes, ''))
  on conflict (tenant_id, chantier_id, date_rapport) do nothing
  returning id into v_id;

  if v_id is null then
    v_code := 'IDEMPOTENT';
  else
    v_code := 'SUIVI_RECORDED';
    -- Optional quality incident — only on a new suivi row, matching Agent BTP-Suivi.
    if p_incident is not null and coalesce(p_incident->>'type', '') <> '' then
      insert into hermes_os.btp_incidents_qualite
        (tenant_id, chantier_id, request_id, type_incident, severity, description, status)
      values
        (p_tenant_id, p_chantier_id, coalesce(p_request_id, gen_random_uuid()::text),
         p_incident->>'type', p_incident->>'severity',
         coalesce(p_incident->>'desc', p_incident->>'description'), 'OPEN')
      returning id into v_inc;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', v_code, 'suivi_id', v_id, 'incident_id', v_inc);
end;
$function$;

revoke all on function hermes_os.record_btp_suivi_progress(text,uuid,date,text,integer,text,text,jsonb) from public;
grant execute on function hermes_os.record_btp_suivi_progress(text,uuid,date,text,integer,text,text,jsonb) to service_role;
