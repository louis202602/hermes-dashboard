-- LOT PV-8 / ROLLBACK — NON APPLIQUE EN PRODUCTION
--
-- DESTRUCTIF. Ce fichier supprime :
--   * toutes les PREUVES D'ACCEPTATION client enregistrees ;
--   * tous les ACOMPTES attendus et tous les PAIEMENTS constates ;
--   * la politique commerciale de chaque tenant.
-- Ces lignes ne sont pas regenerables : une preuve d'acceptation constate un
-- accord passe, un paiement constate un virement recu. Les detruire fait perdre
-- la trace de faits reels, pas seulement des donnees techniques.
--
-- EN REVANCHE, ET C'EST IMPORTANT : PV-8 n'a jamais encaisse d'argent, jamais
-- appele une banque, jamais signe quoi que ce soit chez un prestataire externe.
-- Aucun engagement exterieur n'est donc a defaire — a la difference de ce que
-- ferait un rollback apres integration Stripe ou Yousign.
--
-- ORDRE. `get_pv_deal` et `pv_purchase_blockers` sont restaures dans leur
-- version PV-7 AVANT que `pv_commercial_commitment`, `pv_quote_acceptance_proof`
-- et `pv_deposit_required` ne soient supprimees. L'ordre inverse laisserait
-- toute lecture d'affaire et toute commande fournisseur en echec.
--
-- CE QUI N'EST PAS TOUCHE : PV-1 a PV-7 (dont pv_survey_gate,
-- pv_material_readiness et les 20 facades PV-7), les objets de stockage
-- (aucun `delete from storage.*` ici) et le bucket hermes-pv-documents.

begin;

-- ---------------------------------------------------------------------------
-- 1. Retirer d'abord la garde qui bloque ACCEPTED
-- ---------------------------------------------------------------------------
-- Sans cela, un devis ne pourrait plus jamais passer ACCEPTED apres que la
-- fonction de preuve aura ete supprimee : le declencheur echouerait sur une
-- fonction absente.

drop trigger if exists trg_pv_quotes_z_acceptance_proof on hermes_os.pv_quotes;
drop function if exists hermes_os.pv_quote_acceptance_proof_guard();

-- ---------------------------------------------------------------------------
-- 2. Restaurer get_pv_deal dans sa version PV-7 (sans commercial_commitment)
-- ---------------------------------------------------------------------------

create or replace function public.get_pv_deal(p_prospect_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_p hermes_os.pv_prospects;
  v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies;
  v_latest hermes_os.pv_studies;
  v_econ hermes_os.pv_economics;
  v_cons jsonb; v_bill jsonb; v_assum jsonb; v_docs jsonb; v_studies jsonb;
  v_gate text := 'NONE'; v_material text := 'NOT_READY';
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

  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;

  if v_site.id is not null then
    select coalesce(to_jsonb(c) - 'tenant_id', 'null'::jsonb) into v_cons
      from hermes_os.pv_consumption_profiles c
     where c.tenant_id = v_t and c.site_id = v_site.id
     order by c.created_at desc limit 1;

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
    v_material := hermes_os.pv_material_readiness(v_t, v_site.id);
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
    'survey_gate', v_gate,
    'material_readiness', v_material);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Restaurer pv_purchase_blockers dans sa version PV-7
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_purchase_blockers(p_order_id uuid)
returns text[]
language plpgsql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  o hermes_os.pv_purchase_orders; v_out text[] := '{}'; v_lines int;
  v_gate text; v_accepted int; v_blocking int;
begin
  select * into o from hermes_os.pv_purchase_orders where id = p_order_id;
  if o.id is null then return array['ORDER_NOT_FOUND']; end if;

  select count(*) into v_lines from hermes_os.pv_purchase_order_lines where order_id = p_order_id;
  if v_lines = 0 then v_out := array_append(v_out, 'NO_LINE'); end if;
  if o.subtotal_ht_eur is null or o.subtotal_ht_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;

  if not exists (select 1 from hermes_os.pv_suppliers s
                  where s.id = o.supplier_id and s.tenant_id = o.tenant_id and s.is_active) then
    v_out := array_append(v_out, 'SUPPLIER_INACTIVE');
  end if;

  select count(*) into v_accepted from hermes_os.pv_quotes q
   where q.tenant_id = o.tenant_id and q.site_id = o.site_id and q.status = 'ACCEPTED';
  if v_accepted = 0 then v_out := array_append(v_out, 'QUOTE_NOT_ACCEPTED'); end if;

  v_gate := hermes_os.pv_survey_gate(o.tenant_id, o.site_id);
  if v_gate = 'BLOCKING' then
    v_out := array_append(v_out, 'SITE_SURVEY_BLOCKING');
  elsif v_gate <> 'OK' then
    v_out := array_append(v_out, 'SITE_SURVEY_NOT_VALIDATED');
  end if;

  select count(*) into v_blocking
    from hermes_os.pv_site_survey_findings f
    join hermes_os.pv_site_surveys v on v.id = f.survey_id and v.tenant_id = f.tenant_id
   where f.tenant_id = o.tenant_id and v.site_id = o.site_id
     and f.is_blocking and f.resolution is null
     and v.status <> 'CANCELLED';
  if v_blocking > 0 then v_out := array_append(v_out, 'SURVEY_FINDINGS_UNRESOLVED'); end if;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Facades PV-8
