import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  DashboardProject,
  DashboardProjects,
  PublicKpis,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

/**
 * Platform-wide KPIs (component/agent/workflow activity). Non-tenant-scoped and
 * executable by any authenticated user. Real data from the component registry.
 */
export async function getPublicKpis(): Promise<ServiceResult<PublicKpis>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_dashboard_public_kpis");

    if (error) {
      logEvent("error", "kpis.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { ok: false, provenance: "UNAVAILABLE", error: "No KPI data returned." };
    }

    return {
      ok: true,
      provenance: "REAL",
      data: {
        agentsIaActive: toNumber(row.agents_ia_active),
        modulesSwActive: toNumber(row.modules_sw_active),
        subworkflowsActive: toNumber(row.subworkflows_active),
        componentsRegisteredTotal: toNumber(row.components_registered_total),
        componentsActiveTotal: toNumber(row.components_active_total),
        activeRate: toNumber(row.active_rate),
      },
    };
  } catch (err) {
    logEvent("error", "kpis.exception", { message: (err as Error).message });
    return { ok: false, provenance: "UNAVAILABLE", error: "KPI service unavailable." };
  }
}

function mapProject(raw: Record<string, unknown>): DashboardProject {
  return {
    id: String(raw.id ?? ""),
    chantierName: (raw.chantier_name as string) ?? null,
    clientName: (raw.client_name as string) ?? null,
    typeChantier: (raw.type_chantier as string) ?? null,
    status: (raw.status as string) ?? null,
    coutEstimeEur: toNullableNumber(raw.cout_estime_eur),
    coutReelEur: toNullableNumber(raw.cout_reel_eur),
    progressionPct: toNullableNumber(raw.progression_pct),
    dateDebutPlanifie: (raw.date_debut_planifie as string) ?? null,
    dateFinPlanifiee: (raw.date_fin_planifiee as string) ?? null,
  };
}

/**
 * Tenant-scoped projects for the CALLER's own active tenant. The tenant is resolved
 * server-side inside the RPC (`resolve_active_tenant(null)` from `auth.uid()`); we
 * deliberately expose NO tenant parameter so no client-reachable path can ever request
 * a foreign tenant (defense in depth on top of the RPC's own authorization).
 */
export async function getDashboardProjects(): Promise<ServiceResult<DashboardProjects>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_dashboard_projects", {
      p_requested_tenant_id: null,
    });

    if (error) {
      logEvent("error", "projects.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const resolutionStatus = (payload.resolution_status ??
      "UNAUTHENTICATED") as TenantResolutionStatus;
    const rawProjects = Array.isArray(payload.projects)
      ? (payload.projects as Record<string, unknown>[])
      : [];
    const aggregates = (payload.aggregates ?? {}) as Record<string, unknown>;

    logEvent("info", "projects.resolved", {
      status: resolutionStatus,
      count: rawProjects.length,
    });

    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus,
        tenantId: (payload.tenant_id as string) ?? null,
        projects: rawProjects.map(mapProject),
        aggregates: {
          totalProjects: toNumber(aggregates.total_projects),
          byStatus: (aggregates.by_status as Record<string, number>) ?? {},
          totalEstimatedValueEur: toNullableNumber(
            aggregates.total_estimated_value_eur,
          ),
        },
      },
    };
  } catch (err) {
    logEvent("error", "projects.exception", { message: (err as Error).message });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Projects service unavailable.",
    };
  }
}
