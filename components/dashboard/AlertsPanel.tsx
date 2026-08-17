"use client";

import { AlertOctagon, AlertTriangle, Bell, ShieldAlert } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  sortAlerts,
  type AlertSeverity,
  type UnifiedAlert,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  alerts: ServiceResult<UnifiedAlerts>;
  /** Cockpit summary — keep only the actionable severities (CRITICAL + HIGH) in the
   *  list. The severity counters above stay the full totals. */
  criticalOnly?: boolean;
  /** Cockpit summary — cap the number of alert rows shown. Omitted ⇒ up to 6 (the
   *  historical default, unchanged for every existing caller). */
  limit?: number;
};

function severityIcon(sev: AlertSeverity) {
  if (sev === "CRITICAL") return <AlertOctagon size={17} strokeWidth={1.9} />;
  if (sev === "HIGH") return <ShieldAlert size={17} strokeWidth={1.9} />;
  if (sev === "WARNING") return <AlertTriangle size={16} strokeWidth={1.8} />;
  return <Bell size={16} strokeWidth={1.8} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card alerts-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("alerts.eyebrow")}</span>
          <h3>{t("alerts.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function AlertsPanel({ alerts, criticalOnly = false, limit }: Props) {
  const { t } = useI18n();

  if (!alerts.ok || alerts.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="alerts-empty">{t("alerts.unavailable")}</p>
      </Frame>
    );
  }

  const { alerts: list, summary, unavailable } = alerts.data;
  // Cockpit summary keeps only the two escalated severities so the Home surface shows
  // what actually needs a decision; the counters above still reflect the full picture.
  const filtered = criticalOnly
    ? list.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH")
    : list;
  const cap = typeof limit === "number" && limit >= 0 ? limit : 6;
  const shown: UnifiedAlert[] = sortAlerts(filtered).slice(0, cap);

  return (
    <Frame>
      <div className="alerts-summary">
        <div className={summary.critical > 0 ? "is-critical" : undefined}>
          <strong>{summary.critical}</strong>
          <span>{t("alerts.critical")}</span>
        </div>
        <div className={summary.high > 0 ? "is-high" : undefined}>
          <strong>{summary.high}</strong>
          <span>{t("alerts.high")}</span>
        </div>
        <div className={summary.warning > 0 ? "is-warning" : undefined}>
          <strong>{summary.warning}</strong>
          <span>{t("alerts.warning")}</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="alerts-empty">{t("alerts.empty")}</p>
      ) : (
        <div className="alerts-list">
          {shown.map((a) => (
            <div className={`alert-item is-${a.severity.toLowerCase()}`} key={a.id}>
              <span className="alert-icon">{severityIcon(a.severity)}</span>
              <span className="alert-copy">
                <strong>{a.title}</strong>
                <span>{a.detail ?? t("common.none")}</span>
              </span>
              <span className={`alert-sev is-${a.severity.toLowerCase()}`}>
                {t(`alerts.severity.${a.severity}` as MessageKey)}
              </span>
            </div>
          ))}
        </div>
      )}

      {unavailable.length > 0 ? (
        <p className="alerts-footer-note">
          {t("alerts.partialSources", { sources: unavailable.join(", ") })}
        </p>
      ) : null}
    </Frame>
  );
}
