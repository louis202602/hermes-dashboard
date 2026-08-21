-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / 3 — Façades d'ÉCRITURE HUMAINE (`public.*`).
-- (project smubxqorirlfldatzmym)
--
-- Neuf gestes, tous DÉCLENCHÉS PAR UN HUMAIN. Aucune de ces façades n'est un
-- point d'entrée d'agent : les actions d'IA passent par la passerelle unique
-- (`request_agent_action` → `gateway_policy_gate` → …), et les trois capacités
-- PV correspondantes sont créées DORMANTES au lot PV-2/5.
--
-- LES GARDE-FOUS DE PV-1 RESTENT L'AUTORITÉ FINALE — c'est le point central.
-- Ces façades sont `SECURITY DEFINER`, mais cela ne leur donne AUCUN pouvoir de
-- validation supplémentaire :
--   * `auth.uid()` lit la revendication JWT de la requête, pas le propriétaire de
--     la fonction. Un `SECURITY DEFINER` n'usurpe donc pas une identité humaine ;
--   * les déclencheurs `pv_human_validation_guard` s'exécutent APRÈS la façade et
--     refusent toujours `auth.uid() is null` (runner `service_role`), un acteur
--     absent, ou un acteur ≠ appelant ;
--   * `pv_prospect_status_guard` refuse toujours une transition non déclarée ;
--   * `pv_tenant_immutable` refuse toujours un changement de tenant.
-- Conséquence VÉRIFIABLE : supprimer ces façades ne réduit aucune protection, et
-- les contourner ne permet rien de plus. Elles n'assouplissent rien.
--
-- MASS-ASSIGNMENT — refusée par construction : chaque façade a des paramètres
-- TYPÉS et NOMMÉS. Les colonnes protégées (`tenant_id`, `verified_by`,
-- `validated_by`, `verified_at`, `validated_at`, `promoted_by`) ne sont EXPOSÉES
-- sur aucun paramètre : elles sont dérivées server-side de `auth.uid()` / `now()`.
-- Un client ne peut donc pas valider au nom d'un autre utilisateur — il n'a
-- littéralement pas de champ pour l'exprimer.

begin;

