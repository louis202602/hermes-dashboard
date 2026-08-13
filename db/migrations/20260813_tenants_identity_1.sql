-- Migration: tenants_identity (project smubxqorirlfldatzmym)
-- Canonical tenant identity registry + a read-only, tenant-safe facade so the
-- dashboard can show the ACTIVE tenant's company name + logo DYNAMICALLY
-- (multi-tenant; zero hardcoded client branding in the frontend).
--
-- Brand separation: Hermès OS is the PRODUCT brand (unchanged — sidebar/favicon
-- logo V3). This registry holds the CLIENT/tenant identity only.
-- Logo v1 = `logo_url` (external/hosted URL). Native logo upload is a later
-- Phase B / file-management concern and is NOT created here (no Storage touched).
--
-- Reuses the canonical tenant resolver (`hermes_os.resolve_active_tenant`) — no
-- second tenant-resolution logic, no client-supplied tenant_id.
-- Reversible: 20260813_tenants_identity_9_rollback.sql.

begin;

create table if not exists hermes_os.tenants (
  tenant_id    text primary key,
  name         text not null,
  display_name text,
  logo_url     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Defense in depth: no direct client access to the registry. Only the
-- SECURITY DEFINER facade (which runs as owner) reads it; hermes_os is not
-- PostgREST-exposed. RLS with no policy = deny-all for ordinary roles.
alter table hermes_os.tenants enable row level security;

-- Seed the current tenant (idempotent — never overwrites edited branding).
insert into hermes_os.tenants (tenant_id, name, display_name, logo_url)
values ('heliosolar', 'HelioSolar', 'HelioSolar', null)
on conflict (tenant_id) do nothing;

-- Read-only identity facade. Resolves the ACTIVE tenant SERVER-SIDE via
-- resolve_active_tenant (NEVER a client-supplied id) and returns its branding.
-- Falls back to the slug when no registry row exists, so a tenant without
-- configured branding never hard-fails.
create or replace function public.get_active_tenant_identity()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_tenant text;
  v_status text;
  v_row hermes_os.tenants%rowtype;
begin
  select r.tenant_id, r.resolution_status
    into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;

  if v_status is distinct from 'OK' then
    return jsonb_build_object(
      'resolution_status', v_status,
      'tenant_id', null, 'name', null, 'display_name', null, 'logo_url', null);
  end if;

  select * into v_row from hermes_os.tenants where tenant_id = v_tenant;
  if not found then
    return jsonb_build_object(
      'resolution_status', 'OK', 'tenant_id', v_tenant,
      'name', v_tenant, 'display_name', v_tenant, 'logo_url', null);
  end if;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_row.tenant_id,
    'name', v_row.name,
    'display_name', coalesce(v_row.display_name, v_row.name),
    'logo_url', v_row.logo_url);
end;
$function$;

revoke all on function public.get_active_tenant_identity() from public;
grant execute on function public.get_active_tenant_identity() to authenticated;

commit;
