import { CheckCircle2, CircleDashed, Loader, XCircle } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  buildActivityFeed,
  formatActivityTime,
  type ActivityStatus,
} from "@/lib/dashboard/systemActivity";
import type { ObservabilitySnapshot, ServiceResult } from "@/types/hermes";

type Props = {
  observability: ServiceResult<ObservabilitySnapshot>;
  timezone: string;
  locale: string;
  hour12: boolean;
};

const STATUS_LABEL: Record<ActivityStatus, string> = {
  SUCCEEDED: "Réussi",
  RUNNING: "En cours",
  QUEUED: "En file",
  DEGRADED: "Dégradé",
  FAILED: "Échoué",
  DEAD_LETTER: "Dead-letter",
  UNKNOWN: "—",
};

function statusIcon(s: ActivityStatus) {
  if (s === "SUCCEEDED") return <CheckCircle2 size={15} strokeWidth={1.9} />;
  if (s === "RUNNING") return <Loader size={15} strokeWidth={1.9} />;
  if (s === "FAILED" || s === "DEAD_LETTER")
    return <XCircle size={15} strokeWidth={1.9} />;
  return <CircleDashed size={15} strokeWidth={1.9} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card activity-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">ACTIVITÉ</span>
          <h3>Activité récente des agents</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function AgentActivityPanel({
  observability,
  timezone,
  locale,
  hour12,
}: Props) {
  if (!observability.ok || observability.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="activity-empty">
          L’activité des agents est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const feed = buildActivityFeed(
    observability.data.gateway,
    observability.data.executions,
  );

  return (
    <Frame>
      {feed.length === 0 ? (
        <p className="activity-empty">
          Aucune activité récente enregistrée pour votre tenant.
        </p>
      ) : (
        <div className="activity-list">
          {feed.map((item, index) => (
            <div
              className={`activity-item is-${item.status.toLowerCase()}`}
              key={`${item.kind}-${item.label}-${index}`}
            >
              <span className="activity-status-icon">
                {statusIcon(item.status)}
              </span>
              <span className="activity-copy">
                <strong>{item.label}</strong>
                <span>
                  {STATUS_LABEL[item.status]}
                  {item.latencyMs !== null
                    ? ` · ${Math.round(item.latencyMs)} ms`
                    : ""}
                </span>
              </span>
              <span className="activity-time">
                {formatActivityTime(item.at, timezone, locale, hour12)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}