-- ---------------------------------------------------------------------------
-- 1. ÉCRITURE — créer ou modifier un prospect.
--    Le STATUT n'est PAS modifiable ici : il a sa propre façade, adossée à la
--    machine à états. Séparer les deux évite qu'une correction de numéro de
--    téléphone puisse, par inadvertance, faire avancer un prospect dans le tunnel.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_prospect(
  p_prospect_id        uuid    default null,
  p_prospect_type      text    default null,
  p_first_name         text    default null,
  p_last_name          text    default null,
  p_company_name       text    default null,
  p_phone              text    default null,
  p_email              text    default null,
  p_source             text    default null,
  p_source_detail      text    default null,
  p_campaign_ref       text    default null,
  p_contact_consent    boolean default null,
  p_qualification_score integer default null,
  p_owner_user_id      uuid    default null,
  p_crm_external_id    text    default null,
  p_notes              text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_id uuid; v_consent_at timestamptz;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  v_uid := (v_g->>'uid')::uuid;

  -- MISE À JOUR. `coalesce` : un paramètre absent ne remet jamais une valeur à
  -- NULL par accident (une UI partielle n'efface pas ce qu'elle n'affiche pas).
  if p_prospect_id is not null then
    update hermes_os.pv_prospects p
       set prospect_type       = coalesce(p_prospect_type, p.prospect_type),
           first_name          = coalesce(p_first_name, p.first_name),
           last_name           = coalesce(p_last_name, p.last_name),
           company_name        = coalesce(p_company_name, p.company_name),
           phone               = coalesce(p_phone, p.phone),
           email               = coalesce(p_email, p.email),
           source              = coalesce(p_source, p.source),
           source_detail       = coalesce(p_source_detail, p.source_detail),
           campaign_ref        = coalesce(p_campaign_ref, p.campaign_ref),
           contact_consent     = coalesce(p_contact_consent, p.contact_consent),
           -- L'horodatage du consentement est POSÉ PAR LA BASE au moment où le
           -- consentement passe à vrai. Il n'est pas un paramètre : une date de
           -- consentement fournie par le client ne serait pas une preuve.
           contact_consent_at  = case
             when coalesce(p_contact_consent, p.contact_consent) and p.contact_consent_at is null
               then now() else p.contact_consent_at end,
           qualification_score = coalesce(p_qualification_score, p.qualification_score),
           owner_user_id       = coalesce(p_owner_user_id, p.owner_user_id),
           crm_external_id     = coalesce(p_crm_external_id, p.crm_external_id),
           notes               = coalesce(p_notes, p.notes),
           updated_at          = now()
     where p.id = p_prospect_id and p.tenant_id = v_t
     returning p.id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'prospect_id', v_id);
  end if;

  -- CRÉATION. Le type est obligatoire ; les CHECK de PV-1 (identité utilisable,
  -- contact présent, format e-mail) restent l'arbitre — on ne les redouble pas.
  if p_prospect_type is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_TYPE');
  end if;
  v_consent_at := case when coalesce(p_contact_consent, false) then now() else null end;

  begin
    insert into hermes_os.pv_prospects
      (tenant_id, prospect_type, first_name, last_name, company_name, phone, email,
       source, source_detail, campaign_ref, contact_consent, contact_consent_at,
       qualification_score, owner_user_id, crm_external_id, notes, created_by)
    values
      (v_t, p_prospect_type, p_first_name, p_last_name, p_company_name, p_phone, p_email,
       coalesce(p_source, 'UNKNOWN'), p_source_detail, p_campaign_ref,
       coalesce(p_contact_consent, false), v_consent_at,
       p_qualification_score, p_owner_user_id, p_crm_external_id, p_notes, v_uid)
    returning id into v_id;
  exception
    -- Un CHECK de PV-1 qui refuse est une RÉPONSE MÉTIER, pas une panne : on la
    -- rend au client sous forme de code, sans exposer le texte de la contrainte.
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_PROSPECT');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'prospect_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_prospect(uuid, text, text, text, text, text, text, text,
  text, text, boolean, integer, uuid, text, text) from public;
grant execute on function public.upsert_pv_prospect(uuid, text, text, text, text, text, text, text,
  text, text, boolean, integer, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ÉCRITURE — changer le statut d'un prospect, VIA la machine à états.
--    La façade ne connaît pas les chemins autorisés : elle les LIT dans
--    `pv_prospect_transitions`, et le déclencheur PV-1 refuse de toute façon.
--    Deux vérifications, une seule vérité.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_prospect_status(
  p_prospect_id uuid,
  p_status      text
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

  select p.status into v_current from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_current is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_current = p_status then
    return jsonb_build_object('ok', true, 'code', 'UNCHANGED', 'status', v_current);
  end if;
  if not exists (select 1 from hermes_os.pv_prospect_transitions t
                  where t.from_status = v_current and t.to_status = p_status) then
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED',
      'from', v_current, 'to', p_status);
  end if;

  begin
    update hermes_os.pv_prospects set status = p_status, updated_at = now()
     where id = p_prospect_id and tenant_id = v_t
     returning id into v_id;
  exception when check_violation then
    -- Filet : si le déclencheur PV-1 refuse malgré la pré-lecture (course sur le
    -- statut), c'est LUI qui a raison. La façade ne peut pas passer outre.
    return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED');
  end;

  return jsonb_build_object('ok', true, 'code', 'UPDATED', 'status', p_status);
end;
$function$;

revoke all on function public.set_pv_prospect_status(uuid, text) from public;
grant execute on function public.set_pv_prospect_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ÉCRITURE — créer ou modifier un site.
--    Le prospect parent est vérifié DANS LE TENANT avant l'insertion : un
--    `prospect_id` d'un autre tenant renvoie `NOT_FOUND` (l'existence n'est pas
--    révélée), et la FK composite de PV-1 refuserait de toute façon.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_site(
  p_site_id             uuid    default null,
  p_prospect_id         uuid    default null,
  p_label               text    default null,
  p_address_line1       text    default null,
  p_address_line2       text    default null,
  p_postal_code         text    default null,
  p_city                text    default null,
  p_country_code        text    default null,
  p_building_type       text    default null,
  p_building_use        text    default null,
  p_occupancy           text    default null,
  p_roof_type           text    default null,
  p_roof_material       text    default null,
  p_roof_condition      text    default null,
  p_roof_area_total_m2  numeric default null,
  p_roof_area_usable_m2 numeric default null,
  p_azimuth_deg         numeric default null,
  p_tilt_deg            numeric default null,
  p_shading_level       text    default null,
  p_shading_loss_pct    numeric default null,
  p_height_m            numeric default null,
  p_access_difficulty   text    default null,
  p_access_notes        text    default null,
  p_known_constraints   text    default null,
  p_technical_notes     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_id uuid; v_parent uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_site_id is not null then
    update hermes_os.pv_sites s
       set label               = coalesce(p_label, s.label),
           address_line1       = coalesce(p_address_line1, s.address_line1),
           address_line2       = coalesce(p_address_line2, s.address_line2),
           postal_code         = coalesce(p_postal_code, s.postal_code),
           city                = coalesce(p_city, s.city),
           country_code        = coalesce(p_country_code, s.country_code),
           building_type       = coalesce(p_building_type, s.building_type),
           building_use        = coalesce(p_building_use, s.building_use),
           occupancy           = coalesce(p_occupancy, s.occupancy),
           roof_type           = coalesce(p_roof_type, s.roof_type),
           roof_material       = coalesce(p_roof_material, s.roof_material),
           roof_condition      = coalesce(p_roof_condition, s.roof_condition),
           roof_area_total_m2  = coalesce(p_roof_area_total_m2, s.roof_area_total_m2),
           roof_area_usable_m2 = coalesce(p_roof_area_usable_m2, s.roof_area_usable_m2),
           azimuth_deg         = coalesce(p_azimuth_deg, s.azimuth_deg),
           tilt_deg            = coalesce(p_tilt_deg, s.tilt_deg),
           shading_level       = coalesce(p_shading_level, s.shading_level),
           shading_loss_pct    = coalesce(p_shading_loss_pct, s.shading_loss_pct),
           height_m            = coalesce(p_height_m, s.height_m),
           access_difficulty   = coalesce(p_access_difficulty, s.access_difficulty),
           access_notes        = coalesce(p_access_notes, s.access_notes),
           known_constraints   = coalesce(p_known_constraints, s.known_constraints),
           technical_notes     = coalesce(p_technical_notes, s.technical_notes),
           updated_at          = now()
     where s.id = p_site_id and s.tenant_id = v_t
     returning s.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'site_id', v_id);
  end if;

  if p_prospect_id is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_PROSPECT');
  end if;
  select p.id into v_parent from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_parent is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  begin
    insert into hermes_os.pv_sites
      (tenant_id, prospect_id, label, address_line1, address_line2, postal_code, city,
       country_code, building_type, building_use, occupancy, roof_type, roof_material,
       roof_condition, roof_area_total_m2, roof_area_usable_m2, azimuth_deg, tilt_deg,
       shading_level, shading_loss_pct, height_m, access_difficulty, access_notes,
       known_constraints, technical_notes)
    values
      (v_t, v_parent, p_label, p_address_line1, p_address_line2, p_postal_code, p_city,
       coalesce(p_country_code, 'FR'), p_building_type, p_building_use, p_occupancy,
       p_roof_type, p_roof_material, p_roof_condition, p_roof_area_total_m2,
       p_roof_area_usable_m2, p_azimuth_deg, p_tilt_deg, p_shading_level,
       p_shading_loss_pct, p_height_m, p_access_difficulty, p_access_notes,
       p_known_constraints, p_technical_notes)
    returning id into v_id;
  exception
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SITE');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'site_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_site(uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric,
  text, text, text, text) from public;
grant execute on function public.upsert_pv_site(uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric,
  text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ÉCRITURE — créer ou modifier un profil de consommation.
--    `verification_status` n'est PAS un paramètre : passer un profil en VERIFIED
--    est un geste de certification, pas une saisie. Il reste au déclencheur de
--    PV-1 et au lot PV-3 (il n'a pas encore de façade — dit explicitement).
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_consumption_profile(
  p_profile_id             uuid    default null,
  p_site_id                uuid    default null,
  p_energy_supplier        text    default null,
  p_subscribed_power_kva   numeric default null,
  p_annual_consumption_kwh numeric default null,
  p_annual_cost_eur        numeric default null,
  p_unit_price_eur_kwh     numeric default null,
  p_tariff_option          text    default null,
  p_delivery_point_ref     text    default null,
  p_period_start           date    default null,
  p_period_end             date    default null,
  p_data_source            text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_id uuid; v_site uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_profile_id is not null then
    update hermes_os.pv_consumption_profiles c
       set energy_supplier        = coalesce(p_energy_supplier, c.energy_supplier),
           subscribed_power_kva   = coalesce(p_subscribed_power_kva, c.subscribed_power_kva),
           annual_consumption_kwh = coalesce(p_annual_consumption_kwh, c.annual_consumption_kwh),
           annual_cost_eur        = coalesce(p_annual_cost_eur, c.annual_cost_eur),
           unit_price_eur_kwh     = coalesce(p_unit_price_eur_kwh, c.unit_price_eur_kwh),
           tariff_option          = coalesce(p_tariff_option, c.tariff_option),
           delivery_point_ref     = coalesce(p_delivery_point_ref, c.delivery_point_ref),
           period_start           = coalesce(p_period_start, c.period_start),
           period_end             = coalesce(p_period_end, c.period_end),
           data_source            = coalesce(p_data_source, c.data_source),
           updated_at             = now()
     where c.id = p_profile_id and c.tenant_id = v_t
     returning c.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'profile_id', v_id);
  end if;

  if p_site_id is null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_SITE');
  end if;
  select s.id into v_site from hermes_os.pv_sites s
   where s.id = p_site_id and s.tenant_id = v_t;
  if v_site is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  begin
    insert into hermes_os.pv_consumption_profiles
      (tenant_id, site_id, energy_supplier, subscribed_power_kva, annual_consumption_kwh,
       annual_cost_eur, unit_price_eur_kwh, tariff_option, delivery_point_ref,
       period_start, period_end, data_source)
    values
      (v_t, v_site, p_energy_supplier, p_subscribed_power_kva, p_annual_consumption_kwh,
       p_annual_cost_eur, p_unit_price_eur_kwh, p_tariff_option, p_delivery_point_ref,
       p_period_start, p_period_end, coalesce(p_data_source, 'DECLARATIVE'))
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_PROFILE');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'profile_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_consumption_profile(uuid, uuid, text, numeric, numeric,
  numeric, numeric, text, text, date, date, text) from public;
grant execute on function public.upsert_pv_consumption_profile(uuid, uuid, text, numeric, numeric,
  numeric, numeric, text, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ÉCRITURE — enregistrer / rattacher une facture énergie.
--    Le STATUT n'est pas un paramètre : une facture naît `RECEIVED`. Elle ne
--    peut atteindre `VERIFIED` que par la façade 8, sous l'autorité du
--    déclencheur PV-1. Le document est un couple (bucket privé, chemin) —
--    le CHECK de PV-1 refuse toute URL `http(s)://`.
-- ---------------------------------------------------------------------------
create or replace function public.register_pv_energy_bill(
  p_bill_id              uuid    default null,
  p_site_id              uuid    default null,
  p_supplier             text    default null,
  p_period_start         date    default null,
  p_period_end           date    default null,
  p_issued_on            date    default null,
  p_amount_ht_eur        numeric default null,
  p_amount_ttc_eur       numeric default null,
  p_consumption_kwh      numeric default null,
  p_subscribed_power_kva numeric default null,
  p_tariff_option        text    default null,
  p_delivery_point_ref   text    default null,
  p_document_id          uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_id uuid; v_site uuid;
  v_bucket text; v_path text; v_mime text; v_bytes bigint; v_sha text; v_name text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  -- Rattachement documentaire : on ne recopie JAMAIS un chemin fourni par le
  -- client. On accepte un `document_id` déjà finalisé DANS LE TENANT, et on lit
  -- ses coordonnées en base. Un chemin forgé n'a donc aucun chemin d'entrée.
  if p_document_id is not null then
    select d.storage_bucket, d.storage_path, d.mime_type, d.size_bytes, d.sha256,
           d.original_filename
      into v_bucket, v_path, v_mime, v_bytes, v_sha, v_name
      from hermes_os.pv_documents d
     where d.id = p_document_id and d.tenant_id = v_t and d.deleted_at is null;
    if v_path is null then
      return jsonb_build_object('ok', false, 'code', 'DOCUMENT_NOT_FOUND');
    end if;
  end if;

  if p_bill_id is not null then
    update hermes_os.pv_energy_bills b
       set supplier             = coalesce(p_supplier, b.supplier),
           period_start         = coalesce(p_period_start, b.period_start),
           period_end           = coalesce(p_period_end, b.period_end),
           issued_on            = coalesce(p_issued_on, b.issued_on),
           amount_ht_eur        = coalesce(p_amount_ht_eur, b.amount_ht_eur),
           amount_ttc_eur       = coalesce(p_amount_ttc_eur, b.amount_ttc_eur),
           consumption_kwh      = coalesce(p_consumption_kwh, b.consumption_kwh),
           subscribed_power_kva = coalesce(p_subscribed_power_kva, b.subscribed_power_kva),
           tariff_option        = coalesce(p_tariff_option, b.tariff_option),
           delivery_point_ref   = coalesce(p_delivery_point_ref, b.delivery_point_ref),
           document_bucket      = coalesce(v_bucket, b.document_bucket),
           document_path        = coalesce(v_path, b.document_path),
           document_mime        = coalesce(v_mime, b.document_mime),
           document_bytes       = coalesce(v_bytes, b.document_bytes),
           document_sha256      = coalesce(v_sha, b.document_sha256),
           original_filename    = coalesce(v_name, b.original_filename),
           updated_at           = now()
     where b.id = p_bill_id and b.tenant_id = v_t
     returning b.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  else
    if p_site_id is null then
      return jsonb_build_object('ok', false, 'code', 'MISSING_SITE');
    end if;
    select s.id into v_site from hermes_os.pv_sites s
     where s.id = p_site_id and s.tenant_id = v_t;
    if v_site is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;

    begin
      insert into hermes_os.pv_energy_bills
        (tenant_id, site_id, supplier, period_start, period_end, issued_on,
         amount_ht_eur, amount_ttc_eur, consumption_kwh, subscribed_power_kva,
         tariff_option, delivery_point_ref, document_bucket, document_path,
         document_mime, document_bytes, document_sha256, original_filename)
      values
        (v_t, v_site, p_supplier, p_period_start, p_period_end, p_issued_on,
         p_amount_ht_eur, p_amount_ttc_eur, p_consumption_kwh, p_subscribed_power_kva,
         p_tariff_option, p_delivery_point_ref, v_bucket, v_path,
         v_mime, v_bytes, v_sha, v_name)
      returning id into v_id;
    exception
      when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_BILL');
      when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
    end;
  end if;

  -- Lien documentaire : le document passe LINKED et pointe la facture.
  if p_document_id is not null then
    update hermes_os.pv_documents
       set bill_id = v_id, status = 'LINKED', updated_at = now()
     where id = p_document_id and tenant_id = v_t;
  end if;

  return jsonb_build_object('ok', true, 'code',
    case when p_bill_id is null then 'CREATED' else 'UPDATED' end, 'bill_id', v_id);
end;
$function$;

revoke all on function public.register_pv_energy_bill(uuid, uuid, text, date, date, date,
  numeric, numeric, numeric, numeric, text, text, uuid) from public;
grant execute on function public.register_pv_energy_bill(uuid, uuid, text, date, date, date,
  numeric, numeric, numeric, numeric, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ÉCRITURE — promouvoir une extraction IA vers NEEDS_REVIEW.
--    Enveloppe MINCE autour de `hermes_os.pv_promote_bill_extraction` (PV-1) :
--    on ne réimplémente pas la promotion, on l'expose. Aboutit toujours à
--    `NEEDS_REVIEW`, jamais `VERIFIED` — promouvoir n'est pas certifier.
-- ---------------------------------------------------------------------------
create or replace function public.promote_pv_bill_extraction(p_extraction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_exists uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  -- Bornage au tenant AVANT l'appel : une extraction d'un autre tenant renvoie
  -- `NOT_FOUND` et ne révèle pas son existence.
  select e.id into v_exists from hermes_os.pv_energy_bill_extractions e
   where e.id = p_extraction_id and e.tenant_id = v_t;
  if v_exists is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return hermes_os.pv_promote_bill_extraction(p_extraction_id);
end;
$function$;

revoke all on function public.promote_pv_bill_extraction(uuid) from public;
grant execute on function public.promote_pv_bill_extraction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ÉCRITURE — VÉRIFIER HUMAINEMENT une facture (→ VERIFIED).
--    `verified_by` = `auth.uid()`, imposé server-side. Aucun paramètre d'acteur
--    n'existe : valider au nom d'un autre est INEXPRIMABLE par cette façade, et
--    le déclencheur PV-1 le refuserait de toute façon.
-- ---------------------------------------------------------------------------
create or replace function public.verify_pv_energy_bill(
  p_bill_id uuid,
  p_reject  boolean default false,
  p_reason  text    default null
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
    update hermes_os.pv_energy_bills b
       set status           = v_status,
           verified_by      = case when v_status = 'VERIFIED' then v_uid else b.verified_by end,
           verified_at      = case when v_status = 'VERIFIED' then now() else b.verified_at end,
           rejection_reason = case when v_status = 'REJECTED' then p_reason else b.rejection_reason end,
           updated_at       = now()
     where b.id = p_bill_id and b.tenant_id = v_t
     returning b.id into v_id;
  exception when check_violation or insufficient_privilege then
    -- Le garde-fou PV-1 a refusé : c'est la bonne réponse, on la relaie.
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
  end;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'code', v_status, 'bill_id', v_id);
end;
$function$;

revoke all on function public.verify_pv_energy_bill(uuid, boolean, text) from public;
grant execute on function public.verify_pv_energy_bill(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. ÉCRITURE — VALIDER HUMAINEMENT une étude (→ VALIDATED).
--    Même contrat que la façade 7. Une étude préparée par l'Agent 5 reste
--    CALCULATED / NEEDS_REVIEW jusqu'à ce geste — et l'Agent 5 ne peut pas
--    l'exécuter : il n'a pas d'`auth.uid()`.
-- ---------------------------------------------------------------------------
create or replace function public.validate_pv_study(
  p_study_id uuid,
  p_reject   boolean default false,
  p_reason   text    default null
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
  v_status := case when coalesce(p_reject, false) then 'REJECTED' else 'VALIDATED' end;

  begin
    update hermes_os.pv_studies s
       set status           = v_status,
           validated_by     = case when v_status = 'VALIDATED' then v_uid else s.validated_by end,
           validated_at     = case when v_status = 'VALIDATED' then now() else s.validated_at end,
           rejection_reason = case when v_status = 'REJECTED' then p_reason else s.rejection_reason end,
           updated_at       = now()
     where s.id = p_study_id and s.tenant_id = v_t
     returning s.id into v_id;
  exception when check_violation or insufficient_privilege then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
  end;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'code', v_status, 'study_id', v_id);
end;
$function$;

revoke all on function public.validate_pv_study(uuid, boolean, text) from public;
grant execute on function public.validate_pv_study(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. ÉCRITURE — VÉRIFIER HUMAINEMENT un chiffrage économique (→ VERIFIED).
-- ---------------------------------------------------------------------------
create or replace function public.verify_pv_economics(
  p_economics_id uuid,
  p_reject       boolean default false,
  p_reason       text    default null
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
    update hermes_os.pv_economics e
       set status           = v_status,
           verified_by      = case when v_status = 'VERIFIED' then v_uid else e.verified_by end,
           verified_at      = case when v_status = 'VERIFIED' then now() else e.verified_at end,
           rejection_reason = case when v_status = 'REJECTED' then p_reason else e.rejection_reason end,
           updated_at       = now()
     where e.id = p_economics_id and e.tenant_id = v_t
     returning e.id into v_id;
  exception when check_violation or insufficient_privilege then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
  end;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'code', v_status, 'economics_id', v_id);
end;
$function$;

revoke all on function public.verify_pv_economics(uuid, boolean, text) from public;
grant execute on function public.verify_pv_economics(uuid, boolean, text) to authenticated;

commit;
