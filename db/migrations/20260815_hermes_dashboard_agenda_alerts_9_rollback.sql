-- Rollback: DASH-2 agenda + unified alerts (project smubxqorirlfldatzmym)
-- Drops the two read facades. No business data touched.
begin;

drop function if exists public.get_dashboard_agenda();
drop function if exists public.get_unified_alerts();

commit;
