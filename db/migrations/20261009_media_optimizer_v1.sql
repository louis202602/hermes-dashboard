-- Hermes Media Optimizer v1 (Hermes Visibility OS) -- consolidation des migrations appliquees le 2026-10-09 :
--   20261009_media_optimizer_v1, ..._worker_role, ..._options, ..._facades_and_stop_guard
-- Additif, sauf public.social_publish (garde STOP ajoutee ; corps d'origine conserve, voir ROLLBACK en fin de fichier).
-- Le mot de passe du role hv_media_worker n'est PAS versionne : il est genere sur le VPS et pose hors depot.

create table if not exists hermes_os.media_optimizer_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'heliosolar',
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
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists media_optimizer_jobs_dedup on hermes_os.media_optimizer_jobs (tenant_id, source_sha256, target_network, params_version) where source_sha256 is not null;
create unique index if not exists media_optimizer_jobs_dedup_md5 on hermes_os.media_optimizer_jobs (tenant_id, source_md5, target_network, params_version) where source_md5 is not null and params_version is not null;
create unique index if not exists media_optimizer_jobs_file_net on hermes_os.media_optimizer_jobs (tenant_id, drive_file_id, target_network);
create index if not exists media_optimizer_jobs_status on hermes_os.media_optimizer_jobs (tenant_id, status, updated_at desc);
alter table hermes_os.media_optimizer_jobs enable row level security;

create table if not exists hermes_os.social_publish_control (
  tenant_id text primary key, publish_stop boolean not null default true, reason text,
  updated_at timestamptz not null default now(), updated_by text
);
alter table hermes_os.social_publish_control enable row level security;
insert into hermes_os.social_publish_control (tenant_id, publish_stop, reason, updated_by)
values ('heliosolar', true, 'STOP publication actif par defaut (module Media Optimizer)', 'claude') on conflict (tenant_id) do nothing;

-- Role du pipeline VPS : privileges minimaux (mot de passe pose hors depot)
--   create role hv_media_worker login password '<hors depot>' nosuperuser nocreatedb nocreaterole noinherit connection limit 3;
grant usage on schema hermes_os to hv_media_worker;
grant select, insert, update on hermes_os.media_optimizer_jobs to hv_media_worker;
grant select on hermes_os.social_publish_control to hv_media_worker;
grant select, insert on hermes_os.social_media_library to hv_media_worker;
create policy hv_worker_all on hermes_os.media_optimizer_jobs for all to hv_media_worker using (true) with check (true);
create policy hv_worker_read on hermes_os.social_publish_control for select to hv_media_worker using (true);
alter role hv_media_worker set statement_timeout = '15s';

-- Facades du tableau de bord (tenant resolu en base depuis la session) : voir les fonctions
--   public.get_media_optimizer_state(int), public.request_media_optimization(uuid,boolean,text),
--   public.set_media_rights(uuid,text,text), public.activate_publish_stop(text)
-- (SECURITY DEFINER, EXECUTE reserve au role authenticated). Corps complets dans la base.

-- Garde STOP dans public.social_publish : refuse (PUBLISH_STOPPED) tant que publish_stop est vrai ou absent.
-- ROLLBACK : recreer public.social_publish(uuid) sans le bloc "garde STOP publication" (corps d'origine :
--   meme fonction, sans le test sur hermes_os.social_publish_control).
