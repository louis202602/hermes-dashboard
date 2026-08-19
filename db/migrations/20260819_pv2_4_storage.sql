-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / 4 — Stockage PRIVÉ `hermes-pv-documents`.
-- (project smubxqorirlfldatzmym)
--
-- RÉUTILISATION, PAS DEUXIÈME SYSTÈME. Ce lot copie exactement le patron déjà en
-- production pour `hermes-photo-proxies` (migration `photo_studio_4`) :
--   * bucket `public = false` ⇒ aucune lecture anonyme, aucune URL publique ;
--   * policies `storage.objects` RESTREINTES À CE BUCKET, dérivant le tenant du
--     PREMIER SEGMENT de la clé d'objet, validé par la fonction EXISTANTE
--     `hermes_os.is_active_tenant_member(text)` — ni recréée ici, ni supprimée
--     par le rollback de ce lot ;
--   * AUCUNE policy DELETE : un objet ne s'efface pas depuis le navigateur.
--
-- CLÉ D'OBJET — le tenant est obligatoire, le site l'est aussi :
--   `<tenant_id>/<site_id>/<document_id>/<fichier>`
--   foldername[1] = tenant_id → doit être un tenant dont l'appelant est membre.
--   foldername[2] = site_id   → re-validé server-side par `finalize_pv_document`.
-- Un chemin qui réussirait l'upload mais pointerait hors périmètre est REFUSÉ à
-- la finalisation (`PATH_OUT_OF_SCOPE`) : l'objet reste alors orphelin et non
-- référencé, jamais rattaché à une donnée métier.
--
-- PLAFOND 25 MiB : une facture EDF scannée en PDF pèse quelques centaines de Ko ;
-- un relevé photographique de toiture, quelques Mo. 25 MiB laisse une marge
-- confortable tout en bornant réellement le stockage. MIME : PDF + 3 formats
-- image, allowlist EXPLICITE — tout le reste est refusé par le bucket lui-même,
-- donc avant même d'atteindre une policy ou une façade.
--
-- URL SIGNÉES : elles sont produites à la demande côté serveur (TTL 300 s, voir
-- `services/hermes/pv.ts`) et ne sont JAMAIS persistées. La source de vérité
-- reste le couple (bucket, chemin) en base — c'est ce que PV-1 avait imposé par
-- CHECK, et ce lot ne l'assouplit pas.

begin;

-- ---------------------------------------------------------------------------
-- 1. Bucket strictement PRIVÉ.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hermes-pv-documents',
  'hermes-pv-documents',
  false,
  26214400, -- 25 MiB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. RLS `storage.objects` — CE BUCKET uniquement.
--    `create policy` n'accepte pas `if not exists` : on retire d'abord, pour que
--    le lot reste rejouable comme toutes les migrations du dépôt.
-- ---------------------------------------------------------------------------
drop policy if exists "hermes_pv_documents_insert_tenant" on storage.objects;
drop policy if exists "hermes_pv_documents_select_tenant" on storage.objects;
drop policy if exists "hermes_pv_documents_update_tenant" on storage.objects;

create policy "hermes_pv_documents_insert_tenant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hermes-pv-documents'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_pv_documents_select_tenant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hermes-pv-documents'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_pv_documents_update_tenant"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'hermes-pv-documents'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'hermes-pv-documents'
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 3. Réserver un emplacement AVANT l'upload.
--    L'identifiant du document est attribué PAR LA BASE, et le chemin en
--    découle : le client ne choisit donc jamais où écrire. C'est ce qui rend le
--    contrôle de périmètre à la finalisation non contournable.
-- ---------------------------------------------------------------------------
create or replace function public.prepare_pv_document(
  p_site_id  uuid,
  p_doc_type text,
  p_filename text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_site uuid; v_id uuid := gen_random_uuid(); v_safe text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select s.id into v_site from hermes_os.pv_sites s
   where s.id = p_site_id and s.tenant_id = v_t;
  if v_site is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p_doc_type is null or p_doc_type not in
     ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
      'NOTE_TECHNIQUE','ATTESTATION','AUTRE') then
    return jsonb_build_object('ok', false, 'code', 'BAD_DOC_TYPE');
  end if;

  -- Nom de fichier ASSAINI : le nom d'origine ne construit jamais le chemin
  -- directement (traversée `../`, séparateurs, longueur).
  v_safe := nullif(regexp_replace(coalesce(p_filename, ''), '[^A-Za-z0-9._-]', '_', 'g'), '');
  v_safe := left(coalesce(v_safe, 'document'), 120);

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'document_id', v_id,
    'bucket', 'hermes-pv-documents',
    'path', v_t || '/' || v_site::text || '/' || v_id::text || '/' || v_safe,
    'max_bytes', 26214400,
    'allowed_mime', jsonb_build_array('application/pdf','image/jpeg','image/png','image/webp'));
