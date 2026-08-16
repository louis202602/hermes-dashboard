"use client";

import { CheckCircle2, CircleDashed, Loader, XCircle } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  buildActivityFeed,
  formatActivityTime,
  type ActivityStatus,
} from "@/lib/dashboard/systemActivity";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type { ObservabilitySnapshot, ServiceResult } from "@/types/hermes";

type Props = {
  observability: ServiceResult<ObservabilitySnapshot>;
  timezone: string;
  locale: string;
  hour12: boolean;
};

function statusIcon(s: ActivityStatus) {
  if (s === "SUCCEEDED") return <CheckCircle2 size={15} strokeWidth={1.9} />;
  if (s === "RUNNING") return <Loader size={15} strokeWidth={1.9} />;
  if (s === "FAILED" || s === "DEAD_LETTER")
    return <XCircle size={15} strokeWidth={1.9} />;
  return <CircleDashed size={15} strokeWidth={1.9} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card activity-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("agentact.eyebrow")}</span>
          <h3>{t("agentact.title")}</h3>
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
  const { t } = useI18n();

  if (!observability.ok || observability.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="activity-empty">{t("agentact.unavailable")}</p>
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
        <p className="activity-empty">{t("agentact.empty")}</p>
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
                  {t(`agentact.status.${item.status}` as MessageKey)}
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
