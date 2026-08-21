-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire ce que les quatre migrations PV-6 ont ajouté et REMET la porte de devis
-- de PV-5 (`pv_quote_blockers` sans la preuve terrain) ainsi que les contraintes
-- documentaires de PV-5.
--
-- ⚠️ DESTRUCTIF SUR LES PREUVES TERRAIN : `pv_site_surveys` et
-- `pv_site_survey_findings` sont SUPPRIMÉES. Toute visite, tout relevé, tout
-- écart et toute résolution disparaissent. Les photos et rapports déjà déposés
-- RESTENT dans le bucket (aucune suppression d'objet Storage en SQL — c'est
-- interdit), mais perdent leur rattachement à la visite.
--
-- ⚠️ IL ROUVRE LE TROU QUE PV-6 FERME : un devis pourra de nouveau être émis sur
-- des données de toiture jamais confrontées au terrain.
--
-- ⚠️ Les mesures DÉJÀ APPLIQUÉES à `pv_sites` par un geste humain ne sont PAS
-- annulées : elles sont devenues la donnée déclarée du site, et les défaire
-- reviendrait à réécrire une décision humaine. Les entrées d'audit
-- correspondantes restent dans `entity_audit_log`.
--
-- Contrôles préalables OBLIGATOIRES :
--   select count(*) from hermes_os.pv_site_surveys;                                  -- visites perdues
--   select count(*) from hermes_os.pv_site_surveys where status = 'VALIDATED';        -- PREUVES perdues
--   select count(*) from hermes_os.pv_site_survey_findings where resolution is not null; -- analyses perdues
--   select count(*) from hermes_os.pv_documents where document_stage = 'SURVEY_REPORT'
--                                                  or doc_type in ('PHOTO_TOITURE','PHOTO_TABLEAU',
--                                                                  'PHOTO_ACCES','PHOTO_OBSTACLE','FICHE_VISITE');

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades PV-6.
-- ---------------------------------------------------------------------------
drop function if exists public.plan_pv_site_survey(uuid, date, uuid);
drop function if exists public.upsert_pv_survey_roof(uuid,numeric,numeric,numeric,numeric,text,text,text,text,numeric,numeric,numeric,numeric,text,boolean,text);
drop function if exists public.upsert_pv_survey_electrical(uuid,text,text,text,text,numeric,text,text,integer,numeric,text,text);
drop function if exists public.upsert_pv_survey_context(uuid,text,text,text,text,text,text,text);
drop function if exists public.set_pv_survey_status(uuid, text);
drop function if exists public.validate_pv_site_survey(uuid);
drop function if exists public.resolve_pv_survey_finding(uuid, text, text);
drop function if exists public.apply_pv_survey_measurement(uuid, text);
drop function if exists public.get_pv_site_survey(uuid);
drop function if exists public.get_pv_site_surveys(uuid, integer);
drop function if exists public.register_pv_survey_report(text, uuid, text, bigint, text);

