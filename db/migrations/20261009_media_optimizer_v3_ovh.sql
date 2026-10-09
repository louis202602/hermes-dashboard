-- =============================================================================
-- Hermes Media Optimizer v3 -- Hermes Visibility OS -- CIBLE : PostgreSQL OVH de PRODUCTION (base hermes_os, PG 17)
-- =============================================================================
-- Remplace 20261009_media_optimizer_v1.sql et _v2.sql (ecrites pour Supabase, base gelee depuis le 25-26/09/2026).
-- Retour arriere : 20261009_media_optimizer_v3_ovh_rollback.sql (copie les donnees du module avant tout retrait).
--
-- PRINCIPES
--  * Additif : aucun DROP / RENAME / TRUNCATE / DELETE / ALTER destructif sur un objet existant.
--    Seuls objets existants touches : public.social_publish (garde STOP ajoutee, corps d'origine conserve)
--    et 2 triggers + 1 index partiel poses sur hermes_os.social_content_plan (inertes hors lignes source_strategy='media_optimizer').
--  * Idempotent : rejouable sans effet (IF NOT EXISTS, CREATE OR REPLACE, garde-fous DO).
--  * Moindre privilege : le compte technique hv_media_worker n'a AUCUN acces direct aux tables Visibility ;
--    il est borne par tenant (hermes_os.media_worker_tenants) via RLS et fonctions SECURITY DEFINER a search_path fige.
--  * Toute nouvelle table/fonction est REVOQUEE pour tous les roles (anon, authenticated, service_role, hermes_os_legacy_n8n,
--    roles agent*, ...) avant octroi explicite du minimum : PostgREST expose public + hermes_os et les droits par defaut
--    de hermes_os donnent arwd a hermes_os_legacy_n8n et EXECUTE a service_role.
--  * Le mot de passe de hv_media_worker n'est PAS versionne (ALTER ROLE ... PASSWORD pose hors depot a l'application).
--
-- A EXECUTER en une transaction : psql -X -1 -v ON_ERROR_STOP=1 -f <ce fichier> (role proprietaire, superuser).
-- =============================================================================
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 0) PRECONDITIONS (echec immediat si l'environnement n'est pas celui attendu) ---------------------------------------
do $$
begin
  if current_setting('server_version_num')::int < 170000 then raise exception 'PRECONDITION: PostgreSQL 17 requis'; end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolcreaterole)) then
    raise exception 'PRECONDITION: executer avec un role superuser/createrole';
  end if;
  if to_regclass('hermes_os.social_media_library') is null or to_regclass('hermes_os.social_content_plan') is null
     or to_regclass('hermes_os.social_publications') is null or to_regclass('hermes_os.social_health_events') is null
     or to_regclass('hermes_os.tenants') is null or to_regclass('hermes_os.user_tenant_permissions') is null then
    raise exception 'PRECONDITION: tables Visibility OS / tenants absentes';
  end if;
  if to_regprocedure('hermes_os.resolve_active_tenant(text)') is null or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.social_publish(uuid)') is null then
    raise exception 'PRECONDITION: resolve_active_tenant / auth.uid / social_publish absents';
  end if;
  -- v1 (Supabase) deja appliquee ici : politiques permissives -> ne pas continuer sans revue
  if exists (select 1 from pg_policy p where p.polrelid = to_regclass('hermes_os.media_optimizer_jobs') and p.polname = 'hv_worker_all') then
    raise exception 'PRECONDITION: politique v1 permissive hv_worker_all presente (voir procedure de mise a niveau)';
  end if;
end $$;

-- 1) ROLE TECHNIQUE (sans mot de passe versionne) ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hv_media_worker') then
    create role hv_media_worker login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3;
  end if;
end $$;
-- reapplication apres un rollback (role laisse en nologin) : connexion reactivee, sans mot de passe = aucune connexion possible tant qu'il n'est pas pose hors depot
alter role hv_media_worker login nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3;
alter role hv_media_worker set statement_timeout = '15s';
alter role hv_media_worker set idle_in_transaction_session_timeout = '30s';
alter role hv_media_worker set search_path = pg_catalog, hermes_os;

-- 2) TABLES --------------------------------------------------------------------------------------------------------
create table if not exists hermes_os.media_worker_tenants (
  role_name name not null,
  tenant_id text not null references hermes_os.tenants(tenant_id),
  granted_at timestamptz not null default now(),
  primary key (role_name, tenant_id)
);

