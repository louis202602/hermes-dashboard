-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire EXACTEMENT ce que les cinq migrations PV-2 ont ajouté, et rien d'autre.
-- Après exécution, l'état est celui du LOT PV-1 : les 9 tables métier PV-1, leurs
-- fonctions et leurs déclencheurs restent intacts, ainsi que les Phases 1 et 2.
--
-- ⚠️ DESTRUCTIF PAR NATURE sur `pv_documents` et sur le bucket. Prévu pour un lot
-- sans données de production — ce qui est le cas aujourd'hui (0 ligne, bucket vide).
--
-- CE QUI N'EST PAS SUPPRIMÉ, VOLONTAIREMENT :
--   * `hermes_os.is_active_tenant_member(text)` — antérieure (chat attachments),
--     partagée avec le bucket photo. La supprimer casserait une autre verticale.
--   * `hermes_os._pv_audit`, `pv_tenant_immutable`, `set_updated_at`,
--     `pv_promote_bill_extraction` — elles appartiennent à PV-1.
--   * les lignes de `entity_audit_log` — un journal ne se réécrit pas.
--   * le BUCKET `hermes-pv-documents` lui-même. Ce n'est pas un oubli : MESURÉ
--     sur ce projet, Postgres REFUSE toute suppression directe dans les tables
--     `storage.*` —
--       ERROR 42501: Direct deletion from storage tables is not allowed.
--       Use the Storage API instead.  (trigger `storage.protect_delete()`)
--     Un `delete from storage.buckets` ferait donc ÉCHOUER tout le rollback, y
--     compris les parties qui, elles, fonctionnent. Le bucket se retire par
--     l'API Storage (dashboard ou CLI Supabase), après l'avoir vidé.
--     Conséquence assumée et dite franchement : après ce rollback, le bucket
--     SUBSISTE — mais il est PRIVÉ et n'a plus AUCUNE policy, donc plus aucun
--     accès depuis le navigateur. Il est inerte, pas dangereux.
--     ⚠️ Le rollback du lot photo (`20260818_photo_studio_9_rollback.sql`)
--     contient la même instruction `delete from storage.buckets` et échouerait
--     aujourd'hui pour cette raison. Constaté, non corrigé ici : hors périmètre
--     de PV-2 — signalé dans le rapport.

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades — lecture (11), écriture (9), stockage (3).
--    Signatures COMPLÈTES : `drop function` sans arguments serait ambigu.
-- ---------------------------------------------------------------------------
drop function if exists public.get_pv_prospects(text, text, text, integer);
drop function if exists public.get_pv_prospect(uuid);
drop function if exists public.get_pv_sites(uuid, integer);
drop function if exists public.get_pv_site(uuid);
drop function if exists public.get_pv_consumption_profiles(uuid, integer);
drop function if exists public.get_pv_energy_bills(uuid, integer);
drop function if exists public.get_pv_bill_extractions(uuid, integer);
drop function if exists public.get_pv_studies(uuid, integer);
drop function if exists public.get_pv_study_assumptions(uuid);
drop function if exists public.get_pv_economics(uuid, integer);
drop function if exists public.get_pv_documents(uuid, integer);

drop function if exists public.upsert_pv_prospect(uuid, text, text, text, text, text, text, text,
  text, text, boolean, integer, uuid, text, text);
drop function if exists public.set_pv_prospect_status(uuid, text);
drop function if exists public.upsert_pv_site(uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric,
  text, text, text, text);
drop function if exists public.upsert_pv_consumption_profile(uuid, uuid, text, numeric, numeric,
  numeric, numeric, text, text, date, date, text);
drop function if exists public.register_pv_energy_bill(uuid, uuid, text, date, date, date,
  numeric, numeric, numeric, numeric, text, text, uuid);
drop function if exists public.promote_pv_bill_extraction(uuid);
drop function if exists public.verify_pv_energy_bill(uuid, boolean, text);
drop function if exists public.validate_pv_study(uuid, boolean, text);
drop function if exists public.verify_pv_economics(uuid, boolean, text);

drop function if exists public.prepare_pv_document(uuid, text, text);
drop function if exists public.finalize_pv_document(uuid, uuid, text, text, text, bigint, text, text);
drop function if exists public.soft_delete_pv_document(uuid);

-- ---------------------------------------------------------------------------
-- 2. Registres dormants — capacités, runtime, politiques SW15.
--    Ciblage par clé EXACTE : aucune ligne d'une autre verticale n'est touchée.
-- ---------------------------------------------------------------------------
delete from hermes_os.sw15_policies
 where policy_name in ('PV lecture facture IA', 'PV preparation etude IA',
                       'PV chiffrage economique IA');

delete from hermes_os.resolver_runtime_config
 where action_key in ('pv.bill.extract', 'pv.study.prepare', 'pv.economics.compute');

-- Le catalogue est référencé par `agent_action_requests.action_key` (FK). Comme
-- ces trois actions n'ont jamais été exécutables (`enabled = false`), aucune
-- requête ne peut y pointer ; la garde reste explicite plutôt qu'implicite.
delete from hermes_os.agent_action_catalog c
 where c.action_key in ('pv.bill.extract', 'pv.study.prepare', 'pv.economics.compute')
   and not exists (
     select 1 from hermes_os.agent_action_requests r where r.action_key = c.action_key);

-- ---------------------------------------------------------------------------
-- 3. Stockage — POLICIES uniquement. Le bucket relève de l'API Storage.
-- ---------------------------------------------------------------------------
drop policy if exists "hermes_pv_documents_insert_tenant" on storage.objects;
drop policy if exists "hermes_pv_documents_select_tenant" on storage.objects;
drop policy if exists "hermes_pv_documents_update_tenant" on storage.objects;

-- Le bucket N'EST PAS supprimé ici — voir l'en-tête. Retrait via l'API Storage :
--   supabase storage rm --recursive ss:///hermes-pv-documents
--   (puis suppression du bucket depuis le dashboard)
-- Sans ses policies, il n'est plus accessible à aucun rôle applicatif.

-- ---------------------------------------------------------------------------
-- 4. Table documentaire — déclencheurs, puis fonction dédiée, puis table.
--    ORDRE OBLIGATOIRE : `drop function` avant `drop trigger` échouerait
--    (« other objects depend on it »). La table est retirée en dernier.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_documents_audit on hermes_os.pv_documents;
drop trigger if exists trg_pv_documents_tenant_immutable on hermes_os.pv_documents;
drop trigger if exists trg_pv_documents_updated_at on hermes_os.pv_documents;

drop function if exists hermes_os.pv_document_audit();

drop table if exists hermes_os.pv_documents;

-- ---------------------------------------------------------------------------
-- 5. Garde commune PV. En DERNIER : les 23 façades ci-dessus en dépendent.
-- ---------------------------------------------------------------------------
drop function if exists hermes_os.pv_guard();

commit;
