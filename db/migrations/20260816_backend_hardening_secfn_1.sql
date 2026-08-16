-- 20260816_backend_hardening_secfn_1.sql
-- Phase: PRODUCTION VALIDATION / BACKEND HARDENING (dashboard frozen).
-- Applied to project smubxqorirlfldatzmym. Idempotent.
--
-- Closes two Supabase security-advisor findings triaged during the backend audit:
--
-- B (MEDIUM) — anon_security_definer_function_executable:
--   hermes_os._resolver_operator_audit(text, uuid, text, jsonb) is a SECURITY DEFINER
--   write-only audit logger (INSERT into hermes_os.resolver_operator_audit). It was
--   EXECUTE-reachable by the anon role (via the default PUBLIC grant), so an anonymous
--   caller could forge or spam resolver-operator audit rows (audit-integrity risk; it
--   bypasses RLS as DEFINER). The function is only ever invoked BY the
--   resolver_operator_* SECURITY DEFINER functions, which run as the function owner
--   (postgres) and therefore retain EXECUTE regardless of this revoke — verified by a
--   rolled-back internal-call probe. Lock the direct grant to non-public callers.
--
-- C (LOW) — function_search_path_mutable:
--   public.sw_cost_limit_state(...) and public.sw_action_approval_outcome(...) are pure
--   IMMUTABLE sql helpers that reference NO schema objects (only built-in operators,
--   always resolved from pg_catalog). Pin an empty, non-mutable search_path to clear the
--   advisor with zero behavioural change.

revoke execute on function hermes_os._resolver_operator_audit(text, uuid, text, jsonb) from public;
revoke execute on function hermes_os._resolver_operator_audit(text, uuid, text, jsonb) from anon;
revoke execute on function hermes_os._resolver_operator_audit(text, uuid, text, jsonb) from authenticated;

alter function public.sw_cost_limit_state(numeric, numeric, numeric, boolean) set search_path = '';
alter function public.sw_action_approval_outcome(text, text, boolean, boolean, boolean) set search_path = '';
