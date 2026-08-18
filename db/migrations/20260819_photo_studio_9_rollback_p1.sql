-- PHOTO-P1 / ROLLBACK — annule intégralement les lots 6 et 7.
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉ (les lots 6 et 7 ne le sont pas non plus).
--
-- Ordre inverse des dépendances. Après exécution, la base retrouve exactement
-- l'état post-P0 : les 14 tables photo du lot 1, les 25 fonctions des lots 2-4,
-- et les registres dormants du lot 5 — tous INTACTS.
--
-- NE SUPPRIME PAS, volontairement :
--   * `hermes_os.agent10_call_index` et tout l'Agent 10 — ils PRÉEXISTENT au
--     P1 ; le lot 7 les a seulement RÉUTILISÉS ;
--   * les tables `agent2_*`, `agent9_audit_log`, `peinture_prospects` —
--     briques partagées d'autres verticales ;
--   * quoi que ce soit du P0 (tables, façades, bucket, registres).

begin;

-- --- Lot 7 : standard téléphonique ----------------------------------------
drop function if exists hermes_os.photo_phone_is_open(text, timestamptz);
drop function if exists hermes_os.photo_phone_quotable_offerings(text);
drop table if exists hermes_os.photo_calls;
drop table if exists hermes_os.photo_phone_config;

-- --- Lot 6 : acquisition ---------------------------------------------------
drop function if exists hermes_os.compute_photo_funnel(text, date, date);
drop function if exists hermes_os.photo_followups_due(text, integer);
drop function if exists hermes_os.derive_photo_lead_score(uuid, text);
drop function if exists hermes_os.photo_lead_stage_rank(text);

drop table if exists hermes_os.photo_lead_events;
drop table if exists hermes_os.photo_leads;
drop table if exists hermes_os.photo_campaigns;
drop table if exists hermes_os.photo_service_offerings;

commit;
