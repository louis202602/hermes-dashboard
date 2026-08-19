-- ---------------------------------------------------------------------------
-- HERMÈS STUDIO — ROLLBACK du LOT 8 (commerce, portail, fidélisation).
--
-- ⚠️ Annule 20260820_photo_studio_8_commerce.sql. À n'exécuter que si ce lot a
-- été appliqué. Transactionnel : tout ou rien.
--
-- ORDRE : dépendances d'abord (trigger → fonctions → tables filles → tables
-- mères), sinon un DROP échoue et annule tout le reste.
--
-- ⚠️ POINT D'ATTENTION — les trois colonnes ajoutées à
-- `photo_upsell_opportunities` sont retirées ici. Cette table PRÉEXISTE au lot 8
-- et contient potentiellement des données : le rollback supprime donc les
-- valeurs de `offering_id`, `moment` et `proposed_at`, pas la table. Les
-- opportunités elles-mêmes sont conservées.
-- ---------------------------------------------------------------------------

begin;

drop trigger if exists photo_quote_guard_trg on hermes_os.photo_quotes;
drop function if exists hermes_os.photo_quote_guard();
drop function if exists hermes_os.photo_booking_blockers(text, uuid);

-- Tables filles avant les mères.
drop table if exists hermes_os.photo_quote_lines;
drop table if exists hermes_os.photo_contracts;
drop table if exists hermes_os.photo_payments;
drop table if exists hermes_os.photo_portal_access;
drop table if exists hermes_os.photo_upsell_rules;
drop table if exists hermes_os.photo_referrals;
drop table if exists hermes_os.photo_referral_config;
drop table if exists hermes_os.photo_lifecycle_rules;
drop table if exists hermes_os.photo_followup_config;
drop table if exists hermes_os.photo_quotes;

-- Extension d'une table PRÉEXISTANTE : on retire les colonnes ajoutées, jamais
-- la table.
alter table hermes_os.photo_upsell_opportunities drop column if exists offering_id;
alter table hermes_os.photo_upsell_opportunities drop column if exists moment;
alter table hermes_os.photo_upsell_opportunities drop column if exists proposed_at;

commit;
