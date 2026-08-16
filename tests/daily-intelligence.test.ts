import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { AgendaEvent, DashboardAgenda, UnifiedAlerts } from "../lib/dashboard/agenda.ts";
import type { DashboardCommercial } from "../lib/dashboard/systemActivity.ts";
import type {
  CostGovernanceSnapshot,
  DashboardProjects,
  OperationalPriorities,
} from "../types/hermes.ts";
import {
  atRiskWorksites,
  classifyWorksiteWeather,
  worksiteRiskLevel,
  WORKSITE_WEATHER_THRESHOLDS,
  type WorksiteWeather,
} from "../lib/dashboard/worksiteWeather.ts";
import { buildDailySummary } from "../lib/dashboard/dailySummary.ts";
import {
  addDaysISO,
  buildRecommendedActions,
  MAX_RECOMMENDED_ACTIONS,
} from "../lib/dashboard/recommendedActions.ts";

// --- fixtures ----------------------------------------------------------------
function evt(o: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id: "e", kind: "event", title: "", subtitle: null, startsAt: null, endsAt: null,
    isAllDay: false, status: null, source: "", sourceId: "", eventDate: null,
    dayBucket: "upcoming", ...o,
  };
}
function agenda(o: Partial<DashboardAgenda> = {}): DashboardAgenda {
  return {
    resolutionStatus: "OK", tenantId: "t", timezone: "UTC", todayLocal: "2026-08-16",
    summary: { total: 0, today: 0, overdue: 0 }, events: [], unavailable: [], ...o,
  };
}
function priorities(o: Partial<OperationalPriorities["summary"]> = {}): OperationalPriorities {
  return {
    resolutionStatus: "OK", tenantId: "t",
    summary: { pendingApprovals: 0, openIncidents: 0, toQualify: 0, late: 0, ...o },
    items: [],
  } as OperationalPriorities;
}
function alerts(o: Partial<UnifiedAlerts["summary"]> = {}): UnifiedAlerts {
  return {
    resolutionStatus: "OK", tenantId: "t", alerts: [],
    summary: { total: 0, critical: 0, high: 0, warning: 0, ...o }, unavailable: [],
  };
}
function commercial(o: Partial<DashboardCommercial> = {}): DashboardCommercial {
  return {
    resolutionStatus: "OK", tenantId: "t", currency: "EUR", total: 0, sent: 0,
    toFollowUp: 0, accepted: 0, amountSentTtcEur: 0, amountAcceptedTtcEur: 0, ...o,
  };
}
function projects(list: { status: string | null }[]): DashboardProjects {
  return {
    resolutionStatus: "OK", tenantId: "t",
    projects: list.map((p, i) => ({ id: `p${i}`, chantierName: null, clientName: null, typeChantier: null, status: p.status, coutEstimeEur: null, coutReelEur: null, progressionPct: null, dateDebutPlanifie: null, dateFinPlanifiee: null })),
    aggregates: { totalProjects: list.length, byStatus: {}, totalEstimatedValueEur: 0 },
  } as unknown as DashboardProjects;
}
function cost(state: string): CostGovernanceSnapshot {
  return { resolutionStatus: "OK", governanceState: state } as unknown as CostGovernanceSnapshot;
}
function ww(o: Partial<WorksiteWeather> = {}): WorksiteWeather {
  return { chantierId: "c", name: "Chantier", temperatureC: 20, windKph: 10, precipitationMm: 0, condition: "", icon: "", risks: [], ...o };
}

// ============================ WORKSITE WEATHER ==============================
test("classifyWorksiteWeather: explicit thresholds → risk flags", () => {
  const T = WORKSITE_WEATHER_THRESHOLDS;
  assert.deepEqual(classifyWorksiteWeather({ temperatureC: 20, windKph: 10, precipitationMm: 0 }), [], "calm ⇒ no risk");
  assert.equal(classifyWorksiteWeather({ temperatureC: 20, windKph: 10, precipitationMm: T.heavyRainMm }).find((r) => r.kind === "PLUIE_FORTE")?.level, "HIGH");
  assert.equal(classifyWorksiteWeather({ temperatureC: 20, windKph: T.strongWindKph, precipitationMm: 0 }).find((r) => r.kind === "VENT_FORT")?.level, "HIGH");
  assert.equal(classifyWorksiteWeather({ temperatureC: T.heatC, windKph: 0, precipitationMm: 0 }).find((r) => r.kind === "CHALEUR")?.level, "WARNING");
  assert.equal(classifyWorksiteWeather({ temperatureC: T.frostC, windKph: 0, precipitationMm: 0 }).find((r) => r.kind === "FROID")?.level, "WARNING");
  // just below thresholds ⇒ nothing
  assert.deepEqual(classifyWorksiteWeather({ temperatureC: 32.9, windKph: 39.9, precipitationMm: 3.9 }), []);
  // null readings ⇒ nothing (never fabricate)
  assert.deepEqual(classifyWorksiteWeather({ temperatureC: null, windKph: null, precipitationMm: null }), []);
});

