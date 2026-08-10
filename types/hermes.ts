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

// --- Cost governance (SW23/SW9 read model) ---------------------------------

/** Canonical limit state for a budget period, from `public.sw_cost_limit_state`. */
export type CostLimitState =
  | "NORMAL"
  | "WARNING"
  | "SOFT_LIMIT"
  | "HARD_LIMIT"
  | "BLOCKED";

/** Per-period budget exposure. `budgetUsd` null ⇒ NOT_CONFIGURED (never invented). */
export type CostPeriod = {
  periodKey: string;
  exposureUsd: number;
  committedActualUsd: number;
  budgetUsd: number | null;
  remainingUsd: number | null;
  usageRatio: number | null;
  limitState: CostLimitState;
  provenance: "REAL" | "NOT_CONFIGURED";
};

export type CostBudget =
  | {
      provenance: "REAL";
      dailyBudgetUsd: number | null;
      monthlyBudgetUsd: number | null;
      perRequestBudgetUsd: number | null;
      alertThresholdPct: number | null;
      hardStop: boolean;
    }
  | { provenance: "NOT_CONFIGURED" };

export type CostQuotaProvider = {
  provider: string;
  service: string;
  calls: number;
  costAccumulated: number;
};

export type CostQuotaBlock = {
  provider: string;
  service: string;
  reason: string;
  callCountAtBlock: number;
  blockedAt: string | null;
};

export type CostModel = {
  provider: string;
  modelId: string;
  enabled: boolean;
  inputCost: number | null;
  outputCost: number | null;
  currency: string | null;
  pricingUnit: string | null;
  costStatus: string | null;
};

export type CostEventProvider = {
  provider: string;
  modelOrService: string | null;
  totalUsd: number;
  requests: number;
  measurementStatus: string | null;
};

/**
 * Tenant cost/budget/quota snapshot from `public.get_cost_governance_snapshot`.
 * Reads the REAL SW23/SW9 tables; anything not measured is `UNAVAILABLE` /
 * `NOT_CONFIGURED`, never fabricated.
 */
export type CostGovernanceSnapshot = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  asOf: string | null;
  governanceState: CostLimitState;
  budget: CostBudget;
  period: { day: CostPeriod; month: CostPeriod };
  costEvents:
    | {
        provenance: "REAL";
        requests: number;
        totalUsd: number;
        byProvider: CostEventProvider[];
      }
    | { provenance: "UNAVAILABLE" };
  quota: {
    provenance: "REAL";
    totalCalls: number;
    totalCostAccumulated: number;
    blocksToday: number;
    byProvider: CostQuotaProvider[];
    recentBlocks: CostQuotaBlock[];
  };
  models: CostModel[];
  unavailable: string[];
};

// --- Action & approval audit trail (safety-critical accountability) --------

export type ActionApprovalOutcome =
  | "APPROVED"
  | "REJECTED"
  | "PENDING_APPROVAL"
  | "NOT_REQUIRED";

/**
 * One accountability record for an agent action, from
 * `public.get_action_audit_trail`. Non-identifying: no payload, no requester /
 * approver user id, error CODE only.
 */
export type AuditAction = {
  actionKey: string;
  isSensitive: boolean;
  status: string | null;
  policyDecision: string | null;
  policyReason: string | null;
  requiredApproval: boolean;
  approvalOutcome: ActionApprovalOutcome;
  decidedAt: string | null;
  attempts: number;
  errorCode: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ActionAuditSummary = {
  total: number;
  sensitive: number;
  policyDenied: number;
  approved: number;
  rejected: number;
  pendingApproval: number;
  failed: number;
  queued: number;
  succeeded: number;
};

export type ActionAuditTrail = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  asOf: string | null;
  summary: ActionAuditSummary;
  actions: AuditAction[];
  unavailable: string[];
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
