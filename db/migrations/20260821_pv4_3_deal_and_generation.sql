-- PACK PHOTOVOLTAÏQUE — LOT PV-4 / 3 — Vue « Affaire PV » + enregistrement des PDF.
-- (project smubxqorirlfldatzmym)
--
-- AUCUNE NOUVELLE SOURCE DE VÉRITÉ. `get_pv_deal` n'écrit rien, ne calcule aucun
-- chiffre métier et n'invente aucune valeur : elle AGRÈGE ce que PV-1 à PV-3 ont
-- déjà posé, en une lecture, pour qu'un commercial n'ait pas à parcourir quatre
-- écrans pour lire un dossier.
--
-- SÉLECTION DÉTERMINISTE — le point le plus facile à rater. La règle est écrite
-- ici, en SQL, une fois :
--
--   étude retenue   = la VALIDATED de plus haut `version`   (aucune autre)
--   chiffrage retenu = le VERIFIED le plus récent DE CETTE étude (aucun autre)
--
-- Un `DRAFT` récent n'est JAMAIS retenu. Une étude `CALCULATED`, même seule et
-- même fraîche, n'est pas retenue : elle n'a pas été validée par un humain.
-- Conséquence assumée : un dossier peut n'avoir AUCUNE étude retenue tout en
-- ayant plusieurs études. C'est exact, et c'est ce que l'écran doit montrer.
--
-- Pourquoi PAS de colonne `is_retained` : elle ajouterait un état à maintenir,
-- donc à désynchroniser (une étude marquée retenue puis rejetée). La règle
-- ci-dessus se déduit des données existantes et ne peut pas mentir. Si un jour
-- un opérateur doit retenir une version ANTÉRIEURE contre la règle, alors la
-- colonne deviendra justifiée — pas avant.

begin;

-- ---------------------------------------------------------------------------
-- 1. LA VUE AFFAIRE — une lecture, tout le dossier.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_deal(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_p hermes_os.pv_prospects;
  v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies;
  v_latest hermes_os.pv_studies;
  v_econ hermes_os.pv_economics;
  v_cons jsonb; v_bill jsonb; v_assum jsonb; v_docs jsonb; v_studies jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- Site principal : le PLUS ANCIEN du prospect. Déterministe, et conforme au
  -- geste réel — le premier site saisi est celui de l'affaire.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;

  if v_site.id is not null then
    select coalesce(to_jsonb(c) - 'tenant_id', 'null'::jsonb) into v_cons
      from hermes_os.pv_consumption_profiles c
     where c.tenant_id = v_t and c.site_id = v_site.id
     order by c.created_at desc limit 1;

    -- Facture RETENUE = la plus récente VERIFIED. Une facture non vérifiée
    -- n'est pas une donnée retenue : elle ne peut pas fonder un chiffrage.
    select coalesce(to_jsonb(b) - 'tenant_id', 'null'::jsonb) into v_bill
      from hermes_os.pv_energy_bills b
     where b.tenant_id = v_t and b.site_id = v_site.id and b.status = 'VERIFIED'
     order by b.period_end desc nulls last, b.created_at desc limit 1;

    select * into v_study from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
     order by s.version desc limit 1;

    select * into v_latest from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id
     order by s.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'version', s.version, 'status', s.status,
             'prepared_by', s.prepared_by, 'target_power_kwc', s.target_power_kwc)
             order by s.version desc), '[]'::jsonb)
      into v_studies
      from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
             'original_filename', d.original_filename, 'mime_type', d.mime_type,
             'size_bytes', d.size_bytes, 'status', d.status,
             'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
             order by d.uploaded_at desc), '[]'::jsonb)
      into v_docs
      from hermes_os.pv_documents d
     where d.tenant_id = v_t and d.site_id = v_site.id and d.deleted_at is null;
  end if;

  if v_study.id is not null then
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;

    select coalesce(to_jsonb(a) - 'tenant_id', 'null'::jsonb) into v_assum
      from hermes_os.pv_study_assumptions a
     where a.tenant_id = v_t and a.study_id = v_study.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'prospect', to_jsonb(v_p) - 'tenant_id',
    'site', case when v_site.id is null then 'null'::jsonb else to_jsonb(v_site) - 'tenant_id' end,
    'consumption', coalesce(v_cons, 'null'::jsonb),
    'verified_bill', coalesce(v_bill, 'null'::jsonb),
    'retained_study', case when v_study.id is null then 'null'::jsonb else to_jsonb(v_study) - 'tenant_id' end,
    'latest_study', case when v_latest.id is null then 'null'::jsonb else to_jsonb(v_latest) - 'tenant_id' end,
    'retained_assumptions', coalesce(v_assum, 'null'::jsonb),
    'retained_economics', case when v_econ.id is null then 'null'::jsonb else to_jsonb(v_econ) - 'tenant_id' end,
    'studies', coalesce(v_studies, '[]'::jsonb),
    'documents', coalesce(v_docs, '[]'::jsonb));
