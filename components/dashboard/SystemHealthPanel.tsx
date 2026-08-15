import { Activity, CircuitBoard, Cpu, ServerCog } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  classifyPlatformHealth,
  describeResolver,
  extractCostSummary,
  formatActivityTime,
  type AgentActionStats,
  type PlatformHealthStatus,
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

const HEALTH_LABEL: Record<PlatformHealthStatus, string> = {
  OPERATIONAL: "Opérationnelle",
  DEGRADED: "Dégradée",
  UNAVAILABLE: "Indisponible",
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
  const health = classifyPlatformHealth(platformHealth);
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
          <span className="panel-eyebrow">SYSTÈME</span>
          <h3>État global Hermès</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <div className={`sysh-health is-${health.status.toLowerCase()}`}>
        <ServerCog size={18} strokeWidth={1.9} />
        <div>
          <strong>Plateforme {HEALTH_LABEL[health.status]}</strong>
          <span>
            {health.coverage === "PARTIAL"
              ? `Couverture partielle (composants + dernière exécution) · dernière exéc. ${formatActivityTime(
                  health.lastExecutionAt,
                  timezone,
                  locale,
                  hour12,
                )}`
              : "Mesure indisponible"}
          </span>
        </div>
      </div>

      <div className="sysh-grid">
        <Metric label="Agents IA actifs" value={agents ?? "—"} />
        <Metric
          label="Composants actifs"
          value={
            componentsActive !== null && componentsRegistered !== null
              ? `${componentsActive}/${componentsRegistered}`
              : "—"
          }
        />
        <Metric
          label="Incidents ouverts"
          value={openIncidents ?? "—"}
          tone={openIncidents && openIncidents > 0 ? "warning" : undefined}
        />
      </div>

      <div className="sysh-subtitle">
        <Cpu size={14} strokeWidth={1.8} /> <span>Files d’actions (tenant)</span>
      </div>
      <div className="sysh-grid sysh-grid-4">
        <Metric label="En file" value={stats ? stats.queued : "—"} />
        <Metric label="En cours" value={stats ? stats.running : "—"} />
        <Metric
          label="Échouées"
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
          Résolveur :{" "}
          <strong>
            {res.available
              ? `${res.enabled ? "activé" : "désactivé"} · circuit ${
                  res.circuit === "OPEN" ? "OUVERT" : "CLOSED"
                } · file ${res.queueDepth ?? "—"} · en cours ${
                  res.running ?? "—"
                } · dead-letter ${res.deadLetter ?? "—"}`
              : "—"}
          </strong>
        </span>
      </div>

      <div className="sysh-subtitle">
        <Activity size={14} strokeWidth={1.8} /> <span>Coût IA (USD, source SW23)</span>
      </div>
      {costSummary.provenance === "REAL" ? (
        <div className="sysh-grid">
          <Metric label="Aujourd’hui" value={fmtUsd(costSummary.todayUsd)} />
          <Metric label="Ce mois" value={fmtUsd(costSummary.monthUsd)} />
          <Metric label="Budget restant" value={fmtUsd(costSummary.remainingUsd)} />
        </div>
      ) : (
        <p className="sysh-note">Coût indisponible pour le moment.</p>
      )}
    </section>
  );
}
