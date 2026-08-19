-- 20260819_pv1_9_rollback.sql
-- Rollback COMPLET du lot PV-1. Idempotent.
--
-- ⚠️ DESTRUCTIF PAR NATURE : ce rollback supprime les tables du Pack PV et donc
-- les données métier photovoltaïques qu'elles contiennent. Il est prévu pour
-- annuler un lot qui n'a encore reçu AUCUNE donnée de production. Au-delà,
-- sauvegarder avant.
--
-- Ne touche à AUCUNE autre verticale : rien en photo_*, immo_*, peinture_*,
-- btp_*, sw*, ni au socle. Les protections des Phases 1 et 2 sont intactes.
--
-- Ordre : déclencheurs -> fonctions -> tables (enfants avant parents).

-- --- Déclencheurs -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pv_prospects','pv_sites','pv_consumption_profiles','pv_energy_bills',
                           'pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics']
  loop
    if to_regclass('hermes_os.'||t) is not null then
      execute format('drop trigger if exists trg_%1$s_tenant_immutable on hermes_os.%1$s;', t);
      execute format('drop trigger if exists trg_%1$s_updated_at on hermes_os.%1$s;', t);
    end if;
  end loop;
end $$;

drop trigger if exists trg_pv_prospects_status_guard       on hermes_os.pv_prospects;
drop trigger if exists trg_pv_bills_human_validation       on hermes_os.pv_energy_bills;
drop trigger if exists trg_pv_consumption_human_validation on hermes_os.pv_consumption_profiles;
drop trigger if exists trg_pv_studies_human_validation     on hermes_os.pv_studies;
drop trigger if exists trg_pv_economics_human_validation   on hermes_os.pv_economics;

-- --- Fonctions ----------------------------------------------------------------
drop function if exists hermes_os.pv_promote_bill_extraction(uuid);
drop function if exists hermes_os.pv_human_validation_guard();
drop function if exists hermes_os.pv_prospect_status_guard();
drop function if exists hermes_os.pv_tenant_immutable();
drop function if exists hermes_os._pv_audit(text, text, uuid, jsonb, jsonb, text);

-- --- Tables (enfants d'abord) --------------------------------------------------
drop table if exists hermes_os.pv_economics;
drop table if exists hermes_os.pv_study_assumptions;
drop table if exists hermes_os.pv_studies;
drop table if exists hermes_os.pv_energy_bill_extractions;
drop table if exists hermes_os.pv_energy_bills;
drop table if exists hermes_os.pv_consumption_profiles;
drop table if exists hermes_os.pv_sites;
drop table if exists hermes_os.pv_prospect_transitions;
drop table if exists hermes_os.pv_prospects;

-- Les lignes d'audit écrites dans `entity_audit_log` ne sont PAS supprimées :
-- c'est une brique partagée, et l'historique d'un lot annulé reste une trace
-- légitime. Pour les retirer explicitement :
--   delete from hermes_os.entity_audit_log where entity_type like 'pv\_%';
