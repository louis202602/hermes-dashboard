-- NOTE 2026-10-09 : CETTE MIGRATION EST REMPLACEE pour la production par 20261009_media_optimizer_v3_ovh.sql.
-- Preuve : la production Hermes Visibility OS est PostgreSQL OVH (hermes_os) ; Supabase est un filet de retour arriere gele. Ne PAS l'appliquer.
-- Hermes Media Optimizer v2 : etape brouillon Buffer + apercus avant/apres.
-- ADDITIF ET IDEMPOTENT. Aucun DROP/RENAME/TRUNCATE/DELETE sur un objet existant.
-- Reutilise hermes_os.media_optimizer_jobs / social_content_plan / social_publications (aucune nouvelle base).
-- Retour arriere : db/migrations/20261009_media_optimizer_v2_rollback.sql

-- 1) Colonnes ajoutees (table creee par notre migration v1, 5 lignes)
alter table hermes_os.media_optimizer_jobs
  add column if not exists is_test boolean not null default false,
  add column if not exists public_token text,
  add column if not exists public_ext text,
  add column if not exists buffer_channel_id text,
  add column if not exists buffer_post_id text,
  add column if not exists buffer_status text,
  add column if not exists caption text,
  add column if not exists hashtags text[],
  add column if not exists draft_error text,
  add column if not exists draft_attempts int not null default 0,
  add column if not exists draft_checked_at timestamptz,
  add column if not exists content_plan_id uuid;
create unique index if not exists uq_moj_public_token on hermes_os.media_optimizer_jobs(public_token) where public_token is not null;
create unique index if not exists uq_moj_buffer_post  on hermes_os.media_optimizer_jobs(buffer_post_id) where buffer_post_id is not null;

-- 2) Nouvelle table d'apercus (images JPEG en base64, petites, par job)
create table if not exists hermes_os.media_optimizer_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  job_id uuid not null references hermes_os.media_optimizer_jobs(id) on delete cascade,
  kind text not null check (kind in ('orig','opt','pad916','orig_crop','opt_crop')),
  pos int not null default 0,
  t_sec numeric,
  mime text not null default 'image/jpeg',
  width int, height int,
  data_b64 text not null,
  created_at timestamptz not null default now(),
  unique (job_id, kind, pos)
);
alter table hermes_os.media_optimizer_previews enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid='hermes_os.media_optimizer_previews'::regclass and polname='hv_worker_all') then
    create policy hv_worker_all on hermes_os.media_optimizer_previews for all to hv_media_worker using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on hermes_os.media_optimizer_previews to hv_media_worker;
-- AUCUN droit direct ajoute sur social_content_plan / social_publications / social_health_events :
-- l'ecriture passe par les deux fonctions ci-dessous (tenant verifie, brouillon uniquement).

-- 3) Ecriture controlee dans les tables Visibility OS (SECURITY DEFINER, search_path fige, execute reserve au role worker)
create or replace function hermes_os.media_record_draft(p_job uuid, p_post_id text, p_channel text, p_status text, p_caption text, p_hashtags text[])
 returns uuid language plpgsql security definer set search_path to 'hermes_os','pg_catalog','pg_temp' as $f$
declare j hermes_os.media_optimizer_jobs%rowtype; v_plan uuid;
begin
  if p_status is distinct from 'draft' then raise exception 'ONLY_DRAFT_ALLOWED'; end if;
  if p_post_id is null or length(p_post_id) < 8 then raise exception 'POST_ID_REQUIRED'; end if;
  select * into j from hermes_os.media_optimizer_jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.rights_status <> 'authorized' or j.status <> 'ready_to_publish' then raise exception 'NOT_READY'; end if;
  if j.buffer_post_id is not null then raise exception 'DRAFT_ALREADY_EXISTS'; end if;
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
revoke all on function hermes_os.media_record_draft(uuid,text,text,text,text,text[]) from public, anon, authenticated;
grant execute on function hermes_os.media_record_draft(uuid,text,text,text,text,text[]) to hv_media_worker;

create or replace function hermes_os.media_log_health(p_tenant text, p_component text, p_platform text, p_status text, p_detail text)
 returns void language plpgsql security definer set search_path to 'hermes_os','pg_catalog','pg_temp' as $f$