create table if not exists hermes_os.media_buffer_channels (
  channel_id text primary key check (channel_id ~ '^[0-9a-f]{24}$'),
  tenant_id text not null references hermes_os.tenants(tenant_id),
  network text not null check (network in ('instagram','facebook')),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_mbc_active_per_net on hermes_os.media_buffer_channels (tenant_id, network) where active;

create table if not exists hermes_os.social_publish_control (
  tenant_id text primary key references hermes_os.tenants(tenant_id),
  publish_stop boolean not null default true,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists hermes_os.media_optimizer_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'heliosolar' references hermes_os.tenants(tenant_id),
  media_id uuid references hermes_os.social_media_library(id) on delete set null,
  drive_file_id text, source_name text, source_md5 text, source_sha256 text,
  kind text check (kind in ('video','photo')),
  target_network text not null default 'instagram' check (target_network in ('instagram','facebook')),
  params_version text,
  status text not null default 'discovered' check (status in ('discovered','technically_usable','queued','processing','optimized','ready_to_publish','blocked','failed')),
  rights_status text not null default 'pending_review' check (rights_status in ('pending_review','authorized','rejected')),
  rights_note text,
  trigger_source text not null default 'auto' check (trigger_source in ('auto','manual')),
  optimizer_status text, result jsonb, output_path text, output_sha256 text,
  size_before bigint, size_after bigint, reduction_pct numeric, encode_sec numeric, peak_ram_mb integer, ssim_min numeric,
  ig_ok boolean, fb_ok boolean, error text, attempts integer not null default 0,
  duplicate_of uuid references hermes_os.media_optimizer_jobs(id) on delete set null,
  folder_label text, requested_by text, options jsonb not null default '{}'::jsonb,
  is_test boolean not null default false,
  public_token text, public_ext text,
  buffer_channel_id text, buffer_post_id text, buffer_status text,
  caption text, hashtags text[],
  draft_error text, draft_attempts integer not null default 0, draft_checked_at timestamptz,
  content_plan_id uuid references hermes_os.social_content_plan(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- colonnes v2 si une table v1 preexistait (aucun effet sur une table neuve)
alter table hermes_os.media_optimizer_jobs
  add column if not exists is_test boolean not null default false,
  add column if not exists public_token text, add column if not exists public_ext text,
  add column if not exists buffer_channel_id text, add column if not exists buffer_post_id text, add column if not exists buffer_status text,
  add column if not exists caption text, add column if not exists hashtags text[],
  add column if not exists draft_error text, add column if not exists draft_attempts integer not null default 0,
  add column if not exists draft_checked_at timestamptz,
  add column if not exists content_plan_id uuid references hermes_os.social_content_plan(id) on delete set null;

create unique index if not exists media_optimizer_jobs_dedup on hermes_os.media_optimizer_jobs (tenant_id, source_sha256, target_network, params_version) where source_sha256 is not null;
create unique index if not exists media_optimizer_jobs_dedup_md5 on hermes_os.media_optimizer_jobs (tenant_id, source_md5, target_network, params_version) where source_md5 is not null and params_version is not null;
create unique index if not exists media_optimizer_jobs_file_net on hermes_os.media_optimizer_jobs (tenant_id, drive_file_id, target_network);
create index if not exists media_optimizer_jobs_status on hermes_os.media_optimizer_jobs (tenant_id, status, updated_at desc);
create unique index if not exists uq_moj_id_tenant on hermes_os.media_optimizer_jobs (id, tenant_id);
create unique index if not exists uq_moj_public_token on hermes_os.media_optimizer_jobs (public_token) where public_token is not null;
create unique index if not exists uq_moj_buffer_post on hermes_os.media_optimizer_jobs (buffer_post_id) where buffer_post_id is not null;
create unique index if not exists uq_moj_content_plan on hermes_os.media_optimizer_jobs (content_plan_id) where content_plan_id is not null;

do $$
declare c record;
begin
  for c in select * from (values
    ('moj_buffer_status_chk',  'check (buffer_status is null or buffer_status in (''draft'',''sent'',''deleted'',''error''))'),
    ('moj_draft_attempts_chk', 'check (draft_attempts >= 0)'),
    ('moj_public_token_chk',   'check (public_token is null or public_token ~ ''^[0-9a-f]{64}$'')'),
    ('moj_public_ext_chk',     'check (public_ext is null or public_ext in (''.jpg'',''.jpeg'',''.png'',''.mp4''))'),
    ('moj_public_pair_chk',    'check ((public_token is null) = (public_ext is null))'),
    ('moj_draft_coherence_chk','check (buffer_post_id is null or (buffer_status is not null and buffer_channel_id is not null))'),
    ('moj_hashtags_chk',       'check (hashtags is null or cardinality(hashtags) <= 10)')
  ) as t(name, def) loop
    if not exists (select 1 from pg_constraint where conrelid = 'hermes_os.media_optimizer_jobs'::regclass and conname = c.name) then
      execute format('alter table hermes_os.media_optimizer_jobs add constraint %I %s', c.name, c.def);
    end if;
  end loop;
end $$;

create table if not exists hermes_os.media_optimizer_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid not null,
  kind text not null check (kind in ('orig','opt','pad916','orig_crop','opt_crop')),
  pos integer not null default 0 check (pos between 0 and 11),
  t_sec numeric,
  mime text not null default 'image/jpeg' check (mime = 'image/jpeg'),
  width integer, height integer,
  data_b64 text not null check (length(data_b64) <= 700000),
  created_at timestamptz not null default now(),
  unique (job_id, kind, pos),
  -- le tenant de l'apercu est forcement celui du job (pas de trigger necessaire)
  constraint media_optimizer_previews_job_tenant_fk foreign key (job_id, tenant_id)
    references hermes_os.media_optimizer_jobs (id, tenant_id) on delete cascade
);

-- 3) CONTROLE D'ACCES : fonction de perimetre tenant du compte technique ---------------------------------------------
create or replace function hermes_os.media_worker_allows(p_tenant text)
 returns boolean language sql stable security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
  select exists (select 1 from hermes_os.media_worker_tenants w where w.role_name = session_user and w.tenant_id = p_tenant);
$f$;

alter table hermes_os.media_worker_tenants     enable row level security;
alter table hermes_os.media_buffer_channels    enable row level security;
alter table hermes_os.social_publish_control   enable row level security;
alter table hermes_os.media_optimizer_jobs     enable row level security;
alter table hermes_os.media_optimizer_previews enable row level security;

-- 4) FONCTIONS D'ECRITURE CONTROLEE (SECURITY DEFINER, search_path fige, tenant + canal + etat verifies) ----------------
create or replace function hermes_os.media_library_register(p_tenant text, p_drive_file_id text, p_title text, p_mime text, p_size bigint,
    p_parent text, p_owner text, p_created timestamptz, p_modified timestamptz)
 returns uuid language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_id uuid;