-- ---------------------------------------------------------------------------
-- 2. Porte de devis — RETOUR à la version PV-5 (sans preuve terrain).
--    On la restaure AVANT de supprimer `pv_survey_gate()` : l'ordre inverse
--    laisserait un instant où `pv_quote_blockers` appelle une fonction absente,
--    et tout passage de devis en READY échouerait.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_quote_blockers(p_quote_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_q hermes_os.pv_quotes; v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_out text[] := '{}'; v_lines int;
begin
  select * into v_q from hermes_os.pv_quotes where id = p_quote_id;
  if v_q.id is null then return array['QUOTE_NOT_FOUND']; end if;

  select * into v_study from hermes_os.pv_studies where id = v_q.study_id;
  select * into v_econ  from hermes_os.pv_economics where id = v_q.economics_id;
  select * into v_p     from hermes_os.pv_prospects where id = v_q.prospect_id;
  select * into v_site  from hermes_os.pv_sites where id = v_q.site_id;
  select count(*) into v_lines from hermes_os.pv_quote_lines where quote_id = p_quote_id;

  if v_study.id is null or v_study.status is distinct from 'VALIDATED' then
    v_out := array_append(v_out, 'STUDY_NOT_VALIDATED');
  end if;
  if v_econ.id is null or v_econ.status is distinct from 'VERIFIED' then
    v_out := array_append(v_out, 'ECONOMICS_NOT_VERIFIED');
  end if;
  if v_lines = 0 then
    v_out := array_append(v_out, 'NO_LINE');
  end if;
  if v_q.total_ttc_eur is null or v_q.total_ttc_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;
  if v_p.id is null
     or (coalesce(btrim(v_p.company_name), '') = ''
         and coalesce(btrim(v_p.last_name), '') = '') then
    v_out := array_append(v_out, 'CLIENT_IDENTITY_MISSING');
  end if;
  if v_site.id is null or coalesce(btrim(v_site.address_line1), '') = '' then
    v_out := array_append(v_out, 'SITE_MISSING');
  end if;
  if v_q.valid_until is null then
    v_out := array_append(v_out, 'VALIDITY_DATE_MISSING');
  end if;
  if v_p.opted_out then
    v_out := array_append(v_out, 'PROSPECT_OPTED_OUT');
  end if;

  return v_out;
end;
$function$;

revoke all on function hermes_os.pv_quote_blockers(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2 bis. VUE AFFAIRE — RETOUR à la version PV-4 (sans `survey_gate`).
--        Même raison d'ordre que ci-dessus : restaurée AVANT la suppression de
--        `pv_survey_gate()`, sans quoi toute lecture d'affaire échouerait entre
--        les deux instructions. Corps repris À L'IDENTIQUE de
--        `20260821_pv4_3_deal_and_generation.sql` — pas réécrit de mémoire.
--        ⚠️ Les écrans PV-6 lisant `survey_gate` retomberont sur « aucune
--        visite » : c'est cohérent, puisque les visites n'existeront plus.
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
-- 3. Rattachement documentaire — RETOUR aux contraintes PV-5.
--    Les documents de visite sont ramenés à `SOURCE` / `AUTRE` plutôt que de
--    laisser la contrainte échouer sur des lignes existantes. Le fichier reste,
--    son rattachement à la visite est perdu — c'est dit en tête de ce fichier.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_doc_type_check;

update hermes_os.pv_documents set document_stage = 'SOURCE' where document_stage = 'SURVEY_REPORT';
update hermes_os.pv_documents set doc_type = 'PHOTO_SITE'
 where doc_type in ('PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES','PHOTO_OBSTACLE');
update hermes_os.pv_documents set doc_type = 'NOTE_TECHNIQUE' where doc_type = 'FICHE_VISITE';

alter table hermes_os.pv_documents add constraint pv_documents_doc_type_check check (
  doc_type in ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
               'NOTE_TECHNIQUE','ATTESTATION','AUTRE'));
alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
  document_stage in ('SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL','QUOTE_DRAFT','QUOTE_FINAL'));
alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
  document_stage = 'SOURCE'
  or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
  or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null));

alter table hermes_os.pv_documents drop constraint if exists pv_documents_survey_fk;
drop index if exists hermes_os.idx_pv_documents_tenant_survey;
alter table hermes_os.pv_documents drop column if exists survey_id;

-- ---------------------------------------------------------------------------
-- 4. Déclencheurs, tables, fonctions internes.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_site_surveys_status_guard on hermes_os.pv_site_surveys;
drop trigger if exists trg_pv_site_surveys_human_validation on hermes_os.pv_site_surveys;
drop trigger if exists trg_pv_site_surveys_tenant_immutable on hermes_os.pv_site_surveys;
drop trigger if exists trg_pv_site_surveys_immutable on hermes_os.pv_site_surveys;
drop trigger if exists trg_pv_site_surveys_audit on hermes_os.pv_site_surveys;
drop trigger if exists trg_pv_findings_tenant_immutable on hermes_os.pv_site_survey_findings;
drop trigger if exists trg_pv_findings_audit on hermes_os.pv_site_survey_findings;

drop table if exists hermes_os.pv_site_survey_findings;
drop table if exists hermes_os.pv_site_surveys;
drop table if exists hermes_os.pv_survey_transitions;
drop table if exists hermes_os.pv_survey_thresholds;

drop function if exists hermes_os.compute_pv_survey_findings(uuid);
drop function if exists hermes_os.pv_survey_gate(text, uuid);
drop function if exists hermes_os.pv_survey_threshold(text, text);
drop function if exists hermes_os.pv_survey_status_guard();
drop function if exists hermes_os.pv_survey_immutable_guard();
drop function if exists hermes_os.pv_survey_audit();
drop function if exists hermes_os.pv_survey_finding_audit();
drop function if exists hermes_os.pv_angle_delta(numeric, numeric);
drop function if exists hermes_os.pv_shading_rank(text);

commit;
