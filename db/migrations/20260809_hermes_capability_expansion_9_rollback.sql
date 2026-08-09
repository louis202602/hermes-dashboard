-- Rollback for the Hermès Capability Expansion (first lot).
-- Restores the previous informational layer (without consultation) and unlinks
-- the diag.echo runner.

-- Restore the previous _hermes_informational by re-applying
--   20260809_hermes_control_plane_1_informational.sql
-- (that version has no chantiers/KPIs consultation branch).

-- Unlink diag.echo from its runner (reverts it to a registered-but-unrun action):
update hermes_os.agent_action_catalog set target_workflow_id = null, updated_at = now()
 where action_key = 'diag.echo';

-- The n8n "GW Consumer — Diag Echo" (6687hzOPQ27an2J6) can be archived separately;
-- it is inactive and performs no business effect.
