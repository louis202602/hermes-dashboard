-- 20260819_pv1_1_schema.sql
-- PACK PHOTOVOLTAÏQUE — LOT PV-1 : modèle de données métier natif.
-- Applied to project smubxqorirlfldatzmym. Idempotent (create table if not exists).
--
-- POURQUOI CE LOT EXISTE. L'audit read-only du 2026-08-19 a établi, requête à
-- l'appui, que le schéma `hermes_os` (178 tables) ne contenait AUCUNE colonne
-- photovoltaïque : ni kWc, ni panneau, ni onduleur, ni toiture, ni orientation,
-- ni PVGIS, ni facture d'énergie. Les Agents 4 (Analyse Facture EDF) et 5
-- (Bureau d'Études PV) étaient actifs dans n8n mais ORPHELINS — aucune table ne
-- pouvait recevoir leur sortie. Ce lot construit cette couche, et rien d'autre.
--
-- CE QUE CE LOT NE FAIT PAS, VOLONTAIREMENT :
--   devis · factures client · paiements · Consuel · raccordement Enedis ·
--   commandes fournisseurs · planning chantier · réception · SAV · avis client ·
--   PVGIS/OpenSolar en production · UI · consumers n8n · activation d'agent.
--   Aucune capacité n'est ajoutée à `agent_action_catalog`. Aucun workflow n8n
--   n'est touché. Aucune verticale existante (photo/immo/peinture/btp) n'est modifiée.
--
-- INVARIANTS STRUCTURELS DE CE LOT :
--   1. `tenant_id` NOT NULL + FK vers `tenants` sur CHAQUE table.
--   2. RLS activée, ZÉRO policy => deny-all. L'accès applicatif passera
--      exclusivement par des façades SECURITY DEFINER (lot PV-2).
--   3. `timestamptz` partout. Aucune colonne temporelle naïve.
--   4. Statuts sous contrainte CHECK, jamais du texte libre.
--   5. Aucune donnée métier critique uniquement en JSON : les hypothèses
--      d'étude sont des COLONNES typées (`pv_study_assumptions`), le JSON
--      complémentaire est explicitement secondaire.
--   6. Une donnée produite par l'IA ne peut PAS s'auto-valider — garanti par
--      déclencheur, pas par consigne (voir lot PV-1/2).
--   7. Aucune URL publique stockée : un document est (bucket privé, chemin),
--      sur le patron déjà éprouvé de `photo_session_assets.proxy_path`.
--
-- Réversible : 20260819_pv1_9_rollback.sql

-- ---------------------------------------------------------------------------
-- 1. PROSPECTS
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_prospects (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id)
                        on update cascade on delete restrict,

  prospect_type       text not null
                        check (prospect_type in ('PARTICULIER','PROFESSIONNEL','INDUSTRIEL','AGRICOLE')),

  -- Identité. `last_name` et `company_name` sont nullables séparément : une
  -- contrainte croisée impose qu'au moins un identifiant utilisable existe,
  -- selon le type — un professionnel sans raison sociale n'est pas exploitable,
  -- un particulier sans nom non plus.
  first_name          text check (first_name is null or length(btrim(first_name)) between 1 and 120),
  last_name           text check (last_name  is null or length(btrim(last_name))  between 1 and 120),
  company_name        text check (company_name is null or length(btrim(company_name)) between 1 and 200),
  constraint pv_prospects_identite_utilisable check (
    case prospect_type
      when 'PARTICULIER' then last_name is not null
      else company_name is not null
    end
  ),

  phone               text check (phone is null or length(btrim(phone)) between 4 and 40),
  email               text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  -- Au moins un canal de contact, sinon le prospect n'est pas actionnable.
  constraint pv_prospects_contact_present check (phone is not null or email is not null),

  source              text not null default 'UNKNOWN'
                        check (source in ('WEB','PHONE','REFERRAL','PARTNER','FIELD','EVENT','INBOUND_MAIL','CAMPAIGN','UNKNOWN')),
  source_detail       text check (source_detail is null or length(source_detail) <= 200),
  campaign_ref        text check (campaign_ref is null or length(campaign_ref) <= 120),

  -- RGPD : le consentement est daté ET horodaté, et l'opposition est portée à
  -- part. Un consentement « true » sans date est refusé : il ne serait pas
  -- opposable.
  contact_consent     boolean not null default false,
  contact_consent_at  timestamptz,
  constraint pv_prospects_consent_date check (contact_consent = false or contact_consent_at is not null),
  opted_out           boolean not null default false,
  opted_out_at        timestamptz,
  constraint pv_prospects_optout_date check (opted_out = false or opted_out_at is not null),

  status              text not null default 'NEW'
                        check (status in ('NEW','CONTACTED','QUALIFYING','QUALIFIED','UNQUALIFIED',
                                          'STUDY_REQUESTED','STUDY_DELIVERED','WON','LOST','ON_HOLD','ARCHIVED')),
  qualification_score integer check (qualification_score is null or qualification_score between 0 and 100),

  owner_user_id       uuid references auth.users(id) on delete set null,
  crm_external_id     text check (crm_external_id is null or length(crm_external_id) <= 200),

  notes               text,
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,

  -- Clé candidate COMPOSITE. Sans elle, une FK enfant sur `id` seul laisserait
  -- un site pointer le prospect d'un AUTRE tenant : l'isolation serait fausse
  -- au niveau du schéma, quelles que soient les façades.
  constraint pv_prospects_tenant_id_key unique (tenant_id, id)
);

