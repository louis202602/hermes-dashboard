-- Rollback: tenants_identity (project smubxqorirlfldatzmym)
-- Drops the identity facade and the tenant registry. Non-destructive to other
-- business data (only the new object is removed).
begin;
drop function if exists public.get_active_tenant_identity();
drop table if exists hermes_os.tenants;
commit;
