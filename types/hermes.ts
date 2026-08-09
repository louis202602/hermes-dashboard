/**
 * Shared contracts for data consumed from the Hermès backend (`hermes_os` via
 * the public SECURITY DEFINER RPCs). These mirror existing backend contracts —
 * the frontend does not define its own business schema.
 */

/** Provenance of a piece of displayed data. Never present MOCK/DERIVED as REAL. */
export type DataProvenance = "REAL" | "MOCK" | "DERIVED" | "UNAVAILABLE";

/** Result wrapper for a backend read. */
export type ServiceResult<T> =
  | { ok: true; provenance: "REAL"; data: T }
  | { ok: false; provenance: "UNAVAILABLE"; error: string };

/** Platform-wide KPIs from `public.get_dashboard_public_kpis()`. */
export type PublicKpis = {
  agentsIaActive: number;
  modulesSwActive: number;
  subworkflowsActive: number;
  componentsRegisteredTotal: number;
  componentsActiveTotal: number;
  activeRate: number;
};

/** A tenant-scoped project (chantier) from `public.get_dashboard_projects()`. */
export type DashboardProject = {
  id: string;
  chantierName: string | null;
  clientName: string | null;
  typeChantier: string | null;
  status: string | null;
  coutEstimeEur: number | null;
  coutReelEur: number | null;
  progressionPct: number | null;
  dateDebutPlanifie: string | null;
  dateFinPlanifiee: string | null;
};

/**
 * Tenant resolution outcomes from `hermes_os.resolve_active_tenant`, surfaced by
 * `get_dashboard_projects`. Anything other than `OK` means no data is returned.
 */
export type TenantResolutionStatus =
  | "OK"
  | "UNAUTHENTICATED"
  | "NO_TENANT"
  | "ACCESS_DENIED"
  | "AMBIGUOUS_TENANT_REQUIRE_SELECTION";

export type DashboardProjects = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  projects: DashboardProject[];
  aggregates: {
    totalProjects: number;
    byStatus: Record<string, number>;
    totalEstimatedValueEur: number | null;
  };
};
