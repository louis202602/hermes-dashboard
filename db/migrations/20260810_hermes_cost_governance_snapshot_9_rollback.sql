-- Rollback: hermes_cost_governance_snapshot
-- Drops only the reader + pure helper added by the paired migration. The SW23
-- write engine and all SW23/SW9 tables are untouched.
drop function if exists public.get_cost_governance_snapshot(integer);
drop function if exists public.sw_cost_limit_state(numeric, numeric, numeric, boolean);
