import { AlertTriangle, ClipboardCheck, Clock3, Flag } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  OperationalPriorities,
  OperationalPriority,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

type TasksPanelProps = {
  priorities: ServiceResult<OperationalPriorities>;
};

const RESOLUTION_MESSAGES: Record<TenantResolutionStatus, string> = {
  OK: "",
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucun tenant n’est associé à votre compte.",
  ACCESS_DENIED: "Accès refusé pour le tenant demandé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION:
    "Plusieurs tenants disponibles : sélection requise.",
};

function severityIcon(severity: OperationalPriority["severity"]) {
  if (severity === "critical") return <AlertTriangle size={17} strokeWidth={1.9} />;
  if (severity === "urgent") return <Clock3 size={17} strokeWidth={1.9} />;
  return <Flag size={16} strokeWidth={1.8} />;
}

function severityLabel(severity: OperationalPriority["severity"]): string {
  if (severity === "critical") return "Critique";
  if (severity === "urgent") return "Urgent";
  return "À traiter";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card tasks-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PRIORITÉS</span>
          <h3>Priorités opérationnelles</h3>
        </div>
        <ProvenanceBadge provenance="DERIVED" />
      </div>
      {children}
    </section>
  );
}

export default function TasksPanel({ priorities }: TasksPanelProps) {
  if (!priorities.ok) {
    return (
      <Frame>
        <p className="tasks-empty">
          Les priorités opérationnelles sont indisponibles pour le moment.
        </p>
      </Frame>
    );
  }

  const { resolutionStatus, summary, items } = priorities.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="tasks-empty">{RESOLUTION_MESSAGES[resolutionStatus]}</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="tasks-summary">
        <div>
          <strong>{summary.pendingApprovals}</strong>
          <span>approbations</span>
        </div>
        <div>
          <strong>{summary.openIncidents}</strong>
          <span>incidents ouverts</span>
        </div>
        <div>
          <strong>{summary.toQualify}</strong>
          <span>à qualifier</span>
        </div>
        <div>
          <strong>{summary.late}</strong>
          <span>en retard</span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="tasks-empty">
          Aucune priorité en attente. Tout est à jour pour votre tenant.
        </p>
      ) : (
        <div className="tasks-list">
          {items.map((item, index) => (
            <div className="task-item" key={`${item.kind}-${index}`}>
              <span className={`task-status-icon is-${item.severity}`}>
                {severityIcon(item.severity)}
              </span>

              <span className="task-copy">
                <strong>{item.label}</strong>
                <span>{item.detail ?? "—"}</span>
              </span>

              <span className={`task-priority is-${item.severity}`}>
                {severityLabel(item.severity)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="tasks-footer-note">
        <ClipboardCheck size={16} strokeWidth={1.8} />
        <span>Dérivé de signaux réels : approbations, incidents, chantiers.</span>
      </p>
    </Frame>
  );
}
