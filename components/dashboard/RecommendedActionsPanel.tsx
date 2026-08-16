"use client";

import { ArrowUpRight, ListChecks } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  ActionPriority,
  RecommendedAction,
} from "@/lib/dashboard/recommendedActions";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";

type Props = {
  actions: RecommendedAction[];
  visibleWidgetIds: string[];
};

const PRIORITY_CLASS: Record<ActionPriority, string> = {
  CRITICAL: "is-critical",
  HIGH: "is-high",
  MEDIUM: "is-medium",
  LOW: "is-low",
};

export default function RecommendedActionsPanel({ actions, visibleWidgetIds }: Props) {
  const { t } = useI18n();
  const visible = new Set(visibleWidgetIds);

  return (
    <section className="dashboard-card actions-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("actions.eyebrow")}</span>
          <h3>{t("actions.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      {actions.length === 0 ? (
        <p className="actions-empty">
          <ListChecks size={16} strokeWidth={1.8} aria-hidden /> {t("actions.empty")}
        </p>
      ) : (
        <ul className="actions-list">
          {actions.map((a) => {
            const canLink = a.targetWidget !== null && visible.has(a.targetWidget);
            return (
              <li key={a.id} className={`action-item ${PRIORITY_CLASS[a.priority]}`}>
                <span className="action-prio" aria-hidden />
                <div className="action-body">
                  <div className="action-top">
                    <strong className="action-title">
                      {t(a.titleKey as MessageKey, a.params)}
                    </strong>
                    <span className={`action-prio-label ${PRIORITY_CLASS[a.priority]}`}>
                      {t(`actions.priority.${a.priority}` as MessageKey)}
                    </span>
                  </div>
                  <span className="action-reason">{t(a.reasonKey as MessageKey, a.params)}</span>
                </div>
                {canLink ? (
                  <a className="action-link" href={`#widget-${a.targetWidget}`}>
                    <ArrowUpRight size={15} strokeWidth={1.9} aria-hidden />
                    <span>{t("actions.viewSource")}</span>
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
