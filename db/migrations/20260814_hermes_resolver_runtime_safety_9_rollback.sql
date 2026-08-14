-- Rollback: hermes_resolver_runtime_safety (project smubxqorirlfldatzmym)
-- Drops the dormant runtime-config registry + batch-claim wrapper. The SW23
-- budget row for heliosolar is left in place by default (removing a hard-stop
-- budget makes the tenant LESS safe); uncomment the delete only if you truly
-- intend to revert to an unbounded budget.
begin;

drop function if exists hermes_os.claim_semantic_resolver_batch(text, integer);
drop table if exists hermes_os.resolver_runtime_config;

-- delete from hermes_os.sw23_tenant_budget_config where tenant_id = 'heliosolar';

commit;
