-- Rollback for the Hermès Semantic Intelligence migrations.
-- Removes the semantic apply path, the scoped claim overload and the resolve
-- capability. The deterministic NL orchestration (previous slice) remains.

-- apply
drop function if exists public.apply_hermes_resolution(uuid,text,text);
drop function if exists hermes_os.apply_hermes_resolution(uuid,text,text);

-- action-scoped claim overload (keeps the original claim_agent_action(integer))
drop function if exists hermes_os.claim_agent_action(text,integer);

-- resolve capability
delete from hermes_os.agent_action_catalog where action_key = 'hermes.intent.resolve';

-- Restore the pre-semantic orchestrator body by re-applying
--   20260809_hermes_nl_orchestration_2_functions.sql
-- (its orchestrate_hermes_message definition), which drops the RESOLVING branch.
