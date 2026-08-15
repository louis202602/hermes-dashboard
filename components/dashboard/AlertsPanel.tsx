import { AlertOctagon, AlertTriangle, Bell, ShieldAlert } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  sortAlerts,
  type AlertSeverity,
  type UnifiedAlert,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  alerts: ServiceResult<UnifiedAlerts>;
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  CRITICAL: "Critique",
  HIGH: "Élevé",
  WARNING: "Attention",
  INFO: "Info",
};

function severityIcon(sev: AlertSeverity) {
  if (sev === "CRITICAL") return <AlertOctagon size={17} strokeWidth={1.9} />;
  if (sev === "HIGH") return <ShieldAlert size={17} strokeWidth={1.9} />;
  if (sev === "WARNING") return <AlertTriangle size={16} strokeWidth={1.8} />;
  return <Bell size={16} strokeWidth={1.8} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card alerts-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">ALERTES</span>
          <h3>Alertes &amp; priorités</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function AlertsPanel({ alerts }: Props) {
  if (!alerts.ok || alerts.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="alerts-empty">
          Les alertes sont indisponibles pour le moment.
        </p>
      </Frame>
    );
  }

  const { alerts: list, summary, unavailable } = alerts.data;
  const shown: UnifiedAlert[] = sortAlerts(list).slice(0, 6);

  return (
    <Frame>
      <div className="alerts-summary">
        <div className={summary.critical > 0 ? "is-critical" : undefined}>
          <strong>{summary.critical}</strong>
          <span>critiques</span>
        </div>
        <div className={summary.high > 0 ? "is-high" : undefined}>
          <strong>{summary.high}</strong>
          <span>élevées</span>
        </div>
        <div className={summary.warning > 0 ? "is-warning" : undefined}>
          <strong>{summary.warning}</strong>
          <span>attention</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="alerts-empty">
          Aucune alerte active. Tout est nominal pour votre tenant.
        </p>
      ) : (
        <div className="alerts-list">
          {shown.map((a) => (
            <div className={`alert-item is-${a.severity.toLowerCase()}`} key={a.id}>
              <span className="alert-icon">{severityIcon(a.severity)}</span>
              <span className="alert-copy">
                <strong>{a.title}</strong>
                <span>{a.detail ?? "—"}</span>
              </span>
              <span className={`alert-sev is-${a.severity.toLowerCase()}`}>
                {SEVERITY_LABEL[a.severity]}
              </span>
            </div>
          ))}
        </div>
      )}

      {unavailable.length > 0 ? (
        <p className="alerts-footer-note">
          Sources partiellement indisponibles : {unavailable.join(", ")}.
        </p>
      ) : null}
    </Frame>
  );
}
