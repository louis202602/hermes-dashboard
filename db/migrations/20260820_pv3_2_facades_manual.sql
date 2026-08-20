-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / 2 — Façades de travail MANUEL.
-- (project smubxqorirlfldatzmym)
--
-- Objectif du lot : un humain doit pouvoir mener une affaire photovoltaïque de
-- bout en bout SANS aucun agent IA et SANS n8n. PV-2 avait ouvert la lecture et
-- la validation ; il manquait la CRÉATION et la MODIFICATION d'une étude et d'un
-- chiffrage, ainsi que la vérification humaine d'un profil de consommation.
--
-- Contrat INCHANGÉ, repris à l'identique de PV-2 :
--   * `SECURITY DEFINER`, `search_path` verrouillé ;
--   * `REVOKE ALL … FROM public` puis `GRANT EXECUTE … TO authenticated` ;
--   * tenant résolu server-side par `hermes_os.pv_guard()` — aucun paramètre
--     `tenant_id`, sur aucune signature ;
--   * aucun paramètre d'ACTEUR : `verified_by` / `validated_by` viennent
--     d'`auth.uid()`. Valider au nom d'autrui reste inexprimable ;
--   * les garde-fous PV-1 (validation humaine) et PV-3/1 (machines à états)
--     restent l'autorité finale : ces façades ne peuvent rien assouplir.
--
-- Un humain crée toujours en `DRAFT`. Le statut n'est PAS un paramètre des
-- façades d'écriture : il a ses propres façades, adossées à la machine à états.
-- Séparer les deux évite qu'une correction de puissance fasse avancer une étude.

begin;

-- ---------------------------------------------------------------------------
-- 1. VÉRIFICATION HUMAINE d'un profil de consommation.
--    La colonne `verification_status`, `verified_by`, `verified_at` et la garde
--    `pv_human_validation_guard` EXISTENT DÉJÀ depuis PV-1 — vérifié en base.
--    Aucune évolution de schéma n'est donc nécessaire : il ne manquait que
--    cette façade. On n'ajoute pas une colonne pour le plaisir d'en ajouter.
-- ---------------------------------------------------------------------------
create or replace function public.verify_pv_consumption_profile(
  p_profile_id uuid,
  p_reject     boolean default false,
  p_reason     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_id uuid; v_status text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  v_uid := (v_g->>'uid')::uuid;
  v_status := case when coalesce(p_reject, false) then 'REJECTED' else 'VERIFIED' end;

  begin
    update hermes_os.pv_consumption_profiles c
       set verification_status = v_status,
           verified_by = case when v_status = 'VERIFIED' then v_uid else c.verified_by end,
           verified_at = case when v_status = 'VERIFIED' then now() else c.verified_at end,
           metadata    = case when v_status = 'REJECTED' and p_reason is not null
                              then c.metadata || jsonb_build_object('rejection_reason', p_reason)
                              else c.metadata end,
           updated_at  = now()
     where c.id = p_profile_id and c.tenant_id = v_t
     returning c.id into v_id;
  exception when check_violation or insufficient_privilege then
    -- Le garde-fou PV-1 a refusé : c'est la bonne réponse, on la relaie telle quelle.
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
  end;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'code', v_status, 'profile_id', v_id);
end;
$function$;

