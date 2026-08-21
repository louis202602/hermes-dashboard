-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / 1 — La visite technique : schéma, mesures, écarts, seuils.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- LE PROBLÈME, MESURÉ AVANT D'ÊTRE TRAITÉ. Une requête sur le catalogue :
--
--   select column_name from information_schema.columns
--    where table_schema='hermes_os' and table_name='pv_sites'
--      and (column_name like '%verif%' or column_name like '%visit%');
--   -- → AUCUNE LIGNE
--
-- `pv_sites` ne portait aucun champ de vérification. Les six données qui
-- déterminent la puissance, la production et donc le PRIX — surface exploitable,
-- azimut, inclinaison, état de couverture, ombrage, accès — étaient saisies à la
-- main et jamais confrontées au terrain. PV-5 en a fait la base d'un engagement
-- contractuel. Et les deux PDF produits par Hermès PROMETTENT déjà cette visite :
-- la synthèse d'étude (« sous réserve de … visite technique … ») et le devis
-- (« L'exécution reste soumise à la visite technique préalable … »).
--
-- Le système promettait une visite technique que rien n'implémentait. Ce lot la
-- pose — sans agent, sans IA, sans workflow.
--
-- LA MESURE N'ÉCRASE JAMAIS LA DÉCLARATION. C'est la règle centrale de ce lot :
-- une valeur relevée sur le toit ne remplace pas silencieusement la valeur
-- saisie au bureau. Les deux coexistent, l'écart est nommé, et c'est un humain
-- qui décide — par un geste explicite et audité — d'appliquer la mesure au site.

begin;

-- ---------------------------------------------------------------------------
-- 1. LES SEUILS, EN DONNÉES.
--
--    Pas de nombre magique dans l'UI ni dans une fonction. `tenant_id` NULL =
--    valeur par défaut globale ; une ligne avec `tenant_id` la surcharge pour ce
--    tenant. Un nouveau tenant hérite donc des défauts sans qu'on ait à semer
--    quoi que ce soit — c'est le piège classique d'une table « réglages » qui
--    n'aurait que des lignes par tenant.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_survey_thresholds (
  tenant_id   text references hermes_os.tenants(tenant_id) on delete cascade,
  code        text not null check (length(code) between 3 and 64),
  value       numeric not null,
  unit        text not null check (length(unit) between 1 and 16),
  description text not null
);

-- Unicité : une seule ligne globale par code, une seule ligne par (tenant, code).
create unique index if not exists idx_pv_survey_thresholds_global
  on hermes_os.pv_survey_thresholds (code) where tenant_id is null;
create unique index if not exists idx_pv_survey_thresholds_tenant
  on hermes_os.pv_survey_thresholds (tenant_id, code) where tenant_id is not null;

alter table hermes_os.pv_survey_thresholds enable row level security;
revoke all on table hermes_os.pv_survey_thresholds from anon, authenticated;

comment on table hermes_os.pv_survey_thresholds is
  'PV-6 — tolérances de comparaison déclaré/mesuré. tenant_id NULL = défaut global.';

-- VALEURS PAR DÉFAUT, et ce qu'elles veulent dire.
--
-- Deux paliers par grandeur : au-delà du premier, l'écart mérite une REVUE ; au
-- delà du second, il BLOQUE. Un seul seuil obligerait à choisir entre « tout
-- signaler » et « ne bloquer que le catastrophique » ; deux paliers permettent
-- de dire « regardez ça » sans arrêter une affaire pour trois degrés.
--
-- Les valeurs sont un point de départ défendable, PAS une vérité métier : elles
-- sont là pour être discutées et ajustées par tenant. Aucune n'est déduite d'un
-- modèle : ce sont des conventions, et elles se lisent comme telles.
insert into hermes_os.pv_survey_thresholds (tenant_id, code, value, unit, description) values
  (null, 'AZIMUTH_REVIEW_DEG',      10,  '°',  'Écart d''azimut au-delà duquel une revue est demandée.'),
  (null, 'AZIMUTH_BLOCKING_DEG',    30,  '°',  'Écart d''azimut au-delà duquel le productible retenu n''est plus défendable.'),
  (null, 'TILT_REVIEW_DEG',          5,  '°',  'Écart d''inclinaison au-delà duquel une revue est demandée.'),
  (null, 'TILT_BLOCKING_DEG',       15,  '°',  'Écart d''inclinaison au-delà duquel le calcul de production est faux.'),
  (null, 'USABLE_AREA_REVIEW_PCT',  10,  '%',  'Écart relatif de surface exploitable demandant une revue.'),
  (null, 'USABLE_AREA_BLOCKING_PCT',25,  '%',  'Écart relatif de surface exploitable rendant l''implantation irréalisable en l''état.'),
  (null, 'ROOF_AREA_REVIEW_PCT',    15,  '%',  'Écart relatif de surface totale de toiture demandant une revue.'),
  (null, 'HEIGHT_INFO_M',            6,  'm',  'Hauteur au-delà de laquelle les moyens d''accès sont signalés (information).'),
  (null, 'CABLE_DISTANCE_REVIEW_M',  50,  'm',  'Longueur de cheminement au-delà de laquelle la chute de tension mérite une revue.')