begin
  if not hermes_os.media_worker_allows(p_tenant) then raise exception 'TENANT_FORBIDDEN' using errcode = '42501'; end if;
  if p_drive_file_id is null or length(p_drive_file_id) < 5 then raise exception 'DRIVE_FILE_ID_REQUIRED'; end if;
  insert into hermes_os.social_media_library (tenant_id, drive_file_id, title, mime_type, file_size_bytes, drive_folder_id, drive_owner,
      drive_created_at, drive_modified_at, is_usable, unusable_reason)
  values (p_tenant, p_drive_file_id, left(p_title, 300), left(p_mime, 100), p_size, p_parent, p_owner, p_created, p_modified, false,
      'droits a verifier - ajoute par Media Optimizer')
  on conflict (tenant_id, drive_file_id) do nothing returning id into v_id;
  if v_id is null then
    select l.id into v_id from hermes_os.social_media_library l where l.tenant_id = p_tenant and l.drive_file_id = p_drive_file_id;
  end if;
  return v_id;
end $f$;

create or replace function hermes_os.media_record_draft(p_job uuid, p_post_id text, p_channel text, p_status text, p_caption text, p_hashtags text[])
 returns uuid language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare j hermes_os.media_optimizer_jobs%rowtype; v_plan uuid; v_net_ok boolean;
