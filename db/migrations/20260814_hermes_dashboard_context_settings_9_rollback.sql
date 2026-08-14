-- Rollback: DASH-1 dashboard context settings (project smubxqorirlfldatzmym)
-- Drops the read facade + the settings table. No business data touched.
begin;

drop function if exists public.get_dashboard_context_settings();
drop table if exists hermes_os.dashboard_context_settings;

commit;
