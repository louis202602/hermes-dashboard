-- PHOTO-P0 / 1 — Hermès Studio (verticale photographe) : schéma de données.
-- (project smubxqorirlfldatzmym)
--
-- ✅ APPLIQUÉE en production le 2026-08-18 (migration Supabase `photo_studio_1_schema`,
--    version 20260818210007). Vérifié après application : 14 tables, RLS activée 14/14,
--    0 policy, 0 ligne, 0 colonne interdite.
--    GO_LIVE = NO — la verticale reste DORMANTE : ce lot ne crée QUE des tables
--    vides, en RLS deny-all, atteignables uniquement par les façades du lot 3.
--
-- Invariants (identiques au reste de hermes_os) :
--   * `tenant_id text` sur CHAQUE table + index en tête de clé → isolation par tenant ;
--   * RLS ENABLED **sans policy** ⇒ deny-all pour `authenticated`/`anon` : la seule voie
--     d'accès est une façade SECURITY DEFINER (`hermes_os` n'est pas exposé par PostgREST) ;
--   * AUCUN RAW n'est stocké — `photo_session_assets.source_reference` est une simple
--     référence (chemin/URL chez la photographe) + un sha256 ; seuls des proxies JPEG
--     bornés vivent dans le bucket privé du lot 4 ;
--   * AUCUNE suppression de photo : `photo_culling_verdicts` porte des SUGGESTIONS et une
--     décision humaine ; il n'existe aucun chemin de DELETE sur un asset ;
--   * biométrie : aucune colonne de gabarit facial, aucun identifiant de personne
--     photographiée. `identity_scope` par défaut 'NONE' (RGPD art. 9 — cf. rapport §14 R1).
--
-- Réversible : 20260818_photo_studio_9_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- 0. Activation de la verticale (dormante).
--
--    Pourquoi une table dédiée plutôt que `tenant_module_activation` :
--    celle-ci a une FK vers `component_registry.stable_id`, or `get_platform_health()`
--    compte TOUTES les lignes de `component_registry` sans filtre de visibilité —
--    y insérer des composants encore inexistants changerait un chiffre affiché
--    (régression visible). On garde donc l'activation dans le périmètre de la
--    verticale, entièrement réversible.
--
--    Par défaut `enabled = false` : aucun tenant ne voit la verticale.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_studio_activation (
  tenant_id    text primary key,
  enabled      boolean not null default false,
  activated_at timestamptz,
  activated_by text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table hermes_os.photo_studio_activation enable row level security;

comment on table hermes_os.photo_studio_activation is
  'Activation par tenant de la verticale Hermès Studio. enabled=false par défaut (dormant).';

-- ---------------------------------------------------------------------------
-- 1. Clients & mémoire structurée
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_clients (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null,
  display_name       text not null check (length(btrim(display_name)) between 1 and 200),
  email              text check (email is null or length(email) <= 320),
  phone              text check (phone is null or length(phone) <= 40),
  preferred_channel  text not null default 'EMAIL'
                       check (preferred_channel in ('EMAIL', 'SMS', 'WHATSAPP', 'PHONE')),
  notes              text check (notes is null or length(notes) <= 4000),
  lifetime_value_eur numeric(12,2) not null default 0 check (lifetime_value_eur >= 0),
  follow_up_date     date,
  status             text not null default 'ACTIVE'
                       check (status in ('LEAD', 'ACTIVE', 'DORMANT', 'ARCHIVED')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table hermes_os.photo_clients enable row level security;

create unique index if not exists photo_clients_tenant_identity
  on hermes_os.photo_clients (tenant_id, lower(btrim(display_name)), coalesce(lower(email), ''));
create index if not exists photo_clients_followup
  on hermes_os.photo_clients (tenant_id, follow_up_date) where follow_up_date is not null;

-- Minimisation RGPD : prénom + mois/année de naissance seulement. Jamais de date
-- complète, jamais d'adresse, jamais de donnée de santé. Suffisant pour « séance
-- premier anniversaire », insuffisant pour identifier un mineur hors contexte.
create table if not exists hermes_os.photo_client_members (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  client_id    uuid not null references hermes_os.photo_clients(id) on delete cascade,
  first_name   text not null check (length(btrim(first_name)) between 1 and 100),
  relation     text not null default 'OTHER'
                 check (relation in ('PARTNER', 'CHILD', 'PARENT', 'GRANDPARENT', 'SIBLING', 'OTHER')),
  is_minor     boolean not null default false,
  birth_month  smallint check (birth_month is null or birth_month between 1 and 12),
  birth_year   smallint check (birth_year is null or birth_year between 1900 and 2200),
  notes        text check (notes is null or length(notes) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table hermes_os.photo_client_members enable row level security;
create index if not exists photo_client_members_by_client
  on hermes_os.photo_client_members (tenant_id, client_id);

-- ---------------------------------------------------------------------------
-- 2. Séances — machine à états canonique du workflow (rapport §5)
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_sessions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               text not null,
  client_id               uuid not null references hermes_os.photo_clients(id) on delete restrict,
  session_type            text not null
                            check (session_type in ('MARIAGE', 'FAMILLE', 'GROSSESSE', 'NAISSANCE',
                                                    'PORTRAIT', 'EVENEMENT', 'ENTREPRISE', 'AUTRE')),
  title                   text check (title is null or length(title) <= 200),
  scheduled_at            timestamptz,
  location_label          text check (location_label is null or length(location_label) <= 300),
  status                  text not null default 'DRAFT'
                            check (status in ('DRAFT', 'QUALIFIED', 'QUOTED', 'BOOKED', 'SHOT',
                                              'IMPORTED', 'CULLED', 'SELECTION_APPROVED',
                                              'EDIT_PREPARED', 'EDIT_APPROVED', 'EXPORTED',
                                              'GALLERY_DRAFT', 'DELIVERED', 'CLOSED', 'CANCELLED')),
  shot_at                 timestamptz,
  imported_at             timestamptz,
  culled_at               timestamptz,
  selection_approved_at   timestamptz,
  delivered_at            timestamptz,
  quote_amount_eur        numeric(12,2) check (quote_amount_eur is null or quote_amount_eur >= 0),
  deposit_paid_eur        numeric(12,2) not null default 0 check (deposit_paid_eur >= 0),
  balance_paid_eur        numeric(12,2) not null default 0 check (balance_paid_eur >= 0),
  notes                   text check (notes is null or length(notes) <= 4000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table hermes_os.photo_sessions enable row level security;

-- Idempotence métier : une séance = (client, type, jour planifié).
create unique index if not exists photo_sessions_natural_key
  on hermes_os.photo_sessions (tenant_id, client_id, session_type, coalesce(scheduled_at, 'epoch'::timestamptz));
create index if not exists photo_sessions_by_status
  on hermes_os.photo_sessions (tenant_id, status, scheduled_at desc nulls last);

-- ---------------------------------------------------------------------------
-- 3. Assets — RÉFÉRENCES + proxies. Jamais de RAW.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_session_assets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null,
  session_id        uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  -- Chemin/URL du RAW CHEZ LA PHOTOGRAPHE. Hermès ne le lit pas, ne le télécharge pas,
  -- ne le stocke pas : c'est un pointeur d'inventaire.
  source_reference  text not null check (length(source_reference) between 1 and 1024),
  original_filename text not null check (length(original_filename) between 1 and 512),
  file_sha256       text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at       timestamptz,
  camera_model      text check (camera_model is null or length(camera_model) <= 120),
  lens_model        text check (lens_model is null or length(lens_model) <= 120),
  iso               integer check (iso is null or iso between 1 and 4000000),
  shutter_us        bigint check (shutter_us is null or shutter_us > 0),
  aperture          numeric(5,2) check (aperture is null or aperture > 0),
  focal_mm          numeric(7,2) check (focal_mm is null or focal_mm > 0),
  width             integer check (width is null or width > 0),
  height            integer check (height is null or height > 0),
  proxy_path        text,
  thumb_path        text,
  proxy_status      text not null default 'PENDING'
                      check (proxy_status in ('PENDING', 'READY', 'FAILED', 'PURGED')),
  proxy_bytes       bigint check (proxy_bytes is null or proxy_bytes > 0),
  purge_after       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table hermes_os.photo_session_assets enable row level security;

create unique index if not exists photo_assets_dedupe
  on hermes_os.photo_session_assets (tenant_id, session_id, file_sha256);
create index if not exists photo_assets_by_session
  on hermes_os.photo_session_assets (tenant_id, session_id, captured_at nulls last);
create index if not exists photo_assets_purge
  on hermes_os.photo_session_assets (tenant_id, proxy_status, purge_after)
  where purge_after is not null;

comment on column hermes_os.photo_session_assets.source_reference is
  'Référence du fichier original CHEZ la photographe. Hermès ne stocke jamais le RAW.';

-- ---------------------------------------------------------------------------
-- 4. Tri — passe 1 déterministe (signaux) puis verdicts
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_culling_signals (
  asset_id           uuid primary key references hermes_os.photo_session_assets(id) on delete cascade,
  tenant_id          text not null,
  session_id         uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  -- Variance du Laplacien normalisée [0..1] : plus haut = plus net.
  sharpness          numeric(6,5) not null check (sharpness between 0 and 1),
  -- Fractions de pixels écrêtés en bas / en haut de l'histogramme.
  clip_low           numeric(6,5) not null check (clip_low between 0 and 1),
  clip_high          numeric(6,5) not null check (clip_high between 0 and 1),
  brightness         numeric(6,5) not null check (brightness between 0 and 1),
  -- Empreintes perceptuelles 64 bits (hex) : doublons / séries similaires.
  ahash              text not null check (ahash ~ '^[0-9a-f]{16}$'),
  dhash              text not null check (dhash ~ '^[0-9a-f]{16}$'),
  burst_group        integer not null default 0 check (burst_group >= 0),
  engine_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
alter table hermes_os.photo_culling_signals enable row level security;
create index if not exists photo_signals_by_session
  on hermes_os.photo_culling_signals (tenant_id, session_id, burst_group);

create table if not exists hermes_os.photo_culling_verdicts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null,
  session_id     uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  asset_id       uuid not null references hermes_os.photo_session_assets(id) on delete cascade,
  pass_no        smallint not null default 1 check (pass_no between 1 and 3),
  -- SUGGESTIONS uniquement. `REJECTED_SUGGESTION` n'efface rien et n'autorise rien.
  verdict        text not null
                   check (verdict in ('KEEP_SUGGESTION', 'REJECTED_SUGGESTION', 'BEST_OF_SERIES')),
  score          numeric(6,5) not null default 0 check (score between 0 and 1),
  reason_code    text not null default 'UNSPECIFIED' check (length(reason_code) <= 60),
  -- Vrai quand une consigne PROTECT de la photographe couvre cette photo : le verdict
  -- ne peut alors PAS être REJECTED_SUGGESTION (garanti par la façade du lot 3).
  is_protected   boolean not null default false,
  human_decision text check (human_decision in ('KEEP', 'DISCARD')),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
alter table hermes_os.photo_culling_verdicts enable row level security;

create unique index if not exists photo_verdicts_unique_pass
  on hermes_os.photo_culling_verdicts (tenant_id, asset_id, pass_no);
create index if not exists photo_verdicts_by_session
  on hermes_os.photo_culling_verdicts (tenant_id, session_id, verdict);

comment on column hermes_os.photo_culling_verdicts.human_decision is
  'DISCARD = écartée de la sélection. N''entraîne AUCUNE suppression de fichier.';

create table if not exists hermes_os.photo_culling_instructions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  -- NULL = consigne permanente du studio ; sinon consigne d'une séance.
  session_id   uuid references hermes_os.photo_sessions(id) on delete cascade,
  instruction  text not null check (length(btrim(instruction)) between 1 and 500),
  kind         text not null check (kind in ('PROTECT', 'PREFER', 'EXCLUDE')),
  keyword      text not null check (length(btrim(keyword)) between 1 and 100),
  fingerprint  text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);
alter table hermes_os.photo_culling_instructions enable row level security;

create unique index if not exists photo_instructions_dedupe
  on hermes_os.photo_culling_instructions (tenant_id, session_id, fingerprint) nulls not distinct;

-- ---------------------------------------------------------------------------
-- 5. Signature Edit — profil de style versionné + jobs
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_style_profiles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  genre        text not null
                 check (genre in ('MARIAGE', 'FAMILLE', 'GROSSESSE', 'NAISSANCE',
                                  'PORTRAIT', 'EVENEMENT', 'ENTREPRISE', 'AUTRE')),
  version      integer not null default 1 check (version >= 1),
  -- Réglages develop (température, exposition, contraste, tons chair, grain…) :
  -- structure ouverte, versionnée, jamais interprétée par la base.
  settings     jsonb not null default '{}'::jsonb,
  sample_count integer not null default 0 check (sample_count >= 0),
  status       text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table hermes_os.photo_style_profiles enable row level security;
create unique index if not exists photo_style_profiles_version
  on hermes_os.photo_style_profiles (tenant_id, genre, version);

create table if not exists hermes_os.photo_edit_jobs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text not null,
  session_id       uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  style_profile_id uuid references hermes_os.photo_style_profiles(id) on delete set null,
  -- 'XMP' = chemin par défaut, coût 0, aucun provider. Les autres valeurs supposent un
  -- compte provider de la photographe (BYO) référencé hors de cette table.
  provider         text not null default 'XMP' check (provider in ('XMP', 'IMAGEN', 'LIGHTROOM', 'OTHER')),
  status           text not null default 'QUEUED'
                     check (status in ('QUEUED', 'RUNNING', 'PREPARED', 'APPROVED', 'FAILED', 'CANCELLED')),
  asset_count      integer not null default 0 check (asset_count >= 0),
  result           jsonb,
  error_code       text check (error_code is null or length(error_code) <= 60),
  requested_at     timestamptz not null default now(),
  completed_at     timestamptz
);
alter table hermes_os.photo_edit_jobs enable row level security;
create index if not exists photo_edit_jobs_by_session
  on hermes_os.photo_edit_jobs (tenant_id, session_id, requested_at desc);

-- ---------------------------------------------------------------------------
-- 6. Livraison & revenus
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_galleries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null,
  session_id    uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  provider      text not null default 'PICTIME' check (length(provider) <= 40),
  external_id   text check (external_id is null or length(external_id) <= 200),
  url           text check (url is null or length(url) <= 1024),
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),
  published_at  timestamptz,
  viewed_count  integer not null default 0 check (viewed_count >= 0),
  order_count   integer not null default 0 check (order_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table hermes_os.photo_galleries enable row level security;
create unique index if not exists photo_galleries_unique
  on hermes_os.photo_galleries (tenant_id, session_id, provider);

create table if not exists hermes_os.photo_upsell_opportunities (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null,
  client_id             uuid not null references hermes_os.photo_clients(id) on delete cascade,
  session_id            uuid references hermes_os.photo_sessions(id) on delete set null,
  kind                  text not null
                          check (kind in ('ALBUM', 'TIRAGE', 'AGRANDISSEMENT', 'FICHIERS_SUPP',
                                          'COFFRET', 'SEANCE_ANNIVERSAIRE', 'SEANCE_FAMILLE',
                                          'SEANCE_GROSSESSE', 'SEANCE_NAISSANCE', 'SAISONNIER', 'AUTRE')),
  trigger_code          text not null check (length(trigger_code) <= 60),
  score                 numeric(4,3) not null default 0 check (score between 0 and 1),
  estimated_amount_eur  numeric(12,2) check (estimated_amount_eur is null or estimated_amount_eur >= 0),
  status                text not null default 'DETECTED'
                          check (status in ('DETECTED', 'PROPOSED', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  due_date              date,
  revenue_generated_eur numeric(12,2) not null default 0 check (revenue_generated_eur >= 0),
  detected_at           timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table hermes_os.photo_upsell_opportunities enable row level security;
create unique index if not exists photo_upsell_dedupe
  on hermes_os.photo_upsell_opportunities (tenant_id, client_id, kind, coalesce(due_date, 'epoch'::date));

-- ---------------------------------------------------------------------------
-- 7. Consentement média — contrat copié de `peinture_media_consent`
--
--    Verrou RGPD DB-side : un consentement couvrant des mineurs EXIGE le
--    consentement du représentant légal. C'est une contrainte de table, pas une
--    règle applicative — elle ne peut pas être contournée par un appelant.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_media_consent (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null,
  client_id            uuid not null references hermes_os.photo_clients(id) on delete cascade,
  session_id           uuid references hermes_os.photo_sessions(id) on delete cascade,
  status               text not null default 'GRANTED'
                         check (status in ('GRANTED', 'REVOKED', 'EXPIRED')),
  use_cases_granted    text[] not null default '{}',
  media_types_granted  text[] not null default '{}',
  identity_scope       text not null default 'NONE'
                         check (identity_scope in ('NONE', 'SILHOUETTE', 'FACE')),
  location_scope       text not null default 'NONE'
                         check (location_scope in ('NONE', 'CITY', 'EXACT')),
  includes_minors      boolean not null default false,
  guardian_consent     boolean not null default false,
  consent_text_version text not null check (length(consent_text_version) between 1 and 40),
  granted_at           timestamptz not null default now(),
  revoked_at           timestamptz,
  expires_at           timestamptz,
  proof                jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint photo_consent_minors_need_guardian
    check (includes_minors = false or guardian_consent = true),
  constraint photo_consent_revoked_has_date
    check (status <> 'REVOKED' or revoked_at is not null)
);
alter table hermes_os.photo_media_consent enable row level security;
create index if not exists photo_consent_by_client
  on hermes_os.photo_media_consent (tenant_id, client_id, status, granted_at desc);

-- ---------------------------------------------------------------------------
-- 8. Marketing — contrat copié de `peinture_marketing_draft`
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_marketing_draft (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null,
  session_id        uuid not null references hermes_os.photo_sessions(id) on delete cascade,
  -- Un brouillon SANS consentement rattaché ne peut jamais être publié (façade P2 +
  -- gate `verifier_consentement_photo`). La colonne reste nullable pour permettre le
  -- brouillon, jamais la publication.
  consent_id        uuid references hermes_os.photo_media_consent(id) on delete set null,
  canal             text not null check (canal in ('INSTAGRAM', 'FACEBOOK', 'BLOG', 'PORTFOLIO', 'AUTRE')),
  use_case          text not null check (length(use_case) <= 60),
  identity_scope    text not null default 'NONE'
                      check (identity_scope in ('NONE', 'SILHOUETTE', 'FACE')),
  location_scope    text not null default 'NONE'
                      check (location_scope in ('NONE', 'CITY', 'EXACT')),
  content           jsonb not null default '{}'::jsonb,
  status            text not null default 'DRAFT'
                      check (status in ('DRAFT', 'APPROVED', 'REJECTED', 'PUBLISHED')),
  approved_by       text,
  approved_at       timestamptz,
  rejected_by       text,
  rejected_at       timestamptz,
  rejection_note    text check (rejection_note is null or length(rejection_note) <= 1000),
  publish_result    jsonb,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint photo_marketing_published_needs_consent
    check (status <> 'PUBLISHED' or consent_id is not null)
);
alter table hermes_os.photo_marketing_draft enable row level security;
create unique index if not exists photo_marketing_dedupe
  on hermes_os.photo_marketing_draft (tenant_id, session_id, canal, input_fingerprint);

commit;
