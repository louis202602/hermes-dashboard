-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / 3 — Moteur d'écarts déterministe.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- AUCUNE IA. Les règles sont écrites ici, en SQL, et lisent des seuils stockés
-- en base. Deux propriétés en découlent : le même relevé produit toujours les
-- mêmes écarts, et changer une tolérance ne demande pas de redéploiement.
--
-- LA MESURE N'ÉCRASE JAMAIS LA DÉCLARATION. Ce moteur ne touche pas à
-- `pv_sites` : il produit des CONSTATS. Appliquer une mesure au site est un
-- geste humain distinct (`apply_pv_survey_measurement`), audité.

begin;

-- ---------------------------------------------------------------------------
-- Écart d'azimut : la différence est CIRCULAIRE. 350° et 10° sont distants de
-- 20°, pas de 340°. Sans cela, une correction de plein nord signalerait un
-- écart énorme là où il n'y en a presque pas.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_angle_delta(a numeric, b numeric)
returns numeric
language sql
immutable
as $function$
  select least(abs(a - b), 360 - abs(a - b));
$function$;

-- Rang d'une classe d'ombrage. NULL si la valeur est inconnue — on ne compare
-- pas ce qu'on ne sait pas classer.
create or replace function hermes_os.pv_shading_rank(v text)
returns integer
language sql
immutable
as $function$
  select case v when 'AUCUN' then 0 when 'FAIBLE' then 1
                when 'MODERE' then 2 when 'FORT' then 3 else null end;
$function$;