begin
  select * into j from hermes_os.media_optimizer_jobs where id = p_job for update;
  -- job d'un autre tenant : meme reponse que "inexistant" (pas de fuite d'existence)
  if not found or not hermes_os.media_worker_allows(j.tenant_id) then raise exception 'JOB_NOT_FOUND' using errcode = '42501'; end if;
  if p_status is distinct from 'draft' then raise exception 'ONLY_DRAFT_ALLOWED'; end if;
  if p_post_id is null or p_post_id !~ '^[0-9a-f]{24}$' then raise exception 'POST_ID_INVALID'; end if;
  if not exists (select 1 from hermes_os.media_buffer_channels c
                  where c.channel_id = p_channel and c.tenant_id = j.tenant_id and c.network = j.target_network and c.active) then
    raise exception 'CHANNEL_NETWORK_MISMATCH';
  end if;
  if j.rights_status <> 'authorized' or j.status <> 'ready_to_publish' then raise exception 'NOT_READY'; end if;
  v_net_ok := case j.target_network when 'instagram' then coalesce(j.ig_ok, false) else coalesce(j.fb_ok, false) end;
  if not v_net_ok then raise exception 'NETWORK_CHECK_FAILED'; end if;
  if j.public_token is null then raise exception 'PUBLIC_URL_NOT_READY'; end if;
  if j.buffer_post_id is not null and coalesce(j.buffer_status, '') not in ('deleted', 'error') then raise exception 'DRAFT_ALREADY_EXISTS'; end if;
  if p_caption is null or length(p_caption) < 20 or length(p_caption) > 2200 then raise exception 'CAPTION_INVALID'; end if;
  if p_hashtags is not null and (cardinality(p_hashtags) > 10 or exists (select 1 from unnest(p_hashtags) h where h !~ '^[A-Za-z0-9À-ÿ_]{2,30}$')) then
    raise exception 'HASHTAGS_INVALID';
  end if;
  insert into hermes_os.social_content_plan(tenant_id, platform, media_id, caption, hashtags, status, source_strategy, decision_reason)
    values (j.tenant_id, j.target_network, j.media_id, p_caption, p_hashtags, 'DRAFT', 'media_optimizer', 'Brouillon Buffer prepare, aucune publication')
    returning id into v_plan;
  insert into hermes_os.social_publications(tenant_id, content_plan_id, platform, platform_post_id, status, is_dry_run)
    values (j.tenant_id, v_plan, j.target_network, p_post_id, 'PENDING', true);
  update hermes_os.media_optimizer_jobs set buffer_post_id = p_post_id, buffer_channel_id = p_channel, buffer_status = 'draft',
      caption = p_caption, hashtags = p_hashtags, content_plan_id = v_plan, draft_error = null, draft_checked_at = now(), updated_at = now()
    where id = p_job;
  return v_plan;
end $f$;

create or replace function hermes_os.media_set_draft_status(p_job uuid, p_status text, p_detail text default null)
 returns void language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare j hermes_os.media_optimizer_jobs%rowtype;
begin
  select * into j from hermes_os.media_optimizer_jobs where id = p_job for update;
  if not found or not hermes_os.media_worker_allows(j.tenant_id) then raise exception 'JOB_NOT_FOUND' using errcode = '42501'; end if;
  if j.buffer_post_id is null then raise exception 'NO_DRAFT'; end if;
  if p_status not in ('draft', 'deleted', 'sent', 'error') then raise exception 'BAD_STATUS'; end if;
  if j.buffer_status in ('deleted', 'sent') then raise exception 'TERMINAL_STATUS'; end if;
  update hermes_os.media_optimizer_jobs set buffer_status = p_status, draft_checked_at = now(), updated_at = now(),
      draft_error = case when p_status = 'error' then left(coalesce(p_detail, 'erreur'), 300) else null end
    where id = p_job;
  if p_status = 'deleted' then
    update hermes_os.social_content_plan set status = 'CANCELLED', decision_reason = 'Brouillon Buffer supprime', updated_at = now()
      where id = j.content_plan_id and source_strategy = 'media_optimizer' and status = 'DRAFT';
    update hermes_os.social_publications set status = 'FAILED', error_detail = 'brouillon Buffer supprime'
      where content_plan_id = j.content_plan_id and status = 'PENDING';
  elsif p_status = 'sent' then
    insert into hermes_os.social_health_events(tenant_id, component, platform, status, detail)
      values (j.tenant_id, 'media_optimizer', j.target_network, 'DEGRADED', 'brouillon marque envoye cote Buffer (hors Hermes)');
  end if;
end $f$;

create or replace function hermes_os.media_log_health(p_tenant text, p_component text, p_platform text, p_status text, p_detail text)
 returns void language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
begin
  if not hermes_os.media_worker_allows(p_tenant) then raise exception 'TENANT_FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('RUNNING', 'DEGRADED', 'BLOCKED', 'ERROR') then raise exception 'BAD_STATUS'; end if;
  insert into hermes_os.social_health_events(tenant_id, component, platform, status, detail)
    values (p_tenant, left(p_component, 80), left(p_platform, 40), p_status, left(p_detail, 500));
end $f$;

