"use client";

import { CalendarClock, CalendarX2, Clock } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  relativeDayLabel,
  sortAgendaEvents,
  type AgendaEvent,
  type DashboardAgenda,
} from "@/lib/dashboard/agenda";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  agenda: ServiceResult<DashboardAgenda>;
  locale: string;
};

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card agenda-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("agenda.eyebrow")}</span>
          <h3>{t("agenda.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

function eventTime(
  ev: AgendaEvent,
  timezone: string,
  locale: string,
): string | null {
  if (ev.isAllDay || !ev.startsAt) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ev.startsAt));
  } catch {
    return null;
  }
}

export default function AgendaPanel({ agenda, locale }: Props) {
  const { t } = useI18n();

  if (!agenda.ok || agenda.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="agenda-empty">{t("agenda.unavailable")}</p>
      </Frame>
    );
  }

  const { events, summary, timezone, todayLocal, unavailable } = agenda.data;
  const today = todayLocal ?? "";
  const shown = sortAgendaEvents(events).slice(0, 6);

  return (
    <Frame>
      <div className="agenda-summary">
        <div>
          <strong>{summary.today}</strong>
          <span>{t("agenda.today")}</span>
        </div>
        <div>
          <strong>{summary.total}</strong>
          <span>{t("agenda.upcoming")}</span>
        </div>
        <div className={summary.overdue > 0 ? "is-overdue" : undefined}>
          <strong>{summary.overdue}</strong>
          <span>{t("agenda.overdue")}</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="agenda-empty">{t("agenda.empty")}</p>
      ) : (
        <div className="agenda-list">
          {shown.map((ev) => {
            const time = eventTime(ev, timezone, locale);
            const when = ev.eventDate
              ? relativeDayLabel(ev.eventDate, today, locale)
              : null;
            return (
              <div className={`agenda-item is-${ev.dayBucket}`} key={ev.id}>
                <span className="agenda-when">
                  {ev.dayBucket === "overdue" ? (
                    <CalendarX2 size={15} strokeWidth={1.9} />
                  ) : time ? (
                    <Clock size={15} strokeWidth={1.9} />
                  ) : (
                    <CalendarClock size={15} strokeWidth={1.9} />
                  )}
                  <span>{time ?? when ?? t("common.none")}</span>
                </span>
                <span className="agenda-copy">
                  <strong>{ev.title}</strong>
                  <span>{ev.subtitle ?? t("common.none")}</span>
                </span>
                {when ? <span className="agenda-rel">{when}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {unavailable.length > 0 ? (
        <p className="agenda-footer-note">
          {t("agenda.partialSources", { sources: unavailable.join(", ") })}
        </p>
      ) : null}
    </Frame>
  );
}