revoke all on function public.verify_pv_consumption_profile(uuid, boolean, text) from public;
grant execute on function public.verify_pv_consumption_profile(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. CRÉER ou MODIFIER une étude, à la main.
--    À la création : `status = 'DRAFT'`, `prepared_by = 'MANUAL'`, et la version
--    est calculée EN BASE (max + 1 sur le site) — pas proposée par le client,
--    sinon deux onglets ouverts produiraient deux « version 1 ».
--    `status`, `validated_by`, `validated_at` ne sont paramètres de RIEN ici.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_study(
  p_study_id                  uuid    default null,
  p_site_id                   uuid    default null,
  p_target_power_kwc          numeric default null,
  p_panel_count               integer default null,
  p_panel_unit_power_w        numeric default null,
  p_panel_brand               text    default null,
  p_panel_reference           text    default null,
  p_inverter_type             text    default null,
  p_inverter_brand            text    default null,
  p_inverter_reference        text    default null,
  p_microinverter_count       integer default null,
  p_has_battery               boolean default null,
  p_battery_capacity_kwh      numeric default null,
  p_battery_power_kw          numeric default null,
  p_annual_production_kwh     numeric default null,
  p_specific_yield_kwh_kwc    numeric default null,
  p_self_consumption_rate_pct numeric default null,
  p_self_production_rate_pct  numeric default null,
  p_surplus_kwh               numeric default null,
  p_system_losses_pct         numeric default null,
  p_calculation_method        text    default null,
  p_source                    text    default null,
  p_source_reference          text    default null,
  p_notes                     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_id uuid; v_site uuid; v_version int;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_study_id is not null then
    begin
      update hermes_os.pv_studies s
         set target_power_kwc          = coalesce(p_target_power_kwc, s.target_power_kwc),
             panel_count               = coalesce(p_panel_count, s.panel_count),
             panel_unit_power_w        = coalesce(p_panel_unit_power_w, s.panel_unit_power_w),
             panel_brand               = coalesce(p_panel_brand, s.panel_brand),
             panel_reference           = coalesce(p_panel_reference, s.panel_reference),
             inverter_type             = coalesce(p_inverter_type, s.inverter_type),
             inverter_brand            = coalesce(p_inverter_brand, s.inverter_brand),
             inverter_reference        = coalesce(p_inverter_reference, s.inverter_reference),
             microinverter_count       = coalesce(p_microinverter_count, s.microinverter_count),
             has_battery               = coalesce(p_has_battery, s.has_battery),
             -- Une batterie retirée doit emporter ses caractéristiques, sinon le
             -- CHECK `pv_studies_batterie_coherente` refuserait la ligne.
             battery_capacity_kwh      = case when coalesce(p_has_battery, s.has_battery)
                                              then coalesce(p_battery_capacity_kwh, s.battery_capacity_kwh)
                                              else null end,
             battery_power_kw          = case when coalesce(p_has_battery, s.has_battery)
                                              then coalesce(p_battery_power_kw, s.battery_power_kw)
                                              else null end,
             annual_production_kwh     = coalesce(p_annual_production_kwh, s.annual_production_kwh),
             specific_yield_kwh_kwc    = coalesce(p_specific_yield_kwh_kwc, s.specific_yield_kwh_kwc),
             self_consumption_rate_pct = coalesce(p_self_consumption_rate_pct, s.self_consumption_rate_pct),
             self_production_rate_pct  = coalesce(p_self_production_rate_pct, s.self_production_rate_pct),
             surplus_kwh               = coalesce(p_surplus_kwh, s.surplus_kwh),
             system_losses_pct         = coalesce(p_system_losses_pct, s.system_losses_pct),
             calculation_method        = coalesce(p_calculation_method, s.calculation_method),
             source                    = coalesce(p_source, s.source),
             source_reference          = coalesce(p_source_reference, s.source_reference),
             notes                     = coalesce(p_notes, s.notes),
             updated_at                = now()
       where s.id = p_study_id and s.tenant_id = v_t
       returning s.id into v_id;
    exception
      when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_STUDY');
      when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE_VERSION');
    end;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'study_id', v_id);
  end if;

  if p_site_id is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_SITE');
  end if;
  select s.id into v_site from hermes_os.pv_sites s
   where s.id = p_site_id and s.tenant_id = v_t;
  if v_site is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- Version calculée EN BASE. `unique (tenant_id, site_id, version)` reste
  -- l'arbitre en cas de course : on rend alors un code, pas une erreur brute.
  select coalesce(max(s.version), 0) + 1 into v_version
    from hermes_os.pv_studies s where s.tenant_id = v_t and s.site_id = v_site;

  begin
    insert into hermes_os.pv_studies
      (tenant_id, site_id, version, status, prepared_by,
       target_power_kwc, panel_count, panel_unit_power_w, panel_brand, panel_reference,
       inverter_type, inverter_brand, inverter_reference, microinverter_count,
       has_battery, battery_capacity_kwh, battery_power_kw,
       annual_production_kwh, specific_yield_kwh_kwc, self_consumption_rate_pct,
       self_production_rate_pct, surplus_kwh, system_losses_pct,
       calculation_method, source, source_reference, notes)
    values
      (v_t, v_site, v_version, 'DRAFT', 'MANUAL',
       p_target_power_kwc, p_panel_count, p_panel_unit_power_w, p_panel_brand, p_panel_reference,
       p_inverter_type, p_inverter_brand, p_inverter_reference, p_microinverter_count,
       coalesce(p_has_battery, false),
       case when coalesce(p_has_battery, false) then p_battery_capacity_kwh else null end,
       case when coalesce(p_has_battery, false) then p_battery_power_kw else null end,
       p_annual_production_kwh, p_specific_yield_kwh_kwc, p_self_consumption_rate_pct,
       p_self_production_rate_pct, p_surplus_kwh, p_system_losses_pct,
       p_calculation_method, coalesce(p_source, 'MANUAL'), p_source_reference, p_notes)
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_STUDY');
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE_VERSION');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'study_id', v_id, 'version', v_version);
end;
$function$;

revoke all on function public.upsert_pv_study(uuid, uuid, numeric, integer, numeric, text, text,
  text, text, text, integer, boolean, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, text, text, text, text) from public;
grant execute on function public.upsert_pv_study(uuid, uuid, numeric, integer, numeric, text, text,
  text, text, text, integer, boolean, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. HYPOTHÈSES d'une étude — colonnes TYPÉES de PV-1, 1:1 avec l'étude.
--    Un temps de retour sans hypothèse affichée n'est pas exploitable : c'est la
--    raison d'être de cette table, et de cette façade.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_study_assumptions(
  p_study_id                   uuid,
  p_energy_price_eur_kwh       numeric default null,
  p_energy_price_inflation_pct numeric default null,
  p_analysis_horizon_years     integer default null,
  p_discount_rate_pct          numeric default null,
  p_panel_degradation_pct_year numeric default null,
  p_system_losses_pct          numeric default null,
  p_surplus_sale_price_eur_kwh numeric default null,
  p_subsidy_total_eur          numeric default null,
  p_subsidy_scheme             text    default null,
  p_vat_rate_pct               numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_study uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select s.id into v_study from hermes_os.pv_studies s
   where s.id = p_study_id and s.tenant_id = v_t;
  if v_study is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  begin
    insert into hermes_os.pv_study_assumptions
      (study_id, tenant_id, energy_price_eur_kwh, energy_price_inflation_pct,
       analysis_horizon_years, discount_rate_pct, panel_degradation_pct_year,
       system_losses_pct, surplus_sale_price_eur_kwh, subsidy_total_eur,
       subsidy_scheme, vat_rate_pct)
    values
      (v_study, v_t, p_energy_price_eur_kwh, p_energy_price_inflation_pct,
       p_analysis_horizon_years, p_discount_rate_pct, p_panel_degradation_pct_year,
       p_system_losses_pct, p_surplus_sale_price_eur_kwh, p_subsidy_total_eur,
       p_subsidy_scheme, p_vat_rate_pct)
    on conflict (study_id) do update set
      energy_price_eur_kwh       = coalesce(excluded.energy_price_eur_kwh, hermes_os.pv_study_assumptions.energy_price_eur_kwh),
      energy_price_inflation_pct = coalesce(excluded.energy_price_inflation_pct, hermes_os.pv_study_assumptions.energy_price_inflation_pct),
      analysis_horizon_years     = coalesce(excluded.analysis_horizon_years, hermes_os.pv_study_assumptions.analysis_horizon_years),
      discount_rate_pct          = coalesce(excluded.discount_rate_pct, hermes_os.pv_study_assumptions.discount_rate_pct),
      panel_degradation_pct_year = coalesce(excluded.panel_degradation_pct_year, hermes_os.pv_study_assumptions.panel_degradation_pct_year),
      system_losses_pct          = coalesce(excluded.system_losses_pct, hermes_os.pv_study_assumptions.system_losses_pct),
      surplus_sale_price_eur_kwh = coalesce(excluded.surplus_sale_price_eur_kwh, hermes_os.pv_study_assumptions.surplus_sale_price_eur_kwh),
      subsidy_total_eur          = coalesce(excluded.subsidy_total_eur, hermes_os.pv_study_assumptions.subsidy_total_eur),
      subsidy_scheme             = coalesce(excluded.subsidy_scheme, hermes_os.pv_study_assumptions.subsidy_scheme),
      vat_rate_pct               = coalesce(excluded.vat_rate_pct, hermes_os.pv_study_assumptions.vat_rate_pct),
      updated_at                 = now();
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ASSUMPTIONS');
  end;

  return jsonb_build_object('ok', true, 'code', 'OK', 'study_id', v_study);
end;
$function$;

revoke all on function public.upsert_pv_study_assumptions(uuid, numeric, numeric, integer, numeric,
  numeric, numeric, numeric, numeric, text, numeric) from public;
grant execute on function public.upsert_pv_study_assumptions(uuid, numeric, numeric, integer, numeric,
  numeric, numeric, numeric, numeric, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. AVANCER le statut d'une étude, VIA la machine à états.
--    `VALIDATED` n'est PAS atteignable ici : la validation humaine reste la
--    façade dédiée `validate_pv_study`, qui seule inscrit l'acteur. Refuser
--    explicitement évite qu'un jour ce chemin devienne une porte dérobée.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_study_status(
  p_study_id uuid,
  p_status   text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_current text; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_status = 'VALIDATED' then
    return jsonb_build_object('ok', false, 'code', 'USE_VALIDATION_FACADE');
  end if;

  select s.status into v_current from hermes_os.pv_studies s
   where s.id = p_study_id and s.tenant_id = v_t;
  if v_current is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_current = p_status then
    return jsonb_build_object('ok', true, 'code', 'UNCHANGED', 'status', v_current);
  end if;
  if not exists (select 1 from hermes_os.pv_status_transitions t
                  where t.entity = 'pv_studies' and t.from_status = v_current and t.to_status = p_status) then
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_current, 'to', p_status);
  end if;

  begin
    update hermes_os.pv_studies
       set status = p_status,
           calculated_at = case when p_status = 'CALCULATED' then now() else calculated_at end,
           updated_at = now()
     where id = p_study_id and tenant_id = v_t
     returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED');
  end;

  return jsonb_build_object('ok', true, 'code', 'UPDATED', 'status', p_status);
end;
$function$;

revoke all on function public.set_pv_study_status(uuid, text) from public;
grant execute on function public.set_pv_study_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. CRÉER ou MODIFIER un chiffrage économique, à la main.
--    Création en `DRAFT`, `computed_by = 'MANUAL'`. Aucun chiffre n'est calculé
--    par cette façade : elle enregistre ce qu'un humain a établi. Déduire le
--    reste à charge ou le temps de retour ici reviendrait à produire un chiffre
--    montré au client sans que personne ne l'ait posé.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_economics(
  p_economics_id       uuid    default null,
  p_study_id           uuid    default null,
  p_investment_ht_eur  numeric default null,
  p_investment_ttc_eur numeric default null,
  p_subsidy_total_eur  numeric default null,
  p_net_cost_eur       numeric default null,
  p_year1_savings_eur  numeric default null,
  p_surplus_revenue_eur numeric default null,
  p_annual_gain_eur    numeric default null,
  p_simple_roi_pct     numeric default null,
  p_payback_years      numeric default null,
  p_npv_eur            numeric default null,
  p_irr_pct            numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_id uuid; v_study uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_economics_id is not null then
    begin
      update hermes_os.pv_economics e
         set investment_ht_eur   = coalesce(p_investment_ht_eur, e.investment_ht_eur),
             investment_ttc_eur  = coalesce(p_investment_ttc_eur, e.investment_ttc_eur),
             subsidy_total_eur   = coalesce(p_subsidy_total_eur, e.subsidy_total_eur),
             net_cost_eur        = coalesce(p_net_cost_eur, e.net_cost_eur),
             year1_savings_eur   = coalesce(p_year1_savings_eur, e.year1_savings_eur),
             surplus_revenue_eur = coalesce(p_surplus_revenue_eur, e.surplus_revenue_eur),
             annual_gain_eur     = coalesce(p_annual_gain_eur, e.annual_gain_eur),
             simple_roi_pct      = coalesce(p_simple_roi_pct, e.simple_roi_pct),
             payback_years       = coalesce(p_payback_years, e.payback_years),
             npv_eur             = coalesce(p_npv_eur, e.npv_eur),
             irr_pct             = coalesce(p_irr_pct, e.irr_pct),
             updated_at          = now()
       where e.id = p_economics_id and e.tenant_id = v_t
       returning e.id into v_id;
    exception when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ECONOMICS');
    end;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'economics_id', v_id);
  end if;

  if p_study_id is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_STUDY');
  end if;
  select s.id into v_study from hermes_os.pv_studies s
   where s.id = p_study_id and s.tenant_id = v_t;
  if v_study is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  begin
    insert into hermes_os.pv_economics
      (tenant_id, study_id, status, computed_by,
       investment_ht_eur, investment_ttc_eur, subsidy_total_eur, net_cost_eur,
       year1_savings_eur, surplus_revenue_eur, annual_gain_eur,
       simple_roi_pct, payback_years, npv_eur, irr_pct)
    values
      (v_t, v_study, 'DRAFT', 'MANUAL',
       p_investment_ht_eur, p_investment_ttc_eur, p_subsidy_total_eur, p_net_cost_eur,
       p_year1_savings_eur, p_surplus_revenue_eur, p_annual_gain_eur,
       p_simple_roi_pct, p_payback_years, p_npv_eur, p_irr_pct)
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_ECONOMICS');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'economics_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_economics(uuid, uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.upsert_pv_economics(uuid, uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AVANCER le statut d'un chiffrage, VIA la machine à états.
--    `VERIFIED` n'est pas atteignable ici — même raison qu'au point 4.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_economics_status(
  p_economics_id uuid,
  p_status       text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_current text; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_status = 'VERIFIED' then
    return jsonb_build_object('ok', false, 'code', 'USE_VALIDATION_FACADE');
  end if;

  select e.status into v_current from hermes_os.pv_economics e
   where e.id = p_economics_id and e.tenant_id = v_t;
  if v_current is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_current = p_status then
    return jsonb_build_object('ok', true, 'code', 'UNCHANGED', 'status', v_current);
  end if;
  if not exists (select 1 from hermes_os.pv_status_transitions t
                  where t.entity = 'pv_economics' and t.from_status = v_current and t.to_status = p_status) then
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_current, 'to', p_status);
  end if;

  begin
    update hermes_os.pv_economics set status = p_status, updated_at = now()
     where id = p_economics_id and tenant_id = v_t
     returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED');
  end;

  return jsonb_build_object('ok', true, 'code', 'UPDATED', 'status', p_status);
end;
$function$;

revoke all on function public.set_pv_economics_status(uuid, text) from public;
grant execute on function public.set_pv_economics_status(uuid, text) to authenticated;

commit;
