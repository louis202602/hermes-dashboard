-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire ce que les cinq migrations PV-7 ont ajouté et REMET la vue Affaire de
-- PV-6 (`get_pv_deal` sans `material_readiness`) ainsi que les contraintes
-- documentaires de PV-6.
--
-- ⚠️ DESTRUCTIF SUR L'APPROVISIONNEMENT : `pv_material_catalog`, `pv_suppliers`,
-- `pv_supplier_prices`, `pv_material_requirements`, `pv_purchase_orders`,
-- `pv_purchase_order_lines` et `pv_purchase_receipts` sont SUPPRIMÉES. Tout
-- article, tout fournisseur, tout tarif daté, tout besoin, toute commande et
-- toute réception disparaissent — y compris l'historique des prix d'achat, qui
-- n'existe nulle part ailleurs.
--
-- ⚠️ Les documents fournisseurs déjà déposés RESTENT dans le bucket (aucune
-- suppression d'objet Storage en SQL — c'est interdit), mais perdent leur
-- rattachement à la commande.
--
-- ⚠️ IL ROUVRE LE TROU QUE PV-7 FERME : plus rien ne relie un devis accepté à ce
-- qu'il faut acheter, et la readiness matériel disparaît.
--
-- ⚠️ Ce rollback ne défait RIEN chez les fournisseurs : PV-7 n'a jamais envoyé
-- de commande réelle. Une commande passée dans la vraie vie reste passée.
--
-- Contrôles préalables OBLIGATOIRES :
--   select count(*) from hermes_os.pv_purchase_orders where status in ('ORDERED','PARTIALLY_RECEIVED','RECEIVED');
--   select count(*) from hermes_os.pv_purchase_receipts;
--   select count(*) from hermes_os.pv_supplier_prices;
--   select count(*) from hermes_os.pv_material_requirements;
--   select count(*) from hermes_os.pv_documents where document_stage = 'PURCHASE_ORDER';

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades PV-7.
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_pv_material(uuid,text,text,text,text,text,text,text,text,numeric,uuid,text);
drop function if exists public.set_pv_material_active(uuid, boolean);
drop function if exists public.get_pv_materials(boolean, text, integer);
drop function if exists public.upsert_pv_supplier(uuid,text,text,text,text,text,text,text,integer,text,numeric,boolean,text);
drop function if exists public.get_pv_suppliers(boolean);
drop function if exists public.upsert_pv_supplier_price(uuid,uuid,numeric,date,text,numeric,numeric,integer,text,text,text);
drop function if exists public.get_pv_supplier_prices(uuid);
drop function if exists public.add_pv_material_requirement(uuid,numeric,uuid,text,text,boolean,text);
drop function if exists public.derive_pv_material_requirements(uuid);
drop function if exists public.confirm_pv_material_requirement(uuid, uuid, numeric);
drop function if exists public.dismiss_pv_material_requirement(uuid, text);
drop function if exists public.get_pv_material_plan(uuid);
drop function if exists public.create_pv_purchase_order(uuid, uuid, date);
drop function if exists public.upsert_pv_purchase_order_line(uuid,uuid,text,numeric,text,numeric,numeric,uuid,text,date,uuid,integer);
drop function if exists public.delete_pv_purchase_order_line(uuid);
drop function if exists public.set_pv_purchase_order_ready(uuid);
drop function if exists public.mark_pv_purchase_order_ordered(uuid, date);
drop function if exists public.cancel_pv_purchase_order(uuid, text);
drop function if exists public.record_pv_purchase_receipt(uuid,numeric,date,text,text,text);
drop function if exists public.get_pv_purchase_order(uuid);

-- ---------------------------------------------------------------------------
-- 2. VUE AFFAIRE — RETOUR à la version PV-6 (sans `material_readiness`).
--    Restaurée AVANT la suppression de `pv_material_readiness()`, sans quoi
--    toute lecture d'affaire échouerait entre les deux instructions. Corps repris
--    À L'IDENTIQUE de `20260823_pv6_4_facades.sql` — pas réécrit de mémoire.
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
  v_gate text := 'NONE';
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

    v_gate := hermes_os.pv_survey_gate(v_t, v_site.id);
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
    'documents', coalesce(v_docs, '[]'::jsonb),
    'survey_gate', v_gate);
end;
$function$;

revoke all on function public.get_pv_deal(uuid) from public;
grant execute on function public.get_pv_deal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rattachement documentaire — RETOUR aux contraintes PV-6.
--    Les documents fournisseurs sont ramenés à `SOURCE` / `AUTRE` plutôt que de
--    laisser la contrainte échouer sur des lignes existantes. Le fichier reste,
--    son rattachement à la commande est perdu — c'est dit en tête de ce fichier.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_doc_type_check;

update hermes_os.pv_documents set document_stage = 'SOURCE' where document_stage = 'PURCHASE_ORDER';
update hermes_os.pv_documents set doc_type = 'AUTRE'
 where doc_type in ('DEVIS_FOURNISSEUR','BON_COMMANDE','ACCUSE_RECEPTION',
                    'BON_LIVRAISON','FICHE_TECHNIQUE','FACTURE_FOURNISSEUR');

