-- PHOTO-P0 / 4 — Stockage privé des proxies photo.
-- (project smubxqorirlfldatzmym)
--
-- ✅ APPLIQUÉE en production le 2026-08-18 (migration `photo_studio_4_storage_proxies`,
--    version 20260818210757). GO_LIVE = NO — la verticale reste DORMANTE.
--    Vérifié après application : bucket privé (public=false), plafond 6 MiB,
--    MIME {jpeg, webp}, 3 policies bornées au bucket ET au tenant, 0 policy DELETE,
--    bucket VIDE.
--
-- Ce que ce lot provisionne :
--   1. un bucket PRIVÉ `hermes-photo-proxies` (`public=false`) — lecture uniquement
--      par URL signée à TTL court, jamais `getPublicUrl` ;
--   2. des policies `storage.objects` restreintes À CE BUCKET, dérivant le tenant
--      depuis la clé d'objet — un client ne peut pas élargir sa portée en
--      fournissant un autre chemin ;
--   3. les façades de finalisation / échec / purge, bornées et appelables — AUCUN
--      worker automatique, AUCUN scheduler.
--
-- AUCUN RAW n'entre ici. Seuls deux dérivés bornés par photo :
--   `p1600.jpg` (proxy, grand côté 1600 px) et `t400.jpg` (vignette).
--
-- Clé d'objet : `<tenant_id>/<session_id>/<asset_id>/<variant>.jpg`
--   foldername[1] = tenant_id → doit être un tenant dont l'appelant est membre.
-- Différence assumée avec `hermes-chat-attachments` (qui isole aussi par user) :
-- une séance appartient au STUDIO, pas à un utilisateur — un second opérateur du
-- même tenant doit pouvoir reprendre la revue. L'unité d'isolation correcte ici
-- est donc le tenant, et rien de plus large.
--
-- `hermes_os.is_active_tenant_member(text)` est RÉUTILISÉE telle quelle (créée par
-- la migration `20260813_hermes_chat_attachments_1.sql`) — elle n'est ni recréée
-- ici, ni supprimée par le rollback de ce lot.

begin;

