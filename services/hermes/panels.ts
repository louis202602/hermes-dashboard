import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AvailableCapabilities,
  AvailableCapability,
  CostBudget,
  CostEventProvider,
  CostGovernanceSnapshot,
  CostLimitState,
  CostModel,
  CostPeriod,
  CostQuotaBlock,
  CostQuotaProvider,
  ObsExecution,
  ObsGateway,
  ObsIncident,
  ObservabilitySnapshot,
  OperationalPriorities,
  OperationalPriority,
  PlatformHealth,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

/**
 * Capabilities the caller is permitted to run (`agent_action_catalog` ⋈
 * permissions). Permission/tenant enforced entirely in the RPC — a member without
 * a permission never receives that capability.
 */
export async function getAvailableCapabilities(): Promise<
  ServiceResult<AvailableCapabilities>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_available_capabilities");
    if (error) {
      logEvent("error", "capabilities.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(payload.capabilities)
      ? (payload.capabilities as Record<string, unknown>[])
      : [];
    const capabilities: AvailableCapability[] = raw.map((c) => ({
      actionKey: String(c.action_key ?? ""),
      displayName: (c.display_name as string) ?? String(c.action_key ?? ""),
      description: (c.description as string) ?? null,
      isSensitive: Boolean(c.is_sensitive),
    }));
    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (payload.resolution_status ??
          "UNAUTHENTICATED") as TenantResolutionStatus,
        tenantId: (payload.tenant_id as string) ?? null,
        capabilities,
      },
    };
  } catch (err) {
    logEvent("error", "capabilities.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Capabilities service unavailable.",
    };
  }
}

/**
 * Operational priorities DERIVED from real signals (pending approvals, open
 * quality incidents, chantiers to qualify, late chantiers). Tenant-scoped in the
 * RPC. Provenance is DERIVED — real rows, rule-based prioritisation.
 */
export async function getOperationalPriorities(): Promise<
  ServiceResult<OperationalPriorities>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_operational_priorities");
    if (error) {
      logEvent("error", "priorities.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const s = (payload.summary ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items)
      ? (payload.items as Record<string, unknown>[])
      : [];
    const items: OperationalPriority[] = rawItems.map((i) => ({
      kind: (i.kind as OperationalPriority["kind"]) ?? "qualify",
      severity: (i.severity as OperationalPriority["severity"]) ?? "normal",
      label: (i.label as string) ?? "",
      detail: (i.detail as string) ?? null,
    }));
    // Transport-level provenance is REAL (the read succeeded from real rows).
    // The panel labels the *display* as DERIVED (rule-based prioritisation).
    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (payload.resolution_status ??
          "UNAUTHENTICATED") as TenantResolutionStatus,
        tenantId: (payload.tenant_id as string) ?? null,
        summary: {
          pendingApprovals: toNumber(s.pending_approvals),
          openIncidents: toNumber(s.open_incidents),
          toQualify: toNumber(s.to_qualify),
          late: toNumber(s.late),
        },
        items,
      },
    };
  } catch (err) {
    logEvent("error", "priorities.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Priorities service unavailable.",
    };
  }
}

/**
 * Real measured platform facts (component registry counts + last recorded
 * execution). Anything not measured is left to the frontend to show as
 * UNAVAILABLE — never fabricated.
 */
export async function getPlatformHealth(): Promise<
  ServiceResult<PlatformHealth>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_platform_health");
    if (error) {
      logEvent("error", "health.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (payload.resolution_status ??
          "UNAUTHENTICATED") as PlatformHealth["resolutionStatus"],
        componentsRegistered: toNumber(payload.components_registered),
        componentsActive: toNumber(payload.components_active),
        lastExecutionAt: (payload.last_execution_at as string) ?? null,
      },
    };
  } catch (err) {
    logEvent("error", "health.exception", { message: (err as Error).message });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Platform health service unavailable.",
    };
  }
}

/**
 * Observability snapshot: REAL platform aggregates + non-identifying execution
 * telemetry (platform-wide) plus the caller's tenant gateway activity and quality
 * incidents. Authorization enforced in the RPC; fail-closed.
 */
