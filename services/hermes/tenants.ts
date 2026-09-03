import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DashboardTenant = {
  tenantId: string;
  name: string;
  displayName: string;
  vertical: string | null;
  active: boolean;
};

export type DashboardTenantList = {
  activeTenantId: string | null;
  tenants: DashboardTenant[];
};

export async function getDashboardTenants(): Promise<DashboardTenantList> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_list_my_tenants");

  if (error) return { activeTenantId: null, tenants: [] };

  const payload = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(payload.tenants)
    ? (payload.tenants as Record<string, unknown>[])
    : [];

  const tenants = rows.map((row) => ({
    tenantId: String(row.tenant_id ?? ""),
    name: String(row.name ?? row.tenant_id ?? ""),
    displayName: String(row.display_name ?? row.name ?? row.tenant_id ?? ""),
    vertical: typeof row.vertical === "string" ? row.vertical : null,
    active: row.active === true,
  }));

  const activeTenantId =
    typeof payload.active_tenant_id === "string"
      ? payload.active_tenant_id
      : tenants.length === 1
        ? tenants[0]?.tenantId ?? null
        : null;

  return { activeTenantId, tenants };
}
