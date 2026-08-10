import {
  Activity,
  AlertOctagon,
  Boxes,
  CircleSlash,
  Clock,
  Gauge,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  ObservabilitySnapshot,
  ServiceResult,
} from "@/types/hermes";

type SystemStatusProps = {
  observability: ServiceResult<ObservabilitySnapshot>;
};

// Signals not measured from the dashboard — shown honestly, never faked.
const UNMEASURED = [
  { name: "Heartbeat services", detail: "Aucune sonde de heartbeat" },
  { name: "Disponibilité n8n / Vercel", detail: "Uptime non instrumenté" },
  { name: "SLA global", detail: "Formule SLA non définie" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

function statusTone(status: string | null): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("FAIL") || s.includes("BLOCK") || s.includes("REJECT") || s.includes("DENIED"))
    return "critical";
  if (s.includes("DEGRAD") || s.includes("WARN") || s.includes("REVIEW") || s.includes("PENDING"))
    return "urgent";
  return "normal";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">OBSERVABILITÉ</span>
          <h3>État du système</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function SystemStatus({ observability }: SystemStatusProps) {
  if (!observability.ok || observability.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">
          L’observabilité est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { platform, executions, incidents, gateway } = observability.data;
  const openIncidents = incidents.filter(
    (i) => (i.status ?? "").toUpperCase() !== "RESOLU" && !i.resolvedAt,
  );

  return (
    <Frame>
      {/* REAL measured facts. */}
      <div className="system-metrics">
        <div className="system-metric">
          <Boxes size={17} strokeWidth={1.8} />
          <div>
            <span>Composants actifs</span>
            <strong>
              {platform.componentsActive} / {platform.componentsRegistered}
            </strong>
          </div>
        </div>
        <div className="system-metric">
          <Gauge size={17} strokeWidth={1.8} />
          <div>
            <span>Latence médiane</span>
            <strong>{fmtLatency(platform.medianLatencyMs)}</strong>
          </div>
        </div>
        <div className="system-metric">
          <Activity size={17} strokeWidth={1.8} />
          <div>
            <span>Exécutions dégradées</span>
            <strong>
              {platform.executionsDegraded} / {platform.executionsTotal}
            </strong>
          </div>
        </div>
        <div className="system-metric">
          <Clock size={17} strokeWidth={1.8} />
          <div>
            <span>Dernière exécution</span>
            <strong>{fmtDate(platform.lastExecutionAt)}</strong>
          </div>
        </div>
      </div>

      {/* Open incidents (tenant-scoped). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <AlertOctagon size={15} strokeWidth={1.9} />
          <span>Incidents ouverts</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {openIncidents.length === 0 ? (
          <p className="system-line-empty">Aucun incident ouvert pour votre tenant.</p>
        ) : (
          <ul className="system-line-list">
            {openIncidents.slice(0, 4).map((i, idx) => (
              <li key={`inc-${idx}`} className="system-line is-urgent">
                <strong>{i.type ?? "incident"}</strong>
                <span>
                  {(i.chantier ?? "—") + " · " + (i.severity ?? "—") + " · " + fmtDate(i.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent platform executions (non-identifying telemetry). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <ListChecks size={15} strokeWidth={1.9} />
          <span>Dernières exécutions (plateforme)</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {executions.length === 0 ? (
          <p className="system-line-empty">Aucune exécution enregistrée.</p>
        ) : (
          <ul className="system-line-list">
            {executions.slice(0, 4).map((e, idx) => (
              <li key={`exec-${idx}`} className={`system-line is-${statusTone(e.status)}`}>
                <strong>{e.domain ?? "—"}</strong>
                <span>
                  {(e.status ?? "—") +
                    (e.latencyMs !== null ? " · " + fmtLatency(e.latencyMs) : "") +
                    (e.degraded ? " · dégradé" : "") +
                    " · " +
                    fmtDate(e.finishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Gateway activity (tenant-scoped). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <ShieldCheck size={15} strokeWidth={1.9} />
          <span>Activité gateway (tenant)</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {gateway.length === 0 ? (
          <p className="system-line-empty">Aucune action gateway récente pour votre tenant.</p>
        ) : (
          <ul className="system-line-list">
            {gateway.slice(0, 4).map((g, idx) => (
              <li key={`gw-${idx}`} className={`system-line is-${statusTone(g.status)}`}>
                <strong>{g.actionKey}</strong>
                <span>
                  {(g.status ?? "—") +
                    (g.errorCode ? " · " + g.errorCode : "") +
                    " · " +
                    fmtDate(g.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Honestly UNAVAILABLE — not measured, never faked. */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <CircleSlash size={15} strokeWidth={1.9} />
          <span>Non mesuré</span>
          <ProvenanceBadge provenance="UNAVAILABLE" />
        </div>
        <ul className="system-line-list">
          {UNMEASURED.map((u) => (
            <li key={u.name} className="system-line is-unavailable">
              <strong>{u.name}</strong>
              <span>{u.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}
