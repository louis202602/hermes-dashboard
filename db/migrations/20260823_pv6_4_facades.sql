-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / 4 — Façades de la visite + porte de devis.
-- (project smubxqorirlfldatzmym)
--
-- Même contrat que PV-1 à PV-5 : tables en deny-all, accès par façades
-- `SECURITY DEFINER` accordées au seul rôle `authenticated`, tenant résolu
-- SERVEUR, `search_path` verrouillé, aucun paramètre de tenant ni d'acteur.
--
-- PERMISSIONS — décision documentée. La visite est un geste TECHNIQUE, pas
-- administratif : exiger `tenant.admin` pour saisir un relevé de toiture
-- interdirait à un technicien de faire son travail, et pousserait à partager un
-- compte d'administrateur — ce qui serait pire que tout. Toutes les façades de
-- ce lot sont donc ouvertes au MEMBRE du tenant (`pv_guard()`), comme la
-- validation d'étude en PV-3. La seule irréversibilité du Pack PV, la purge
-- d'octets, reste réservée à `tenant.admin` (PV-4) : elle détruit, la visite
-- constate.

begin;

-- ---------------------------------------------------------------------------
-- 1. PLANIFIER.
-- ---------------------------------------------------------------------------
create or replace function public.plan_pv_site_survey(
  p_prospect_id uuid,
  p_scheduled_on date default null,
  p_technician_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_p.opted_out then return jsonb_build_object('ok', false, 'code', 'PROSPECT_OPTED_OUT'); end if;

  -- Site principal : le plus ancien du prospect. MÊME règle déterministe qu'en
  -- PV-4 et PV-5 — trois règles différentes finiraient par désigner trois sites.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;
  if v_site.id is null then return jsonb_build_object('ok', false, 'code', 'NO_SITE'); end if;

  insert into hermes_os.pv_site_surveys
    (tenant_id, prospect_id, site_id, technician_user_id, scheduled_on, status, created_by, updated_by)
  values (v_t, v_p.id, v_site.id, coalesce(p_technician_user_id, v_uid), p_scheduled_on,
          'PLANNED', v_uid, v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'PLANNED', 'survey_id', v_id, 'site_id', v_site.id);
end;
$function$;

revoke all on function public.plan_pv_site_survey(uuid, date, uuid) from public;
grant execute on function public.plan_pv_site_survey(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. SAISIE DU RELEVÉ — trois groupes cohérents plutôt qu'une façade à 30
--    paramètres. Chacun correspond à une section de l'écran, et chacun
--    RECALCULE les écarts : un relevé enregistré sans ses conséquences serait
--    une demi-vérité.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_survey_roof(
  p_survey_id uuid,
  p_roof_area_total_m2 numeric default null,
  p_roof_area_usable_m2 numeric default null,
  p_azimuth_deg numeric default null,
  p_tilt_deg numeric default null,
  p_roof_type text default null,
  p_roof_condition text default null,
  p_shading text default null,
  p_access_difficulty text default null,
  p_height_m numeric default null,
  p_ridge_length_m numeric default null,
  p_eave_length_m numeric default null,
  p_slope_length_m numeric default null,
  p_obstacles text default null,
  p_asbestos_suspicion boolean default null,
  p_asbestos_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_s hermes_os.pv_site_surveys; v_n integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_s from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v_s.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_s.status in ('VALIDATED', 'CANCELLED') then
    return jsonb_build_object('ok', false, 'code', 'SURVEY_LOCKED', 'status', v_s.status);
  end if;

  begin
    update hermes_os.pv_site_surveys
       set roof_area_total_measured_m2  = coalesce(p_roof_area_total_m2, roof_area_total_measured_m2),
           roof_area_usable_measured_m2 = coalesce(p_roof_area_usable_m2, roof_area_usable_measured_m2),
           azimuth_measured_deg         = coalesce(p_azimuth_deg, azimuth_measured_deg),
           tilt_measured_deg            = coalesce(p_tilt_deg, tilt_measured_deg),
           roof_type_measured           = coalesce(p_roof_type, roof_type_measured),
           roof_condition_measured      = coalesce(p_roof_condition, roof_condition_measured),
           shading_measured             = coalesce(p_shading, shading_measured),
           access_difficulty_measured   = coalesce(p_access_difficulty, access_difficulty_measured),
           height_measured_m            = coalesce(p_height_m, height_measured_m),
           ridge_length_m               = coalesce(p_ridge_length_m, ridge_length_m),
           eave_length_m                = coalesce(p_eave_length_m, eave_length_m),
           slope_length_m               = coalesce(p_slope_length_m, slope_length_m),
           obstacles                    = coalesce(p_obstacles, obstacles),
           asbestos_suspicion           = coalesce(p_asbestos_suspicion, asbestos_suspicion),
           asbestos_note                = coalesce(p_asbestos_note, asbestos_note),
           updated_by = v_uid, updated_at = now()
     where id = p_survey_id and tenant_id = v_t;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_MEASUREMENT');
  end;

  v_n := hermes_os.compute_pv_survey_findings(p_survey_id);
  return jsonb_build_object('ok', true, 'code', 'SAVED', 'survey_id', p_survey_id, 'findings', v_n);
end;
$function$;

revoke all on function public.upsert_pv_survey_roof(uuid,numeric,numeric,numeric,numeric,text,text,text,text,numeric,numeric,numeric,numeric,text,boolean,text) from public;
grant execute on function public.upsert_pv_survey_roof(uuid,numeric,numeric,numeric,numeric,text,text,text,text,numeric,numeric,numeric,numeric,text,boolean,text) to authenticated;

create or replace function public.upsert_pv_survey_electrical(
  p_survey_id uuid,
  p_panel_location text default null,
  p_inverter_location text default null,
  p_battery_location text default null,
  p_cable_route text default null,
  p_cable_distance_m numeric default null,
  p_panel_board_location text default null,
  p_panel_board_condition text default null,
  p_panel_board_free_slots integer default null,
  p_main_breaker_rating_a numeric default null,
  p_earthing_observed text default null,
  p_earthing_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_s hermes_os.pv_site_surveys; v_n integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  select * into v_s from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v_s.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_s.status in ('VALIDATED', 'CANCELLED') then
    return jsonb_build_object('ok', false, 'code', 'SURVEY_LOCKED', 'status', v_s.status);
  end if;

  begin
    update hermes_os.pv_site_surveys
       set panel_location         = coalesce(p_panel_location, panel_location),
           inverter_location      = coalesce(p_inverter_location, inverter_location),
           battery_location       = coalesce(p_battery_location, battery_location),
           cable_route            = coalesce(p_cable_route, cable_route),
           cable_distance_m       = coalesce(p_cable_distance_m, cable_distance_m),
           panel_board_location   = coalesce(p_panel_board_location, panel_board_location),
           panel_board_condition  = coalesce(p_panel_board_condition, panel_board_condition),
           panel_board_free_slots = coalesce(p_panel_board_free_slots, panel_board_free_slots),
           main_breaker_rating_a  = coalesce(p_main_breaker_rating_a, main_breaker_rating_a),
           earthing_observed      = coalesce(p_earthing_observed, earthing_observed),
           earthing_note          = coalesce(p_earthing_note, earthing_note),
           updated_by = v_uid, updated_at = now()
     where id = p_survey_id and tenant_id = v_t;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_MEASUREMENT');
  end;

  v_n := hermes_os.compute_pv_survey_findings(p_survey_id);
  return jsonb_build_object('ok', true, 'code', 'SAVED', 'survey_id', p_survey_id, 'findings', v_n);
end;
$function$;

revoke all on function public.upsert_pv_survey_electrical(uuid,text,text,text,text,numeric,text,text,integer,numeric,text,text) from public;
grant execute on function public.upsert_pv_survey_electrical(uuid,text,text,text,text,numeric,text,text,integer,numeric,text,text) to authenticated;

create or replace function public.upsert_pv_survey_context(
  p_survey_id uuid,
  p_weather_conditions text default null,
  p_roof_access text default null,
  p_access_means text default null,
  p_site_condition text default null,
  p_safety_constraints text default null,
  p_observations text default null,
  p_remarks text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_s hermes_os.pv_site_surveys; v_n integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  select * into v_s from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v_s.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_s.status in ('VALIDATED', 'CANCELLED') then
    return jsonb_build_object('ok', false, 'code', 'SURVEY_LOCKED', 'status', v_s.status);
  end if;

  begin
    update hermes_os.pv_site_surveys
       set weather_conditions = coalesce(p_weather_conditions, weather_conditions),
           roof_access        = coalesce(p_roof_access, roof_access),
           access_means       = coalesce(p_access_means, access_means),
           site_condition     = coalesce(p_site_condition, site_condition),
           safety_constraints = coalesce(p_safety_constraints, safety_constraints),
           observations       = coalesce(p_observations, observations),
           remarks            = coalesce(p_remarks, remarks),
           updated_by = v_uid, updated_at = now()
     where id = p_survey_id and tenant_id = v_t;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_MEASUREMENT');
  end;

  v_n := hermes_os.compute_pv_survey_findings(p_survey_id);
  return jsonb_build_object('ok', true, 'code', 'SAVED', 'survey_id', p_survey_id, 'findings', v_n);
end;
$function$;

revoke all on function public.upsert_pv_survey_context(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.upsert_pv_survey_context(uuid,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CHANGEMENTS D'ÉTAT.
--    `VALIDATED` n'est PAS atteignable par cette façade : elle a la sienne, qui
--    porte la garde humaine. Le même refus explicite qu'en PV-3.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_survey_status(p_survey_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_s hermes_os.pv_site_surveys;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  if p_status = 'VALIDATED' then
    return jsonb_build_object('ok', false, 'code', 'USE_VALIDATION_FACADE');
  end if;
  if p_status not in ('PLANNED','IN_PROGRESS','DONE','NEEDS_REVIEW','BLOCKING','CANCELLED') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  end if;

  select * into v_s from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v_s.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  begin
    update hermes_os.pv_site_surveys
       set status = p_status,
           started_at   = case when p_status = 'IN_PROGRESS' and started_at is null then now() else started_at end,
           completed_at = case when p_status = 'DONE' then now() else completed_at end,
           updated_by = v_uid, updated_at = now()
     where id = p_survey_id and tenant_id = v_t;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED',
        'from', v_s.status, 'to', p_status);
  end;

  return jsonb_build_object('ok', true, 'code', p_status);
end;
$function$;

revoke all on function public.set_pv_survey_status(uuid, text) from public;
grant execute on function public.set_pv_survey_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. VALIDER — geste humain, et seulement si rien ne bloque.
--
--    Un écart BLOQUANT non résolu interdit la validation. Sans cette règle, la
--    porte de visite (`pv_survey_gate`) pourrait renvoyer `OK` sur une visite
--    qui a constaté un toit impraticable — la preuve terrain dirait le contraire
--    de ce qu'elle a constaté.
-- ---------------------------------------------------------------------------
create or replace function public.validate_pv_site_survey(p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_s hermes_os.pv_site_surveys; v_blocking text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_s from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v_s.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_s.status = 'VALIDATED' then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_VALIDATED');
  end if;
  if v_s.status not in ('DONE', 'NEEDS_REVIEW') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_s.status);
  end if;

  select coalesce(array_agg(code), '{}') into v_blocking
    from hermes_os.pv_site_survey_findings
   where tenant_id = v_t and survey_id = p_survey_id and is_blocking and resolution is null;
  if array_length(v_blocking, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'BLOCKING_FINDINGS_UNRESOLVED',
      'findings', to_jsonb(v_blocking));
  end if;

  begin
    update hermes_os.pv_site_surveys
       set status = 'VALIDATED', validated_by = v_uid, validated_at = now(),
           updated_by = v_uid, updated_at = now()
     where id = p_survey_id and tenant_id = v_t;
  exception
    when insufficient_privilege then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_s.status);
  end;

  return jsonb_build_object('ok', true, 'code', 'VALIDATED');
end;
$function$;

revoke all on function public.validate_pv_site_survey(uuid) from public;
grant execute on function public.validate_pv_site_survey(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RÉSOUDRE UN ÉCART.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_pv_survey_finding(
  p_finding_id uuid,
  p_resolution text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  if p_resolution not in ('ACCEPTED_AS_IS','SITE_UPDATED','STUDY_TO_REVISE','QUOTE_TO_REVISE','NOT_AN_ISSUE') then
    return jsonb_build_object('ok', false, 'code', 'BAD_RESOLUTION');
  end if;

  update hermes_os.pv_site_survey_findings
     set resolution = p_resolution, resolved_by = v_uid, resolved_at = now(),
         comment = coalesce(p_comment, comment), updated_at = now()
   where id = p_finding_id and tenant_id = v_t
  returning id into v_id;

  if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'code', 'RESOLVED', 'finding_id', v_id);
end;
$function$;

revoke all on function public.resolve_pv_survey_finding(uuid, text, text) from public;
grant execute on function public.resolve_pv_survey_finding(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. APPLIQUER UNE MESURE AU SITE — le SEUL chemin par lequel une valeur de
--    terrain remplace une valeur déclarée. Explicite, champ par champ, audité.
--
--    Aucun déclencheur ne fait cela automatiquement, et c'est le point du lot :
--    un écrasement silencieux effacerait la déclaration d'origine, donc la
--    possibilité même de constater l'écart.
-- ---------------------------------------------------------------------------
create or replace function public.apply_pv_survey_measurement(p_survey_id uuid, p_field text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v hermes_os.pv_site_surveys; v_old text; v_new text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v from hermes_os.pv_site_surveys s where s.id = p_survey_id and s.tenant_id = v_t;
  if v.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v.status not in ('DONE','NEEDS_REVIEW','VALIDATED') then
    return jsonb_build_object('ok', false, 'code', 'SURVEY_NOT_READY', 'status', v.status);
  end if;

  case p_field
    when 'roof_area_total_m2' then
      if v.roof_area_total_measured_m2 is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select roof_area_total_m2::text into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set roof_area_total_m2 = v.roof_area_total_measured_m2, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.roof_area_total_measured_m2::text;
    when 'roof_area_usable_m2' then
      if v.roof_area_usable_measured_m2 is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select roof_area_usable_m2::text into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set roof_area_usable_m2 = v.roof_area_usable_measured_m2, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.roof_area_usable_measured_m2::text;
    when 'azimuth_deg' then
      if v.azimuth_measured_deg is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select azimuth_deg::text into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set azimuth_deg = v.azimuth_measured_deg, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.azimuth_measured_deg::text;
    when 'tilt_deg' then
      if v.tilt_measured_deg is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select tilt_deg::text into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set tilt_deg = v.tilt_measured_deg, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.tilt_measured_deg::text;
    when 'roof_type' then
      if v.roof_type_measured is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select roof_type into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set roof_type = v.roof_type_measured, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.roof_type_measured;
    when 'roof_condition' then
      if v.roof_condition_measured is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select roof_condition into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set roof_condition = v.roof_condition_measured, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.roof_condition_measured;
    when 'shading_level' then
      if v.shading_measured is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select shading_level into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set shading_level = v.shading_measured, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.shading_measured;
    when 'access_difficulty' then
      if v.access_difficulty_measured is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select access_difficulty into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set access_difficulty = v.access_difficulty_measured, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.access_difficulty_measured;
    when 'height_m' then
      if v.height_measured_m is null then return jsonb_build_object('ok', false, 'code', 'NO_MEASUREMENT'); end if;
      select height_m::text into v_old from hermes_os.pv_sites where id = v.site_id;
      update hermes_os.pv_sites set height_m = v.height_measured_m, updated_at = now()
       where id = v.site_id and tenant_id = v_t;
      v_new := v.height_measured_m::text;
    else
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_FIELD', 'field', p_field);
  end case;

  perform hermes_os._pv_audit(v_t, 'pv_sites', v.site_id,
    jsonb_build_object(p_field, v_old), jsonb_build_object(p_field, v_new),
    format('mesure de visite technique appliquee au site : %s (%s -> %s)',
           p_field, coalesce(v_old, 'non renseigne'), coalesce(v_new, 'non renseigne')));

  -- Le site a changé : les écarts de CETTE visite ne disent plus la même chose.
  perform hermes_os.compute_pv_survey_findings(p_survey_id);

  return jsonb_build_object('ok', true, 'code', 'APPLIED', 'field', p_field,
    'previous_value', v_old, 'new_value', v_new);
end;
$function$;

revoke all on function public.apply_pv_survey_measurement(uuid, text) from public;
grant execute on function public.apply_pv_survey_measurement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. LECTURES.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_site_survey(p_survey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v hermes_os.pv_site_surveys; s hermes_os.pv_sites; p hermes_os.pv_prospects;
  v_findings jsonb; v_docs jsonb; v_next jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v from hermes_os.pv_site_surveys x where x.id = p_survey_id and x.tenant_id = v_t;
  if v.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  select * into s from hermes_os.pv_sites where id = v.site_id and tenant_id = v_t;
  select * into p from hermes_os.pv_prospects where id = v.prospect_id and tenant_id = v_t;

  select coalesce(jsonb_agg(to_jsonb(f) - 'tenant_id'
           order by case f.severity when 'BLOCKING' then 0 when 'REVIEW' then 1 else 2 end, f.code),
         '[]'::jsonb)
    into v_findings
    from hermes_os.pv_site_survey_findings f
   where f.tenant_id = v_t and f.survey_id = v.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
           'original_filename', d.original_filename, 'mime_type', d.mime_type,
           'size_bytes', d.size_bytes, 'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
           order by d.uploaded_at desc), '[]'::jsonb)
    into v_docs
    from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.survey_id = v.id and d.deleted_at is null;

  -- LES SUITES POSSIBLES, LUES DANS LA TABLE DE TRANSITIONS elle-même. L'écran
  -- ne redéclare donc pas la machine à états : une transition ajoutée ou retirée
  -- en base change immédiatement ce que l'écran propose. `VALIDATED` en est
  -- retiré parce qu'il ne s'atteint PAS par un changement de statut : il passe
  -- par `validate_pv_site_survey`, qui exige un humain authentifié.
  select coalesce(jsonb_agg(t.to_status order by t.to_status), '[]'::jsonb)
    into v_next
    from hermes_os.pv_survey_transitions t
   where t.from_status = v.status and t.to_status <> 'VALIDATED';

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'survey', to_jsonb(v) - 'tenant_id',
    'next_statuses', v_next,
    'site', case when s.id is null then 'null'::jsonb else to_jsonb(s) - 'tenant_id' end,
    'prospect', case when p.id is null then 'null'::jsonb else to_jsonb(p) - 'tenant_id' end,
    'findings', v_findings,
    'documents', v_docs,
    'gate', hermes_os.pv_survey_gate(v_t, v.site_id));
end;
$function$;

revoke all on function public.get_pv_site_survey(uuid) from public;
grant execute on function public.get_pv_site_survey(uuid) to authenticated;

create or replace function public.get_pv_site_surveys(p_prospect_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'site_id', x.site_id, 'status', x.status,
           'scheduled_on', x.scheduled_on, 'completed_at', x.completed_at,
           'validated_at', x.validated_at, 'technician_user_id', x.technician_user_id,
           'created_at', x.created_at,
           'findings_total', (select count(*) from hermes_os.pv_site_survey_findings f
                               where f.tenant_id = v_t and f.survey_id = x.id),
           'findings_blocking', (select count(*) from hermes_os.pv_site_survey_findings f
                                  where f.tenant_id = v_t and f.survey_id = x.id
                                    and f.is_blocking and f.resolution is null))
           order by x.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_site_surveys x
           where x.tenant_id = v_t and (p_prospect_id is null or x.prospect_id = p_prospect_id)
           order by x.created_at desc limit v_lim) x;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_site_surveys(uuid, integer) from public;
grant execute on function public.get_pv_site_surveys(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RAPPORT DE VISITE — enregistrement du PDF. Même contrat qu'en PV-4/PV-5.
-- ---------------------------------------------------------------------------
create or replace function public.register_pv_survey_report(
  p_request_id text,
  p_survey_id  uuid,
  p_path       text,
  p_bytes      bigint,
  p_sha256     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v hermes_os.pv_site_surveys; v_id uuid; v_existing uuid; v_prefix text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  if p_request_id is null or length(btrim(p_request_id)) not between 8 and 200 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST_ID');
  end if;

  select d.id into v_existing from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
  end if;

  select * into v from hermes_os.pv_site_surveys x where x.id = p_survey_id and x.tenant_id = v_t;
  if v.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  v_prefix := v_t || '/' || v.site_id::text || '/';
  if p_path is null or left(p_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 26214400 then
    return jsonb_build_object('ok', false, 'code', 'BAD_SIZE');
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'BAD_HASH');
  end if;

  begin
    insert into hermes_os.pv_documents
      (tenant_id, site_id, survey_id, doc_type, document_stage, generation_request_id,
       storage_bucket, storage_path, mime_type, size_bytes, sha256, original_filename,
       status, uploaded_by)
    values
      (v_t, v.site_id, v.id, 'FICHE_VISITE', 'SURVEY_REPORT', btrim(p_request_id),
       'hermes-pv-documents', p_path, 'application/pdf', p_bytes, p_sha256,
       'rapport-visite-technique.pdf', 'LINKED', v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      select d.id into v_existing from hermes_os.pv_documents d
       where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
      end if;
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OBJECT');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_DOCUMENT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'GENERATED', 'document_id', v_id, 'path', p_path);
end;
$function$;

revoke all on function public.register_pv_survey_report(text, uuid, text, bigint, text) from public;
grant execute on function public.register_pv_survey_report(text, uuid, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. LA PORTE DE DEVIS.
--
--    On étend `pv_quote_blockers` de PV-5 — UN SEUL endroit, consulté par
--    `set_pv_quote_ready`, `send_pv_quote`, `register_pv_quote_pdf(FINAL)` et
--    la lecture d'un devis. Trois copies auraient divergé.
--
--    ⚠️ CE QUI CHANGE, DIT EN ENTIER : un devis ne peut plus passer `READY`, ni
--    être transmis, ni produire un PDF FINAL sans visite VALIDÉE. Un devis DÉJÀ
--    `SENT` ou `ACCEPTED` n'est PAS modifié — rien ne le relit pour le changer.
--    Il affichera en revanche l'alerte, ce qui est le but : si la visite
--    découvre un problème après l'envoi, le commercial doit le savoir, et la
--    seule voie de correction reste la RÉVISION (nouvelle version).
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_quote_blockers(p_quote_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_q hermes_os.pv_quotes; v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_out text[] := '{}'; v_lines int; v_gate text;
begin
  select * into v_q from hermes_os.pv_quotes where id = p_quote_id;
  if v_q.id is null then return array['QUOTE_NOT_FOUND']; end if;

  select * into v_study from hermes_os.pv_studies where id = v_q.study_id;
  select * into v_econ  from hermes_os.pv_economics where id = v_q.economics_id;
  select * into v_p     from hermes_os.pv_prospects where id = v_q.prospect_id;
  select * into v_site  from hermes_os.pv_sites where id = v_q.site_id;
  select count(*) into v_lines from hermes_os.pv_quote_lines where quote_id = p_quote_id;

  if v_study.id is null or v_study.status is distinct from 'VALIDATED' then
    v_out := array_append(v_out, 'STUDY_NOT_VALIDATED');
  end if;
  if v_econ.id is null or v_econ.status is distinct from 'VERIFIED' then
    v_out := array_append(v_out, 'ECONOMICS_NOT_VERIFIED');
  end if;
  if v_lines = 0 then
    v_out := array_append(v_out, 'NO_LINE');
  end if;
  if v_q.total_ttc_eur is null or v_q.total_ttc_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;
  if v_p.id is null
     or (coalesce(btrim(v_p.company_name), '') = ''
         and coalesce(btrim(v_p.last_name), '') = '') then
    v_out := array_append(v_out, 'CLIENT_IDENTITY_MISSING');
  end if;
  if v_site.id is null or coalesce(btrim(v_site.address_line1), '') = '' then
    v_out := array_append(v_out, 'SITE_MISSING');
  end if;
  if v_q.valid_until is null then
    v_out := array_append(v_out, 'VALIDITY_DATE_MISSING');
  end if;
  if v_p.opted_out then
    v_out := array_append(v_out, 'PROSPECT_OPTED_OUT');
  end if;

  -- PV-6 — LA PREUVE TERRAIN. Un prix contractuel ne repose plus sur des
  -- données de toiture jamais confrontées au site.
  v_gate := hermes_os.pv_survey_gate(v_q.tenant_id, v_q.site_id);
  if v_gate = 'NONE' then
    v_out := array_append(v_out, 'SITE_SURVEY_REQUIRED');
  elsif v_gate = 'BLOCKING' then
    v_out := array_append(v_out, 'SITE_SURVEY_BLOCKING');
  elsif v_gate = 'NOT_VALIDATED' then
    v_out := array_append(v_out, 'SITE_SURVEY_NOT_VALIDATED');
  end if;

  return v_out;
end;
$function$;

revoke all on function hermes_os.pv_quote_blockers(uuid) from public;

-- ---------------------------------------------------------------------------
-- 10. LA VUE AFFAIRE apprend l'état de la visite.
--
--     `get_pv_deal` gagne UN champ, `survey_gate`, lu par le même
--     `pv_survey_gate` que la porte de devis. L'écran n'a donc pas à faire une
--     seconde lecture ni à recalculer sa propre idée de l'état du terrain : un
--     dossier sans visite l'affiche, un dossier bloqué aussi.
--
--     Rien d'autre ne change dans cette façade — c'est un ajout, pas une
--     réécriture : les appelants existants lisent les mêmes clés qu'avant.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_deal(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_p hermes_os.pv_prospects;
  v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies;
  v_latest hermes_os.pv_studies;
  v_econ hermes_os.pv_economics;
  v_cons jsonb; v_bill jsonb; v_assum jsonb; v_docs jsonb; v_studies jsonb;
  v_gate text := 'NONE';
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- Site principal : le PLUS ANCIEN du prospect. Déterministe, et conforme au
  -- geste réel — le premier site saisi est celui de l'affaire.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;

  if v_site.id is not null then
    select coalesce(to_jsonb(c) - 'tenant_id', 'null'::jsonb) into v_cons
      from hermes_os.pv_consumption_profiles c
     where c.tenant_id = v_t and c.site_id = v_site.id
     order by c.created_at desc limit 1;

    -- Facture RETENUE = la plus récente VERIFIED. Une facture non vérifiée
    -- n'est pas une donnée retenue : elle ne peut pas fonder un chiffrage.
    select coalesce(to_jsonb(b) - 'tenant_id', 'null'::jsonb) into v_bill
      from hermes_os.pv_energy_bills b
     where b.tenant_id = v_t and b.site_id = v_site.id and b.status = 'VERIFIED'
     order by b.period_end desc nulls last, b.created_at desc limit 1;

    select * into v_study from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
     order by s.version desc limit 1;

    select * into v_latest from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id
     order by s.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'version', s.version, 'status', s.status,
             'prepared_by', s.prepared_by, 'target_power_kwc', s.target_power_kwc)
             order by s.version desc), '[]'::jsonb)
      into v_studies
      from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
             'original_filename', d.original_filename, 'mime_type', d.mime_type,
             'size_bytes', d.size_bytes, 'status', d.status,
             'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
             order by d.uploaded_at desc), '[]'::jsonb)
      into v_docs
      from hermes_os.pv_documents d
     where d.tenant_id = v_t and d.site_id = v_site.id and d.deleted_at is null;

    v_gate := hermes_os.pv_survey_gate(v_t, v_site.id);
  end if;

  if v_study.id is not null then
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;

    select coalesce(to_jsonb(a) - 'tenant_id', 'null'::jsonb) into v_assum
      from hermes_os.pv_study_assumptions a
     where a.tenant_id = v_t and a.study_id = v_study.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'prospect', to_jsonb(v_p) - 'tenant_id',
    'site', case when v_site.id is null then 'null'::jsonb else to_jsonb(v_site) - 'tenant_id' end,
    'consumption', coalesce(v_cons, 'null'::jsonb),
    'verified_bill', coalesce(v_bill, 'null'::jsonb),
    'retained_study', case when v_study.id is null then 'null'::jsonb else to_jsonb(v_study) - 'tenant_id' end,
    'latest_study', case when v_latest.id is null then 'null'::jsonb else to_jsonb(v_latest) - 'tenant_id' end,
    'retained_assumptions', coalesce(v_assum, 'null'::jsonb),
    'retained_economics', case when v_econ.id is null then 'null'::jsonb else to_jsonb(v_econ) - 'tenant_id' end,
    'studies', coalesce(v_studies, '[]'::jsonb),
    'documents', coalesce(v_docs, '[]'::jsonb),
    'survey_gate', v_gate);
end;
$function$;

revoke all on function public.get_pv_deal(uuid) from public;
grant execute on function public.get_pv_deal(uuid) to authenticated;

commit;