-- 5) GARDES (triggers) ------------------------------------------------------------------------------------------------
create or replace function hermes_os.moj_guard() returns trigger language plpgsql set search_path = pg_catalog, hermes_os, pg_temp as $f$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.is_test is distinct from old.is_test
       or new.drive_file_id is distinct from old.drive_file_id or new.target_network is distinct from old.target_network then
      raise exception 'IMMUTABLE_COLUMN';
    end if;
    -- seuls les humains (facade set_media_rights) decident des droits
    if session_user = 'hv_media_worker' and (new.rights_status is distinct from old.rights_status or new.rights_note is distinct from old.rights_note) then
      raise exception 'RIGHTS_HUMAN_ONLY';
    end if;
  end if;
  if new.status = 'ready_to_publish' and (tg_op = 'INSERT' or old.status is distinct from 'ready_to_publish') then
    if new.rights_status <> 'authorized' or coalesce(new.ig_ok, false) is not true or coalesce(new.fb_ok, false) is not true then
      raise exception 'NOT_PUBLISHABLE';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.rights_status = 'authorized' and new.rights_status <> 'authorized' then
    if new.status = 'ready_to_publish' then new.status := 'optimized'; end if;
    if new.buffer_post_id is not null and coalesce(new.buffer_status, '') = 'draft' then
      new.draft_error := 'droits retires : supprimer le brouillon Buffer';
    end if;
  end if;
  return new;
end $f$;

create or replace function hermes_os.scp_media_draft_lock() returns trigger language plpgsql set search_path = pg_catalog, hermes_os, pg_temp as $f$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'CANCELLED') then raise exception 'MEDIA_OPTIMIZER_DRAFT_LOCKED'; end if;
  else
    if new.source_strategy is distinct from old.source_strategy
       or (new.status in ('SCHEDULED', 'PUBLISHED') and new.status is distinct from old.status) then
      raise exception 'MEDIA_OPTIMIZER_DRAFT_LOCKED';
    end if;
  end if;
  return new;
end $f$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'hermes_os.media_optimizer_jobs'::regclass and tgname = 'trg_moj_guard') then
    create trigger trg_moj_guard before insert or update on hermes_os.media_optimizer_jobs
      for each row execute function hermes_os.moj_guard();
  end if;
  -- inertes pour toute ligne qui n'est pas un brouillon du Media Optimizer
  if not exists (select 1 from pg_trigger where tgrelid = 'hermes_os.social_content_plan'::regclass and tgname = 'trg_scp_media_lock_ins') then
    create trigger trg_scp_media_lock_ins before insert on hermes_os.social_content_plan
      for each row when (new.source_strategy = 'media_optimizer') execute function hermes_os.scp_media_draft_lock();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'hermes_os.social_content_plan'::regclass and tgname = 'trg_scp_media_lock_upd') then
    create trigger trg_scp_media_lock_upd before update on hermes_os.social_content_plan
      for each row when (old.source_strategy = 'media_optimizer') execute function hermes_os.scp_media_draft_lock();
  end if;
end $$;
-- un seul brouillon actif par media et par reseau (n'affecte aucune autre ligne)
create unique index if not exists uq_scp_media_optimizer_draft on hermes_os.social_content_plan (tenant_id, media_id, platform)
  where source_strategy = 'media_optimizer' and status = 'DRAFT';

-- 6) FACADES TABLEAU DE BORD (tenant resolu en base depuis la session ; aucun tenant_id fourni par le client) -------------
create or replace function public.get_media_optimizer_state(p_limit integer default 100)
 returns jsonb language plpgsql stable security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 300); v_rows jsonb; v_stop boolean;
begin
  if v_uid is null then return jsonb_build_object('resolution_status', 'UNAUTHENTICATED', 'jobs', '[]'::jsonb); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('resolution_status', coalesce(v_s, 'NO_TENANT'), 'jobs', '[]'::jsonb); end if;
  select coalesce(c.publish_stop, true) into v_stop from hermes_os.social_publish_control c where c.tenant_id = v_t;
  select coalesce(jsonb_agg(x.o order by x.u desc), '[]'::jsonb) into v_rows from (
    select j.updated_at u, jsonb_build_object('id', j.id, 'media_id', j.media_id, 'source_name', j.source_name, 'folder_label', j.folder_label, 'kind', j.kind,
      'network', j.target_network, 'status', j.status, 'rights_status', j.rights_status, 'rights_note', j.rights_note, 'trigger', j.trigger_source,
      'optimizer_status', j.optimizer_status, 'size_before', j.size_before, 'size_after', j.size_after, 'reduction_pct', j.reduction_pct,
      'encode_sec', j.encode_sec, 'peak_ram_mb', j.peak_ram_mb, 'ssim_min', j.ssim_min, 'ig_ok', j.ig_ok, 'fb_ok', j.fb_ok, 'error', j.error,
      'attempts', j.attempts, 'params_version', j.params_version, 'updated_at', j.updated_at,
      'is_test', j.is_test, 'public_ready', (j.public_token is not null), 'buffer_status', j.buffer_status, 'buffer_post_id', j.buffer_post_id,
      'caption', j.caption, 'draft_error', j.draft_error, 'draft_checked_at', j.draft_checked_at,
      'aspect', j.result->'aspect', 'warnings', j.result->'warnings', 'pad_vertical', coalesce((j.options->>'pad_vertical')::boolean, false),
      'has_previews', exists (select 1 from hermes_os.media_optimizer_previews p where p.job_id = j.id and p.tenant_id = j.tenant_id)) o
    from hermes_os.media_optimizer_jobs j where j.tenant_id = v_t order by j.updated_at desc limit v_lim) x;
  return jsonb_build_object('resolution_status', 'OK', 'publish_stop', coalesce(v_stop, true), 'jobs', v_rows, 'provenance', 'REAL');
