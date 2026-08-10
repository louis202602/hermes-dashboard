-- Rollback for the dashboard panel readers (QuickActions / Tasks / SystemStatus).
-- The frontend revert (panels back to their illustrative markup and removal from
-- page.tsx / DashboardShell props) lives in git history. Once the dashboard no
-- longer calls them:
drop function if exists public.get_available_capabilities();
drop function if exists public.get_operational_priorities();
drop function if exists public.get_platform_health();