export async function getObservabilitySnapshot(
  limit = 6,
): Promise<ServiceResult<ObservabilitySnapshot>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_observability_snapshot", {
      p_limit: limit,
    });
    if (error) {
      logEvent("error", "observability.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const p = (payload.platform ?? {}) as Record<string, unknown>;
    const rawExec = Array.isArray(payload.executions)
      ? (payload.executions as Record<string, unknown>[])
      : [];
    const rawGw = Array.isArray(payload.gateway)
      ? (payload.gateway as Record<string, unknown>[])
      : [];
    const rawInc = Array.isArray(payload.incidents)
      ? (payload.incidents as Record<string, unknown>[])
      : [];

    const executions: ObsExecution[] = rawExec.map((e) => ({
      domain: (e.domain as string) ?? null,
      status: (e.status as string) ?? null,
      latencyMs:
        e.latency_ms === null || e.latency_ms === undefined
          ? null
          : toNumber(e.latency_ms),
      degraded: Boolean(e.degraded),
      finishedAt: (e.finished_at as string) ?? null,
    }));
    const gateway: ObsGateway[] = rawGw.map((g) => ({
      actionKey: String(g.action_key ?? ""),
      status: (g.status as string) ?? null,
      policyDecision: (g.policy_decision as string) ?? null,
      errorCode: (g.error_code as string) ?? null,
      createdAt: (g.created_at as string) ?? null,
    }));
    const incidents: ObsIncident[] = rawInc.map((i) => ({
      type: (i.type as string) ?? null,
      severity: (i.severity as string) ?? null,
      status: (i.status as string) ?? null,
      chantier: (i.chantier as string) ?? null,
      createdAt: (i.created_at as string) ?? null,
      resolvedAt: (i.resolved_at as string) ?? null,
    }));

    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (payload.resolution_status ??
          "UNAUTHENTICATED") as ObservabilitySnapshot["resolutionStatus"],
        tenantResolution: (payload.tenant_resolution ??
          null) as ObservabilitySnapshot["tenantResolution"],
        tenantId: (payload.tenant_id as string) ?? null,
        platform: {
          componentsRegistered: toNumber(p.components_registered),
          componentsActive: toNumber(p.components_active),
          executionsTotal: toNumber(p.executions_total),
          executionsDegraded: toNumber(p.executions_degraded),
          executionsWithLatency: toNumber(p.executions_with_latency),
          medianLatencyMs:
            p.median_latency_ms === null || p.median_latency_ms === undefined
              ? null
              : toNumber(p.median_latency_ms),
          lastExecutionAt: (p.last_execution_at as string) ?? null,
          byStatus: (p.by_status as Record<string, number>) ?? {},
        },
        executions,
        gateway,
        incidents,
      },
    };
  } catch (err) {
    logEvent("error", "observability.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Observability service unavailable.",
    };
  }
}

function mapCostPeriod(raw: Record<string, unknown>): CostPeriod {
  return {
    periodKey: String(raw.period_key ?? ""),
    exposureUsd: toNumber(raw.exposure_usd),
    committedActualUsd: toNumber(raw.committed_actual_usd),
    budgetUsd: toNumOrNull(raw.budget_usd),
    remainingUsd: toNumOrNull(raw.remaining_usd),
    usageRatio: toNumOrNull(raw.usage_ratio),
    limitState: (raw.limit_state as CostLimitState) ?? "NORMAL",
    provenance:
      (raw.provenance as CostPeriod["provenance"]) ?? "NOT_CONFIGURED",
  };
}

/**
 * Tenant cost/budget/quota snapshot (`public.get_cost_governance_snapshot`).
 * Read-only over the real SW23/SW9 tables — reserve/commit/release and quota
 * enforcement stay in the existing engine. Unmeasured signals are surfaced as
 * UNAVAILABLE / NOT_CONFIGURED, never fabricated.
 */
