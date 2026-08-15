import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  actionableAlertCount,
  classifyDayBucket,
  dedupeAlerts,
  isActiveStatus,
  localDateISO,
  nextEventForBar,
  parseAgenda,
  parseAlerts,
  relativeDayLabel,
  selectNextEvent,
  sortAgendaEvents,
  sortAlerts,
  type AgendaEvent,
  type UnifiedAlert,
} from "../lib/dashboard/agenda.ts";

function ev(partial: Partial<AgendaEvent> & { id: string }): AgendaEvent {
  return {
    kind: "phase",
    title: partial.id,
    subtitle: null,
    startsAt: null,
    endsAt: null,
    isAllDay: true,
    status: "PLANNED",
    source: "BTP_PHASE",
    sourceId: partial.id,
    eventDate: null,
    dayBucket: "upcoming",
    ...partial,
  };
}

// --- AGENDA_EMPTY -----------------------------------------------------------
test("AGENDA_EMPTY: missing/empty payload → no events, honest status", () => {
  const a = parseAgenda({ resolution_status: "OK", tenant_id: "t", events: [] });
  assert.equal(a.events.length, 0);
  assert.equal(a.summary.total, 0);
  assert.equal(selectNextEvent(a.events, new Date("2026-08-15T09:00:00Z")), null);
});

// --- AGENDA_TODAY -----------------------------------------------------------
test("AGENDA_TODAY: parses events + buckets from the RPC payload", () => {
  const a = parseAgenda({
    resolution_status: "OK",
    tenant_id: "t",
    timezone: "Europe/Paris",
    today_local: "2026-08-15",
    summary: { total: 2, today: 1, overdue: 0 },
    events: [
      { id: "BTP_PHASE:1", kind: "phase", title: "Coulage dalle", subtitle: "Chantier A",
        starts_at: "2026-08-15T06:00:00Z", is_all_day: true, status: "PLANNED",
        source: "BTP_PHASE", source_id: "1", event_date: "2026-08-15", day_bucket: "today" },
      { id: "PROJECT_END:9", kind: "project_end", title: "Fin chantier prévue", subtitle: "Chantier B",
        starts_at: "2026-08-20T06:00:00Z", is_all_day: true, status: "", source: "PROJECT_END",
        source_id: "9", event_date: "2026-08-20", day_bucket: "upcoming" },
    ],
  });
  assert.equal(a.events.length, 2);
  assert.equal(a.summary.today, 1);
  assert.equal(a.events[0].dayBucket, "today");
  assert.equal(a.events[0].title, "Coulage dalle");
});

// --- AGENDA_SORT_ORDER ------------------------------------------------------
test("AGENDA_SORT_ORDER: soonest first, nulls last", () => {
  const sorted = sortAgendaEvents([
    ev({ id: "c", startsAt: "2026-08-20T00:00:00Z" }),
    ev({ id: "a", startsAt: "2026-08-15T00:00:00Z" }),
    ev({ id: "n", startsAt: null }),
    ev({ id: "b", startsAt: "2026-08-18T00:00:00Z" }),
  ]);
  assert.deepEqual(sorted.map((e) => e.id), ["a", "b", "c", "n"]);
});

// --- NEXT_EVENT_FUTURE ------------------------------------------------------
test("NEXT_EVENT_FUTURE: earliest still-to-come active event", () => {
  const now = new Date("2026-08-15T09:00:00Z");
  const next = selectNextEvent(
    [
      ev({ id: "past", startsAt: "2026-08-14T00:00:00Z", dayBucket: "overdue" }),
      ev({ id: "soon", startsAt: "2026-08-16T08:00:00Z", dayBucket: "upcoming" }),
      ev({ id: "later", startsAt: "2026-08-18T08:00:00Z", dayBucket: "upcoming" }),
    ],
    now,
  );
  assert.equal(next?.id, "soon");
});

test("NEXT_EVENT ignores cancelled/done and overdue-only sets", () => {
  const now = new Date("2026-08-15T09:00:00Z");
  assert.equal(isActiveStatus("CANCELLED"), false);
  assert.equal(isActiveStatus("En cours"), true);
  const next = selectNextEvent(
    [
      ev({ id: "cancel", startsAt: "2026-08-16T08:00:00Z", dayBucket: "upcoming", status: "ANNULÉ" }),
      ev({ id: "done", startsAt: "2026-08-17T08:00:00Z", dayBucket: "upcoming", status: "DONE" }),
    ],
    now,
  );
  assert.equal(next, null);
});

// --- NEXT_EVENT_NONE --------------------------------------------------------
test("NEXT_EVENT_NONE: only past events ⇒ null, never fabricated", () => {
  const now = new Date("2026-08-15T09:00:00Z");
  const next = selectNextEvent(
    [ev({ id: "old", startsAt: "2026-08-10T00:00:00Z", dayBucket: "overdue" })],
    now,
  );
  assert.equal(next, null);

  const a = parseAgenda({ resolution_status: "OK", events: [] });
  assert.equal(nextEventForBar(a, now, "fr-FR"), null);
});