on conflict do nothing;

create or replace function hermes_os.pv_survey_threshold(p_tenant text, p_code text)
returns numeric
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select value from hermes_os.pv_survey_thresholds
   where code = p_code and (tenant_id = p_tenant or tenant_id is null)
   -- La ligne du tenant prime sur le défaut global.
   order by tenant_id nulls last
   limit 1;
$function$;

revoke all on function hermes_os.pv_survey_threshold(text, text) from public;

-- ---------------------------------------------------------------------------
-- 2. LA VISITE.
--
--    Les mesures sont des COLONNES TYPÉES, pas un blob JSON. Une surface cachée
--    dans du JSON ne peut être ni contrainte, ni indexée, ni comparée par une
--    règle déterministe — et c'est exactement ce qu'on veut faire d'elle.
--    `metadata` existe pour le complément (notes libres, relevés annexes), pas
--    comme source principale.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_site_surveys (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  prospect_id         uuid not null,
  site_id             uuid not null,

  technician_user_id  uuid references auth.users(id) on delete set null,

  scheduled_on        date,
  started_at          timestamptz,
  completed_at        timestamptz,
  validated_at        timestamptz,
  validated_by        uuid references auth.users(id) on delete set null,
  constraint pv_site_surveys_validation_coherente
    check ((validated_at is null) = (validated_by is null)),

  status              text not null default 'PLANNED'
                        check (status in ('PLANNED','IN_PROGRESS','DONE','NEEDS_REVIEW',
                                          'VALIDATED','BLOCKING','CANCELLED')),

  -- --- Conditions de la visite ---------------------------------------------
  weather_conditions  text check (weather_conditions is null or weather_conditions in
                        ('SEC','PLUIE','NEIGE','VENT_FORT','AUTRE')),
  roof_access         text check (roof_access is null or roof_access in
                        ('FACILE','MOYEN','DIFFICILE','IMPOSSIBLE')),
  access_means        text check (access_means is null or access_means in
                        ('ECHELLE','ECHAFAUDAGE','NACELLE','TRAPPE','AUCUN','AUTRE')),
  site_condition      text check (site_condition is null or site_condition in
                        ('BON','MOYEN','DEGRADE','CRITIQUE')),
  safety_constraints  text,
  observations        text,
  remarks             text,

  -- --- MESURES DE TOITURE ---------------------------------------------------
  roof_area_total_measured_m2   numeric(10,2) check (roof_area_total_measured_m2 is null or roof_area_total_measured_m2 > 0),
  roof_area_usable_measured_m2  numeric(10,2) check (roof_area_usable_measured_m2 is null or roof_area_usable_measured_m2 > 0),
  azimuth_measured_deg          numeric(6,2)  check (azimuth_measured_deg is null or (azimuth_measured_deg >= 0 and azimuth_measured_deg <= 360)),
  tilt_measured_deg             numeric(5,2)  check (tilt_measured_deg is null or (tilt_measured_deg >= 0 and tilt_measured_deg <= 90)),
  -- VOCABULAIRES ALIGNÉS SUR `pv_sites`. Deux échelles différentes pour la même
  -- grandeur obligeraient à une table de traduction que personne ne maintiendrait,
  -- et la comparaison déclaré/mesuré deviendrait une approximation.
  roof_type_measured            text check (roof_type_measured is null or roof_type_measured in
                                  ('PENTE','TERRASSE','MULTIPENTE','SHED','COURBE','SOL','OMBRIERE','AUTRE')),
  roof_condition_measured       text check (roof_condition_measured is null or roof_condition_measured in
                                  ('BON','MOYEN','MAUVAIS','INCONNU')),
  shading_measured              text check (shading_measured is null or shading_measured in
                                  ('AUCUN','FAIBLE','MODERE','FORT')),
  access_difficulty_measured    text check (access_difficulty_measured is null or access_difficulty_measured in
                                  ('FACILE','MOYEN','DIFFICILE','TRES_DIFFICILE')),
  height_measured_m             numeric(6,2) check (height_measured_m is null or height_measured_m >= 0),
  ridge_length_m                numeric(8,2) check (ridge_length_m is null or ridge_length_m > 0),
  eave_length_m                 numeric(8,2) check (eave_length_m is null or eave_length_m > 0),
  slope_length_m                numeric(8,2) check (slope_length_m is null or slope_length_m > 0),
  obstacles                     text,

  -- CONSTAT, pas diagnostic. Hermès ne produit AUCUN diagnostic amiante : la
  -- réglementation impose un opérateur certifié et un rapport dédié. Ce champ
  -- enregistre une SUSPICION de terrain, à faire lever par qui de droit — le
  -- commentaire le dit, et le PDF le répétera.
  asbestos_suspicion            boolean not null default false,
  asbestos_note                 text,
  constraint pv_site_surveys_amiante_note
    check (asbestos_suspicion = false or asbestos_note is not null),

  -- --- IMPLANTATION ---------------------------------------------------------
  panel_location                text,
  inverter_location             text,
  battery_location              text,
  cable_route                   text,
  cable_distance_m              numeric(7,2) check (cable_distance_m is null or cable_distance_m >= 0),

  -- --- ÉLECTRICITÉ ----------------------------------------------------------
  panel_board_location          text,
  panel_board_condition         text check (panel_board_condition is null or panel_board_condition in
                                  ('BON','MOYEN','DEGRADE','NON_CONFORME_APPARENT')),
  panel_board_free_slots        integer check (panel_board_free_slots is null or panel_board_free_slots >= 0),
  main_breaker_rating_a         numeric(6,2) check (main_breaker_rating_a is null or main_breaker_rating_a > 0),
  -- OBSERVÉ, pas mesuré par un contrôle réglementaire.
  earthing_observed             text check (earthing_observed is null or earthing_observed in
                                  ('PRESENTE','ABSENTE','NON_VERIFIABLE')),
  earthing_note                 text,

  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_site_surveys_tenant_id_key unique (tenant_id, id)
);

