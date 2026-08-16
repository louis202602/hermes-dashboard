"use client";

import { Activity, CircuitBoard, Cpu, ServerCog } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import {
  classifyPlatformHealth,
  describeResolver,
  extractCostSummary,
  formatActivityTime,
  type AgentActionStats,
} from "@/lib/dashboard/systemActivity";
import type {
  CostGovernanceSnapshot,
  ObservabilitySnapshot,
  PlatformHealth,
  PublicKpis,
  ResolverObservability,
  ServiceResult,
} from "@/types/hermes";

type Props = {
  kpis: ServiceResult<PublicKpis>;
  observability: ServiceResult<ObservabilitySnapshot>;
  platformHealth: ServiceResult<PlatformHealth>;
  actionStats: ServiceResult<AgentActionStats>;
  resolver: ServiceResult<ResolverObservability>;
  cost: ServiceResult<CostGovernanceSnapshot>;
  locale: string;
  timezone: string;
  hour12: boolean;
};

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "warning" | "muted";
}) {
  return (
    <div className={`sysh-metric${tone ? ` is-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function SystemHealthPanel({
  kpis,
  observability,
  platformHealth,
  actionStats,
  resolver,
  cost,
  locale,
  timezone,
  hour12,
}: Props) {
  const { t } = useI18n();
  const health = classifyPlatformHealth(platformHealth);
  const healthLabel =
    health.status === "UNAVAILABLE"
      ? t("common.unavailable")
      : t(`health.status.${health.status}` as MessageKey);
  const res = describeResolver(resolver);
  const costSummary = extractCostSummary(cost);
  const stats = actionStats.ok ? actionStats.data : null;

  const agents = kpis.ok ? kpis.data.agentsIaActive : null;
  const componentsActive =
    health.status !== "UNAVAILABLE"
      ? health.componentsActive
      : observability.ok
        ? observability.data.platform.componentsActive
        : null;
  const componentsRegistered =
    health.status !== "UNAVAILABLE"
      ? health.componentsRegistered
      : observability.ok
        ? observability.data.platform.componentsRegistered
        : null;
  const openIncidents = observability.ok
    ? observability.data.incidents.filter((i) => !i.resolvedAt).length
    : null;

  return (
    <section className="dashboard-card sysh-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("health.eyebrow")}</span>
          <h3>{t("health.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <div className={`sysh-health is-${health.status.toLowerCase()}`}>
        <ServerCog size={18} strokeWidth={1.9} />
        <div>
          <strong>
            {t("health.platform")} {healthLabel}
          </strong>
          <span>
            {health.coverage === "PARTIAL"
              ? t("health.partialCoverage", {
                  time: formatActivityTime(
                    health.lastExecutionAt,
                    timezone,
                    locale,
                    hour12,
                  ),
                })
              : t("health.measureUnavailable")}
          </span>
        </div>
      </div>

      <div className="sysh-grid">
        <Metric label={t("health.agentsActive")} value={agents ?? "—"} />
        <Metric
          label={t("health.componentsActive")}
          value={
            componentsActive !== null && componentsRegistered !== null
              ? `${componentsActive}/${componentsRegistered}`
              : "—"
          }
        />
        <Metric
          label={t("health.openIncidents")}
          value={openIncidents ?? "—"}
          tone={openIncidents && openIncidents > 0 ? "warning" : undefined}
        />
      </div>

      <div className="sysh-subtitle">
        <Cpu size={14} strokeWidth={1.8} /> <span>{t("health.actionQueues")}</span>
      </div>
      <div className="sysh-grid sysh-grid-4">
        <Metric label={t("health.queued")} value={stats ? stats.queued : "—"} />
        <Metric label={t("health.running")} value={stats ? stats.running : "—"} />
        <Metric
          label={t("health.failed")}
          value={stats ? stats.failed : "—"}
          tone={stats && stats.failed > 0 ? "warning" : undefined}
        />
        <Metric
          label="Dead-letter"
          value={stats ? stats.deadLetter : "—"}
          tone={stats && stats.deadLetter > 0 ? "danger" : undefined}
        />
      </div>

      <div className="sysh-row">
        <span className="sysh-row-item">
          <CircuitBoard size={14} strokeWidth={1.8} />
          {t("health.resolver")} :{" "}
          <strong>
            {res.available
              ? t("health.resolverSummary", {
                  state: res.enabled ? t("health.enabled") : t("health.disabled"),
                  circuit:
                    res.circuit === "OPEN"
                      ? t("health.circuitOpen")
                      : t("health.circuitClosed"),
                  queue: res.queueDepth ?? "—",
                  running: res.running ?? "—",
                  deadLetter: res.deadLetter ?? "—",
                })
              : "—"}
          </strong>
        </span>
      </div>

      <div className="sysh-subtitle">
        <Activity size={14} strokeWidth={1.8} /> <span>{t("health.costTitle")}</span>
      </div>
      {costSummary.provenance === "REAL" ? (
        <div className="sysh-grid">
          <Metric label={t("health.today")} value={fmtUsd(costSummary.todayUsd)} />
          <Metric label={t("health.thisMonth")} value={fmtUsd(costSummary.monthUsd)} />
          <Metric label={t("health.remainingBudget")} value={fmtUsd(costSummary.remainingUsd)} />
        </div>
      ) : (
        <p className="sysh-note">{t("health.costUnavailable")}</p>
      )}
    </section>
  );
}