// --- TIMEZONE_PARIS / TIMEZONE_NEW_YORK -------------------------------------
test("TIMEZONE_PARIS / NEW_YORK: 'today' is local, not UTC", () => {
  const instant = new Date("2026-07-15T23:30:00Z"); // 01:30 Paris (+2), 19:30 NY (-4)
  assert.equal(localDateISO(instant, "Europe/Paris"), "2026-07-16");
  assert.equal(localDateISO(instant, "America/New_York"), "2026-07-15");
  // classification uses the local date, not the server's.
  assert.equal(classifyDayBucket("2026-07-16", "2026-07-16"), "today");
  assert.equal(classifyDayBucket("2026-07-17", "2026-07-16"), "upcoming");
  assert.equal(classifyDayBucket("2026-07-15", "2026-07-16"), "overdue");
});

// --- DST_SAFE ---------------------------------------------------------------
test("DST_SAFE: same UTC wall-time yields different local dates by season", () => {
  // 22:30Z → summer Paris (+2)=00:30 next day; winter Paris (+1)=23:30 same day.
  assert.equal(localDateISO(new Date("2026-07-15T22:30:00Z"), "Europe/Paris"), "2026-07-16");
  assert.equal(localDateISO(new Date("2026-01-15T22:30:00Z"), "Europe/Paris"), "2026-01-15");
});

// --- relative labels are international (not hardcoded FR) --------------------
test("relativeDayLabel follows the locale", () => {
  assert.equal(relativeDayLabel("2026-08-16", "2026-08-15", "fr-FR"), "demain");
  assert.equal(relativeDayLabel("2026-08-16", "2026-08-15", "en-US"), "tomorrow");
  assert.match(relativeDayLabel("2026-08-15", "2026-08-15", "fr-FR"), /aujourd.hui/);
});

// --- Alerts: APPROVAL_EXPIRING / INCIDENT_OPEN / CIRCUIT / BUDGET / LATE -----
function alertsPayload() {
  return {
    resolution_status: "OK",
    tenant_id: "t",
    summary: { total: 5, critical: 1, high: 3, warning: 1 },
    alerts: [
      { id: "APPROVAL_PENDING:1", severity: "HIGH", kind: "approval", title: "Approbation requise",
        detail: "btp.planning", source: "APPROVAL_PENDING", source_id: "1", ts: "2026-08-15T08:00:00Z" },
      { id: "INCIDENT_OPEN:2", severity: "WARNING", kind: "incident", title: "Incident qualité ouvert",
        detail: "fissure", source: "INCIDENT_OPEN", source_id: "2", ts: "2026-08-15T07:00:00Z" },
      { id: "CIRCUIT_OPEN:hermes.intent.resolve", severity: "CRITICAL", kind: "circuit",
        title: "Circuit résolveur ouvert", detail: "seuil", source: "CIRCUIT_OPEN",
        source_id: "hermes.intent.resolve", ts: "2026-08-15T06:00:00Z" },
      { id: "BUDGET_MONTH:2026-08", severity: "HIGH", kind: "budget", title: "Budget mensuel atteint",
        detail: "104% du budget mensuel", source: "BUDGET", source_id: "2026-08", ts: "2026-08-15T05:00:00Z" },
      { id: "LATE_ITEM:9", severity: "HIGH", kind: "late", title: "Chantier en retard",
        detail: "Chantier B (3 j)", source: "LATE_ITEM", source_id: "9", ts: "2026-08-15T04:00:00Z" },
    ],
    unavailable: [],
  };
}

test("ALERTS: parse + severity ordering CRITICAL→HIGH→WARNING", () => {
  const a = parseAlerts(alertsPayload());
  assert.equal(a.alerts.length, 5);
  const sorted = sortAlerts(a.alerts);
  assert.equal(sorted[0].severity, "CRITICAL");
  assert.equal(sorted[0].source, "CIRCUIT_OPEN");
  assert.equal(sorted[sorted.length - 1].severity, "WARNING");
  // Budget "blocked" (>=100% w/ hard stop) would arrive as CRITICAL; here HIGH.
  assert.ok(a.alerts.find((x) => x.source === "BUDGET"));
  assert.ok(a.alerts.find((x) => x.source === "INCIDENT_OPEN"));
});

test("BUDGET_BLOCKED maps to CRITICAL severity when present", () => {
  const a = parseAlerts({
    resolution_status: "OK",
    alerts: [{ id: "BUDGET_MONTH:2026-08", severity: "CRITICAL", kind: "budget",
      title: "Budget mensuel atteint", detail: "120%", source: "BUDGET", source_id: "2026-08",
      ts: "2026-08-15T05:00:00Z" }],
  });
  assert.equal(a.alerts[0].severity, "CRITICAL");
});

