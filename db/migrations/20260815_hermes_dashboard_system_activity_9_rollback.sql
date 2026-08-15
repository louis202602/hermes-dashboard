-- Rollback: DASH-3 system state + commercial facades (project smubxqorirlfldatzmym)
-- Drops only the two DASH-3 facades. get_platform_health is PRE-EXISTING (E2.2-era)
-- and is intentionally NOT dropped here. No business data touched.
begin;

drop function if exists public.get_agent_action_stats();
drop function if exists public.get_dashboard_commercial();

commit;