test("worksiteRiskLevel + atRiskWorksites: HIGH dominates, sorted HIGH first", () => {
  assert.equal(worksiteRiskLevel([]), null);
  assert.equal(worksiteRiskLevel(classifyWorksiteWeather({ temperatureC: 35, windKph: 0, precipitationMm: 0 })), "WARNING");
  assert.equal(worksiteRiskLevel(classifyWorksiteWeather({ temperatureC: 35, windKph: 50, precipitationMm: 0 })), "HIGH");
  const list = [
    ww({ chantierId: "calm", risks: [] }),
    ww({ chantierId: "warm", risks: classifyWorksiteWeather({ temperatureC: 35, windKph: 0, precipitationMm: 0 }) }),
    ww({ chantierId: "windy", risks: classifyWorksiteWeather({ temperatureC: 20, windKph: 60, precipitationMm: 0 }) }),
  ];
  const at = atRiskWorksites(list);
  assert.deepEqual(at.map((w) => w.chantierId), ["windy", "warm"], "at-risk only, HIGH first");
});

// ============================ DAILY SUMMARY ================================
test("buildDailySummary: synthesises counts, next event, weather", () => {
  const s = buildDailySummary({
    agenda: agenda({ summary: { total: 5, today: 2, overdue: 1 }, events: [
      evt({ id: "later", title: "Réunion", dayBucket: "upcoming", status: "PLANNED", startsAt: "2026-08-18T09:00:00Z", eventDate: "2026-08-18" }),
      evt({ id: "soon", title: "Coulage dalle", dayBucket: "today", status: "PLANNED", startsAt: "2026-08-16T08:00:00Z", eventDate: "2026-08-16" }),
    ] }),
    priorities: priorities({ pendingApprovals: 3, openIncidents: 1, late: 2, toQualify: 4 }),
    projects: projects([{ status: "EN_COURS" }, { status: "TERMINE" }, { status: null }]),
    alerts: alerts({ critical: 1, high: 2, warning: 3 }),
    commercial: commercial({ toFollowUp: 7 }),
    worksiteWeather: [
      ww({ risks: classifyWorksiteWeather({ temperatureC: 35, windKph: 60, precipitationMm: 0 }) }),
      ww({ risks: [] }),
    ],
    locale: "fr-FR",
  });
  assert.equal(s.agenda?.today, 2);
  assert.equal(s.agenda?.overdue, 1);
  assert.equal(s.agenda?.nextEvent?.title, "Coulage dalle", "earliest active today/upcoming");
  assert.deepEqual(s.priorities, { pendingApprovals: 3, openIncidents: 1, late: 2, toQualify: 4 });
  assert.equal(s.chantiersActive, 2, "EN_COURS + null active; TERMINE excluded");
  assert.deepEqual(s.alerts, { critical: 1, high: 2, warning: 3, actionable: 0 });
  assert.equal(s.devisToFollowUp, 7);
  assert.deepEqual(s.weather, { worksites: 2, atRisk: 1, level: "HIGH" });
  assert.equal(s.hasContent, true);
});

test("buildDailySummary: unavailable inputs ⇒ null sections, hasContent false", () => {
  const s = buildDailySummary({
    agenda: { resolutionStatus: "NO_TENANT" } as DashboardAgenda,
    priorities: null, projects: null, alerts: null, commercial: null,
    worksiteWeather: null, locale: "fr-FR",
  });
  assert.equal(s.agenda, null);
  assert.equal(s.priorities, null);
  assert.equal(s.chantiersActive, null);
  assert.equal(s.weather, null);
  assert.equal(s.hasContent, false);
});

