-- Rollback for the observability snapshot reader.
-- The frontend revert (SystemStatus back to get_platform_health) lives in git
-- history. get_platform_health() itself is left in place (still valid). Once the
-- dashboard no longer calls the snapshot:
drop function if exists public.get_observability_snapshot(integer);
