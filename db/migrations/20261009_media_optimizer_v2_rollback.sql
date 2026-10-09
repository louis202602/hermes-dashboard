-- NOTE 2026-10-09 : CETTE MIGRATION EST REMPLACEE pour la production par 20261009_media_optimizer_v3_ovh.sql.
-- Preuve : la production Hermes Visibility OS est PostgreSQL OVH (hermes_os) ; Supabase est un filet de retour arriere gele. Ne PAS l'appliquer.
-- Retour arriere de media_optimizer_v2 SANS PERTE : les donnees des colonnes/tables ajoutees sont d'abord copiees
-- dans des tables de sauvegarde (hermes_os.mo_v2_backup_*), puis les objets v2 sont retires, puis la fonction v1 est restauree.
begin;
create table if not exists hermes_os.mo_v2_backup_jobs as
  select id, is_test, public_token, public_ext, buffer_channel_id, buffer_post_id, buffer_status, caption, hashtags, draft_error, draft_attempts, draft_checked_at, content_plan_id, now() as saved_at
  from hermes_os.media_optimizer_jobs;
create table if not exists hermes_os.mo_v2_backup_previews as select * from hermes_os.media_optimizer_previews;
revoke all on hermes_os.mo_v2_backup_jobs, hermes_os.mo_v2_backup_previews from public, anon, authenticated;

drop function if exists public.get_media_optimizer_previews(uuid);
drop function if exists hermes_os.media_record_draft(uuid,text,text,text,text,text[]);
drop function if exists hermes_os.media_log_health(text,text,text,text,text);
drop table if exists hermes_os.media_optimizer_previews;
drop index if exists hermes_os.uq_moj_public_token;
drop index if exists hermes_os.uq_moj_buffer_post;
alter table hermes_os.media_optimizer_jobs
  drop column if exists is_test, drop column if exists public_token, drop column if exists public_ext, drop column if exists buffer_channel_id,
  drop column if exists buffer_post_id, drop column if exists buffer_status, drop column if exists caption, drop column if exists hashtags,
  drop column if exists draft_error, drop column if exists draft_attempts, drop column if exists draft_checked_at, drop column if exists content_plan_id;

-- fonction v1 restauree a l'identique (definition releve en production le 2026-10-09)
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
      'attempts',j.attempts,'params_version',j.params_version,'updated_at',j.updated_at) o
    from hermes_os.media_optimizer_jobs j where j.tenant_id=v_t order by j.updated_at desc limit v_lim) x;
  return jsonb_build_object('resolution_status','OK','publish_stop',coalesce(v_stop,true),'jobs',v_rows,'provenance','REAL');
end; $f$;
grant execute on function public.get_media_optimizer_state(integer) to authenticated;
commit;
