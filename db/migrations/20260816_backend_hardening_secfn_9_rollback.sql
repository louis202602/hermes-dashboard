-- 20260816_backend_hardening_secfn_9_rollback.sql
-- Rollback of 20260816_backend_hardening_secfn_1.sql. Idempotent.
--
-- Restores the prior default PUBLIC EXECUTE grant on the resolver audit logger and
-- removes the pinned search_path from the two helper functions (reverts to the
-- role-mutable default). Note: restoring PUBLIC re-opens the advisor finding B — only
-- run this to revert the hardening.

grant execute on function hermes_os._resolver_operator_audit(text, uuid, text, jsonb) to public;

alter function public.sw_cost_limit_state(numeric, numeric, numeric, boolean) reset search_path;
alter function public.sw_action_approval_outcome(text, text, boolean, boolean, boolean) reset search_path;
