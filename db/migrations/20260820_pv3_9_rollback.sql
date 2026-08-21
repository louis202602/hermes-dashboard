-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire EXACTEMENT ce que les trois migrations PV-3 ont ajouté. Après
-- exécution, l'état est celui du LOT PV-2 : les 23 façades PV-2, la table
-- `pv_documents`, le bucket, les capacités dormantes, PV-1 et les Phases 1 et 2
-- restent intacts.
--
-- ⚠️ PERTE DE TRAÇABILITÉ ASSUMÉE : `purged_at` / `purged_path` disparaissent.
-- Un document dont les octets ont RÉELLEMENT été purgés via l'API Storage
-- redeviendrait alors indiscernable d'un document jamais purgé — et son
-- `storage_path` a déjà été effacé, donc il ne repointerait vers rien.
-- À n'exécuter que sur un lot sans purge effectuée. Contrôle préalable :
--   select count(*) from hermes_os.pv_documents where purged_at is not null;
--
-- CE QUI N'EST PAS SUPPRIMÉ, VOLONTAIREMENT :
--   * `hermes_os._pv_audit`, `pv_tenant_immutable`, `pv_human_validation_guard`,
--     `pv_prospect_status_guard`, `pv_guard` — elles appartiennent à PV-1/PV-2 ;
--   * les lignes d'`entity_audit_log` — un journal ne se réécrit pas ;
--   * la correction du rollback photo (`20260818_photo_studio_9_rollback.sql`),
--     qui est un correctif de fichier, pas un objet de base.

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades — travail manuel (6) + purge (2). Signatures COMPLÈTES.
-- ---------------------------------------------------------------------------
drop function if exists public.verify_pv_consumption_profile(uuid, boolean, text);
drop function if exists public.upsert_pv_study(uuid, uuid, numeric, integer, numeric, text, text,
  text, text, text, integer, boolean, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, text, text, text, text);
drop function if exists public.upsert_pv_study_assumptions(uuid, numeric, numeric, integer, numeric,
  numeric, numeric, numeric, numeric, text, numeric);
drop function if exists public.set_pv_study_status(uuid, text);
drop function if exists public.upsert_pv_economics(uuid, uuid, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric);
drop function if exists public.set_pv_economics_status(uuid, text);

drop function if exists public.list_pv_documents_to_purge(interval, integer);
drop function if exists public.mark_pv_document_purged(uuid);
drop function if exists public.get_pv_pilot_snapshot(integer);

-- ---------------------------------------------------------------------------
-- 2. Traçabilité de purge. La contrainte tombe AVANT les colonnes qu'elle cite.
--    `storage_path` redevient NOT NULL : impossible s'il subsiste une ligne
--    purgée — c'est voulu, l'échec vaut mieux qu'un silence (cf. en-tête).
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents drop constraint if exists pv_documents_purge_coherente;
drop index if exists hermes_os.idx_pv_documents_tenant_a_purger;
alter table hermes_os.pv_documents drop column if exists purged_path;
alter table hermes_os.pv_documents drop column if exists purged_at;
alter table hermes_os.pv_documents alter column storage_path set not null;

-- ---------------------------------------------------------------------------
-- 3. Audit des créations / modifications — déclencheurs PUIS fonctions.
--    L'ordre inverse échouerait (« other objects depend on it »).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_studies_change_audit on hermes_os.pv_studies;
drop trigger if exists trg_pv_economics_change_audit on hermes_os.pv_economics;
drop trigger if exists trg_pv_consumption_change_audit on hermes_os.pv_consumption_profiles;
drop function if exists hermes_os.pv_change_audit();
drop function if exists hermes_os.pv_consumption_change_audit();

-- ---------------------------------------------------------------------------
-- 4. Machines à états étude / chiffrage.
--    ⚠️ Après ce rollback, `DRAFT -> VALIDATED` redevient possible en SQL direct :
--    seule la validation humaine (garde PV-1) reste opposable. C'est exactement
--    l'état de PV-2, ni pire ni meilleur.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_studies_status_guard on hermes_os.pv_studies;
drop trigger if exists trg_pv_economics_status_guard on hermes_os.pv_economics;
drop function if exists hermes_os.pv_status_guard();
drop table if exists hermes_os.pv_status_transitions;

commit;
