/**
 * DASH-4G — "Actions recommandées": a deterministic TO-DO list derived by EXPLICIT
 * rules from snapshots already loaded (+ the enriched worksite weather). Pure, no LLM,
 * no fetch. Each action carries a reason, a priority, its source, and a deep-link.
 *
 * Distinction: notifications = raw signal, résumé = synthesis, THESE = what to do. The
 * UI text is i18n keys + params (counts + CANONICAL business names), never hardcoded,
 * so business data stays canonical while chrome is translated.
 */

import {
  isActiveStatus,
  type DashboardAgenda,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import { worksiteRiskLevel, type WorksiteWeather } from "@/lib/dashboard/worksiteWeather";
import type {
  CostGovernanceSnapshot,
  OperationalPriorities,
} from "@/types/hermes";
import type { DashboardCommercial } from "@/lib/dashboard/systemActivity";

export type ActionPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const ACTION_PRIORITY_RANK: Record<ActionPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export type RecommendedAction = {
  id: string;
  kind: string;
  priority: ActionPriority;
  source: string;
  /** i18n key for the title; render with `params`. */
  titleKey: string;
  /** i18n key for the "why". */
  reasonKey: string;
  /** Interpolation params (counts + CANONICAL names — names are not translated). */
  params: Record<string, string | number>;
  /** Dashboard widget id to deep-link to, or null. */
  targetWidget: string | null;
};

export const MAX_RECOMMENDED_ACTIONS = 12;

export type RecommendedActionsInputs = {
  agenda: DashboardAgenda | null;
  priorities: OperationalPriorities | null;
  alerts: UnifiedAlerts | null;
  cost: CostGovernanceSnapshot | null;
  commercial: DashboardCommercial | null;
  worksiteWeather: WorksiteWeather[] | null;
};

/** Add whole days to a YYYY-MM-DD date, UTC-anchored (deterministic, no clock). */
export function addDaysISO(dateISO: string, days: number): string | null {
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

function okOf<T extends { resolutionStatus: string }>(v: T | null): T | null {
  return v && v.resolutionStatus === "OK" ? v : null;
}

export function buildRecommendedActions(
  inputs: RecommendedActionsInputs,
): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  const agenda = okOf(inputs.agenda);
  const priorities = okOf(inputs.priorities);
  const alerts = okOf(inputs.alerts);
  const cost = okOf(inputs.cost);
  const commercial = okOf(inputs.commercial);

  // Incident critique (most severe) ---------------------------------------
  const criticalAlerts = alerts ? alerts.summary.critical : 0;
  const openIncidents = priorities ? priorities.summary.openIncidents : 0;
  if (criticalAlerts > 0) {
    out.push({
      id: "incident-critical",
      kind: "incident",
      priority: "CRITICAL",
      source: "alerts",
      titleKey: "actions.incident.title",
      reasonKey: "actions.incident.reason",
      params: { count: criticalAlerts },
      targetWidget: "alerts",
    });
  } else if (openIncidents > 0) {
    out.push({
      id: "incident-open",
      kind: "incident",
      priority: "HIGH",
      source: "priorities",
      titleKey: "actions.incidentOpen.title",
      reasonKey: "actions.incidentOpen.reason",
      params: { count: openIncidents },
      targetWidget: "system-status",
    });
  }

  // Budget proche de la limite -------------------------------------------
  if (cost && cost.resolutionStatus === "OK") {
    const s = cost.governanceState;
    if (s === "BLOCKED" || s === "HARD_LIMIT") {
      out.push({
        id: "budget-hard",
        kind: "budget",
        priority: "CRITICAL",
        source: "cost",
        titleKey: "actions.budgetHard.title",
        reasonKey: "actions.budgetHard.reason",
        params: {},
        targetWidget: "cost",
      });
    } else if (s === "SOFT_LIMIT") {
      out.push({
        id: "budget-soft",
        kind: "budget",
        priority: "HIGH",
        source: "cost",
        titleKey: "actions.budget.title",
        reasonKey: "actions.budget.reason",
        params: {},
        targetWidget: "cost",
      });
    } else if (s === "WARNING") {
      out.push({
        id: "budget-warn",
        kind: "budget",
        priority: "MEDIUM",
        source: "cost",
        titleKey: "actions.budget.title",
        reasonKey: "actions.budget.reason",
        params: {},
        targetWidget: "cost",
      });
    }
  }

  // Approbations en attente ----------------------------------------------
  const pendingApprovals = priorities ? priorities.summary.pendingApprovals : 0;
  if (pendingApprovals > 0) {
    out.push({
      id: "approvals-pending",
      kind: "approval",
      priority: "HIGH",
      source: "priorities",
      titleKey: "actions.approvals.title",
      reasonKey: "actions.approvals.reason",
      params: { count: pendingApprovals },
      targetWidget: "approvals",
    });
  }

  // Chantiers / tâches en retard -----------------------------------------
  const late = priorities ? priorities.summary.late : 0;
  const overdue = agenda ? agenda.summary.overdue : 0;
  const lateTotal = Math.max(late, overdue);
  if (lateTotal > 0) {
    out.push({
      id: "late-items",
      kind: "late",
      priority: "HIGH",
      source: "priorities",
      titleKey: "actions.late.title",
      reasonKey: "actions.late.reason",
      params: { count: lateTotal },
      targetWidget: "projects",
    });
  }

  // Météo chantier risquée -----------------------------------------------
  if (inputs.worksiteWeather && inputs.worksiteWeather.length > 0) {
    const atRisk = inputs.worksiteWeather.filter((w) => w.risks.length > 0);
    if (atRisk.length > 0) {
      const anyHigh = atRisk.some((w) => worksiteRiskLevel(w.risks) === "HIGH");
      out.push({
        id: "weather-risk",
        kind: "weather",
        priority: anyHigh ? "HIGH" : "MEDIUM",
        source: "weather",
        titleKey: "actions.weather.title",
        reasonKey: "actions.weather.reason",
        params: {
          count: atRisk.length,
          names: atRisk
            .slice(0, 3)
            .map((w) => w.name)
            .join(", "),
        },
        targetWidget: "chantiers-map",
      });
    }
  }

  // Chantier demain -------------------------------------------------------
  if (agenda && agenda.todayLocal) {
    const tomorrow = addDaysISO(agenda.todayLocal, 1);
    const ev = tomorrow
      ? agenda.events.find(
          (e) => e.eventDate === tomorrow && isActiveStatus(e.status),
        )
      : undefined;
    if (ev) {
      out.push({
        id: `chantier-tomorrow:${ev.id}`,
        kind: "tomorrow",
        priority: "MEDIUM",
        source: "agenda",
        titleKey: "actions.tomorrow.title",
        reasonKey: "actions.tomorrow.reason",
        params: { name: ev.title },
        targetWidget: "agenda",
      });
    }
  }

  // Devis à relancer (aggregate count — no per-devis list exists) ----------
  if (commercial && commercial.toFollowUp > 0) {
    out.push({
      id: "devis-followup",
      kind: "devis",
      priority: "MEDIUM",
      source: "commercial",
      titleKey: "actions.devis.title",
      reasonKey: "actions.devis.reason",
      params: { count: commercial.toFollowUp },
      targetWidget: "commercial",
    });
  }

  return out
    .sort((a, b) => ACTION_PRIORITY_RANK[a.priority] - ACTION_PRIORITY_RANK[b.priority])
    .slice(0, MAX_RECOMMENDED_ACTIONS);
}