-- ---------------------------------------------------------------------------
-- LE MOTEUR.
--
-- Régénérable : on recalcule tous les écarts d'une visite à chaque saisie. Mais
-- une RÉSOLUTION humaine déjà posée n'est pas effacée — sinon chaque frappe au
-- clavier annulerait le travail d'analyse. D'où l'`on conflict … do update` qui
-- ne touche ni `resolution`, ni `resolved_by`, ni `resolved_at`.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.compute_pv_survey_findings(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v hermes_os.pv_site_surveys;
  s hermes_os.pv_sites;
  t text;
  v_codes text[] := '{}';
  v_delta numeric; v_pct numeric; v_sev text; v_n integer;
begin
  select * into v from hermes_os.pv_site_surveys where id = p_survey_id;
  if v.id is null then return 0; end if;
  select * into s from hermes_os.pv_sites where id = v.site_id and tenant_id = v.tenant_id;
  t := v.tenant_id;

  -- ---- 1. Surface exploitable ---------------------------------------------
  if v.roof_area_usable_measured_m2 is not null and s.roof_area_usable_m2 is not null
     and s.roof_area_usable_m2 > 0 then
    v_pct := abs(v.roof_area_usable_measured_m2 - s.roof_area_usable_m2) / s.roof_area_usable_m2 * 100;
    v_sev := case
      when v_pct >= hermes_os.pv_survey_threshold(t, 'USABLE_AREA_BLOCKING_PCT') then 'BLOCKING'
      when v_pct >= hermes_os.pv_survey_threshold(t, 'USABLE_AREA_REVIEW_PCT')   then 'REVIEW'
      else null end;
    if v_sev is not null then
      v_codes := array_append(v_codes, 'USABLE_AREA_MISMATCH');
      insert into hermes_os.pv_site_survey_findings
        (tenant_id, survey_id, code, category, severity, is_blocking,
         declared_value, measured_value, unit, comment)
      values (t, v.id, 'USABLE_AREA_MISMATCH', 'TOITURE', v_sev, v_sev = 'BLOCKING',
              s.roof_area_usable_m2::text, v.roof_area_usable_measured_m2::text, 'm²',
              format('Écart de %s %% entre la surface exploitable déclarée et mesurée.', round(v_pct, 1)))
      on conflict (tenant_id, survey_id, code) do update set
        severity = excluded.severity, is_blocking = excluded.is_blocking,
        declared_value = excluded.declared_value, measured_value = excluded.measured_value,
        comment = excluded.comment, updated_at = now();
    end if;
  end if;

  -- ---- 2. Surface totale de toiture (revue au maximum) ---------------------
  if v.roof_area_total_measured_m2 is not null and s.roof_area_total_m2 is not null
     and s.roof_area_total_m2 > 0 then
    v_pct := abs(v.roof_area_total_measured_m2 - s.roof_area_total_m2) / s.roof_area_total_m2 * 100;
    if v_pct >= hermes_os.pv_survey_threshold(t, 'ROOF_AREA_REVIEW_PCT') then
      v_codes := array_append(v_codes, 'ROOF_AREA_MISMATCH');
      insert into hermes_os.pv_site_survey_findings
        (tenant_id, survey_id, code, category, severity, is_blocking,
         declared_value, measured_value, unit, comment)
      values (t, v.id, 'ROOF_AREA_MISMATCH', 'TOITURE', 'REVIEW', false,
              s.roof_area_total_m2::text, v.roof_area_total_measured_m2::text, 'm²',
              format('Écart de %s %% sur la surface totale de toiture.', round(v_pct, 1)))
      on conflict (tenant_id, survey_id, code) do update set
        severity = excluded.severity, is_blocking = excluded.is_blocking,
        declared_value = excluded.declared_value, measured_value = excluded.measured_value,
        comment = excluded.comment, updated_at = now();
    end if;
  end if;

  -- ---- 3. Azimut (différence circulaire) -----------------------------------
  if v.azimuth_measured_deg is not null and s.azimuth_deg is not null then
    v_delta := hermes_os.pv_angle_delta(v.azimuth_measured_deg, s.azimuth_deg);
    v_sev := case
      when v_delta >= hermes_os.pv_survey_threshold(t, 'AZIMUTH_BLOCKING_DEG') then 'BLOCKING'
      when v_delta >= hermes_os.pv_survey_threshold(t, 'AZIMUTH_REVIEW_DEG')   then 'REVIEW'
      else null end;
    if v_sev is not null then
      v_codes := array_append(v_codes, 'AZIMUTH_MISMATCH');
      insert into hermes_os.pv_site_survey_findings
        (tenant_id, survey_id, code, category, severity, is_blocking,
         declared_value, measured_value, unit, comment)
      values (t, v.id, 'AZIMUTH_MISMATCH', 'ORIENTATION', v_sev, v_sev = 'BLOCKING',
              s.azimuth_deg::text, v.azimuth_measured_deg::text, '°',
              format('Écart d''orientation de %s° (différence circulaire).', round(v_delta, 1)))
      on conflict (tenant_id, survey_id, code) do update set
        severity = excluded.severity, is_blocking = excluded.is_blocking,
        declared_value = excluded.declared_value, measured_value = excluded.measured_value,
        comment = excluded.comment, updated_at = now();
    end if;
  end if;

  -- ---- 4. Inclinaison ------------------------------------------------------
  if v.tilt_measured_deg is not null and s.tilt_deg is not null then
    v_delta := abs(v.tilt_measured_deg - s.tilt_deg);
    v_sev := case
      when v_delta >= hermes_os.pv_survey_threshold(t, 'TILT_BLOCKING_DEG') then 'BLOCKING'
      when v_delta >= hermes_os.pv_survey_threshold(t, 'TILT_REVIEW_DEG')   then 'REVIEW'
      else null end;
    if v_sev is not null then
      v_codes := array_append(v_codes, 'TILT_MISMATCH');
      insert into hermes_os.pv_site_survey_findings
        (tenant_id, survey_id, code, category, severity, is_blocking,
         declared_value, measured_value, unit, comment)
      values (t, v.id, 'TILT_MISMATCH', 'ORIENTATION', v_sev, v_sev = 'BLOCKING',
              s.tilt_deg::text, v.tilt_measured_deg::text, '°',
              format('Écart d''inclinaison de %s°.', round(v_delta, 1)))
      on conflict (tenant_id, survey_id, code) do update set
        severity = excluded.severity, is_blocking = excluded.is_blocking,
        declared_value = excluded.declared_value, measured_value = excluded.measured_value,
        comment = excluded.comment, updated_at = now();
    end if;
  end if;

  -- ---- 5. Type de couverture ----------------------------------------------
  if v.roof_type_measured is not null and s.roof_type is not null
     and v.roof_type_measured is distinct from s.roof_type then
    v_codes := array_append(v_codes, 'ROOF_TYPE_MISMATCH');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking,
       declared_value, measured_value, comment)
    values (t, v.id, 'ROOF_TYPE_MISMATCH', 'TOITURE', 'REVIEW', false,
            s.roof_type, v.roof_type_measured,
            'Le type de couverture constaté diffère de celui déclaré : le mode de fixation change.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      declared_value = excluded.declared_value, measured_value = excluded.measured_value,
      comment = excluded.comment, updated_at = now();
  end if;

  -- ---- 6. État de couverture ----------------------------------------------
  if v.roof_condition_measured in ('MAUVAIS', 'MOYEN') then
    v_sev := case when v.roof_condition_measured = 'MAUVAIS' then 'BLOCKING' else 'REVIEW' end;
    v_codes := array_append(v_codes, 'ROOF_CONDITION_ISSUE');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking,
       declared_value, measured_value, comment)
    values (t, v.id, 'ROOF_CONDITION_ISSUE', 'TOITURE', v_sev, v_sev = 'BLOCKING',
            s.roof_condition, v.roof_condition_measured,
            case when v.roof_condition_measured = 'MAUVAIS'
                 then 'Couverture en mauvais état constaté : poser sans reprise engagerait la responsabilité de l''entreprise.'
                 else 'Couverture en état moyen : à confirmer avant pose.' end)
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      declared_value = excluded.declared_value, measured_value = excluded.measured_value,
      comment = excluded.comment, updated_at = now();
  end if;

  -- ---- 7. Ombrage ----------------------------------------------------------
  if hermes_os.pv_shading_rank(v.shading_measured) is not null
     and hermes_os.pv_shading_rank(s.shading_level) is not null
     and v.shading_measured is distinct from s.shading_level then
    -- Deux classes d'écart vers le pire = le productible retenu n'est plus tenable.
    v_sev := case when hermes_os.pv_shading_rank(v.shading_measured)
                     - hermes_os.pv_shading_rank(s.shading_level) >= 2
                  then 'BLOCKING' else 'REVIEW' end;
    v_codes := array_append(v_codes, 'SHADING_MISMATCH');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking,
       declared_value, measured_value, comment)
    values (t, v.id, 'SHADING_MISMATCH', 'ORIENTATION', v_sev, v_sev = 'BLOCKING',
            s.shading_level, v.shading_measured,
            'La classe d''ombrage constatée diffère de celle déclarée : la production estimée en dépend.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      declared_value = excluded.declared_value, measured_value = excluded.measured_value,
      comment = excluded.comment, updated_at = now();
  end if;

  -- ---- 8. Accès ------------------------------------------------------------
  if v.roof_access = 'IMPOSSIBLE' then
    v_codes := array_append(v_codes, 'ACCESS_BLOCKED');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, comment)
    values (t, v.id, 'ACCESS_BLOCKED', 'ACCES', 'BLOCKING', true, v.roof_access,
            'Aucun accès praticable au toit constaté : la pose est impossible en l''état.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  if v.height_measured_m is not null
     and v.height_measured_m > hermes_os.pv_survey_threshold(t, 'HEIGHT_INFO_M') then
    v_codes := array_append(v_codes, 'HEIGHT_ACCESS_NOTICE');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, unit, comment)
    values (t, v.id, 'HEIGHT_ACCESS_NOTICE', 'ACCES', 'INFO', false,
            v.height_measured_m::text, 'm',
            'Hauteur relevée : les moyens d''accès et la sécurité doivent être chiffrés en conséquence.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  -- ---- 9. Électricité ------------------------------------------------------
  if v.panel_board_condition in ('DEGRADE', 'NON_CONFORME_APPARENT')
     or v.panel_board_free_slots = 0 then
    v_codes := array_append(v_codes, 'ELECTRICAL_PANEL_ISSUE');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, comment)
    values (t, v.id, 'ELECTRICAL_PANEL_ISSUE', 'ELECTRICITE', 'REVIEW', false,
            coalesce(v.panel_board_condition, 'emplacements libres : 0'),
            'Le tableau électrique constaté demande une reprise ou une extension avant raccordement.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  if v.earthing_observed = 'ABSENTE' then
    v_codes := array_append(v_codes, 'EARTHING_ISSUE');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, comment)
    values (t, v.id, 'EARTHING_ISSUE', 'ELECTRICITE', 'REVIEW', false, v.earthing_observed,
            'Aucune prise de terre observée. Constat visuel, à faire confirmer par un contrôle.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  if v.cable_distance_m is not null
     and v.cable_distance_m > hermes_os.pv_survey_threshold(t, 'CABLE_DISTANCE_REVIEW_M') then
    v_codes := array_append(v_codes, 'CABLE_ROUTE_ISSUE');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, unit, comment)
    values (t, v.id, 'CABLE_ROUTE_ISSUE', 'ELECTRICITE', 'REVIEW', false,
            v.cable_distance_m::text, 'm',
            'Cheminement long : la section de câble et la chute de tension doivent être revérifiées.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  -- ---- 10. Structure et sécurité -------------------------------------------
  if v.site_condition in ('DEGRADE', 'CRITIQUE') then
    v_sev := case when v.site_condition = 'CRITIQUE' then 'BLOCKING' else 'REVIEW' end;
    v_codes := array_append(v_codes, 'STRUCTURAL_CONCERN');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, comment)
    values (t, v.id, 'STRUCTURAL_CONCERN', 'SECURITE', v_sev, v_sev = 'BLOCKING', v.site_condition,
            'État général du site constaté : la tenue de la structure doit être établie avant pose.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  -- CONSTAT, jamais diagnostic. Ne bloque pas automatiquement : c'est à
  -- l'entreprise de décider si elle fait intervenir un opérateur certifié.
  if v.asbestos_suspicion then
    v_codes := array_append(v_codes, 'ASBESTOS_SUSPICION');
    insert into hermes_os.pv_site_survey_findings
      (tenant_id, survey_id, code, category, severity, is_blocking, measured_value, comment)
    values (t, v.id, 'ASBESTOS_SUSPICION', 'SECURITE', 'REVIEW', false, 'suspicion',
            'Suspicion d''amiante relevée sur site. CONSTAT, pas diagnostic : un diagnostic amiante relève d''un opérateur certifié.')
    on conflict (tenant_id, survey_id, code) do update set
      severity = excluded.severity, is_blocking = excluded.is_blocking,
      measured_value = excluded.measured_value, comment = excluded.comment, updated_at = now();
  end if;

  -- ---- Nettoyage : un écart qui n'est plus constaté disparaît ---------------
  -- ... SAUF s'il porte une résolution humaine. Effacer une analyse parce que la
  -- mesure a changé ferait disparaître une décision sans trace.
  delete from hermes_os.pv_site_survey_findings f
   where f.tenant_id = t and f.survey_id = v.id
     and not (f.code = any (v_codes))
     and f.resolution is null;

  select count(*) into v_n from hermes_os.pv_site_survey_findings
   where tenant_id = t and survey_id = v.id;
  return v_n;
end;
$function$;

revoke all on function hermes_os.compute_pv_survey_findings(uuid) from public;

comment on function hermes_os.compute_pv_survey_findings(uuid) is
  'PV-6 — moteur d''écarts DÉTERMINISTE. Aucune IA. Lit les seuils en base, ne touche jamais à pv_sites.';

-- ---------------------------------------------------------------------------
-- LA PORTE DE VISITE — une seule fonction, consultée partout.
--
-- Renvoie l'état de la preuve terrain pour un site :
--   NONE                 aucune visite exploitable
--   BLOCKING             une visite bloque, ou un écart bloquant non résolu
--   NOT_VALIDATED        une visite existe mais n'est pas validée
--   OK                   une visite VALIDÉE existe
--
-- Une seule règle, un seul endroit : le devis, la readiness et l'écran la
-- consultent tous. Trois copies auraient divergé.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_survey_gate(p_tenant text, p_site_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_n integer; v_blocking integer;
begin
  select count(*) into v_n from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id and status = 'VALIDATED';
  if v_n > 0 then
    -- Une visite validée ne peut pas porter d'écart bloquant non résolu : la
    -- façade de validation le refuse. On n'a donc pas à le revérifier ici.
    return 'OK';
  end if;

  select count(*) into v_blocking from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id and status = 'BLOCKING';
  if v_blocking > 0 then return 'BLOCKING'; end if;

  select count(*) into v_n from hermes_os.pv_site_surveys
   where tenant_id = p_tenant and site_id = p_site_id
     and status in ('PLANNED','IN_PROGRESS','DONE','NEEDS_REVIEW');
  if v_n > 0 then return 'NOT_VALIDATED'; end if;

  return 'NONE';
end;
$function$;

revoke all on function hermes_os.pv_survey_gate(text, uuid) from public;

commit;
