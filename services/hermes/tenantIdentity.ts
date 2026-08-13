import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ServiceResult,
  TenantIdentity,
  TenantResolutionStatus,
} from "@/types/hermes";

/**
 * Active tenant identity (company name + logo) for branding the Command Center.
 * The tenant is resolved ENTIRELY server-side by the SECURITY DEFINER facade
 * (`public.get_active_tenant_identity` → `resolve_active_tenant`); this never
 * sends or trusts a client-supplied tenant id. Reuses the same read pattern as
 * the other Hermès dashboard services (no second tenant-resolution logic).
 */
export async function getActiveTenantIdentity(): Promise<ServiceResult<TenantIdentity>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_active_tenant_identity");

    if (error) {
      logEvent("error", "tenant_identity.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }

    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (d.resolution_status ??
          "UNAUTHENTICATED") as TenantResolutionStatus,
        tenantId: (d.tenant_id as string) ?? null,
        name: (d.name as string) ?? null,
        displayName: (d.display_name as string) ?? null,
        logoUrl: (d.logo_url as string) ?? null,
      },
    };
  } catch (err) {
    logEvent("error", "tenant_identity.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Tenant identity service unavailable.",
    };
  }
}
