/**
 * DASH-2 — Agenda du jour + prochain événement + alertes/priorités unifiées.
 * Pure, DOM-free, deterministic logic (no LLM, no I/O). Parses the two DASH-2
 * RPC payloads and derives the "next event" + actionable alert count used by the
 * DASH-1 context bar. International-ready: relative day labels come from
 * `Intl.RelativeTimeFormat(locale)`, never hardcoded French.
 */

import type { ContextNextEvent } from "@/lib/dashboard/contextBar";

// --- Agenda -----------------------------------------------------------------

export type AgendaDayBucket = "today" | "upcoming" | "overdue";

export type AgendaEvent = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  startsAt: string | null; // ISO timestamptz
  endsAt: string | null;
  isAllDay: boolean;
  status: string | null;
  source: string; // BTP_PHASE | PROJECT_START | PROJECT_END | APPROVAL_EXPIRY
  sourceId: string;
  eventDate: string | null; // YYYY-MM-DD (local to tenant tz)
  dayBucket: AgendaDayBucket;
};

export type DashboardAgenda = {
  resolutionStatus: string;
  tenantId: string | null;
  timezone: string;
  todayLocal: string | null;
  summary: { total: number; today: number; overdue: number };
  events: AgendaEvent[];
  unavailable: string[];
};

const DONE_STATUSES = new Set([
  "DONE",
  "TERMINE",
  "TERMINÉ",
  "FINI",
  "CANCELLED",
  "ANNULE",
  "ANNULÉ",
  "REJECTED",
  "REFUSE",
  "REFUSÉ",
]);

/** An event still "live" — not completed/cancelled. */
export function isActiveStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return !DONE_STATUSES.has(status.toUpperCase());
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toBucket(v: unknown): AgendaDayBucket {
  return v === "today" || v === "overdue" ? v : "upcoming";
}

export function parseAgenda(payload: unknown): DashboardAgenda {
  const p = (payload ?? {}) as Record<string, unknown>;
  const rawEvents = Array.isArray(p.events)
    ? (p.events as Record<string, unknown>[])
    : [];
  const events: AgendaEvent[] = rawEvents.map((e) => ({
    id: String(e.id ?? `${e.source}:${e.source_id}`),
    kind: String(e.kind ?? "event"),
    title: String(e.title ?? ""),
    subtitle: asString(e.subtitle),
    startsAt: asString(e.starts_at),
    endsAt: asString(e.ends_at),
    isAllDay: Boolean(e.is_all_day),
    status: asString(e.status),
    source: String(e.source ?? ""),
    sourceId: String(e.source_id ?? ""),
    eventDate: asString(e.event_date),
    dayBucket: toBucket(e.day_bucket),
  }));
  const summary = (p.summary ?? {}) as Record<string, unknown>;
  return {
    resolutionStatus: String(p.resolution_status ?? "NO_TENANT"),
    tenantId: asString(p.tenant_id),
    timezone: String(p.timezone ?? "UTC"),
    todayLocal: asString(p.today_local),
    summary: {
      total: Number(summary.total ?? events.length) || 0,
      today: Number(summary.today ?? 0) || 0,
      overdue: Number(summary.overdue ?? 0) || 0,
    },
    events,
    unavailable: Array.isArray(p.unavailable)
      ? (p.unavailable as unknown[]).map(String)
      : [],
  };
}