// ========================= RECOMMENDED ACTIONS =============================
test("addDaysISO: UTC-anchored, deterministic", () => {
  assert.equal(addDaysISO("2026-08-16", 1), "2026-08-17");
  assert.equal(addDaysISO("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysISO("bad", 1), null);
});

test("buildRecommendedActions: deterministic rules, priority-sorted, with reason/source/deep-link", () => {
  const actions = buildRecommendedActions({
    agenda: agenda({ summary: { total: 3, today: 1, overdue: 2 }, todayLocal: "2026-08-16", events: [
      evt({ id: "tmrw", title: "Chantier Villa", eventDate: "2026-08-17", status: "PLANNED", dayBucket: "upcoming" }),
    ] }),
    priorities: priorities({ pendingApprovals: 2, openIncidents: 0, late: 2 }),
    alerts: alerts({ critical: 1 }),
    cost: cost("WARNING"),
    commercial: commercial({ toFollowUp: 4 }),
    worksiteWeather: [ww({ risks: classifyWorksiteWeather({ temperatureC: 20, windKph: 60, precipitationMm: 0 }) })],
  });
  const byKind = Object.fromEntries(actions.map((a) => [a.kind, a]));
  assert.ok(byKind.incident && byKind.incident.priority === "CRITICAL");
  assert.ok(byKind.approval && byKind.approval.priority === "HIGH" && byKind.approval.targetWidget === "approvals");
  assert.ok(byKind.late && byKind.late.params.count === 2 && byKind.late.targetWidget === "projects");
  assert.ok(byKind.weather && byKind.weather.priority === "HIGH" && byKind.weather.targetWidget === "chantiers-map");
  assert.ok(byKind.budget && byKind.budget.priority === "MEDIUM");
  assert.ok(byKind.tomorrow && byKind.tomorrow.params.name === "Chantier Villa" && byKind.tomorrow.targetWidget === "agenda");
  assert.ok(byKind.devis && byKind.devis.params.count === 4 && byKind.devis.targetWidget === "commercial");
  // every action has reason + title keys + a source
  for (const a of actions) {
    assert.ok(a.titleKey.startsWith("actions."));
    assert.ok(a.reasonKey.startsWith("actions."));
    assert.ok(a.source.length > 0);
  }
  // priority-sorted (CRITICAL first)
  assert.equal(actions[0].priority, "CRITICAL");
  const ranks = actions.map((a) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.priority));
  assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), "sorted by priority");
});

test("buildRecommendedActions: budget state → priority; empty inputs ⇒ no actions", () => {
  assert.equal(buildRecommendedActions({ agenda: null, priorities: null, alerts: null, cost: cost("BLOCKED"), commercial: null, worksiteWeather: null })[0].priority, "CRITICAL");
  assert.equal(buildRecommendedActions({ agenda: null, priorities: null, alerts: null, cost: cost("SOFT_LIMIT"), commercial: null, worksiteWeather: null })[0].priority, "HIGH");
  assert.equal(buildRecommendedActions({ agenda: null, priorities: null, alerts: null, cost: cost("NORMAL"), commercial: null, worksiteWeather: null }).length, 0);
  assert.deepEqual(buildRecommendedActions({ agenda: null, priorities: null, alerts: null, cost: null, commercial: null, worksiteWeather: null }), []);
});

test("buildRecommendedActions: bounded to MAX", () => {
  // Many at-risk worksites still collapse to ONE weather action; assert overall cap holds.
  const actions = buildRecommendedActions({
    agenda: agenda({ summary: { total: 0, today: 0, overdue: 9 }, todayLocal: "2026-08-16" }),
    priorities: priorities({ pendingApprovals: 5, openIncidents: 3, late: 9 }),
    alerts: alerts({ critical: 2 }),
    cost: cost("HARD_LIMIT"),
    commercial: commercial({ toFollowUp: 3 }),
    worksiteWeather: Array.from({ length: 20 }, () => ww({ risks: classifyWorksiteWeather({ temperatureC: 40, windKph: 0, precipitationMm: 0 }) })),
  });
  assert.ok(actions.length <= MAX_RECOMMENDED_ACTIONS);
});

// --- purity ------------------------------------------------------------------
test("pure modules: no fetch / network / LLM", () => {
  for (const f of ["../lib/dashboard/worksiteWeather.ts", "../lib/dashboard/dailySummary.ts", "../lib/dashboard/recommendedActions.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} fetch`);
    assert.doesNotMatch(src, /https?:\/\//, `${f} url`);
    assert.doesNotMatch(src, /openai|anthropic|supabase/i, `${f} sdk`);
  }
});

test("CSS: summary + actions surfaces present (glass, semantic priority colours)", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  for (const cls of [
    ".summary-grid", ".summary-stat", ".summary-weather-risk.is-high",
    ".actions-list", ".action-item.is-critical", ".action-prio-label", ".action-link",
  ]) {
    assert.ok(css.includes(cls), `missing CSS ${cls}`);
  }
});