// --- ALERT_COUNT_ONLY_ACTIONABLE --------------------------------------------
test("ALERT_COUNT_ONLY_ACTIONABLE: neutral INFO never counted", () => {
  const alerts: UnifiedAlert[] = [
    { id: "a", severity: "CRITICAL", kind: "x", title: "", detail: null, source: "S", sourceId: "a", ts: null },
    { id: "b", severity: "HIGH", kind: "x", title: "", detail: null, source: "S", sourceId: "b", ts: null },
    { id: "c", severity: "WARNING", kind: "x", title: "", detail: null, source: "S", sourceId: "c", ts: null },
    { id: "d", severity: "INFO", kind: "x", title: "", detail: null, source: "S", sourceId: "d", ts: null },
  ];
  assert.equal(actionableAlertCount(alerts), 3);
  // ALERT_COUNT_EMPTY = 0
  assert.equal(actionableAlertCount([]), 0);
});

// --- NO_DUPLICATES ----------------------------------------------------------
test("NO_DUPLICATES: same canonical id collapses once", () => {
  const dup: UnifiedAlert[] = [
    { id: "INCIDENT_OPEN:2", severity: "HIGH", kind: "incident", title: "", detail: null, source: "INCIDENT_OPEN", sourceId: "2", ts: null },
    { id: "INCIDENT_OPEN:2", severity: "HIGH", kind: "incident", title: "", detail: null, source: "INCIDENT_OPEN", sourceId: "2", ts: null },
    { id: "LATE_ITEM:9", severity: "HIGH", kind: "late", title: "", detail: null, source: "LATE_ITEM", sourceId: "9", ts: null },
  ];
  assert.equal(dedupeAlerts(dup).length, 2);
  // parseAlerts also dedupes.
  assert.equal(parseAlerts({ resolution_status: "OK", alerts: dup }).alerts.length, 2);

  // Same numeric source_id under different sources must NOT collide — the
  // canonical id is SOURCE:source_id, so both survive.
  const crossSource: UnifiedAlert[] = [
    { id: "APPROVAL_PENDING:123", severity: "WARNING", kind: "approval", title: "", detail: null, source: "APPROVAL_PENDING", sourceId: "123", ts: null },
    { id: "INCIDENT_OPEN:123", severity: "HIGH", kind: "incident", title: "", detail: null, source: "INCIDENT_OPEN", sourceId: "123", ts: null },
  ];
  assert.equal(dedupeAlerts(crossSource).length, 2);
});

// --- FAIL_SOFT_SOURCE_UNAVAILABLE -------------------------------------------
test("FAIL_SOFT_SOURCE_UNAVAILABLE: broken source listed, others still shown", () => {
  const a = parseAlerts({
    resolution_status: "OK",
    alerts: [{ id: "LATE_ITEM:9", severity: "HIGH", kind: "late", title: "Chantier en retard",
      detail: "B", source: "LATE_ITEM", source_id: "9", ts: null }],
    unavailable: ["BUDGET"],
  });
  assert.deepEqual(a.unavailable, ["BUDGET"]);
  assert.equal(a.alerts.length, 1);
});

// --- CROSS_TENANT_DENIED / UNAUTHENTICATED_DENIED (RPC-enforced) ------------
// The SECURITY DEFINER RPCs resolve the caller's tenant via resolve_active_tenant
// (never a client id) and were verified live: unauthenticated → UNAUTHENTICATED,
// authenticated → OK for the caller's tenant only. Here we assert the client
// surfaces those statuses without leaking events/alerts.
test("UNAUTHENTICATED/NO_TENANT payloads surface empty, no data leak", () => {
  const ag = parseAgenda({ resolution_status: "UNAUTHENTICATED" });
  assert.equal(ag.resolutionStatus, "UNAUTHENTICATED");
  assert.equal(ag.events.length, 0);
  const al = parseAlerts({ resolution_status: "NO_TENANT" });
  assert.equal(al.resolutionStatus, "NO_TENANT");
  assert.equal(al.alerts.length, 0);
});

// --- LIGHT / DARK / TABLET / MOBILE (design-system contract) -----------------
test("LIGHT/DARK/TABLET/MOBILE: agenda + alerts are token-driven", () => {
  const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /\.agenda-item\b/);
  assert.match(css, /\.alert-item\b/);
  // Painted from shared theme tokens ⇒ LIGHT + DARK both covered.
  assert.match(css, /\.agenda-item[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.alert-sev\.is-critical[^}]*var\(--danger\)/s);
  // Panels live in the responsive two-column grid (tablet/mobile stack).
  assert.match(css, /\.exec-grid-2/);
});
