-- 20260819_phase2_hygiene_9_rollback.sql
-- Rollback des lots PHASE 2 (1 et 2). Idempotent. Non destructif.
--
-- Ce rollback ne réintroduit AUCUN défaut de sécurité : les deux lots de la
-- Phase 2 sont de l'hygiène, pas des garde-fous. Les protections de la Phase 1
-- (passerelle SW15 fail-closed) ne sont ni touchées ni annulées ici.

-- --- Lot 2 : contrainte d'intégrité tenant -----------------------------------
alter table hermes_os.agent_action_requests
  drop constraint if exists agent_action_requests_tenant_id_fkey;

-- --- Lot 1 : mécanisme d'expiration ------------------------------------------
-- NOTE : si la fonction a été EXÉCUTÉE, supprimer la fonction ne restaure pas
-- les requêtes expirées. Pour les remettre en file (elles n'ont rien perdu) :
--   update hermes_os.agent_action_requests
--      set status = 'QUEUED', error = null, finished_at = null, updated_at = now()
--    where status = 'FAILED' and error->>'code' = 'STALE_NO_CONSUMER';
drop function if exists hermes_os.expire_stale_queued_agent_actions(interval, text, integer);
