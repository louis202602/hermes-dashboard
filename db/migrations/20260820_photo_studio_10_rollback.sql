-- ---------------------------------------------------------------------------
-- HERMÈS STUDIO — ROLLBACK du LOT 10 (coûts téléphoniques → SW19 / SW23).
--
-- ⚠️ Annule 20260820_photo_studio_10_phone_costs.sql. Transactionnel.
--
-- NE SUPPRIME PAS, volontairement :
--   * les lignes déjà écrites dans `sw19_cost_events` — ce sont des faits
--     comptables, pas des objets de schéma. Les effacer réviserait l'histoire ;
--   * `sw23_budget_ledger` ni sa configuration — ils préexistent au lot 10 ;
--   * la colonne `photo_calls.request_id` — elle appartient au lot 7, qui a son
--     propre rollback.
-- ---------------------------------------------------------------------------

begin;

drop trigger if exists photo_call_cost_sync_trg on hermes_os.photo_calls;
drop function if exists hermes_os.photo_call_cost_sync();
drop function if exists hermes_os.photo_phone_settle_budget(text, text);
drop function if exists hermes_os.photo_phone_budget_gate(text, text, numeric);
drop function if exists hermes_os.record_photo_call_costs(text, text);
drop function if exists hermes_os.photo_call_request_id(text);

commit;