export async function getCostGovernanceSnapshot(
  limit = 8,
): Promise<ServiceResult<CostGovernanceSnapshot>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      "get_cost_governance_snapshot",
      { p_limit: limit },
    );
    if (error) {
      logEvent("error", "cost_governance.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const rawBudget = (payload.budget ?? {}) as Record<string, unknown>;
    const rawPeriod = (payload.period ?? {}) as Record<string, unknown>;
    const rawQuota = (payload.quota ?? {}) as Record<string, unknown>;
    const rawCe = (payload.cost_events ?? {}) as Record<string, unknown>;

    const budget: CostBudget =
      rawBudget.provenance === "REAL"
        ? {
            provenance: "REAL",
            dailyBudgetUsd: toNumOrNull(rawBudget.daily_budget_usd),
            monthlyBudgetUsd: toNumOrNull(rawBudget.monthly_budget_usd),
            perRequestBudgetUsd: toNumOrNull(rawBudget.per_request_budget_usd),
            alertThresholdPct: toNumOrNull(rawBudget.alert_threshold_pct),
            hardStop: Boolean(rawBudget.hard_stop),
          }
        : { provenance: "NOT_CONFIGURED" };

    const quotaBy = Array.isArray(rawQuota.by_provider)
      ? (rawQuota.by_provider as Record<string, unknown>[])
      : [];
    const quotaBlocks = Array.isArray(rawQuota.recent_blocks)
      ? (rawQuota.recent_blocks as Record<string, unknown>[])
      : [];
    const byProvider: CostQuotaProvider[] = quotaBy.map((q) => ({
      provider: String(q.provider ?? ""),
      service: String(q.service ?? ""),
      calls: toNumber(q.calls),
      costAccumulated: toNumber(q.cost_accumulated),
    }));
    const recentBlocks: CostQuotaBlock[] = quotaBlocks.map((b) => ({
      provider: String(b.provider ?? ""),
      service: String(b.service ?? ""),
      reason: String(b.reason ?? ""),
      callCountAtBlock: toNumber(b.call_count_at_block),
      blockedAt: (b.blocked_at as string) ?? null,
    }));

    const rawModels = Array.isArray(payload.models)
      ? (payload.models as Record<string, unknown>[])
      : [];
    const models: CostModel[] = rawModels.map((m) => ({
      provider: String(m.provider ?? ""),
      modelId: String(m.model_id ?? ""),
      enabled: Boolean(m.enabled),
      inputCost: toNumOrNull(m.input_cost),
      outputCost: toNumOrNull(m.output_cost),
      currency: (m.currency as string) ?? null,
      pricingUnit: (m.pricing_unit as string) ?? null,
      costStatus: (m.cost_status as string) ?? null,
    }));

    const costEvents: CostGovernanceSnapshot["costEvents"] =
      rawCe.provenance === "REAL"
        ? {
            provenance: "REAL",
            requests: toNumber(rawCe.requests),
            totalUsd: toNumber(rawCe.total_usd),
            byProvider: (Array.isArray(rawCe.by_provider)
              ? (rawCe.by_provider as Record<string, unknown>[])
              : []
            ).map(
              (c): CostEventProvider => ({
                provider: String(c.provider ?? ""),
                modelOrService: (c.model_or_service as string) ?? null,
                totalUsd: toNumber(c.total_usd),
                requests: toNumber(c.requests),
                measurementStatus: (c.measurement_status as string) ?? null,
              }),
            ),
          }
        : { provenance: "UNAVAILABLE" };

    const unavailable = Array.isArray(payload.unavailable)
      ? (payload.unavailable as string[])
      : [];

    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus: (payload.resolution_status ??
          "UNAUTHENTICATED") as TenantResolutionStatus,
        tenantId: (payload.tenant_id as string) ?? null,
        asOf: (payload.as_of as string) ?? null,
        governanceState:
          (payload.governance_state as CostLimitState) ?? "NORMAL",
        budget,
        period: {
          day: mapCostPeriod((rawPeriod.day ?? {}) as Record<string, unknown>),
          month: mapCostPeriod(
            (rawPeriod.month ?? {}) as Record<string, unknown>,
          ),
        },
        costEvents,
        quota: {
          provenance: "REAL",
          totalCalls: toNumber(rawQuota.total_calls),
          totalCostAccumulated: toNumber(rawQuota.total_cost_accumulated),
          blocksToday: toNumber(rawQuota.blocks_today),
          byProvider,
          recentBlocks,
        },
        models,
        unavailable,
      },
    };
  } catch (err) {
    logEvent("error", "cost_governance.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Cost governance service unavailable.",
    };
  }
}
