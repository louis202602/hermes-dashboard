"use client";

import { AlertTriangle, ClipboardCheck, Clock3, Flag } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey, TranslateFn } from "@/lib/i18n/languages";
import type {
  OperationalPriorities,
  OperationalPriority,
  ServiceResult,
} from "@/types/hermes";

type TasksPanelProps = {
  priorities: ServiceResult<OperationalPriorities>;
  /** Cockpit summary — cap the number of priority rows shown (Command Center Home).
   *  The summary counters above the list are always the full totals. Omitted ⇒
   *  the full list (unchanged for every existing caller). */
  limit?: number;
};

function severityIcon(severity: OperationalPriority["severity"]) {
  if (severity === "critical") return <AlertTriangle size={17} strokeWidth={1.9} />;
  if (severity === "urgent") return <Clock3 size={17} strokeWidth={1.9} />;
  return <Flag size={16} strokeWidth={1.8} />;
}

function severityLabel(
  severity: OperationalPriority["severity"],
  t: TranslateFn,
): string {
  if (severity === "critical") return t("tasks.severity.critical");
  if (severity === "urgent") return t("tasks.severity.urgent");
  return t("tasks.severity.default");
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card tasks-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("tasks.eyebrow")}</span>
          <h3>{t("tasks.title")}</h3>
        </div>
        <ProvenanceBadge provenance="DERIVED" />
      </div>
      {children}
    </section>
  );
}

export default function TasksPanel({ priorities, limit }: TasksPanelProps) {
  const { t } = useI18n();

  if (!priorities.ok) {
    return (
      <Frame>
        <p className="tasks-empty">{t("tasks.unavailable")}</p>
      </Frame>
    );
  }

  const { resolutionStatus, summary, items: allItems } = priorities.data;
  const items =
    typeof limit === "number" && limit >= 0 ? allItems.slice(0, limit) : allItems;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="tasks-empty">
          {t(`tasks.resolution.${resolutionStatus}` as MessageKey)}
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="tasks-summary">
        <div>
          <strong>{summary.pendingApprovals}</strong>
          <span>{t("tasks.summary.approvals")}</span>
        </div>
        <div>
          <strong>{summary.openIncidents}</strong>
          <span>{t("tasks.summary.openIncidents")}</span>
        </div>
        <div>
          <strong>{summary.toQualify}</strong>
          <span>{t("tasks.summary.toQualify")}</span>
        </div>
        <div>
          <strong>{summary.late}</strong>
          <span>{t("tasks.summary.late")}</span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="tasks-empty">{t("tasks.empty")}</p>
      ) : (
        <div className="tasks-list">
          {items.map((item, index) => (
            <div className="task-item" key={`${item.kind}-${index}`}>
              <span className={`task-status-icon is-${item.severity}`}>
                {severityIcon(item.severity)}
              </span>

              <span className="task-copy">
                <strong>{item.label}</strong>
                <span>{item.detail ?? t("common.none")}</span>
              </span>

              <span className={`task-priority is-${item.severity}`}>
                {severityLabel(item.severity, t)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="tasks-footer-note">
        <ClipboardCheck size={16} strokeWidth={1.8} />
        <span>{t("tasks.footerNote")}</span>
      </p>
    </Frame>
  );
}