end;
$function$;

revoke all on function public.prepare_pv_document(uuid, text, text) from public;
grant execute on function public.prepare_pv_document(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Finaliser un document après upload sous RLS.
--    Le chemin est RE-VALIDÉ server-side contre `<tenant>/<site>/<document>/` :
--    un chemin forgé pointant ailleurs est refusé même si l'upload a réussi.
--    MIME et taille sont revalidés ici AUSSI — le bucket les borne déjà, mais
--    une base ne doit pas dépendre d'un composant en amont pour rester cohérente.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_pv_document(
  p_document_id uuid,
  p_site_id     uuid,
  p_doc_type    text,
  p_path        text,
  p_mime        text,
  p_bytes       bigint,
  p_sha256      text default null,
  p_filename    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_site uuid; v_prefix text; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  v_uid := (v_g->>'uid')::uuid;

  select s.id into v_site from hermes_os.pv_sites s
   where s.id = p_site_id and s.tenant_id = v_t;
  if v_site is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_prefix := v_t || '/' || v_site::text || '/' || p_document_id::text || '/';
  if p_path is null or left(p_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then
    return jsonb_build_object('ok', false, 'code', 'BAD_MIME');
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 26214400 then
    return jsonb_build_object('ok', false, 'code', 'BAD_SIZE');
  end if;

  begin
    insert into hermes_os.pv_documents
      (id, tenant_id, site_id, doc_type, storage_bucket, storage_path,
       mime_type, size_bytes, sha256, original_filename, uploaded_by)
    values
      (p_document_id, v_t, v_site, p_doc_type, 'hermes-pv-documents', p_path,
       p_mime, p_bytes, p_sha256, left(coalesce(p_filename, ''), 260), v_uid)
    on conflict (id) do update
      set size_bytes = excluded.size_bytes,
          sha256     = excluded.sha256,
          updated_at = now()
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_DOCUMENT');
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OBJECT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'OK', 'document_id', v_id,
    'bucket', 'hermes-pv-documents', 'path', p_path);
end;
$function$;

revoke all on function public.finalize_pv_document(uuid, uuid, text, text, text, bigint, text, text) from public;
grant execute on function public.finalize_pv_document(uuid, uuid, text, text, text, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Suppression LOGIQUE d'un document.
--    La ligne survit — un document retiré de l'UI reste traçable et auditable.
--    L'effacement PHYSIQUE de l'objet est un geste serveur explicite du lot
--    PV-3 : il n'existe pas ici, et aucune policy DELETE ne le rend possible
--    depuis le navigateur. Dit franchement : le stockage n'est donc pas encore
--    récupéré automatiquement.
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_pv_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  v_uid := (v_g->>'uid')::uuid;

  update hermes_os.pv_documents d
     set deleted_at = now(), deleted_by = v_uid, updated_at = now()
   where d.id = p_document_id and d.tenant_id = v_t and d.deleted_at is null
   returning d.id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true, 'code', 'DELETED', 'document_id', v_id);
end;
$function$;

revoke all on function public.soft_delete_pv_document(uuid) from public;
grant execute on function public.soft_delete_pv_document(uuid) to authenticated;

commit;