end $f$;

create or replace function public.get_media_optimizer_previews(p_job uuid)
 returns jsonb language plpgsql stable security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('resolution_status', 'UNAUTHENTICATED', 'previews', '[]'::jsonb); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('resolution_status', coalesce(v_s, 'NO_TENANT'), 'previews', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind, 'pos', p.pos, 't_sec', p.t_sec, 'mime', p.mime, 'width', p.width, 'height', p.height,
         'data_b64', p.data_b64) order by p.kind, p.pos), '[]'::jsonb)
    into v_out from hermes_os.media_optimizer_previews p where p.job_id = p_job and p.tenant_id = v_t;
  return jsonb_build_object('resolution_status', 'OK', 'previews', v_out);
end $f$;

create or replace function public.request_media_optimization(p_job_id uuid, p_pad_vertical boolean default false, p_network text default null)
 returns jsonb language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_n int; v_opts jsonb := '{}'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('ok', false, 'code', coalesce(v_s, 'NO_TENANT')); end if;
  if p_network is not null and p_network not in ('instagram', 'facebook') then return jsonb_build_object('ok', false, 'code', 'BAD_NETWORK'); end if;
  if exists (select 1 from hermes_os.media_optimizer_jobs j where j.id = p_job_id and j.tenant_id = v_t
               and j.buffer_post_id is not null and coalesce(j.buffer_status, '') = 'draft') then
    return jsonb_build_object('ok', false, 'code', 'DRAFT_EXISTS');
  end if;
  if coalesce(p_pad_vertical, false) then v_opts := v_opts || '{"pad_vertical":true}'::jsonb; end if;
  if p_network is not null then v_opts := v_opts || jsonb_build_object('network', p_network); end if;
  update hermes_os.media_optimizer_jobs set status = 'queued', trigger_source = 'manual', requested_by = v_uid::text, options = v_opts,
         attempts = 0, error = null, updated_at = now()
   where id = p_job_id and tenant_id = v_t and status not in ('processing', 'queued');
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND_OR_BUSY'); end if;
  return jsonb_build_object('ok', true, 'code', 'QUEUED');
end $f$;

create or replace function public.set_media_rights(p_job_id uuid, p_status text, p_note text default null)
 returns jsonb language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_media uuid; v_n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('ok', false, 'code', coalesce(v_s, 'NO_TENANT')); end if;
  if p_status not in ('authorized', 'rejected', 'pending_review') then return jsonb_build_object('ok', false, 'code', 'BAD_STATUS'); end if;
  if p_status = 'authorized' and length(btrim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('ok', false, 'code', 'NOTE_REQUIRED'); end if;
  update hermes_os.media_optimizer_jobs set rights_status = p_status, rights_note = nullif(btrim(p_note), ''), updated_at = now()
   where id = p_job_id and tenant_id = v_t returning media_id into v_media;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_media is not null then
    update hermes_os.social_media_library set is_usable = (p_status = 'authorized'),
           unusable_reason = case p_status when 'authorized' then null when 'rejected' then 'droits refuses' else 'droits a verifier' end
     where id = v_media and tenant_id = v_t;
  end if;
  return jsonb_build_object('ok', true, 'code', 'OK');
end $f$;

create or replace function public.activate_publish_stop(p_reason text default null)
 returns jsonb language plpgsql security definer set search_path = pg_catalog, hermes_os, pg_temp as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('ok', false, 'code', coalesce(v_s, 'NO_TENANT')); end if;
  insert into hermes_os.social_publish_control (tenant_id, publish_stop, reason, updated_by)
    values (v_t, true, coalesce(p_reason, 'STOP active depuis le tableau de bord'), v_uid::text)
  on conflict (tenant_id) do update set publish_stop = true, reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'code', 'OK');