begin
  if p_status not in ('RUNNING','DEGRADED','BLOCKED','ERROR') then raise exception 'BAD_STATUS'; end if;
  if not exists (select 1 from hermes_os.social_publish_control where tenant_id = p_tenant) then raise exception 'UNKNOWN_TENANT'; end if;
  insert into hermes_os.social_health_events(tenant_id, component, platform, status, detail)
    values (p_tenant, left(p_component, 80), left(p_platform, 40), p_status, left(p_detail, 500));
end $f$;
revoke all on function hermes_os.media_log_health(text,text,text,text,text) from public, anon, authenticated;
grant execute on function hermes_os.media_log_health(text,text,text,text,text) to hv_media_worker;

-- 4) Facades dashboard (meme schema de securite que v1 : auth.uid() + tenant resolu)
create or replace function public.get_media_optimizer_state(p_limit integer default 100)
 returns jsonb language plpgsql stable security definer
 set search_path to 'hermes_os','pg_catalog','pg_temp' as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_lim int := least(greatest(coalesce(p_limit,100),1),300);
        v_rows jsonb; v_stop boolean;
begin
  if v_uid is null then return jsonb_build_object('resolution_status','UNAUTHENTICATED','jobs','[]'::jsonb); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('resolution_status', coalesce(v_s,'NO_TENANT'),'jobs','[]'::jsonb); end if;
  select coalesce(publish_stop,true) into v_stop from hermes_os.social_publish_control where tenant_id=v_t;
  select coalesce(jsonb_agg(x.o order by x.u desc),'[]'::jsonb) into v_rows from (
    select j.updated_at u, jsonb_build_object('id',j.id,'media_id',j.media_id,'source_name',j.source_name,'folder_label',j.folder_label,'kind',j.kind,
      'network',j.target_network,'status',j.status,'rights_status',j.rights_status,'rights_note',j.rights_note,'trigger',j.trigger_source,
      'optimizer_status',j.optimizer_status,'size_before',j.size_before,'size_after',j.size_after,'reduction_pct',j.reduction_pct,
      'encode_sec',j.encode_sec,'peak_ram_mb',j.peak_ram_mb,'ssim_min',j.ssim_min,'ig_ok',j.ig_ok,'fb_ok',j.fb_ok,'error',j.error,
      'attempts',j.attempts,'params_version',j.params_version,'updated_at',j.updated_at,
      'is_test',j.is_test,'public_ready',(j.public_token is not null),'buffer_status',j.buffer_status,'buffer_post_id',j.buffer_post_id,
      'caption',j.caption,'draft_error',j.draft_error,'draft_checked_at',j.draft_checked_at,
      'aspect',j.result->'aspect','warnings',j.result->'warnings','pad_vertical',coalesce((j.options->>'pad_vertical')::boolean,false),
      'has_previews',exists(select 1 from hermes_os.media_optimizer_previews p where p.job_id=j.id)) o
    from hermes_os.media_optimizer_jobs j where j.tenant_id=v_t order by j.updated_at desc limit v_lim) x;
  return jsonb_build_object('resolution_status','OK','publish_stop',coalesce(v_stop,true),'jobs',v_rows,'provenance','REAL');
end; $f$;

create or replace function public.get_media_optimizer_previews(p_job uuid)
 returns jsonb language plpgsql stable security definer
 set search_path to 'hermes_os','pg_catalog','pg_temp' as $f$
declare v_uid uuid := auth.uid(); v_t text; v_s text; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('resolution_status','UNAUTHENTICATED','previews','[]'::jsonb); end if;
  select r.tenant_id, r.resolution_status into v_t, v_s from hermes_os.resolve_active_tenant(null) r;
  if v_s is distinct from 'OK' then return jsonb_build_object('resolution_status', coalesce(v_s,'NO_TENANT'),'previews','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',p.kind,'pos',p.pos,'t_sec',p.t_sec,'mime',p.mime,'width',p.width,'height',p.height,'data_b64',p.data_b64) order by p.kind,p.pos),'[]'::jsonb)
    into v_out from hermes_os.media_optimizer_previews p where p.job_id=p_job and p.tenant_id=v_t;
  return jsonb_build_object('resolution_status','OK','previews',v_out);
end; $f$;
revoke all on function public.get_media_optimizer_previews(uuid) from public, anon;
grant execute on function public.get_media_optimizer_previews(uuid) to authenticated;
grant execute on function public.get_media_optimizer_state(integer) to authenticated;
