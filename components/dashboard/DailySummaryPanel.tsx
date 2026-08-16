"use client";

import { CalendarClock, CloudSun } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { DailySummary } from "@/lib/dashboard/dailySummary";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  summary: DailySummary;
};

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={`summary-stat${value > 0 ? " is-active" : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function DailySummaryPanel({ summary }: Props) {
  const { t } = useI18n();

  return (
    <section className="dashboard-card summary-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("summary.eyebrow")}</span>
          <h3>{t("summary.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      {!summary.hasContent ? (
        <p className="summary-empty">{t("summary.empty")}</p>
      ) : (
        <>
          <div className="summary-grid">
            {summary.chantiersActive !== null ? (
              <Stat value={summary.chantiersActive} label={t("summary.tile.chantiers")} />
            ) : null}
            {summary.agenda ? (
              <>
                <Stat value={summary.agenda.today} label={t("summary.tile.today")} />
                <Stat value={summary.agenda.overdue} label={t("summary.tile.overdue")} />
              </>
            ) : null}
            {summary.priorities ? (
              <Stat value={summary.priorities.pendingApprovals} label={t("summary.tile.approvals")} />
            ) : null}
            {summary.alerts ? (
              <Stat value={summary.alerts.actionable} label={t("summary.tile.alerts")} />
            ) : null}
            {summary.devisToFollowUp !== null ? (
              <Stat value={summary.devisToFollowUp} label={t("summary.tile.devis")} />
            ) : null}
          </div>

          {summary.agenda ? (
            <p className="summary-line">
              <CalendarClock size={15} strokeWidth={1.8} aria-hidden />
              <span className="summary-line-label">{t("summary.nextEvent.label")}</span>
              {summary.agenda.nextEvent ? (
                <span className="summary-line-value">
                  {summary.agenda.nextEvent.title}
                  {summary.agenda.nextEvent.whenLabel
                    ? ` · ${summary.agenda.nextEvent.whenLabel}`
                    : ""}
                </span>
              ) : (
                <span className="summary-line-value is-muted">{t("summary.nextEvent.none")}</span>
              )}
            </p>
          ) : null}

          {summary.weather && summary.weather.worksites > 0 ? (
            <p className="summary-line">
              <CloudSun size={15} strokeWidth={1.8} aria-hidden />
              <span className="summary-line-label">{t("summary.weather.label")}</span>
              {summary.weather.atRisk > 0 ? (
                <span className={`summary-weather-risk is-${(summary.weather.level ?? "warning").toLowerCase()}`}>
                  {t("summary.weather.atRisk", { count: String(summary.weather.atRisk) })}
                </span>
              ) : (
                <span className="summary-line-value is-muted">{t("summary.weather.ok")}</span>
              )}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