-- Table de transitions : ajouter un chemin autorisé = insérer une ligne, jamais
-- modifier du code. Le déclencheur du lot 2 s'y réfère.
create table if not exists hermes_os.pv_prospect_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

insert into hermes_os.pv_prospect_transitions (from_status, to_status) values
  ('NEW','CONTACTED'), ('NEW','UNQUALIFIED'), ('NEW','ON_HOLD'), ('NEW','ARCHIVED'),
  ('CONTACTED','QUALIFYING'), ('CONTACTED','UNQUALIFIED'), ('CONTACTED','ON_HOLD'), ('CONTACTED','LOST'),
  ('QUALIFYING','QUALIFIED'), ('QUALIFYING','UNQUALIFIED'), ('QUALIFYING','ON_HOLD'), ('QUALIFYING','LOST'),
  ('QUALIFIED','STUDY_REQUESTED'), ('QUALIFIED','ON_HOLD'), ('QUALIFIED','LOST'),
  ('STUDY_REQUESTED','STUDY_DELIVERED'), ('STUDY_REQUESTED','ON_HOLD'), ('STUDY_REQUESTED','LOST'),
  ('STUDY_DELIVERED','WON'), ('STUDY_DELIVERED','LOST'), ('STUDY_DELIVERED','ON_HOLD'),
  ('ON_HOLD','CONTACTED'), ('ON_HOLD','QUALIFYING'), ('ON_HOLD','QUALIFIED'),
  ('ON_HOLD','STUDY_REQUESTED'), ('ON_HOLD','STUDY_DELIVERED'), ('ON_HOLD','LOST'), ('ON_HOLD','ARCHIVED'),
  ('WON','ARCHIVED'),
  ('LOST','CONTACTED'), ('LOST','ARCHIVED'),
  ('UNQUALIFIED','CONTACTED'), ('UNQUALIFIED','ARCHIVED')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. SITES — un prospect peut en avoir plusieurs
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_sites (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null references hermes_os.tenants(tenant_id)
                          on update cascade on delete restrict,
  -- RESTRICT et non CASCADE : supprimer un prospect ne doit pas faire
  -- disparaître silencieusement ses sites, ses études et son historique.
  prospect_id           uuid not null,
  -- FK COMPOSITE : le site hérite du tenant de son prospect. Un site ne peut
  -- structurellement pas référencer le prospect d'un autre tenant.
  constraint pv_sites_prospect_fk foreign key (tenant_id, prospect_id)
    references hermes_os.pv_prospects (tenant_id, id) on update cascade on delete restrict,

  label                 text check (label is null or length(label) <= 120),
  address_line1         text not null check (length(btrim(address_line1)) between 1 and 200),
  address_line2         text check (address_line2 is null or length(address_line2) <= 200),
  postal_code           text not null check (length(btrim(postal_code)) between 2 and 12),
  city                  text not null check (length(btrim(city)) between 1 and 120),
  country_code          text not null default 'FR' check (country_code ~ '^[A-Z]{2}$'),
  latitude              double precision check (latitude is null or latitude between -90 and 90),
  longitude             double precision check (longitude is null or longitude between -180 and 180),

  building_type         text check (building_type is null or building_type in
                          ('MAISON','IMMEUBLE','HANGAR','ENTREPOT','ATELIER','BUREAU','COMMERCE',
                           'EXPLOITATION_AGRICOLE','SERRE','OMBRIERE','SOL','AUTRE')),
  building_use          text check (building_use is null or building_use in
                          ('RESIDENTIEL','TERTIAIRE','INDUSTRIEL','AGRICOLE','MIXTE','AUTRE')),
  occupancy             text check (occupancy is null or occupancy in ('PROPRIETAIRE','LOCATAIRE','COPROPRIETE','AUTRE')),

  roof_type             text check (roof_type is null or roof_type in
                          ('PENTE','TERRASSE','MULTIPENTE','SHED','COURBE','SOL','OMBRIERE','AUTRE')),
  roof_material         text check (roof_material is null or roof_material in
                          ('TUILE','ARDOISE','BAC_ACIER','FIBROCIMENT','BITUME','ZINC','AUTRE')),
  roof_condition        text check (roof_condition is null or roof_condition in ('BON','MOYEN','MAUVAIS','INCONNU')),

  -- Surfaces en m². Numériques : l'exploitable ne peut pas dépasser le total.
  roof_area_total_m2      numeric(10,2) check (roof_area_total_m2 is null or roof_area_total_m2 > 0),
  roof_area_usable_m2     numeric(10,2) check (roof_area_usable_m2 is null or roof_area_usable_m2 > 0),
  constraint pv_sites_surface_coherente check (
    roof_area_total_m2 is null or roof_area_usable_m2 is null
    or roof_area_usable_m2 <= roof_area_total_m2
  ),

  -- Orientation en AZIMUT DEGRÉS (0 = Nord, 90 = Est, 180 = Sud, 270 = Ouest) —
  -- numérique, pas une chaîne libre : un moteur de calcul (PVGIS) en a besoin
  -- comme nombre, et « plein sud » n'est pas calculable.
  azimuth_deg           numeric(5,2) check (azimuth_deg is null or azimuth_deg >= 0 and azimuth_deg < 360),
  -- Inclinaison en degrés depuis l'horizontale (0 = plat, 90 = vertical).
  tilt_deg              numeric(4,2) check (tilt_deg is null or tilt_deg between 0 and 90),

  shading_level         text check (shading_level is null or shading_level in ('AUCUN','FAIBLE','MODERE','FORT')),
  shading_loss_pct      numeric(5,2) check (shading_loss_pct is null or shading_loss_pct between 0 and 100),
  shading_sources       text,

  height_m              numeric(6,2) check (height_m is null or height_m > 0),
  access_difficulty     text check (access_difficulty is null or access_difficulty in ('FACILE','MOYEN','DIFFICILE','TRES_DIFFICILE')),
  access_notes          text,
  known_constraints     text,
  technical_notes       text,

  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint pv_sites_tenant_id_key unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- 3. PROFILS DE CONSOMMATION
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_consumption_profiles (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               text not null references hermes_os.tenants(tenant_id)
                            on update cascade on delete restrict,
  site_id                 uuid not null,
  constraint pv_consumption_site_fk foreign key (tenant_id, site_id)
    references hermes_os.pv_sites (tenant_id, id) on update cascade on delete restrict,

  energy_supplier         text check (energy_supplier is null or length(energy_supplier) <= 120),
  subscribed_power_kva    numeric(7,2) check (subscribed_power_kva is null or subscribed_power_kva > 0),
  annual_consumption_kwh  numeric(12,2) check (annual_consumption_kwh is null or annual_consumption_kwh >= 0),
  -- Consommation mensuelle : 12 valeurs ordonnées (janvier → décembre) quand
  -- elle est connue. Tableau typé, pas un JSON informe.
  monthly_consumption_kwh numeric(12,2)[] check (
    monthly_consumption_kwh is null or array_length(monthly_consumption_kwh, 1) = 12
  ),
  annual_cost_eur         numeric(12,2) check (annual_cost_eur is null or annual_cost_eur >= 0),
  unit_price_eur_kwh      numeric(8,5) check (unit_price_eur_kwh is null or unit_price_eur_kwh >= 0),
  tariff_option           text check (tariff_option is null or tariff_option in
                            ('BASE','HPHC','TEMPO','EJP','POINTE_MOBILE','AUTRE')),
  -- Point de livraison / point référence mesure. 14 chiffres en France.
  delivery_point_ref      text check (delivery_point_ref is null or delivery_point_ref ~ '^[0-9]{14}$'),

  period_start            date,
  period_end              date,
  constraint pv_consumption_periode_coherente check (
    period_start is null or period_end is null or period_end >= period_start
  ),

  data_source             text not null default 'DECLARATIVE'
                            check (data_source in ('DECLARATIVE','BILL','METER','ESTIMATE','PARTNER','OTHER')),
  verification_status     text not null default 'UNVERIFIED'
                            check (verification_status in ('UNVERIFIED','NEEDS_REVIEW','VERIFIED','REJECTED')),
  verified_by             uuid references auth.users(id) on delete set null,
  verified_at             timestamptz,
  constraint pv_consumption_verifie_par_humain check (
    verification_status <> 'VERIFIED' or (verified_by is not null and verified_at is not null)
  ),

  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. FACTURES D'ÉNERGIE — document source / extraction / donnée validée
-- ---------------------------------------------------------------------------
-- Trois niveaux SÉPARÉS, c'est l'exigence structurante :
--   `pv_energy_bills`            = le document source + les valeurs RETENUES
--   `pv_energy_bill_extractions` = ce que l'IA a LU, avec sa confiance
-- Une extraction n'écrit jamais dans les colonnes retenues : une écriture
-- humaine explicite les y promeut (fonction du lot 2).
create table if not exists hermes_os.pv_energy_bills (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null references hermes_os.tenants(tenant_id)
                          on update cascade on delete restrict,
  site_id               uuid not null,
  constraint pv_energy_bills_site_fk foreign key (tenant_id, site_id)
    references hermes_os.pv_sites (tenant_id, id) on update cascade on delete restrict,

  -- Document : bucket privé + chemin, JAMAIS une URL. Patron identique à
  -- `photo_session_assets.proxy_path`. Le bucket `hermes-pv-documents` sera
  -- créé avec sa RLS storage au lot PV-2 : PV-1 ne pose que le contrat.
  document_bucket       text check (document_bucket is null or document_bucket in
                          ('hermes-pv-documents','hermes-chat-attachments')),
  document_path         text check (document_path is null or (length(document_path) between 1 and 400
                          and document_path !~* '^https?://')),
  document_sha256       text check (document_sha256 is null or document_sha256 ~ '^[a-f0-9]{64}$'),
  document_mime         text check (document_mime is null or document_mime in
                          ('application/pdf','image/jpeg','image/png','image/webp')),
  document_bytes        bigint check (document_bytes is null or document_bytes > 0),
  original_filename     text check (original_filename is null or length(original_filename) <= 260),
  constraint pv_energy_bills_document_complet check (
    (document_bucket is null and document_path is null)
    or (document_bucket is not null and document_path is not null)
  ),

  supplier              text check (supplier is null or length(supplier) <= 120),
  period_start          date,
  period_end            date,
  issued_on             date,
  constraint pv_bills_periode_coherente check (
    period_start is null or period_end is null or period_end >= period_start
  ),

  -- Valeurs RETENUES (promues depuis une extraction, ou saisies à la main).
  amount_ht_eur         numeric(12,2) check (amount_ht_eur is null or amount_ht_eur >= 0),
  amount_ttc_eur        numeric(12,2) check (amount_ttc_eur is null or amount_ttc_eur >= 0),
  consumption_kwh       numeric(12,2) check (consumption_kwh is null or consumption_kwh >= 0),
  subscribed_power_kva  numeric(7,2) check (subscribed_power_kva is null or subscribed_power_kva > 0),
  tariff_option         text check (tariff_option is null or tariff_option in
                          ('BASE','HPHC','TEMPO','EJP','POINTE_MOBILE','AUTRE')),
  delivery_point_ref    text check (delivery_point_ref is null or delivery_point_ref ~ '^[0-9]{14}$'),

  status                text not null default 'RECEIVED'
                          check (status in ('RECEIVED','EXTRACTED','NEEDS_REVIEW','VERIFIED','REJECTED')),
  verified_by           uuid references auth.users(id) on delete set null,
  verified_at           timestamptz,
  rejection_reason      text,
  constraint pv_bills_verifie_par_humain check (
    status <> 'VERIFIED' or (verified_by is not null and verified_at is not null)
  ),

  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint pv_energy_bills_tenant_id_key unique (tenant_id, id)
);

create table if not exists hermes_os.pv_energy_bill_extractions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null references hermes_os.tenants(tenant_id)
                          on update cascade on delete restrict,
  -- CASCADE ici, et seulement ici : une extraction n'a aucun sens sans sa
  -- facture, et elle ne porte aucune donnée validée — rien d'important n'est
  -- perdu silencieusement.
  bill_id               uuid not null,
  constraint pv_bill_extractions_bill_fk foreign key (tenant_id, bill_id)
    references hermes_os.pv_energy_bills (tenant_id, id) on update cascade on delete cascade,

  extracted_by          text not null default 'AGENT_4'
                          check (extracted_by in ('AGENT_4','MANUAL','OTHER_TOOL')),
  model_used            text check (model_used is null or length(model_used) <= 120),
  extraction_run_id     text check (extraction_run_id is null or length(extraction_run_id) <= 200),

  supplier              text,
  period_start          date,
  period_end            date,
  issued_on             date,
  amount_ht_eur         numeric(12,2),
  amount_ttc_eur        numeric(12,2),
  consumption_kwh       numeric(12,2),
  subscribed_power_kva  numeric(7,2),
  tariff_option         text,
  delivery_point_ref    text,

  -- Confiance globale + par champ. Une extraction sans confiance déclarée est
  -- refusée : « je ne sais pas à quel point je suis sûr » n'est pas exploitable.
  confidence            numeric(4,3) not null check (confidence between 0 and 1),
  field_confidence      jsonb not null default '{}'::jsonb,
  raw_output            jsonb not null default '{}'::jsonb,

  -- Une extraction ne se valide pas elle-même : elle est PROPOSÉE, puis
  -- éventuellement promue par un humain (fonction du lot 2).
  promoted_to_bill      boolean not null default false,
  promoted_by           uuid references auth.users(id) on delete set null,
  promoted_at           timestamptz,
  constraint pv_extraction_promotion_humaine check (
    promoted_to_bill = false or (promoted_by is not null and promoted_at is not null)
  ),

  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. ÉTUDES
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_studies (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 text not null references hermes_os.tenants(tenant_id)
                              on update cascade on delete restrict,
  site_id                   uuid not null,
  constraint pv_studies_site_fk foreign key (tenant_id, site_id)
    references hermes_os.pv_sites (tenant_id, id) on update cascade on delete restrict,
  version                   integer not null default 1 check (version >= 1),

  status                    text not null default 'DRAFT'
                              check (status in ('DRAFT','CALCULATED','NEEDS_REVIEW','VALIDATED','REJECTED','SUPERSEDED')),

  -- Dimensionnement
  target_power_kwc          numeric(9,3) check (target_power_kwc is null or target_power_kwc > 0),
  panel_count               integer check (panel_count is null or panel_count > 0),
  panel_unit_power_w        numeric(7,1) check (panel_unit_power_w is null or panel_unit_power_w > 0),
  panel_brand               text check (panel_brand is null or length(panel_brand) <= 120),
  panel_reference           text check (panel_reference is null or length(panel_reference) <= 160),

  inverter_type             text check (inverter_type is null or inverter_type in
                              ('STRING','MICRO','HYBRIDE','CENTRAL','AUTRE')),
  inverter_brand            text check (inverter_brand is null or length(inverter_brand) <= 120),
  inverter_reference        text check (inverter_reference is null or length(inverter_reference) <= 160),
  microinverter_count       integer check (microinverter_count is null or microinverter_count >= 0),

  has_battery               boolean not null default false,
  battery_capacity_kwh      numeric(9,3) check (battery_capacity_kwh is null or battery_capacity_kwh > 0),
  battery_power_kw          numeric(9,3) check (battery_power_kw is null or battery_power_kw > 0),
  constraint pv_studies_batterie_coherente check (
    has_battery = true or (battery_capacity_kwh is null and battery_power_kw is null)
  ),

  -- Production
  annual_production_kwh     numeric(12,2) check (annual_production_kwh is null or annual_production_kwh >= 0),
  specific_yield_kwh_kwc    numeric(8,2) check (specific_yield_kwh_kwc is null or specific_yield_kwh_kwc >= 0),
  self_consumption_rate_pct numeric(5,2) check (self_consumption_rate_pct is null or self_consumption_rate_pct between 0 and 100),
  self_production_rate_pct  numeric(5,2) check (self_production_rate_pct is null or self_production_rate_pct between 0 and 100),
  surplus_kwh               numeric(12,2) check (surplus_kwh is null or surplus_kwh >= 0),
  system_losses_pct         numeric(5,2) check (system_losses_pct is null or system_losses_pct between 0 and 100),

  calculation_method        text check (calculation_method is null or length(calculation_method) <= 200),
  source                    text not null default 'MANUAL'
                              check (source in ('PVGIS','OPENSOLAR','MANUAL','OTHER')),
  source_reference          text check (source_reference is null or length(source_reference) <= 300),
  calculated_at             timestamptz,
  assumptions_version       text check (assumptions_version is null or length(assumptions_version) <= 60),

  -- Une étude calculée par l'IA n'est PAS une étude validée. Le déclencheur du
  -- lot 2 impose que `validated_by` soit l'utilisateur authentifié appelant.
  prepared_by               text not null default 'MANUAL'
                              check (prepared_by in ('AGENT_5','MANUAL','OTHER_TOOL')),
  validated_by              uuid references auth.users(id) on delete set null,
  validated_at              timestamptz,
  rejection_reason          text,
  constraint pv_studies_validee_par_humain check (
    status <> 'VALIDATED' or (validated_by is not null and validated_at is not null)
  ),

  notes                     text,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint pv_studies_version_unique unique (tenant_id, site_id, version),
  constraint pv_studies_tenant_id_key unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- 6. HYPOTHÈSES D'ÉTUDE — colonnes typées, pas un blob
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_study_assumptions (
  study_id                    uuid primary key,
  tenant_id                   text not null references hermes_os.tenants(tenant_id)
                                on update cascade on delete restrict,
  constraint pv_study_assumptions_study_fk foreign key (tenant_id, study_id)
    references hermes_os.pv_studies (tenant_id, id) on update cascade on delete cascade,

  energy_price_eur_kwh        numeric(8,5) check (energy_price_eur_kwh is null or energy_price_eur_kwh >= 0),
  energy_price_inflation_pct  numeric(5,2) check (energy_price_inflation_pct is null or energy_price_inflation_pct between -20 and 50),
  analysis_horizon_years      integer check (analysis_horizon_years is null or analysis_horizon_years between 1 and 40),
  discount_rate_pct           numeric(5,2) check (discount_rate_pct is null or discount_rate_pct between 0 and 30),
  panel_degradation_pct_year  numeric(5,3) check (panel_degradation_pct_year is null or panel_degradation_pct_year between 0 and 5),
  system_losses_pct           numeric(5,2) check (system_losses_pct is null or system_losses_pct between 0 and 100),
  surplus_sale_price_eur_kwh  numeric(8,5) check (surplus_sale_price_eur_kwh is null or surplus_sale_price_eur_kwh >= 0),
  subsidy_total_eur           numeric(12,2) check (subsidy_total_eur is null or subsidy_total_eur >= 0),
  subsidy_scheme              text check (subsidy_scheme is null or length(subsidy_scheme) <= 200),
  vat_rate_pct                numeric(5,2) check (vat_rate_pct is null or vat_rate_pct between 0 and 30),

  -- Complément UNIQUEMENT. Les hypothèses ci-dessus ne doivent jamais y migrer :
  -- une hypothèse qui pilote un chiffre présenté au client doit être une colonne.
  extra_assumptions           jsonb not null default '{}'::jsonb,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. ÉCONOMIE
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_economics (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                text not null references hermes_os.tenants(tenant_id)
                             on update cascade on delete restrict,
  study_id                 uuid not null,
  constraint pv_economics_study_fk foreign key (tenant_id, study_id)
    references hermes_os.pv_studies (tenant_id, id) on update cascade on delete restrict,

  investment_ht_eur        numeric(12,2) check (investment_ht_eur is null or investment_ht_eur >= 0),
  investment_ttc_eur       numeric(12,2) check (investment_ttc_eur is null or investment_ttc_eur >= 0),
  subsidy_total_eur        numeric(12,2) check (subsidy_total_eur is null or subsidy_total_eur >= 0),
  net_cost_eur             numeric(12,2) check (net_cost_eur is null or net_cost_eur >= 0),

  year1_savings_eur        numeric(12,2) check (year1_savings_eur is null or year1_savings_eur >= 0),
  surplus_revenue_eur      numeric(12,2) check (surplus_revenue_eur is null or surplus_revenue_eur >= 0),
  annual_gain_eur          numeric(12,2) check (annual_gain_eur is null or annual_gain_eur >= 0),
  simple_roi_pct           numeric(7,2),
  payback_years            numeric(6,2) check (payback_years is null or payback_years >= 0),
  npv_eur                  numeric(14,2),
  irr_pct                  numeric(7,2),

  status                   text not null default 'DRAFT'
                             check (status in ('DRAFT','CALCULATED','NEEDS_REVIEW','VERIFIED','REJECTED')),
  computed_by              text not null default 'MANUAL'
                             check (computed_by in ('AGENT_5','MANUAL','OTHER_TOOL')),
  verified_by              uuid references auth.users(id) on delete set null,
  verified_at              timestamptz,
  rejection_reason         text,
  constraint pv_economics_verifie_par_humain check (
    status <> 'VERIFIED' or (verified_by is not null and verified_at is not null)
  ),

  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. RLS — deny-all sur TOUTES les tables du lot
-- ---------------------------------------------------------------------------
-- Aucune policy n'est créée : c'est délibéré et c'est le modèle Hermès
-- (177/178 tables). L'accès applicatif passera par des façades SECURITY DEFINER
-- au lot PV-2. Aucun GRANT n'est accordé à `anon` ni `authenticated`.
alter table hermes_os.pv_prospects              enable row level security;
alter table hermes_os.pv_prospect_transitions   enable row level security;
alter table hermes_os.pv_sites                  enable row level security;
alter table hermes_os.pv_consumption_profiles   enable row level security;
alter table hermes_os.pv_energy_bills           enable row level security;
alter table hermes_os.pv_energy_bill_extractions enable row level security;
alter table hermes_os.pv_studies                enable row level security;
alter table hermes_os.pv_study_assumptions      enable row level security;
alter table hermes_os.pv_economics              enable row level security;

revoke all on hermes_os.pv_prospects, hermes_os.pv_prospect_transitions, hermes_os.pv_sites,
              hermes_os.pv_consumption_profiles, hermes_os.pv_energy_bills,
              hermes_os.pv_energy_bill_extractions, hermes_os.pv_studies,
              hermes_os.pv_study_assumptions, hermes_os.pv_economics
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. INDEX
-- ---------------------------------------------------------------------------
create index if not exists idx_pv_prospects_tenant_status   on hermes_os.pv_prospects (tenant_id, status);
create index if not exists idx_pv_prospects_tenant_owner    on hermes_os.pv_prospects (tenant_id, owner_user_id);
create unique index if not exists uq_pv_prospects_crm_ext   on hermes_os.pv_prospects (tenant_id, crm_external_id) where crm_external_id is not null;
create index if not exists idx_pv_sites_tenant_prospect     on hermes_os.pv_sites (tenant_id, prospect_id);
create index if not exists idx_pv_sites_tenant_cp           on hermes_os.pv_sites (tenant_id, postal_code);
create index if not exists idx_pv_consumption_tenant_site   on hermes_os.pv_consumption_profiles (tenant_id, site_id);
create index if not exists idx_pv_bills_tenant_site_status  on hermes_os.pv_energy_bills (tenant_id, site_id, status);
create index if not exists idx_pv_bill_extr_tenant_bill     on hermes_os.pv_energy_bill_extractions (tenant_id, bill_id);
create index if not exists idx_pv_studies_tenant_site       on hermes_os.pv_studies (tenant_id, site_id, status);
create index if not exists idx_pv_economics_tenant_study    on hermes_os.pv_economics (tenant_id, study_id, status);

-- ---------------------------------------------------------------------------
-- 10. updated_at — réutilise le déclencheur existant du schéma
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pv_prospects','pv_sites','pv_consumption_profiles','pv_energy_bills',
                           'pv_studies','pv_study_assumptions','pv_economics']
  loop
    execute format(
      'drop trigger if exists trg_%1$s_updated_at on hermes_os.%1$s;
       create trigger trg_%1$s_updated_at before update on hermes_os.%1$s
         for each row execute function hermes_os.set_updated_at();', t);
  end loop;
end $$;