/** Local calendar date (YYYY-MM-DD) for an instant in a timezone. DST-safe. */
export function localDateISO(instant: Date, timezone: string): string {
  try {
    // en-CA renders ISO-style YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

/** Whole-day difference eventDate − today (both YYYY-MM-DD), UTC-anchored. */
export function dayDiff(eventDateISO: string, todayISO: string): number {
  const a = Date.parse(`${eventDateISO}T00:00:00Z`);
  const b = Date.parse(`${todayISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

export function classifyDayBucket(
  eventDateISO: string,
  todayISO: string,
): AgendaDayBucket {
  const d = dayDiff(eventDateISO, todayISO);
  if (d === 0) return "today";
  return d > 0 ? "upcoming" : "overdue";
}

/** Localised relative label ("aujourd'hui", "demain", "in 3 days", "hier"…). */
export function relativeDayLabel(
  eventDateISO: string,
  todayISO: string,
  locale = "fr-FR",
): string {
  const d = dayDiff(eventDateISO, todayISO);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      d,
      "day",
    );
  } catch {
    if (d === 0) return "today";
    return d > 0 ? `in ${d} d` : `${-d} d ago`;
  }
}

/** Soonest-first, nulls last. Stable. */
export function sortAgendaEvents(events: AgendaEvent[]): AgendaEvent[] {
  return [...events].sort((a, b) => {
    if (a.startsAt === b.startsAt) return 0;
    if (!a.startsAt) return 1;
    if (!b.startsAt) return -1;
    return a.startsAt < b.startsAt ? -1 : 1;
  });
}

/**
 * Deterministic next-event pick: among active events that are today or upcoming,
 * the earliest still-to-come (`startsAt >= now`); if all of today's have already
 * started, the earliest ongoing today event; else none. Overdue never counts as
 * "next".
 */
export function selectNextEvent(
  events: AgendaEvent[],
  now: Date,
): AgendaEvent | null {
  const nowIso = now.toISOString();
  const candidates = sortAgendaEvents(
    events.filter(
      (e) =>
        (e.dayBucket === "today" || e.dayBucket === "upcoming") &&
        isActiveStatus(e.status),
    ),
  );
  if (candidates.length === 0) return null;
  const future = candidates.find((e) => (e.startsAt ?? "") >= nowIso);
  if (future) return future;
  const ongoingToday = candidates.find((e) => e.dayBucket === "today");
  return ongoingToday ?? null;
}

/** Next-event view model for the DASH-1 context bar (label + relative when). */
export function nextEventForBar(
  agenda: DashboardAgenda,
  now: Date,
  locale = "fr-FR",
): ContextNextEvent | null {
  const ev = selectNextEvent(agenda.events, now);
  if (!ev) return null;
  const today = agenda.todayLocal ?? localDateISO(now, agenda.timezone);
  const whenLabel = ev.eventDate
    ? relativeDayLabel(ev.eventDate, today, locale)
    : null;
  return { label: ev.title, whenLabel };
}

// --- Unified alerts ---------------------------------------------------------

export type AlertSeverity = "INFO" | "WARNING" | "HIGH" | "CRITICAL";

export type UnifiedAlert = {
  id: string;
  severity: AlertSeverity;
  kind: string;
  title: string;
  detail: string | null;
  source: string;
  sourceId: string;
  ts: string | null;
};

export type UnifiedAlerts = {
  resolutionStatus: string;
  tenantId: string | null;
  alerts: UnifiedAlert[];
  summary: { total: number; critical: number; high: number; warning: number };
  unavailable: string[];
};

function toSeverity(v: unknown): AlertSeverity {
  const s = String(v ?? "").toUpperCase();
  return s === "CRITICAL" || s === "HIGH" || s === "WARNING" ? s : "INFO";
}

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  WARNING: 2,
  INFO: 3,
};

export function parseAlerts(payload: unknown): UnifiedAlerts {
  const p = (payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(p.alerts)
    ? (p.alerts as Record<string, unknown>[])
    : [];
  const alerts: UnifiedAlert[] = dedupeAlerts(
    raw.map((a) => ({
      id: String(a.id ?? `${a.source}:${a.source_id}`),
      severity: toSeverity(a.severity),
      kind: String(a.kind ?? ""),
      title: String(a.title ?? ""),
      detail: asString(a.detail),
      source: String(a.source ?? ""),
      sourceId: String(a.source_id ?? ""),
      ts: asString(a.ts),
    })),
  );
  const s = (p.summary ?? {}) as Record<string, unknown>;
  return {
    resolutionStatus: String(p.resolution_status ?? "NO_TENANT"),
    tenantId: asString(p.tenant_id),
    alerts,
    summary: {
      total: Number(s.total ?? alerts.length) || 0,
      critical: Number(s.critical ?? 0) || 0,
      high: Number(s.high ?? 0) || 0,
      warning: Number(s.warning ?? 0) || 0,
    },
    unavailable: Array.isArray(p.unavailable)
      ? (p.unavailable as unknown[]).map(String)
      : [],
  };
}

/** Remove exact duplicate signals (same canonical id). */
export function dedupeAlerts(alerts: UnifiedAlert[]): UnifiedAlert[] {
  const seen = new Set<string>();
  const out: UnifiedAlert[] = [];
  for (const a of alerts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Severity-first ordering (CRITICAL → HIGH → WARNING → INFO), then recency. */
export function sortAlerts(alerts: UnifiedAlert[]): UnifiedAlert[] {
  return [...alerts].sort((a, b) => {
    const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (r !== 0) return r;
    return (b.ts ?? "").localeCompare(a.ts ?? "");
  });
}

/**
 * The context-bar counter: only *actionable* alerts (WARNING/HIGH/CRITICAL).
 * Neutral INFO signals are never counted as an alert.
 */
export function actionableAlertCount(alerts: UnifiedAlert[]): number {
  return alerts.filter((a) => a.severity !== "INFO").length;
}