-- FK COMPOSITES. Une FK sur `site_id` seul laisserait une visite décrire le toit
-- d'un AUTRE tenant — la faille que PV-1 avait fermée, et qui serait pire ici :
-- la visite est censée être la PREUVE.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_site_surveys_prospect_fk') then
    alter table hermes_os.pv_site_surveys add constraint pv_site_surveys_prospect_fk
      foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_site_surveys_site_fk') then
    alter table hermes_os.pv_site_surveys add constraint pv_site_surveys_site_fk
      foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id)
      on update cascade on delete restrict;
  end if;
end;
$$;

alter table hermes_os.pv_site_surveys enable row level security;
revoke all on table hermes_os.pv_site_surveys from anon, authenticated;

create index if not exists idx_pv_site_surveys_tenant_site
  on hermes_os.pv_site_surveys (tenant_id, site_id, created_at desc);
create index if not exists idx_pv_site_surveys_tenant_status
  on hermes_os.pv_site_surveys (tenant_id, status);

comment on table hermes_os.pv_site_surveys is
  'PV-6 — visite technique. Les mesures sont des colonnes TYPÉES : elles doivent être comparables.';
comment on column hermes_os.pv_site_surveys.asbestos_suspicion is
  'PV-6 — CONSTAT de terrain, jamais un diagnostic. Un diagnostic amiante relève d''un opérateur certifié.';
comment on column hermes_os.pv_site_surveys.earthing_observed is
  'PV-6 — OBSERVATION visuelle, pas un contrôle réglementaire d''installation.';