alter table hermes_os.pv_documents add constraint pv_documents_doc_type_check check (
  doc_type in ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
               'NOTE_TECHNIQUE','ATTESTATION',
               'PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES','PHOTO_OBSTACLE','FICHE_VISITE',
               'AUTRE'));
alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
  document_stage in ('SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL',
                     'QUOTE_DRAFT','QUOTE_FINAL','SURVEY_REPORT'));
alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
  document_stage = 'SOURCE'
  or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
  or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null)
  or (document_stage = 'SURVEY_REPORT' and survey_id is not null));

alter table hermes_os.pv_documents drop constraint if exists pv_documents_purchase_order_fk;
drop index if exists hermes_os.idx_pv_documents_tenant_po;
alter table hermes_os.pv_documents drop column if exists purchase_order_id;

-- ---------------------------------------------------------------------------
-- 4. Déclencheurs, tables, fonctions internes.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_material_catalog_tenant_immutable on hermes_os.pv_material_catalog;
drop trigger if exists trg_pv_material_catalog_audit on hermes_os.pv_material_catalog;
drop trigger if exists trg_pv_suppliers_tenant_immutable on hermes_os.pv_suppliers;
drop trigger if exists trg_pv_suppliers_audit on hermes_os.pv_suppliers;
drop trigger if exists trg_pv_supplier_prices_tenant_immutable on hermes_os.pv_supplier_prices;
drop trigger if exists trg_pv_supplier_prices_audit on hermes_os.pv_supplier_prices;
drop trigger if exists trg_pv_material_req_tenant_immutable on hermes_os.pv_material_requirements;
drop trigger if exists trg_pv_material_req_audit on hermes_os.pv_material_requirements;
drop trigger if exists trg_pv_purchase_orders_status_guard on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_purchase_orders_human_ready on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_purchase_orders_human_ordered on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_purchase_orders_tenant_immutable on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_purchase_orders_immutable on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_purchase_orders_audit on hermes_os.pv_purchase_orders;
drop trigger if exists trg_pv_po_lines_tenant_immutable on hermes_os.pv_purchase_order_lines;
drop trigger if exists trg_pv_po_lines_immutable on hermes_os.pv_purchase_order_lines;
drop trigger if exists trg_pv_po_lines_totals on hermes_os.pv_purchase_order_lines;
drop trigger if exists trg_pv_po_lines_audit on hermes_os.pv_purchase_order_lines;
drop trigger if exists trg_pv_receipts_human on hermes_os.pv_purchase_receipts;
drop trigger if exists trg_pv_receipts_quantity on hermes_os.pv_purchase_receipts;
drop trigger if exists trg_pv_receipts_rollup on hermes_os.pv_purchase_receipts;
drop trigger if exists trg_pv_receipts_audit on hermes_os.pv_purchase_receipts;

drop table if exists hermes_os.pv_purchase_receipts;
drop table if exists hermes_os.pv_purchase_order_lines;
drop table if exists hermes_os.pv_purchase_orders;
drop table if exists hermes_os.pv_purchase_order_transitions;
drop table if exists hermes_os.pv_purchase_order_sequences;
drop table if exists hermes_os.pv_material_requirements;
drop table if exists hermes_os.pv_supplier_prices;
drop table if exists hermes_os.pv_material_catalog;
drop table if exists hermes_os.pv_suppliers;

drop function if exists hermes_os.pv_material_balance(text, uuid);
drop function if exists hermes_os.pv_material_readiness(text, uuid);
drop function if exists hermes_os.pv_material_costs(text, uuid);
drop function if exists hermes_os.pv_purchase_blockers(uuid);
drop function if exists hermes_os.pv_derive_requirements_from_quote(uuid);
drop function if exists hermes_os.pv_derive_requirements_from_survey(uuid);
drop function if exists hermes_os.recompute_pv_purchase_order_totals(uuid);
drop function if exists hermes_os.next_pv_purchase_order_number(text, integer);
drop function if exists hermes_os.pv_supplier_price_at(text, uuid, uuid, date);
drop function if exists hermes_os.pv_purchase_order_status_guard();
drop function if exists hermes_os.pv_purchase_order_immutable_guard();
drop function if exists hermes_os.pv_po_line_immutable_guard();
drop function if exists hermes_os.pv_po_line_totals_trigger();
drop function if exists hermes_os.pv_purchase_receipt_guard();
drop function if exists hermes_os.pv_receipt_quantity_guard();
drop function if exists hermes_os.pv_receipt_rollup();
drop function if exists hermes_os.pv_catalog_audit();
drop function if exists hermes_os.pv_supplier_audit();
drop function if exists hermes_os.pv_supplier_price_audit();
drop function if exists hermes_os.pv_material_requirement_audit();
drop function if exists hermes_os.pv_purchase_order_audit();
drop function if exists hermes_os.pv_po_line_audit();
drop function if exists hermes_os.pv_receipt_audit();

commit;
