/**
 * DASH-4G — "Résumé du jour": a deterministic SYNTHESIS (counts + next event + weather)
 * built purely from snapshots ALREADY loaded by the dashboard. No fetch, no LLM.
 *
 * Distinction (see recommendedActions.ts): notifications = raw signal, this résumé =
 * synthesis (how many / what's next), recommended actions = what to do.
 */

import {
  actionableAlertCount,
  isActiveStatus,
  relativeDayLabel,
  sortAgendaEvents,
  type DashboardAgenda,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import {
  worksiteRiskLevel,
  type WeatherRiskLevel,
  type WorksiteWeather,
} from "@/lib/dashboard/worksiteWeather";
import type {
  DashboardProjects,
  OperationalPriorities,
} from "@/types/hermes";
import type { DashboardCommercial } from "@/lib/dashboard/systemActivity";

export type DailySummary = {
  agenda: {
    today: number;
    overdue: number;
    nextEvent: { title: string; whenLabel: string | null } | null;
  } | null;
  priorities: {
    pendingApprovals: number;
    openIncidents: number;
    late: number;
    toQualify: number;
  } | null;
  chantiersActive: number | null;
  alerts: { critical: number; high: number; warning: number; actionable: number } | null;
  devisToFollowUp: number | null;
  weather: { worksites: number; atRisk: number; level: WeatherRiskLevel | null } | null;
  /** True when at least one section carries real data (else the widget shows empty). */
  hasContent: boolean;
};

export type DailySummaryInputs = {
  agenda: DashboardAgenda | null;
  priorities: OperationalPriorities | null;
  projects: DashboardProjects | null;
  alerts: UnifiedAlerts | null;
  commercial: DashboardCommercial | null;
  worksiteWeather: WorksiteWeather[] | null;
  locale: string;
};

/** The soonest active today/upcoming event, without needing a clock (server-derived dates). */
function pickNextEvent(
  agenda: DashboardAgenda,
  locale: string,
): { title: string; whenLabel: string | null } | null {
  const cands = sortAgendaEvents(
    agenda.events.filter(
      (e) => (e.dayBucket === "today" || e.dayBucket === "upcoming") && isActiveStatus(e.status),
    ),
  );
  const ev = cands[0];
  if (!ev) return null;
  const whenLabel =
    ev.eventDate && agenda.todayLocal
      ? relativeDayLabel(ev.eventDate, agenda.todayLocal, locale)
      : null;
  return { title: ev.title, whenLabel };
}

export function buildDailySummary(inputs: DailySummaryInputs): DailySummary {
  const okAgenda =
    inputs.agenda && inputs.agenda.resolutionStatus === "OK" ? inputs.agenda : null;
  const okPriorities =
    inputs.priorities && inputs.priorities.resolutionStatus === "OK"
      ? inputs.priorities
      : null;
  const okProjects =
    inputs.projects && inputs.projects.resolutionStatus === "OK" ? inputs.projects : null;
  const okAlerts =
    inputs.alerts && inputs.alerts.resolutionStatus === "OK" ? inputs.alerts : null;
  const okCommercial =
    inputs.commercial && inputs.commercial.resolutionStatus === "OK"
      ? inputs.commercial
      : null;

  const agenda = okAgenda
    ? {
        today: okAgenda.summary.today,
        overdue: okAgenda.summary.overdue,
        nextEvent: pickNextEvent(okAgenda, inputs.locale),
      }
    : null;

  const priorities = okPriorities
    ? {
        pendingApprovals: okPriorities.summary.pendingApprovals,
        openIncidents: okPriorities.summary.openIncidents,
        late: okPriorities.summary.late,
        toQualify: okPriorities.summary.toQualify,
      }
    : null;

  const chantiersActive = okProjects
    ? okProjects.projects.filter((p) => isActiveStatus(p.status)).length
    : null;

  const alerts = okAlerts
    ? {
        critical: okAlerts.summary.critical,
        high: okAlerts.summary.high,
        warning: okAlerts.summary.warning,
        actionable: actionableAlertCount(okAlerts.alerts),
      }
    : null;

  const devisToFollowUp = okCommercial ? okCommercial.toFollowUp : null;

  const weather = inputs.worksiteWeather
    ? (() => {
        const atRisk = inputs.worksiteWeather!.filter((w) => w.risks.length > 0);
        const level: WeatherRiskLevel | null = atRisk.some(
          (w) => worksiteRiskLevel(w.risks) === "HIGH",
        )
          ? "HIGH"
          : atRisk.length > 0
            ? "WARNING"
            : null;
        return { worksites: inputs.worksiteWeather!.length, atRisk: atRisk.length, level };
      })()
    : null;

  const hasContent =
    agenda !== null ||
    priorities !== null ||
    chantiersActive !== null ||
    alerts !== null ||
    devisToFollowUp !== null ||
    (weather !== null && weather.worksites > 0);

  return {
    agenda,
    priorities,
    chantiersActive,
    alerts,
    devisToFollowUp,
    weather,
    hasContent,
  };
}
