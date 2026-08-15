-- Rollback: DASH-4A dashboard user preferences (project smubxqorirlfldatzmym)
-- Drops the two facades + the user-preferences table. No other data touched
-- (DASH-1/2/3, resolver, SW23, attachments, business data all untouched).
begin;

drop function if exists public.upsert_dashboard_user_preferences(jsonb, integer);
drop function if exists public.get_dashboard_user_preferences();
drop table if exists hermes_os.dashboard_user_preferences;

commit;
