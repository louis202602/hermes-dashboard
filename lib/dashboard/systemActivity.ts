/**
 * DASH-3 — État global Hermès + Activité récente des agents (+ commercial).
 * Pure, DOM-free, deterministic logic (no LLM, no I/O). Composes signals ALREADY
 * fetched elsewhere (KPIs, observability, resolver, cost) plus the DASH-3 reads
 * (platform health, agent-action stats, commercial). No duplicated KPI logic — it
 * reads the parsed snapshots and normalises them for display.
 */

import type {
  CostGovernanceSnapshot,
  ObsExecution,
  ObsGateway,
  PlatformHealth,
  ResolverObservability,
  ServiceResult,
} from "@/types/hermes";

// --- Agent-action stats (tenant queue health) -------------------------------

export type AgentActionStats = {
  resolutionStatus: string;
  tenantId: string | null;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  pendingApproval: number;
};

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseAgentActionStats(payload: unknown): AgentActionStats {
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    resolutionStatus: String(p.resolution_status ?? "NO_TENANT"),
    tenantId: str(p.tenant_id),
    queued: num(p.queued),
    running: num(p.running),
    succeeded: num(p.succeeded),
    failed: num(p.failed),
    deadLetter: num(p.dead_letter),
    pendingApproval: num(p.pending_approval),
  };
}

// --- Commercial (btp_devis, EUR) --------------------------------------------

export type DashboardCommercial = {
  resolutionStatus: string;
  tenantId: string | null;
  currency: string;
  total: number;
  sent: number;
  toFollowUp: number;
  accepted: number;
  amountSentTtcEur: number;
  amountAcceptedTtcEur: number;
};

export function parseCommercial(payload: unknown): DashboardCommercial {
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    resolutionStatus: String(p.resolution_status ?? "NO_TENANT"),
    tenantId: str(p.tenant_id),
    currency: String(p.currency ?? "EUR"),
    total: num(p.total),
    sent: num(p.sent),
    toFollowUp: num(p.to_follow_up),
    accepted: num(p.accepted),
    amountSentTtcEur: num(p.amount_sent_ttc_eur),
    amountAcceptedTtcEur: num(p.amount_accepted_ttc_eur),
  };
}

// --- Platform health (PARTIAL coverage: components + last execution) ---------

export type PlatformHealthStatus = "OPERATIONAL" | "DEGRADED" | "UNAVAILABLE";

/**
 * `get_platform_health` only measures the component registry + last execution —
 * it is NOT a full-system probe, so coverage is honestly `PARTIAL` (never a bold
 * "everything works"). Status is OPERATIONAL when active components exist,
 * DEGRADED when none are active, UNAVAILABLE when the read failed.
 */
export function classifyPlatformHealth(ph: ServiceResult<PlatformHealth>): {
  status: PlatformHealthStatus;
  coverage: "PARTIAL" | "UNAVAILABLE";
  componentsActive: number;
  componentsRegistered: number;
  lastExecutionAt: string | null;
} {
  if (!ph.ok || ph.data.resolutionStatus !== "OK") {
    return {
      status: "UNAVAILABLE",
      coverage: "UNAVAILABLE",
      componentsActive: 0,
      componentsRegistered: 0,
      lastExecutionAt: null,
    };
  }
  const active = ph.data.componentsActive;
  return {
    status: active > 0 ? "OPERATIONAL" : "DEGRADED",
    coverage: "PARTIAL",
    componentsActive: active,
    componentsRegistered: ph.data.componentsRegistered,
    lastExecutionAt: ph.data.lastExecutionAt,
  };
}

// --- Recent agent activity --------------------------------------------------

export type ActivityStatus =
  | "SUCCEEDED"
  | "RUNNING"
  | "QUEUED"
  | "DEGRADED"
  | "FAILED"
  | "DEAD_LETTER"
  | "UNKNOWN";

export type ActivityItem = {
  label: string;
  status: ActivityStatus;
  rawStatus: string | null;
  latencyMs: number | null;
  at: string | null;
  kind: "gateway" | "execution";
};

export const ACTIVITY_LIMIT = 12;

