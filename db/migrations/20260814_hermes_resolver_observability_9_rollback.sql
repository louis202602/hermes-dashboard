-- Rollback: hermes_resolver_observability (project smubxqorirlfldatzmym)
-- Drops the observability RPC, circuit breaker + reset, the reaper wrapper, and
-- the circuit-breaker columns. The E2.1 runtime config (kill-switch, bounds) and
-- the reused reap_dead_letter_agent_actions primitive are left untouched. No
-- business data touched.
begin;

drop function if exists public.get_resolver_observability();
drop function if exists hermes_os.resolver_circuit_evaluate(text);
drop function if exists hermes_os.resolver_circuit_reset(text);
drop function if exists hermes_os.reap_resolver_dead_letters(integer);

alter table hermes_os.resolver_runtime_config
  drop column if exists circuit_state,
  drop column if exists circuit_opened_at,
  drop column if exists circuit_reason,
  drop column if exists circuit_error_threshold,
  drop column if exists circuit_deadletter_threshold,
  drop column if exists circuit_window_minutes;

commit;
