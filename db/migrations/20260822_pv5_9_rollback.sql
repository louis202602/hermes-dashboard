-- PACK PHOTOVOLTAÏQUE — LOT PV-5 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire exactement ce que les trois migrations PV-5 ont ajouté, et REMET la
-- machine à états du prospect et les contraintes de `pv_documents` dans leur
-- état PV-4.
--
-- ⚠️ DESTRUCTIF SUR LES DONNÉES COMMERCIALES : `pv_quotes` et `pv_quote_lines`
-- sont SUPPRIMÉES. Tout devis créé disparaît, y compris ses lignes, ses totaux
-- et son historique de versions. Les PDF déjà déposés dans le bucket RESTENT
-- (aucune suppression d'objet Storage n'est faite en SQL — c'est interdit), mais
-- leur ligne d'inventaire perd son rattachement au devis.
--
-- Contrôles préalables OBLIGATOIRES :
--   select count(*) from hermes_os.pv_quotes;                                   -- devis perdus
--   select count(*) from hermes_os.pv_quotes where status in ('SENT','ACCEPTED'); -- devis ENGAGEANTS perdus
--   select count(*) from hermes_os.pv_documents where document_stage like 'QUOTE%';
--   select count(*) from hermes_os.pv_prospects
--    where status in ('OFFER_PREPARED','OFFER_SENT','OFFER_ACCEPTED');           -- prospects à requalifier
--
-- ⚠️ Si des prospects sont dans un état `OFFER_*`, ce rollback ÉCHOUERA sur la
-- contrainte de statut — c'est VOULU. Les requalifier explicitement d'abord :
--   update hermes_os.pv_prospects set status = 'STUDY_DELIVERED'
--    where status in ('OFFER_PREPARED','OFFER_SENT','OFFER_ACCEPTED');
-- Écraser silencieusement l'état commercial de vrais prospects serait pire que
-- l'échec.

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades PV-5.
-- ---------------------------------------------------------------------------
drop function if exists public.create_pv_quote(uuid);
drop function if exists public.upsert_pv_quote_line(uuid,uuid,text,text,numeric,text,numeric,numeric,numeric,text,integer);
drop function if exists public.delete_pv_quote_line(uuid);
drop function if exists public.update_pv_quote(uuid, numeric, date, text, text);
drop function if exists public.set_pv_quote_ready(uuid);
drop function if exists public.send_pv_quote(uuid, date);
drop function if exists public.accept_pv_quote(uuid, date, text);
drop function if exists public.refuse_pv_quote(uuid, text);
drop function if exists public.cancel_pv_quote(uuid);
drop function if exists public.revise_pv_quote(uuid);
drop function if exists public.expire_pv_quotes();
drop function if exists public.get_pv_quote(uuid);
drop function if exists public.get_pv_quotes(uuid, integer);
drop function if exists public.register_pv_quote_pdf(text, uuid, text, text, bigint, text);

-- ---------------------------------------------------------------------------
-- 2. Rattachement documentaire — RETOUR aux contraintes PV-4.
--    On restaure AVANT de supprimer la colonne : l'ordre inverse laisserait un
--    instant où une contrainte référence une colonne disparue.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;

-- Un document de devis n'a plus de stade valide après ce rollback : on le
-- ramène à SOURCE plutôt que de laisser la contrainte échouer sur des lignes
-- existantes. Le fichier reste, son rattachement au devis est perdu — c'est dit
-- en tête de ce fichier.
update hermes_os.pv_documents
   set document_stage = 'SOURCE'
 where document_stage in ('QUOTE_DRAFT', 'QUOTE_FINAL');

alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
  document_stage in ('SOURCE', 'STUDY_SUMMARY_DRAFT', 'STUDY_SUMMARY_FINAL'));
alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
  document_stage = 'SOURCE' or study_id is not null);

alter table hermes_os.pv_documents drop constraint if exists pv_documents_quote_fk;
drop index if exists hermes_os.idx_pv_documents_tenant_quote;
alter table hermes_os.pv_documents drop column if exists quote_id;

-- ---------------------------------------------------------------------------
-- 3. Machine à états du prospect — RETOUR à l'état PV-4.
--    Le chemin direct `STUDY_DELIVERED -> WON` est REMIS : ce rollback restaure
--    le trou commercial que PV-5 avait fermé. C'est la conséquence, et elle est
--    dite plutôt que tue.
-- ---------------------------------------------------------------------------
delete from hermes_os.pv_prospect_transitions
 where from_status in ('OFFER_PREPARED', 'OFFER_SENT', 'OFFER_ACCEPTED')
    or to_status   in ('OFFER_PREPARED', 'OFFER_SENT', 'OFFER_ACCEPTED');

insert into hermes_os.pv_prospect_transitions (from_status, to_status)
values ('STUDY_DELIVERED', 'WON')
on conflict (from_status, to_status) do nothing;

alter table hermes_os.pv_prospects drop constraint if exists pv_prospects_status_check;
alter table hermes_os.pv_prospects add constraint pv_prospects_status_check check (
  status in ('NEW','CONTACTED','QUALIFYING','QUALIFIED','UNQUALIFIED',
             'STUDY_REQUESTED','STUDY_DELIVERED','WON','LOST','ON_HOLD','ARCHIVED'));

-- ---------------------------------------------------------------------------
-- 4. Déclencheurs, fonctions internes, puis tables.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_quotes_human_acceptance on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quotes_status_guard on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quotes_immutable on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quotes_tenant_immutable on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quotes_audit on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quote_discount_recompute on hermes_os.pv_quotes;
drop trigger if exists trg_pv_quote_lines_immutable on hermes_os.pv_quote_lines;
drop trigger if exists trg_pv_quote_lines_tenant_immutable on hermes_os.pv_quote_lines;
drop trigger if exists trg_pv_quote_lines_audit on hermes_os.pv_quote_lines;
drop trigger if exists trg_pv_quote_lines_recompute on hermes_os.pv_quote_lines;

drop table if exists hermes_os.pv_quote_lines;
drop table if exists hermes_os.pv_quotes;
drop table if exists hermes_os.pv_quote_transitions;
drop table if exists hermes_os.pv_quote_sequences;

drop function if exists hermes_os.pv_quote_blockers(uuid);
drop function if exists hermes_os.recompute_pv_quote_totals(uuid);
drop function if exists hermes_os.pv_quote_lines_recompute();
drop function if exists hermes_os.pv_quote_discount_recompute();
drop function if exists hermes_os.pv_quote_status_guard();
drop function if exists hermes_os.pv_quote_immutable_guard();
drop function if exists hermes_os.pv_quote_lines_immutable_guard();
drop function if exists hermes_os.pv_quote_audit();
drop function if exists hermes_os.pv_quote_line_audit();
drop function if exists hermes_os.next_pv_quote_number(text, integer);

commit;