/** Deterministic status normalisation shared by the panel + the tests. */
export function normalizeActivityStatus(raw: string | null | undefined): ActivityStatus {
  const s = (raw ?? "").toUpperCase();
  if (["SUCCEEDED", "SUCCESS", "OK", "COMPLETED", "DONE"].includes(s)) return "SUCCEEDED";
  if (["RUNNING", "IN_PROGRESS", "STARTED", "PROCESSING"].includes(s)) return "RUNNING";
  if (["QUEUED", "PENDING", "PENDING_APPROVAL"].includes(s)) return "QUEUED";
  if (["DEGRADED", "WARNING", "PARTIAL"].includes(s)) return "DEGRADED";
  if (["FAILED", "ERROR", "FAIL"].includes(s)) return "FAILED";
  if (["DEAD_LETTER", "DEADLETTER"].includes(s)) return "DEAD_LETTER";
  return "UNKNOWN";
}

/**
 * Merge tenant gateway activity + platform execution telemetry into one recent
 * feed, most-recent first, BOUNDED to `limit`. Non-identifying: labels are action
 * keys / domains only — no user id, no payload.
 */
export function buildActivityFeed(
  gateway: ObsGateway[],
  executions: ObsExecution[],
  limit: number = ACTIVITY_LIMIT,
): ActivityItem[] {
  const fromGateway: ActivityItem[] = (gateway ?? []).map((g) => ({
    label: g.actionKey || "action",
    status: normalizeActivityStatus(g.status),
    rawStatus: g.status,
    latencyMs: null,
    at: g.createdAt,
    kind: "gateway",
  }));
  const fromExec: ActivityItem[] = (executions ?? []).map((e) => ({
    label: e.domain || "execution",
    status: e.degraded ? "DEGRADED" : normalizeActivityStatus(e.status),
    rawStatus: e.status,
    latencyMs: e.latencyMs,
    at: e.finishedAt,
    kind: "execution",
  }));
  return [...fromGateway, ...fromExec]
    .sort((a, b) => {
      if (a.at === b.at) return 0;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return a.at < b.at ? 1 : -1; // desc
    })
    .slice(0, Math.max(0, limit));
}

/** Short local timestamp for an activity row (tenant tz + locale). */
export function formatActivityTime(
  iso: string | null,
  timezone: string,
  locale = "fr-FR",
  hour12 = false,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12,
    }).format(d);
  } catch {
    return "—";
  }
}

// --- Resolver + cost summaries (read from already-parsed snapshots) ----------

export function describeResolver(resolver: ServiceResult<ResolverObservability>): {
  available: boolean;
  enabled: boolean | null;
  circuit: "CLOSED" | "OPEN" | null;
  queueDepth: number | null;
  running: number | null;
  deadLetter: number | null;
  state: string | null;
} {
  if (!resolver.ok || resolver.data.resolutionStatus !== "OK") {
    return {
      available: false,
      enabled: null,
      circuit: null,
      queueDepth: null,
      running: null,
      deadLetter: null,
      state: null,
    };
  }
  const d = resolver.data;
  return {
    available: true,
    enabled: d.control.enabled,
    circuit: d.control.circuitState,
    queueDepth: d.queue.queueDepth,
    running: d.queue.runningCount,
    deadLetter: d.outcomes.deadLetterCount,
    state: d.resolverState,
  };
}

export function extractCostSummary(cost: ServiceResult<CostGovernanceSnapshot>): {
  provenance: "REAL" | "UNAVAILABLE";
  todayUsd: number | null;
  monthUsd: number | null;
  remainingUsd: number | null;
  currency: "USD";
} {
  if (!cost.ok || cost.data.resolutionStatus !== "OK" || !cost.data.period?.day) {
    return {
      provenance: "UNAVAILABLE",
      todayUsd: null,
      monthUsd: null,
      remainingUsd: null,
      currency: "USD",
    };
  }
  const p = cost.data.period;
  return {
    provenance: "REAL",
    todayUsd: p.day.exposureUsd,
    monthUsd: p.month?.exposureUsd ?? null,
    remainingUsd: p.month?.remainingUsd ?? null,
    currency: "USD",
  };
}
