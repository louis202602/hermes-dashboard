-- Rollback: hermes_action_audit_trail
-- Drops only the reader + pure helper. No tables touched.
drop function if exists public.get_action_audit_trail(integer);
drop function if exists public.sw_action_approval_outcome(text, text, boolean, boolean, boolean);
