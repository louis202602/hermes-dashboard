-- 20260819_phase1_security_4_photo_rank_search_path.sql
-- PHASE 1 — SÉCURISATION DU SOCLE. Correctif MEDIUM M6 de l'audit READ-ONLY.
-- Applied to project smubxqorirlfldatzmym. Idempotent.
--
-- Advisor Supabase `function_search_path_mutable` :
--   `hermes_os.photo_session_status_rank(text)` était la seule fonction du schéma
--   dont le `search_path` restait modifiable par le rôle appelant.
--
-- La fonction est un simple `CASE` sur une chaîne (SQL IMMUTABLE, aucun objet de
-- schéma référencé), donc le risque pratique est faible ; mais elle est appelée
-- depuis des fonctions SECURITY DEFINER de la verticale Studio, où un `search_path`
-- mutable est un vecteur à ne pas laisser ouvert par principe.
--
-- On épingle le même `search_path` que le reste des fonctions du schéma. Zéro
-- changement de comportement : la fonction ne résout aucun nom d'objet.
--
-- Réversible : 20260819_phase1_security_9_rollback.sql

alter function hermes_os.photo_session_status_rank(text)
  set search_path = 'hermes_os', 'pg_catalog', 'pg_temp';
