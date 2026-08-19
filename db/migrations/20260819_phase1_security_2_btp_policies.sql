-- 20260819_phase1_security_2_btp_policies.sql
-- PHASE 1 — SÉCURISATION DU SOCLE. Politiques SW15 explicites pour les capacités BTP.
-- Applied to project smubxqorirlfldatzmym. Idempotent (insert conditionnel + update ciblé).
--
-- Les trois seules capacités d'ÉCRITURE MÉTIER actuellement actives dans
-- `agent_action_catalog` (enabled = true) sont marquées `is_sensitive = true` :
--   * btp.qualification.create   — crée un chantier
--   * btp.planning.phase.add     — ajoute une phase de planning
--   * btp.suivi.progress.report  — enregistre un avancement (+ incident qualité)
--
-- Le lot 1 les protège déjà par défaut (fail-closed). Cette migration rend la
-- protection EXPLICITE et auditable plutôt qu'implicite : une ligne sw15_policies
-- ACTIVE par capacité, effet REQUIRE_APPROVAL, scopée au tenant `heliosolar`.
--
-- Pourquoi explicite ALORS QUE le défaut suffit :
--   * la décision devient lisible dans `sw15_policies` (revue de conformité) ;
--   * `agent_action_requests.policy_id` pointe vers une politique nommée, donc la
--     demande d'approbation SW15 est rattachée à une règle et non à un défaut ;
--   * changer la doctrine plus tard = modifier une ligne, pas la fonction.
--
-- AUCUNE ACTION N'EST RENDUE AUTONOME. Aucun effet PERMIT n'est créé ici.
-- Les 13 politiques préexistantes (1 SW18 + 12 photo) restent DISABLED : ce lot ne
-- les touche pas.
--
-- Scope tenant : `heliosolar` est le seul tenant de `hermes_os.tenants`. Le scope est
-- posé en dur volontairement — une politique globale (tenant_id NULL) ne serait de
-- toute façon pas sélectionnée par la gate (cf. limite documentée au lot 1).
--
-- Réversible : 20260819_phase1_security_9_rollback.sql

insert into hermes_os.sw15_policies
  (policy_name, tenant_id, action_pattern, effect, priority, status, updated_by)
select v.policy_name, 'heliosolar', v.action_pattern, 'REQUIRE_APPROVAL', 10, 'ACTIVE',
       'phase1_security_2'
from (values
  ('PHASE1 BTP qualification — approbation humaine', 'btp.qualification.create'),
  ('PHASE1 BTP planning — approbation humaine',      'btp.planning.phase.add'),
  ('PHASE1 BTP suivi — approbation humaine',         'btp.suivi.progress.report')
) as v(policy_name, action_pattern)
where not exists (
  select 1 from hermes_os.sw15_policies p
  where p.tenant_id = 'heliosolar'
    and p.action_pattern = v.action_pattern
    and p.updated_by = 'phase1_security_2'
);

-- Ré-exécution : si les lignes existent déjà, on garantit qu'elles sont bien ACTIVE
-- et REQUIRE_APPROVAL (et rien d'autre). Aucun autre enregistrement n'est touché.
update hermes_os.sw15_policies
   set effect     = 'REQUIRE_APPROVAL',
       status     = 'ACTIVE',
       priority   = 10,
       updated_at = now(),
       updated_by = 'phase1_security_2'
 where tenant_id = 'heliosolar'
   and updated_by = 'phase1_security_2'
   and action_pattern in ('btp.qualification.create',
                          'btp.planning.phase.add',
                          'btp.suivi.progress.report')
   and (effect is distinct from 'REQUIRE_APPROVAL' or status is distinct from 'ACTIVE');
