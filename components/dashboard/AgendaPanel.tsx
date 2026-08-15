import { CalendarClock, CalendarX2, Clock } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  relativeDayLabel,
  sortAgendaEvents,
  type AgendaEvent,
  type DashboardAgenda,
} from "@/lib/dashboard/agenda";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  agenda: ServiceResult<DashboardAgenda>;
  locale: string;
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card agenda-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">AGENDA</span>
          <h3>Agenda du jour</h3>
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
  if (!agenda.ok || agenda.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="agenda-empty">
          L’agenda est indisponible pour le moment.
        </p>
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
          <span>aujourd’hui</span>
        </div>
        <div>
          <strong>{summary.total}</strong>
          <span>à venir</span>
        </div>
        <div className={summary.overdue > 0 ? "is-overdue" : undefined}>
          <strong>{summary.overdue}</strong>
          <span>en retard</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="agenda-empty">Aucun événement planifié à venir.</p>
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
                  <span>{time ?? when ?? "—"}</span>
                </span>
                <span className="agenda-copy">
                  <strong>{ev.title}</strong>
                  <span>{ev.subtitle ?? "—"}</span>
                </span>
                {when ? <span className="agenda-rel">{when}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {unavailable.length > 0 ? (
        <p className="agenda-footer-note">
          Sources partiellement indisponibles : {unavailable.join(", ")}.
        </p>
      ) : null}
    </Frame>
  );
}