-- ---------------------------------------------------------------------------

drop function if exists public.get_pv_commitment(uuid);
drop function if exists public.cancel_pv_deposit(uuid, text);
drop function if exists public.waive_pv_deposit(uuid, text);
drop function if exists public.record_pv_deposit_payment(uuid, numeric, date, text, text, uuid, text);
drop function if exists public.create_pv_deposit(uuid, numeric, numeric, text, date, text);
drop function if exists public.accept_pv_quote(uuid, text, date, text, text, text, uuid, text);
drop function if exists public.get_pv_quote_acceptances(uuid);
drop function if exists public.supersede_pv_quote_acceptance(uuid, text);
drop function if exists public.record_pv_quote_acceptance(uuid, text, date, text, text, text, uuid, text);
drop function if exists public.set_pv_commercial_policy(boolean, numeric, text);
drop function if exists public.get_pv_commercial_policy();

-- ---------------------------------------------------------------------------
-- 5. Declencheurs, tables, fonctions internes
-- ---------------------------------------------------------------------------

drop trigger if exists trg_pv_deposit_payments_audit on hermes_os.pv_deposit_payments;
drop trigger if exists trg_pv_deposit_payments_rollup on hermes_os.pv_deposit_payments;
drop trigger if exists trg_pv_deposit_payments_guard on hermes_os.pv_deposit_payments;
drop trigger if exists trg_pv_deposit_payments_tenant_immutable on hermes_os.pv_deposit_payments;
drop trigger if exists trg_pv_deposits_audit on hermes_os.pv_deposits;
drop trigger if exists trg_pv_deposits_status_guard on hermes_os.pv_deposits;
drop trigger if exists trg_pv_deposits_human_waiver on hermes_os.pv_deposits;
drop trigger if exists trg_pv_deposits_tenant_immutable on hermes_os.pv_deposits;
drop trigger if exists trg_pv_acceptances_audit on hermes_os.pv_quote_acceptances;
drop trigger if exists trg_pv_acceptances_quote_state on hermes_os.pv_quote_acceptances;
drop trigger if exists trg_pv_acceptances_human on hermes_os.pv_quote_acceptances;
drop trigger if exists trg_pv_acceptances_immutable on hermes_os.pv_quote_acceptances;
drop trigger if exists trg_pv_acceptances_tenant_immutable on hermes_os.pv_quote_acceptances;

drop table if exists hermes_os.pv_deposit_payments cascade;
drop table if exists hermes_os.pv_deposits cascade;
drop table if exists hermes_os.pv_deposit_transitions cascade;
drop table if exists hermes_os.pv_quote_acceptances cascade;
drop table if exists hermes_os.pv_commercial_policies cascade;

drop function if exists hermes_os.pv_commercial_commitment(text, uuid);
drop function if exists hermes_os.pv_quote_acceptance_proof(text, uuid);
drop function if exists hermes_os.pv_deposit_required(text);
drop function if exists hermes_os.pv_deposit_rollup();
drop function if exists hermes_os.pv_deposit_status_guard();
drop function if exists hermes_os.pv_deposit_payment_guard();
drop function if exists hermes_os.pv_deposit_audit();
drop function if exists hermes_os.pv_deposit_payment_audit();
drop function if exists hermes_os.pv_acceptance_audit();
drop function if exists hermes_os.pv_acceptance_quote_state_guard();
drop function if exists hermes_os.pv_acceptance_immutable_guard();

-- ---------------------------------------------------------------------------
-- 6. Contraintes documentaires : retour a l'etat PV-7
-- ---------------------------------------------------------------------------
--
-- ATTENTION. Si des documents DEVIS_SIGNE / PREUVE_ACCEPTATION / PREUVE_ACOMPTE
-- ont ete televerses, ces ALTER echoueront tant que ces lignes existent. C'est
-- VOULU : plutot echouer bruyamment que supprimer en silence des justificatifs
-- reels. Les traiter explicitement (les reclasser en AUTRE, ou les supprimer par
-- la voie normale de PV-4) avant de rejouer cette section.

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents
  add constraint pv_documents_synthese_rattachee check (
    document_stage = 'SOURCE'
    or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
    or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null)
    or (document_stage = 'SURVEY_REPORT' and survey_id is not null)
    or (document_stage = 'PURCHASE_ORDER' and purchase_order_id is not null));

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_stage_valide;
alter table hermes_os.pv_documents
  add constraint pv_documents_stage_valide check (document_stage in (
    'SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL','QUOTE_DRAFT','QUOTE_FINAL',
    'SURVEY_REPORT','PURCHASE_ORDER'));

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_doc_type_check;
alter table hermes_os.pv_documents
  add constraint pv_documents_doc_type_check check (doc_type in (
    'FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
    'NOTE_TECHNIQUE','ATTESTATION','PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES',
    'PHOTO_OBSTACLE','FICHE_VISITE','DEVIS_FOURNISSEUR','BON_COMMANDE',
    'ACCUSE_RECEPTION','BON_LIVRAISON','FICHE_TECHNIQUE','FACTURE_FOURNISSEUR',
    'AUTRE'));

commit;
