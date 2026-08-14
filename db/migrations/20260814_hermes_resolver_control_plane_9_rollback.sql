-- Rollback: hermes_resolver_control_plane (project smubxqorirlfldatzmym)
-- Drops the operator control-plane RPCs, internal appliers, preflight, audit
-- helper + table. Leaves the E2.1/E2.2 runtime config, circuit breaker, reaper
-- primitive and claim exclusions untouched. No business data touched. The
-- resolver stays enabled=false, circuit CLOSED.
begin;

drop function if exists public.resolver_operator_reap(integer);
drop function if exists public.resolver_operator_reset_circuit();
drop function if exists public.resolver_operator_disable();
drop function if exists public.resolver_operator_enable();
drop function if exists public.resolver_operator_get_control();

drop function if exists hermes_os.resolver_apply_reap(text,integer,uuid);
drop function if exists hermes_os.resolver_apply_circuit_reset(text,uuid);
drop function if exists hermes_os.resolver_apply_set_enabled(text,boolean,uuid);
drop function if exists hermes_os.resolver_enable_preflight(text);
drop function if exists hermes_os._resolver_operator_audit(text,uuid,text,jsonb);

drop table if exists hermes_os.resolver_operator_audit;

alter table hermes_os.resolver_runtime_config
  drop column if exists protected_exclusions_expected;

commit;
