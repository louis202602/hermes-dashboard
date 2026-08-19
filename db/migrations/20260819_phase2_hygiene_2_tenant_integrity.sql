-- 20260819_phase2_hygiene_2_tenant_integrity.sql
-- PHASE 2 — HYGIÈNE DU SOCLE. Intégrité référentielle de `tenant_id` sur la
-- table du gateway. Idempotent. Non destructif.
--
-- PROBLÈME MESURÉ. `tenant_id` est un `text` sans clé étrangère dans tout le
-- schéma. Constat direct : `hermes_os.execution_logs` contient 30 lignes portant
-- 10 tenants qui n'existent PAS dans `hermes_os.tenants` (`tenant-iso-A` x11,
-- `tenant-hb-test` x5, `tenant-loop-test` x3, `tenant-monitoring-relapse` x3,
-- `tenant-execute-test` x2, `tenant-sw12-test-A` x2, `tenant-iso-B`,
-- `tenant-conflict-test`, `tenant-consent-test`, `tenant_test_resolved`) —
-- résidus de campagnes de test.
--
-- CE QUE CE LOT FAIT. Il pose la contrainte là où elle est sûre ET utile : sur
-- `agent_action_requests`, la table du gateway. Ses 11 lignes sont toutes sur
-- `heliosolar` (vérifié), et son SEUL écrivain est
-- `hermes_os.request_agent_action`, qui obtient le tenant via
-- `resolve_active_tenant` — jamais du client. La contrainte transforme donc un
-- invariant applicatif en invariant de schéma, sans rien casser.
--
-- CE QUE CE LOT NE FAIT PAS, ET POURQUOI.
--   * `execution_logs` n'est PAS contraint. Ses écrivains sont les modules SW
--     côté n8n, actuellement INSPECTABLES PAR PERSONNE (quota n8n Cloud bloqué).
--     Poser une FK sur une table écrite par du code non auditable, c'est risquer
--     de faire échouer un écrivain légitime en production — exactement ce que la
--     consigne « sans casser l'existant » interdit.
--   * Les 30 lignes de test ne sont PAS supprimées. Ce serait destructif, et
--     elles constituent la trace des campagnes d'isolation SW12/SW17. Leur sort
--     est une décision d'exploitation, pas un effet de bord de migration.
--
-- Réversible : 20260819_phase2_hygiene_9_rollback.sql

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'hermes_os.agent_action_requests'::regclass
       and conname = 'agent_action_requests_tenant_id_fkey'
  ) then
    alter table hermes_os.agent_action_requests
      add constraint agent_action_requests_tenant_id_fkey
      foreign key (tenant_id) references hermes_os.tenants(tenant_id)
      on update cascade on delete restrict;
  end if;
end $$;

comment on constraint agent_action_requests_tenant_id_fkey on hermes_os.agent_action_requests is
  'PHASE 2 — un tenant inexistant ne peut plus entrer dans la file du gateway. ON DELETE RESTRICT : supprimer un tenant qui a des requêtes est refusé plutôt que de les orpheliner silencieusement.';
