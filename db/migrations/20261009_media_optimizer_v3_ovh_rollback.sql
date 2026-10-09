-- =============================================================================
-- ROLLBACK de 20261009_media_optimizer_v3_ovh.sql -- SANS PERTE DE DONNEES
-- =============================================================================
-- 1) copie TOUTES les donnees du module dans des tables de conservation hermes_os.mo_v3_backup_<horodatage>_* (jamais supprimees ici,
--    inaccessibles a tout role non-superuser) ;
-- 2) annule (statut CANCELLED, ligne conservee) les brouillons crees par le module dans social_content_plan ;
-- 3) retire triggers, index, fonctions, facades et tables du module ;
-- 4) restaure a l'identique le corps d'origine de public.social_publish (copie de la sauvegarde social_publish_original_body.sql) ;
-- 5) le role hv_media_worker est conserve mais sans connexion (nologin) -- DROP ROLE manuel si souhaite.
-- Aucune ligne des tables Visibility d'origine n'est supprimee. Idempotent. A executer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier
-- =============================================================================
set local lock_timeout = '5s';
set local statement_timeout = '300s';

do $$
declare s text := to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS'); t text;
begin
  -- 1) conservation des donnees du module
  foreach t in array array['media_optimizer_jobs','media_optimizer_previews','social_publish_control','media_buffer_channels','media_worker_tenants'] loop
    if to_regclass('hermes_os.' || t) is not null then
      execute format('create table hermes_os.mo_v3_backup_%s_%s as table hermes_os.%I', s, t, t);
      execute format('revoke all on hermes_os.mo_v3_backup_%s_%s from public', s, t);
    end if;
  end loop;
  if to_regclass('hermes_os.social_content_plan') is not null then
    execute format('create table hermes_os.mo_v3_backup_%s_plan as select * from hermes_os.social_content_plan where source_strategy = ''media_optimizer''', s);
    execute format('create table hermes_os.mo_v3_backup_%s_publications as select * from hermes_os.social_publications where content_plan_id in (select id from hermes_os.social_content_plan where source_strategy = ''media_optimizer'')', s);
    execute format('create table hermes_os.mo_v3_backup_%s_health as select * from hermes_os.social_health_events where component = ''media_optimizer''', s);
    execute format('revoke all on hermes_os.mo_v3_backup_%s_plan, hermes_os.mo_v3_backup_%s_publications, hermes_os.mo_v3_backup_%s_health from public', s, s, s);
  end if;
  -- les tables de conservation ne sont pas lisibles par les roles applicatifs
  for t in select c.relname from pg_class c where c.relnamespace = 'hermes_os'::regnamespace and c.relname like 'mo\_v3\_backup\_%' loop
    perform 1;
  end loop;
end $$;

do $$
declare r record; t text;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'hermes_os'::regnamespace and c.relkind = 'r' and c.relname like 'mo\_v3\_backup\_%' loop
    for r in select rolname from pg_roles where rolname !~ '^pg_' and not rolsuper loop
      execute format('revoke all on hermes_os.%I from %I', t, r.rolname);
    end loop;
  end loop;
end $$;

-- 2) neutraliser les brouillons du module (lignes conservees)
do $$
begin
  if to_regclass('hermes_os.social_content_plan') is not null then
    update hermes_os.social_content_plan set status = 'CANCELLED', decision_reason = 'Rollback Media Optimizer v3', updated_at = now()
     where source_strategy = 'media_optimizer' and status = 'DRAFT';
  end if;
end $$;

-- 3) retrait des objets du module
drop trigger if exists trg_scp_media_lock_ins on hermes_os.social_content_plan;
drop trigger if exists trg_scp_media_lock_upd on hermes_os.social_content_plan;
drop index if exists hermes_os.uq_scp_media_optimizer_draft;
drop function if exists public.get_media_optimizer_state(integer);
drop function if exists public.get_media_optimizer_previews(uuid);
drop function if exists public.request_media_optimization(uuid, boolean, text);
drop function if exists public.set_media_rights(uuid, text, text);
drop function if exists public.activate_publish_stop(text);
-- tables d'abord (leurs politiques RLS dependent de media_worker_allows), fonctions ensuite
drop table if exists hermes_os.media_optimizer_previews;
drop table if exists hermes_os.media_optimizer_jobs;
drop table if exists hermes_os.social_publish_control;
drop table if exists hermes_os.media_buffer_channels;
drop table if exists hermes_os.media_worker_tenants;
drop function if exists hermes_os.moj_guard();
drop function if exists hermes_os.scp_media_draft_lock();
drop function if exists hermes_os.media_record_draft(uuid, text, text, text, text, text[]);
drop function if exists hermes_os.media_set_draft_status(uuid, text, text);
drop function if exists hermes_os.media_log_health(text, text, text, text, text);
drop function if exists hermes_os.media_library_register(text, text, text, text, bigint, text, text, timestamptz, timestamptz);
drop function if exists hermes_os.media_worker_allows(text);

-- 4) corps d'origine de public.social_publish (ACL existantes inchangees)
create or replace function public.social_publish(p_content_plan_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare cp hermes_os.social_content_plan; conn hermes_os.social_platform_connections; v_pub_id uuid; v_dry boolean;
begin
  select * into cp from hermes_os.social_content_plan where id=p_content_plan_id;
  if cp.id is null then return jsonb_build_object('ok', false, 'code','PLAN_NOT_FOUND'); end if;
  if cp.status <> 'SCHEDULED' then return jsonb_build_object('ok', false, 'code','PLAN_NOT_SCHEDULED'); end if;

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

-- 5) le compte technique n'a plus aucun usage
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'hv_media_worker') then
    alter role hv_media_worker nologin;
    revoke usage on schema hermes_os from hv_media_worker;
  end if;
end $$;