-- ---------------------------------------------------------------------------
-- 3. LES ÉCARTS.
--
--    Une table, pas un champ calculé : un écart porte une valeur déclarée, une
--    valeur mesurée, une gravité, un caractère bloquant, un commentaire et une
--    RÉSOLUTION. Rien de tout cela ne tient dans un booléen, et c'est justement
--    ce que l'écran doit montrer.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_site_survey_findings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references hermes_os.tenants(tenant_id) on delete cascade,
  survey_id      uuid not null,

  code           text not null check (code in (
                   'ROOF_AREA_MISMATCH','USABLE_AREA_MISMATCH','AZIMUTH_MISMATCH','TILT_MISMATCH',
                   'ROOF_TYPE_MISMATCH','ROOF_CONDITION_ISSUE','SHADING_MISMATCH','ACCESS_BLOCKED',
                   'ELECTRICAL_PANEL_ISSUE','CABLE_ROUTE_ISSUE','STRUCTURAL_CONCERN',
                   'ASBESTOS_SUSPICION','EARTHING_ISSUE','HEIGHT_ACCESS_NOTICE')),
  category       text not null check (category in ('TOITURE','ORIENTATION','ACCES','ELECTRICITE','SECURITE','AUTRE')),
  severity       text not null check (severity in ('INFO','REVIEW','BLOCKING')),
  is_blocking    boolean not null default false,
  -- Cohérence : `BLOCKING` et `is_blocking` ne peuvent pas se contredire.
  constraint pv_findings_gravite_coherente
    check (is_blocking = (severity = 'BLOCKING')),

  declared_value text,
  measured_value text,
  unit           text,
  comment        text,

  -- L'écart détecté par la règle est REGÉNÉRABLE ; sa résolution, non. On la
  -- garde donc à part, et la regénération ne l'efface pas (voir la façade).
  resolution     text check (resolution is null or resolution in
                   ('ACCEPTED_AS_IS','SITE_UPDATED','STUDY_TO_REVISE','QUOTE_TO_REVISE','NOT_AN_ISSUE')),
  resolved_by    uuid references auth.users(id) on delete set null,
  resolved_at    timestamptz,
  constraint pv_findings_resolution_coherente
    check ((resolved_at is null) = (resolved_by is null)),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint pv_site_survey_findings_tenant_id_key unique (tenant_id, id),
  -- Un code d'écart par visite : la regénération met à jour, elle n'empile pas.
  constraint pv_findings_code_unique unique (tenant_id, survey_id, code)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_findings_survey_fk') then
    alter table hermes_os.pv_site_survey_findings add constraint pv_findings_survey_fk
      foreign key (tenant_id, survey_id) references hermes_os.pv_site_surveys (tenant_id, id)
      on update cascade on delete cascade;
  end if;
end;
$$;

alter table hermes_os.pv_site_survey_findings enable row level security;
revoke all on table hermes_os.pv_site_survey_findings from anon, authenticated;

create index if not exists idx_pv_findings_survey
  on hermes_os.pv_site_survey_findings (tenant_id, survey_id, severity);

-- ---------------------------------------------------------------------------
-- 4. RATTACHEMENT DOCUMENTAIRE. Photos et rapport rejoignent `pv_documents` et
--    le bucket privé existant. AUCUN nouveau bucket : un second magasin de
--    fichiers aurait ses propres politiques, donc ses propres trous.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents add column if not exists survey_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_documents_survey_fk') then
    alter table hermes_os.pv_documents add constraint pv_documents_survey_fk
      foreign key (tenant_id, survey_id) references hermes_os.pv_site_surveys (tenant_id, id)
      on update cascade on delete set null;
  end if;

  -- Types documentaires de la visite. On REMPLACE la contrainte plutôt que d'en
  -- ajouter une seconde : deux CHECK sur la même colonne finissent par se
  -- contredire, et plus personne ne sait laquelle fait foi.
  alter table hermes_os.pv_documents drop constraint if exists pv_documents_doc_type_check;
  alter table hermes_os.pv_documents add constraint pv_documents_doc_type_check check (
    doc_type in ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
                 'NOTE_TECHNIQUE','ATTESTATION',
                 'PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES','PHOTO_OBSTACLE','FICHE_VISITE',
                 'AUTRE'));

  alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
  alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
    document_stage in ('SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL',
                       'QUOTE_DRAFT','QUOTE_FINAL','SURVEY_REPORT'));

  alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
  alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
    document_stage = 'SOURCE'
    or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
    or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null)
    or (document_stage = 'SURVEY_REPORT' and survey_id is not null));
end;
$$;

create index if not exists idx_pv_documents_tenant_survey
  on hermes_os.pv_documents (tenant_id, survey_id) where survey_id is not null;

commit;