end;
$function$;

revoke all on function public.get_pv_deal(uuid) from public;
grant execute on function public.get_pv_deal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ENREGISTRER UN DOCUMENT GÉNÉRÉ (synthèse PDF).
--
--    Distincte de `finalize_pv_document` (PV-2) pour une raison de fond : ce
--    document n'a pas été DÉPOSÉ, il a été PRODUIT. Il porte une étude, un
--    chiffrage, un stade, et une clé d'idempotence — quatre choses qu'un dépôt
--    n'a pas. Les mélanger dans une seule façade obligerait à rendre optionnels
--    des champs qui, ici, ne le sont pas.
--
--    IDEMPOTENCE : même `request_id` ⇒ le document EXISTANT est renvoyé, aucun
--    second fichier n'est créé. C'est le comportement attendu d'un double clic.
--
--    FINAL SOUS CONDITION, revérifiée EN BASE : l'étude doit être VALIDATED et
--    le chiffrage VERIFIED. L'interface le vérifie déjà ; la contourner ne doit
--    pas produire un document présenté comme définitif.
-- ---------------------------------------------------------------------------
create or replace function public.register_pv_study_summary(
  p_request_id   text,
  p_study_id     uuid,
  p_economics_id uuid,
  p_stage        text,
  p_path         text,
  p_bytes        bigint,
  p_sha256       text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_site uuid; v_id uuid; v_prefix text;
  v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics; v_existing uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  v_uid := (v_g->>'uid')::uuid;

  if p_request_id is null or length(btrim(p_request_id)) not between 8 and 200 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST_ID');
  end if;
  if p_stage not in ('STUDY_SUMMARY_DRAFT', 'STUDY_SUMMARY_FINAL') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STAGE');
  end if;

  -- Idempotence AVANT tout : une demande déjà servie ne refait rien.
  select d.id into v_existing from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
  end if;

  select * into v_study from hermes_os.pv_studies s
   where s.id = p_study_id and s.tenant_id = v_t;
  if v_study.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_site := v_study.site_id;

  if p_economics_id is not null then
    select * into v_econ from hermes_os.pv_economics e
     where e.id = p_economics_id and e.tenant_id = v_t and e.study_id = v_study.id;
    if v_econ.id is null then
      return jsonb_build_object('ok', false, 'code', 'ECONOMICS_NOT_FOUND');
    end if;
  end if;

  if p_stage = 'STUDY_SUMMARY_FINAL' then
    if v_study.status is distinct from 'VALIDATED' then
      return jsonb_build_object('ok', false, 'code', 'PDF_FINAL_NOT_READY',
        'reason', 'STUDY_NOT_VALIDATED');
    end if;
    if v_econ.id is null or v_econ.status is distinct from 'VERIFIED' then
      return jsonb_build_object('ok', false, 'code', 'PDF_FINAL_NOT_READY',
        'reason', 'ECONOMICS_NOT_VERIFIED');
    end if;
  end if;

  -- Même contrôle de périmètre que pour un dépôt : le chemin doit vivre sous
  -- <tenant>/<site>/. Un chemin forgé n'a aucun point d'entrée.
  v_prefix := v_t || '/' || v_site::text || '/';
  if p_path is null or left(p_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 26214400 then
    return jsonb_build_object('ok', false, 'code', 'BAD_SIZE');
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'BAD_HASH');
  end if;

  begin
    insert into hermes_os.pv_documents
      (tenant_id, site_id, study_id, economics_id, doc_type, document_stage,
       generation_request_id, storage_bucket, storage_path, mime_type, size_bytes,
       sha256, original_filename, status, uploaded_by)
    values
      (v_t, v_site, v_study.id, v_econ.id, 'NOTE_TECHNIQUE', p_stage,
       btrim(p_request_id), 'hermes-pv-documents', p_path, 'application/pdf', p_bytes,
       p_sha256,
       'synthese-etude-pv-v' || v_study.version::text ||
         case when p_stage = 'STUDY_SUMMARY_DRAFT' then '-brouillon' else '' end || '.pdf',
       'LINKED', v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      -- Course sur la même demande : on relit plutôt que d'échouer.
      select d.id into v_existing from hermes_os.pv_documents d
       where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
      end if;
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OBJECT');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_DOCUMENT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'GENERATED',
    'document_id', v_id, 'stage', p_stage, 'path', p_path);
end;
$function$;

revoke all on function public.register_pv_study_summary(text, uuid, uuid, text, text, bigint, text) from public;
grant execute on function public.register_pv_study_summary(text, uuid, uuid, text, text, bigint, text) to authenticated;

commit;