end $f$;

-- 7) GARDE STOP dans public.social_publish : corps d'origine OVH conserve a l'identique + bloc "garde STOP" ---------------
--    (absence de ligne = STOP actif par prudence). ACL existantes inchangees (voir proposition separee pour les revoquer).
create or replace function public.social_publish(p_content_plan_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'hermes_os', 'pg_catalog', 'pg_temp' as $function$
declare cp hermes_os.social_content_plan; conn hermes_os.social_platform_connections; v_pub_id uuid; v_dry boolean;
begin
  select * into cp from hermes_os.social_content_plan where id=p_content_plan_id;
  if cp.id is null then return jsonb_build_object('ok', false, 'code','PLAN_NOT_FOUND'); end if;
  if cp.status <> 'SCHEDULED' then return jsonb_build_object('ok', false, 'code','PLAN_NOT_SCHEDULED'); end if;
  -- garde STOP publication (absence de ligne = STOP actif par prudence)
  if coalesce((select c.publish_stop from hermes_os.social_publish_control c where c.tenant_id=cp.tenant_id), true) then
    return jsonb_build_object('ok', false, 'code','PUBLISH_STOPPED');
  end if;

  select * into conn from hermes_os.social_platform_connections where platform=cp.platform;
  v_dry := (conn.status is distinct from 'CONNECTED') or (conn.publish_mode <> 'LIVE');

  insert into hermes_os.social_publications (content_plan_id, platform, platform_post_id, status, published_at, is_dry_run)
  values (p_content_plan_id, cp.platform, null, 'PUBLISHED', now(), v_dry)
  returning id into v_pub_id;

  update hermes_os.social_content_plan set status='PUBLISHED', updated_at=now() where id=p_content_plan_id;

  insert into hermes_os.social_events(event_type, payload)
  values ('SOCIAL_MEDIA_PUBLISHED', jsonb_build_object('publication_id', v_pub_id, 'content_plan_id', p_content_plan_id, 'is_dry_run', v_dry, 'platform', cp.platform));

  return jsonb_build_object('ok', true, 'publication_id', v_pub_id, 'is_dry_run', v_dry);
end; $function$;

-- 8) DROITS : tout revoquer pour tous les roles sur les NOUVEAUX objets, puis octroyer le minimum -------------------------
do $$
declare r record;
begin
  revoke all on table hermes_os.media_worker_tenants, hermes_os.media_buffer_channels, hermes_os.social_publish_control,
                      hermes_os.media_optimizer_jobs, hermes_os.media_optimizer_previews from public;
  revoke all on function hermes_os.media_worker_allows(text),
    hermes_os.media_library_register(text,text,text,text,bigint,text,text,timestamptz,timestamptz),
    hermes_os.media_record_draft(uuid,text,text,text,text,text[]), hermes_os.media_set_draft_status(uuid,text,text),
    hermes_os.media_log_health(text,text,text,text,text), hermes_os.moj_guard(), hermes_os.scp_media_draft_lock(),
    public.get_media_optimizer_state(integer), public.get_media_optimizer_previews(uuid),
    public.request_media_optimization(uuid,boolean,text), public.set_media_rights(uuid,text,text), public.activate_publish_stop(text) from public;
  for r in select rolname from pg_roles where rolname !~ '^pg_' and not rolsuper loop
    execute format('revoke all on table hermes_os.media_worker_tenants, hermes_os.media_buffer_channels, hermes_os.social_publish_control, hermes_os.media_optimizer_jobs, hermes_os.media_optimizer_previews from %I', r.rolname);
    execute format('revoke all on function hermes_os.media_worker_allows(text), hermes_os.media_library_register(text,text,text,text,bigint,text,text,timestamptz,timestamptz), hermes_os.media_record_draft(uuid,text,text,text,text,text[]), hermes_os.media_set_draft_status(uuid,text,text), hermes_os.media_log_health(text,text,text,text,text), hermes_os.moj_guard(), hermes_os.scp_media_draft_lock(), public.get_media_optimizer_state(integer), public.get_media_optimizer_previews(uuid), public.request_media_optimization(uuid,boolean,text), public.set_media_rights(uuid,text,text), public.activate_publish_stop(text) from %I', r.rolname);
  end loop;
end $$;

