-- 20260819_phase1_security_3_context_settings_rls.sql
-- PHASE 1 — SÉCURISATION DU SOCLE. Correctif HIGH H3 de l'audit READ-ONLY.
-- Applied to project smubxqorirlfldatzmym. Idempotent.
--
-- `hermes_os.dashboard_context_settings` était la SEULE table de `hermes_os`
-- (1 sur 178) avec `relrowsecurity = false`. Elle n'est aujourd'hui pas exploitable :
-- aucun GRANT SELECT n'est accordé à `anon` ni `authenticated`, et la lecture passe
-- par la façade `public.get_dashboard_context_settings()` (SECURITY DEFINER, qui
-- résout le tenant côté serveur via `resolve_active_tenant`).
--
-- La brèche est donc de DÉFENSE EN PROFONDEUR : le jour où un GRANT est ajouté par
-- erreur, la table devient lisible par tous les tenants. On aligne cette table sur le
-- modèle des 177 autres : RLS activée, AUCUNE politique => deny-all pour tout rôle
-- non privilégié ; le propriétaire (postgres) et les fonctions SECURITY DEFINER
-- continuent d'y accéder normalement.
--
-- COMPORTEMENT APPLICATIF INCHANGÉ : la façade est SECURITY DEFINER et s'exécute avec
-- les droits de son propriétaire, qui n'est pas soumis à la RLS de cette table
-- (`relforcerowsecurity` reste false — volontairement, comme pour les autres tables
-- lues par façade).
--
-- On réaffirme aussi l'absence de grant direct (no-op si déjà absent) : c'est le
-- second pilier de l'invariant « aucun accès direct à une table métier ».
--
-- Réversible : 20260819_phase1_security_9_rollback.sql

alter table hermes_os.dashboard_context_settings enable row level security;

revoke all on table hermes_os.dashboard_context_settings from anon;
revoke all on table hermes_os.dashboard_context_settings from authenticated;
