import { Activity, CircuitBoard, PauseCircle, PlayCircle } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  ResolverObservability,
  ResolverState,
  ServiceResult,
} from "@/types/hermes";

type Props = {
  resolver: ServiceResult<ResolverObservability>;
};

const STATE_LABEL: Record<ResolverState, string> = {
  READY: "Prêt",
  DISABLED: "Désactivé",
  CIRCUIT_OPEN: "Circuit ouvert",
  NOT_CONFIGURED: "Non configuré",
};

function stateTone(s: ResolverState): string {
  if (s === "CIRCUIT_OPEN") return "critical";
  if (s === "READY") return "normal";
  return "unavailable"; // DISABLED / NOT_CONFIGURED — expected while dormant
}

function fmtAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function fmtRate(r: number | null): string {
  return r === null || !Number.isFinite(r) ? "—" : `${Math.round(r * 100)} %`;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">RÉSOLVEUR · OPÉRATIONNEL</span>
          <h3>Résolveur sémantique</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ResolverStatus({ resolver }: Props) {
  if (!resolver.ok || resolver.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">
          L’état du résolveur est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { resolverState, control, queue, outcomes, cost } = resolver.data;
  const tone = stateTone(resolverState);

  const StateIcon =
    resolverState === "READY"
      ? PlayCircle
      : resolverState === "CIRCUIT_OPEN"
        ? CircuitBoard
        : PauseCircle;

  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "File", value: String(queue.queueDepth) },
    { label: "Plus ancienne", value: fmtAge(queue.oldestQueuedAgeSeconds) },
    { label: "En cours", value: String(queue.runningCount) },
    {
      label: "Échecs (24 h)",
      value: outcomes.provenance === "REAL" ? String(outcomes.failedCount) : "—",
      tone: outcomes.failedCount > 0 ? "critical" : undefined,
    },
    {
      label: "Dead-letter",
      value: outcomes.provenance === "REAL" ? String(outcomes.deadLetterCount) : "—",
      tone: outcomes.deadLetterCount > 0 ? "critical" : undefined,
    },
    {
      label: "Taux d’erreur",
      value: outcomes.provenance === "REAL" ? fmtRate(outcomes.errorRate) : "—",
    },
    { label: "Coût jour", value: fmtUsd(cost.daySpendUsd) },
    { label: "Budget restant", value: fmtUsd(cost.dailyRemainingUsd) },
  ];

  return (
    <Frame>
      <div className="resolver-state-row">
        <span className={`resolver-state-pill is-${tone}`}>
          <StateIcon size={14} strokeWidth={2} />
          {STATE_LABEL[resolverState]}
        </span>
        <span className="resolver-state-meta">
          <Activity size={12} strokeWidth={1.9} />
          lot {control.maxBatch ?? "—"} · concurrence {control.maxConcurrency ?? "—"}
          {control.circuitState === "OPEN" ? " · circuit ouvert" : ""}
        </span>
      </div>

      {resolverState === "CIRCUIT_OPEN" && control.circuitReason ? (
        <p className="resolver-circuit-reason">{control.circuitReason}</p>
      ) : null}

      <ul className="resolver-metric-grid">
        {cells.map((c) => (
          <li key={c.label} className={`resolver-metric${c.tone ? ` is-${c.tone}` : ""}`}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
          </li>
        ))}
      </ul>

      <p className="resolver-note">
        Consommateur inactif — le résolveur ne traite aucune demande tant qu’il
        n’est pas explicitement activé.
        {outcomes.provenance !== "REAL"
          ? " Taux/latence indisponibles (aucune exécution récente)."
          : ""}
      </p>
    </Frame>
  );
}
