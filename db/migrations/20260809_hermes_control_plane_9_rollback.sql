-- Rollback for the Hermès Conversational Control Plane migrations.
-- Removes the informational layer. The semantic + deterministic orchestration
-- (previous slices) remains.

-- Restore the pre-control-plane orchestrator body by re-applying
--   20260809_hermes_semantic_2_orchestrator_and_apply.sql
-- (its orchestrate_hermes_message definition), which drops the informational
-- branch and restores the previous behavior.

-- Then drop the informational helper:
drop function if exists hermes_os._hermes_informational(uuid,text,text);