-- compte technique : lecture/ecriture bornees par colonne et par tenant (RLS ci-dessous)
grant usage on schema hermes_os to hv_media_worker;
grant select on hermes_os.media_optimizer_jobs, hermes_os.media_optimizer_previews, hermes_os.social_publish_control to hv_media_worker;
grant insert (tenant_id, media_id, drive_file_id, source_name, source_md5, source_sha256, kind, target_network, params_version, status,
              rights_status, trigger_source, folder_label, requested_by, options, error, is_test)
  on hermes_os.media_optimizer_jobs to hv_media_worker;
grant update (source_name, source_md5, source_sha256, kind, params_version, status, trigger_source, optimizer_status, result, output_path,
              output_sha256, size_before, size_after, reduction_pct, encode_sec, peak_ram_mb, ssim_min, ig_ok, fb_ok, error, attempts,
              duplicate_of, folder_label, requested_by, options, public_token, public_ext, draft_error, draft_attempts, draft_checked_at, updated_at)
  on hermes_os.media_optimizer_jobs to hv_media_worker;
grant insert, update, delete on hermes_os.media_optimizer_previews to hv_media_worker;
grant execute on function hermes_os.media_worker_allows(text),
  hermes_os.media_library_register(text,text,text,text,bigint,text,text,timestamptz,timestamptz),
  hermes_os.media_record_draft(uuid,text,text,text,text,text[]), hermes_os.media_set_draft_status(uuid,text,text),
  hermes_os.media_log_health(text,text,text,text,text) to hv_media_worker;

-- facades : authenticated uniquement (aucun acces anon)
grant execute on function public.get_media_optimizer_state(integer), public.get_media_optimizer_previews(uuid),
  public.request_media_optimization(uuid,boolean,text), public.set_media_rights(uuid,text,text), public.activate_publish_stop(text) to authenticated;

-- 9) POLITIQUES RLS (compte technique borne a ses tenants ; aucune politique pour les autres roles = refus) ---------------
do $$
declare p record;
begin
  for p in select * from (values
    ('media_optimizer_jobs',     'hv_worker_select', 'for select to hv_media_worker using (hermes_os.media_worker_allows(tenant_id))'),
    ('media_optimizer_jobs',     'hv_worker_insert', 'for insert to hv_media_worker with check (hermes_os.media_worker_allows(tenant_id) and rights_status = ''pending_review'')'),
    ('media_optimizer_jobs',     'hv_worker_update', 'for update to hv_media_worker using (hermes_os.media_worker_allows(tenant_id)) with check (hermes_os.media_worker_allows(tenant_id))'),
    ('media_optimizer_previews', 'hv_worker_select', 'for select to hv_media_worker using (hermes_os.media_worker_allows(tenant_id))'),
    ('media_optimizer_previews', 'hv_worker_insert', 'for insert to hv_media_worker with check (hermes_os.media_worker_allows(tenant_id))'),
    ('media_optimizer_previews', 'hv_worker_update', 'for update to hv_media_worker using (hermes_os.media_worker_allows(tenant_id)) with check (hermes_os.media_worker_allows(tenant_id))'),
    ('media_optimizer_previews', 'hv_worker_delete', 'for delete to hv_media_worker using (hermes_os.media_worker_allows(tenant_id))'),
    ('social_publish_control',   'hv_worker_select', 'for select to hv_media_worker using (hermes_os.media_worker_allows(tenant_id))')
  ) as t(tbl, name, def) loop
    if not exists (select 1 from pg_policy where polrelid = ('hermes_os.' || p.tbl)::regclass and polname = p.name) then
      execute format('create policy %I on hermes_os.%I %s', p.name, p.tbl, p.def);
    end if;
  end loop;
end $$;

-- 10) DONNEES INITIALES (aucune publication ; STOP actif) -----------------------------------------------------------------
insert into hermes_os.social_publish_control (tenant_id, publish_stop, reason, updated_by)
  values ('heliosolar', true, 'STOP publication actif par defaut (module Media Optimizer)', 'migration v3') on conflict (tenant_id) do nothing;
insert into hermes_os.media_worker_tenants (role_name, tenant_id) values ('hv_media_worker', 'heliosolar') on conflict do nothing;
insert into hermes_os.media_buffer_channels (channel_id, tenant_id, network, note) values
  ('6ac7feb86a5c39ccb65695ff', 'heliosolar', 'facebook', 'Page Facebook Heliosolar'),
  ('6ac7fb6d6a5c39ccb65676a1', 'heliosolar', 'instagram', '@heliosolar.fr') on conflict do nothing;
