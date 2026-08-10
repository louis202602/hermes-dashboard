-- Rollback for the dashboard "Conversations récentes" reader.
-- The frontend revert (RecentConversations back to its illustrative markup and
-- removal from page.tsx / DashboardShell props) lives in git history. Once the
-- dashboard no longer calls it:
drop function if exists public.get_recent_hermes_conversations(integer);
