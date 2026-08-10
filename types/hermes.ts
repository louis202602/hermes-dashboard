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

/**
 * A single recent Hermès conversation belonging to the caller, from
 * `public.get_recent_hermes_conversations()`. `preview` is the latest assistant
 * reply (truncated); `outcome` is its business outcome (e.g. `ANSWER_ONLY`,
 * `ACTION`). No internal ids (request / correlation / workflow) are exposed.
 */
export type RecentConversation = {
  id: string;
  title: string;
  preview: string;
  outcome: string | null;
  lastMessageAt: string | null;
};

export type RecentConversations = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  conversations: RecentConversation[];
};

/** A capability the caller is permitted to run, from `agent_action_catalog`. */
export type AvailableCapability = {
  actionKey: string;
  displayName: string;
  description: string | null;
  isSensitive: boolean;
};

export type AvailableCapabilities = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  capabilities: AvailableCapability[];
};

/** A single operational priority, DERIVED from a real backend row. */
export type OperationalPriority = {
  kind: "approval" | "incident" | "qualify" | "late";
  severity: "critical" | "urgent" | "normal";
  label: string;
  detail: string | null;
};

export type OperationalPriorities = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  summary: {
    pendingApprovals: number;
    openIncidents: number;
    toQualify: number;
    late: number;
  };
  items: OperationalPriority[];
};

/**
 * Real, measured platform facts. Infra SLA / latency / uptime are intentionally
 * NOT here — the frontend surfaces those as UNAVAILABLE rather than inventing them.
 */
export type PlatformHealth = {
  resolutionStatus: "OK" | "UNAUTHENTICATED";
  componentsRegistered: number;
  componentsActive: number;
  lastExecutionAt: string | null;
};

/** A recent platform execution (non-identifying telemetry — no tenant/user/payload). */
export type ObsExecution = {
  domain: string | null;
  status: string | null;
  latencyMs: number | null;
  degraded: boolean;
  finishedAt: string | null;
};

/** A recent gateway request for the caller's tenant. */
export type ObsGateway = {
  actionKey: string;
  status: string | null;
  policyDecision: string | null;
  errorCode: string | null;
  createdAt: string | null;
};

/** A quality incident for the caller's tenant. */
export type ObsIncident = {
  type: string | null;
  severity: string | null;
  status: string | null;
  chantier: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
};

/**
 * Observability snapshot. Platform aggregates + non-identifying execution
 * telemetry are REAL and platform-wide; gateway activity and incidents are the
 * caller's tenant only. Heartbeat / SLA / uptime are not stored and are shown as
 * UNAVAILABLE by the frontend — never fabricated. `medianLatencyMs` is a robust
 * (median) real latency; the raw mean is intentionally not used (outlier-skewed).
 */
export type ObservabilitySnapshot = {
  resolutionStatus: "OK" | "UNAUTHENTICATED";
  tenantResolution: TenantResolutionStatus | null;
  tenantId: string | null;
  platform: {
    componentsRegistered: number;
    componentsActive: number;
    executionsTotal: number;
    executionsDegraded: number;
    executionsWithLatency: number;
    medianLatencyMs: number | null;
    lastExecutionAt: string | null;
    byStatus: Record<string, number>;
  };
  executions: ObsExecution[];
  gateway: ObsGateway[];
  incidents: ObsIncident[];
};