-- ---------------------------------------------------------------------------
-- 1. Bucket privé. Plafond 6 MiB : un proxy 1600 px pèse ~400 Ko ; 6 MiB laisse
--    une marge large tout en rendant impossible le dépôt d'un RAW (20-45 Mo).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hermes-photo-proxies',
  'hermes-photo-proxies',
  false,
  6291456, -- 6 MiB : trop petit pour un RAW, largement assez pour un proxy JPEG
  array['image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS storage.objects — ce bucket uniquement.
--    Pas de policy DELETE : l'effacement d'un objet passe par la purge côté
--    serveur (rôle de service), jamais par le navigateur. Un client ne peut
--    donc pas détruire un proxy depuis l'UI.
-- ---------------------------------------------------------------------------
-- `create policy` n'accepte pas `if not exists` : on retire d'abord, afin que ce
-- lot reste rejouable (idempotent) comme les autres migrations du dépôt.
drop policy if exists "hermes_photo_proxy_insert_tenant" on storage.objects;
drop policy if exists "hermes_photo_proxy_select_tenant" on storage.objects;
drop policy if exists "hermes_photo_proxy_update_tenant" on storage.objects;

create policy "hermes_photo_proxy_insert_tenant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hermes-photo-proxies'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_photo_proxy_select_tenant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hermes-photo-proxies'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_photo_proxy_update_tenant"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'hermes-photo-proxies'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'hermes-photo-proxies'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 3. Finaliser un proxy après upload sous RLS. Le chemin est re-validé
--    server-side contre `<tenant>/<session>/<asset>/` : un chemin forgé pointant
--    ailleurs est refusé (`PATH_OUT_OF_SCOPE`), même si l'upload avait réussi.
--    Pose aussi le TTL de purge (90 jours), origine de la maîtrise du stockage.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_photo_proxy(
  p_asset_id    uuid,
  p_proxy_path  text,
  p_thumb_path  text,
  p_proxy_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_session uuid; v_prefix text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select a.session_id into v_session
    from hermes_os.photo_session_assets a
   where a.id = p_asset_id and a.tenant_id = v_t;
  if v_session is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_prefix := v_t || '/' || v_session::text || '/' || p_asset_id::text || '/';
  if p_proxy_path is null or left(p_proxy_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_thumb_path is not null and left(p_thumb_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_proxy_bytes is null or p_proxy_bytes <= 0 or p_proxy_bytes > 6291456 then
    return jsonb_build_object('ok', false, 'code', 'BAD_SIZE');
  end if;

  update hermes_os.photo_session_assets
     set proxy_path = p_proxy_path,
         thumb_path = p_thumb_path,
         proxy_bytes = p_proxy_bytes,
         proxy_status = 'READY',
         purge_after = (current_date + 90),
         updated_at = now()
   where id = p_asset_id and tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'OK', 'asset_id', p_asset_id);
end;
$function$;

revoke all on function public.finalize_photo_proxy(uuid, text, text, bigint) from public;
grant execute on function public.finalize_photo_proxy(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Marquer un proxy en échec. La photo reste INVENTORIÉE (la ligne n'est pas
--    supprimée) et reste visible dans la revue avec un état honnête : une photo
--    illisible ne doit jamais disparaître silencieusement du tri.
-- ---------------------------------------------------------------------------
create or replace function public.mark_photo_proxy_failed(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_n int;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  update hermes_os.photo_session_assets
     set proxy_status = 'FAILED', updated_at = now()
   where id = p_asset_id and tenant_id = v_t and proxy_status <> 'PURGED';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', v_n > 0, 'code', case when v_n > 0 then 'OK' else 'NOT_FOUND' end);
end;
$function$;

revoke all on function public.mark_photo_proxy_failed(uuid) from public;
grant execute on function public.mark_photo_proxy_failed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Purge — bornée, APPELABLE, jamais automatique.
--    `list_expired_photo_proxies` liste ce qui a dépassé son TTL ;
--    `mark_photo_proxy_purged` oublie le dérivé (chemins effacés, statut PURGED)
--    SANS supprimer la ligne d'inventaire et sans jamais toucher au fichier
--    original, qui n'a jamais quitté le poste de la photographe.
--
--    ⚠️ ORDRE OBLIGATOIRE : lister → supprimer les objets Storage → marquer purgé.
--    `mark_photo_proxy_purged` efface les chemins ; l'appeler AVANT la suppression
--    physique rendrait l'objet définitivement orphelin (plus aucune référence).
--
--    ⚠️ PHASE 1 : ces deux façades ne sont câblées à AUCUN appelant. Le TTL de
--    90 jours est donc posé mais PAS appliqué automatiquement — conforme à
--    « aucun worker, aucun scheduler », à câbler explicitement au go-live.
-- ---------------------------------------------------------------------------
create or replace function public.list_expired_photo_proxies(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'asset_id', a.id, 'proxy_path', a.proxy_path, 'thumb_path', a.thumb_path,
           'purge_after', a.purge_after) order by a.purge_after), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.photo_session_assets
           where tenant_id = v_t and proxy_status = 'READY'
             and purge_after is not null and purge_after < current_date
           order by purge_after limit v_lim) a;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.list_expired_photo_proxies(integer) from public;
grant execute on function public.list_expired_photo_proxies(integer) to authenticated;

create or replace function public.mark_photo_proxy_purged(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_n int;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  update hermes_os.photo_session_assets
     set proxy_status = 'PURGED', proxy_path = null, thumb_path = null,
         proxy_bytes = null, updated_at = now()
   where id = p_asset_id and tenant_id = v_t;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', v_n > 0, 'code', case when v_n > 0 then 'OK' else 'NOT_FOUND' end);
end;
$function$;

revoke all on function public.mark_photo_proxy_purged(uuid) from public;
grant execute on function public.mark_photo_proxy_purged(uuid) to authenticated;

commit;
