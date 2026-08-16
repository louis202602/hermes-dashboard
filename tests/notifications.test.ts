import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { UnifiedAlert, UnifiedAlerts } from "../lib/dashboard/agenda.ts";
import type { NotificationCursor } from "../lib/dashboard/preferences.ts";
import { clampBehavior, clampNotificationCursor } from "../lib/dashboard/preferences.ts";
import type { ServiceResult } from "../types/hermes.ts";
import {
  NOTIFICATION_CATEGORIES,
  MAX_NOTIFICATIONS,
  availableFilters,
  badgeText,
  buildNotifications,
  buildNotificationsFromResult,
  categoryForAlert,
  filterNotifications,
  isRead,
  markAllRead,
  markRead,
  targetWidgetForAlert,
  unreadCount,
} from "../lib/dashboard/notifications.ts";

const EMPTY: NotificationCursor = { lastSeenAt: null, readIds: [] };

function alert(p: Partial<UnifiedAlert> & { id: string }): UnifiedAlert {
  return {
    id: p.id,
    severity: p.severity ?? "INFO",
    kind: p.kind ?? "",
    title: p.title ?? "",
    detail: p.detail ?? null,
    source: p.source ?? "",
    sourceId: p.sourceId ?? "",
    ts: p.ts ?? null,
  };
}

function okResult(alerts: UnifiedAlert[]): ServiceResult<UnifiedAlerts> {
  return {
    ok: true,
    provenance: "REAL",
    data: {
      resolutionStatus: "OK",
      tenantId: "tenant-1",
      alerts,
      summary: { total: alerts.length, critical: 0, high: 0, warning: 0 },
      unavailable: [],
    },
  } as ServiceResult<UnifiedAlerts>;
}

// --- NOTIFICATIONS_EMPTY -----------------------------------------------------
test("NOTIFICATIONS_EMPTY: no alerts ⇒ no notifications, count 0, no badge", () => {
  const n = buildNotifications([], EMPTY);
  assert.deepEqual(n, []);
  assert.equal(unreadCount(n), 0);
  assert.equal(badgeText(unreadCount(n)), "");
});

// --- NOTIFICATION_WARNING / HIGH / CRITICAL + category mapping ---------------
test("severity is carried verbatim (deterministic, no LLM) + category by rule", () => {
  const n = buildNotifications([
    alert({ id: "BUDGET_MONTH:k", severity: "WARNING", kind: "budget", source: "BUDGET" }),
    alert({ id: "CIRCUIT_OPEN:a", severity: "CRITICAL", kind: "circuit", source: "CIRCUIT_OPEN" }),
    alert({ id: "LATE_ITEM:c", severity: "HIGH", kind: "late", source: "LATE_ITEM" }),
  ]);
  assert.equal(n.find((x) => x.kind === "budget")!.severity, "WARNING");
  assert.equal(n.find((x) => x.kind === "circuit")!.severity, "CRITICAL");
  assert.equal(n.find((x) => x.kind === "late")!.severity, "HIGH");
  assert.equal(categoryForAlert({ kind: "approval", source: "APPROVAL_PENDING" }), "approvals");
  assert.equal(categoryForAlert({ kind: "incident", source: "INCIDENT_OPEN" }), "chantiers");
  assert.equal(categoryForAlert({ kind: "late", source: "LATE_ITEM" }), "chantiers");
  assert.equal(categoryForAlert({ kind: "circuit", source: "CIRCUIT_OPEN" }), "agents");
  assert.equal(categoryForAlert({ kind: "dead_letter", source: "DEAD_LETTER" }), "agents");
  assert.equal(categoryForAlert({ kind: "budget", source: "BUDGET" }), "systeme");
  assert.equal(categoryForAlert({ kind: "quota", source: "QUOTA_BLOCK" }), "systeme");
  // every mapped category is a declared one
  for (const n2 of n) assert.ok(NOTIFICATION_CATEGORIES.includes(n2.category));
});

// --- DEEP_LINKS (targetWidget), no dead target for unknown -------------------
test("deep-link target widget by rule; unknown ⇒ null (no dead button)", () => {
  assert.equal(targetWidgetForAlert({ kind: "approval", source: "APPROVAL_PENDING" }), "approvals");
  assert.equal(targetWidgetForAlert({ kind: "late", source: "LATE_ITEM" }), "projects");
  assert.equal(targetWidgetForAlert({ kind: "incident", source: "INCIDENT_OPEN" }), "projects");
  assert.equal(targetWidgetForAlert({ kind: "circuit", source: "CIRCUIT_OPEN" }), "resolver-status");
  assert.equal(targetWidgetForAlert({ kind: "dead_letter", source: "DEAD_LETTER" }), "agent-activity");
  assert.equal(targetWidgetForAlert({ kind: "budget", source: "BUDGET" }), "cost");
  assert.equal(targetWidgetForAlert({ kind: "quota", source: "QUOTA_BLOCK" }), "cost");
  assert.equal(targetWidgetForAlert({ kind: "mystery", source: "WAT" }), null);
});

// --- DEDUPLICATION -----------------------------------------------------------
test("DEDUPLICATION: same canonical id collapses to one notification", () => {
  const n = buildNotifications([
    alert({ id: "APPROVAL_PENDING:1", severity: "HIGH", kind: "approval", ts: "2026-08-16T10:00:00Z" }),
    alert({ id: "APPROVAL_PENDING:1", severity: "HIGH", kind: "approval", ts: "2026-08-16T10:00:00Z" }),
    alert({ id: "APPROVAL_PENDING:2", severity: "HIGH", kind: "approval", ts: "2026-08-16T09:00:00Z" }),
  ]);
  assert.equal(n.length, 2);
  assert.deepEqual(n.map((x) => x.id).sort(), ["APPROVAL_PENDING:1", "APPROVAL_PENDING:2"]);
});

test("DEDUP key includes source/type: APPROVAL:123 ≠ INCIDENT:123", () => {
  const n = buildNotifications([
    alert({ id: "APPROVAL_PENDING:123", severity: "HIGH", kind: "approval", source: "APPROVAL_PENDING" }),
    alert({ id: "INCIDENT_OPEN:123", severity: "HIGH", kind: "incident", source: "INCIDENT_OPEN" }),
  ]);
  assert.equal(n.length, 2, "same numeric id but different source ⇒ two distinct notifications");
});

// --- SORT_PRIORITY -----------------------------------------------------------
test("SORT_PRIORITY: CRITICAL → HIGH → WARNING → INFO", () => {
  const n = buildNotifications([
    alert({ id: "i", severity: "INFO", kind: "x" }),
    alert({ id: "w", severity: "WARNING", kind: "x" }),
    alert({ id: "c", severity: "CRITICAL", kind: "x" }),
    alert({ id: "h", severity: "HIGH", kind: "x" }),
  ]);
  assert.deepEqual(n.map((x) => x.severity), ["CRITICAL", "HIGH", "WARNING", "INFO"]);
});

// --- SORT_RECENCY ------------------------------------------------------------
test("SORT_RECENCY: within equal severity, newest ts first", () => {
  const n = buildNotifications([
    alert({ id: "old", severity: "HIGH", kind: "x", ts: "2026-08-16T08:00:00Z" }),
    alert({ id: "new", severity: "HIGH", kind: "x", ts: "2026-08-16T12:00:00Z" }),
    alert({ id: "mid", severity: "HIGH", kind: "x", ts: "2026-08-16T10:00:00Z" }),
  ]);
  assert.deepEqual(n.map((x) => x.id), ["new", "mid", "old"]);
});

// --- MAX_LIMIT ---------------------------------------------------------------
test("MAX_LIMIT: never surfaces more than MAX_NOTIFICATIONS", () => {
  const many = Array.from({ length: MAX_NOTIFICATIONS + 25 }, (_, i) =>
    alert({ id: `LATE_ITEM:${i}`, severity: "HIGH", kind: "late", ts: `2026-08-16T00:${String(i).padStart(2, "0")}:00Z` }),
  );
  assert.equal(buildNotifications(many).length, MAX_NOTIFICATIONS);
});

// --- READ_STATE / UNREAD_STATE ----------------------------------------------
test("READ_STATE: watermark covers INFO/WARNING; HIGH/CRITICAL need explicit key", () => {
  const cursor: NotificationCursor = { lastSeenAt: "2026-08-16T10:00:00Z", readIds: [] };
  const warnOld = alert({ id: "w", severity: "WARNING", ts: "2026-08-16T08:00:00Z" });
  const warnNew = alert({ id: "w2", severity: "WARNING", ts: "2026-08-16T12:00:00Z" });
  assert.equal(isRead(warnOld, cursor), true, "WARNING older than watermark ⇒ read");
  assert.equal(isRead(warnNew, cursor), false, "WARNING newer than watermark ⇒ unread");
  // HIGH is NEVER auto-read by the time watermark (even when older) — must be explicit
  const highOld = alert({ id: "h", severity: "HIGH", ts: "2026-08-16T08:00:00Z" });
  assert.equal(isRead(highOld, cursor), false, "HIGH not covered by watermark");
  const c2 = markRead(cursor, highOld);
  assert.equal(isRead(highOld, c2), true, "explicit mark ⇒ read");
});

// --- SEVERITY ESCALATION (aggravation must resurface, never masked) ----------
test("ESCALATION: a read WARNING that becomes CRITICAL on the SAME source resurfaces", () => {
  const base = { id: "BUDGET_MONTH:2026-08", source: "BUDGET", kind: "budget", ts: "2026-08-16T08:00:00Z" };
  const warn = alert({ ...base, severity: "WARNING" });
  const crit = alert({ ...base, severity: "CRITICAL" });
  // (a) individually read WARNING → escalation to CRITICAL is UNREAD again
  const c1 = markRead(EMPTY, warn);
  assert.equal(isRead(warn, c1), true);
  assert.equal(isRead(crit, c1), false, "aggravation not masked by individual read");
  // (b) mark-all-read (watermark) then escalation with the SAME ts is still UNREAD
  const c2 = markAllRead(EMPTY, buildNotifications([warn]));
  assert.equal(isRead(crit, c2), false, "aggravation not masked by watermark");
  // sanity: same-severity re-render stays read
  assert.equal(isRead(warn, c2), true);
});

// --- MARK_ALL_READ -----------------------------------------------------------
test("MARK_ALL_READ: everything currently surfaced becomes read (ts + null-ts)", () => {
  const list = [
    alert({ id: "a", severity: "HIGH", kind: "x", ts: "2026-08-16T08:00:00Z" }),
    alert({ id: "b", severity: "CRITICAL", kind: "x", ts: "2026-08-16T12:00:00Z" }),
    alert({ id: "c", severity: "INFO", kind: "x", ts: null }), // no timestamp
  ];
  let n = buildNotifications(list, EMPTY);
  assert.equal(unreadCount(n), 3);
  const cursor = markAllRead(EMPTY, n);
  n = buildNotifications(list, cursor);
  assert.equal(unreadCount(n), 0);
  assert.equal(badgeText(unreadCount(n)), "");
  // a NEW, newer alert arriving afterwards is unread again
  const withNew = [...list, alert({ id: "d", severity: "HIGH", kind: "x", ts: "2026-08-16T18:00:00Z" })];
  assert.equal(unreadCount(buildNotifications(withNew, cursor)), 1);
});

// --- markRead bounded --------------------------------------------------------
test("markRead is bounded and de-duplicated (no infinite list)", () => {
  let c: NotificationCursor = EMPTY;
  for (let i = 0; i < 500; i++) c = markRead(c, { id: `id-${i}`, severity: "HIGH" });
  assert.ok(c.readIds.length <= 200, "readIds bounded to 200");
  assert.ok(c.readIds.includes("id-499::HIGH"), "keeps the most recent (id::severity)");
  // idempotent
  const before = c.readIds.length;
  c = markRead(c, { id: "id-499", severity: "HIGH" });
  assert.equal(c.readIds.length, before);
});

// --- USER_SCOPED_READ_STATE --------------------------------------------------
test("USER_SCOPED_READ_STATE: two users' cursors are independent on the same feed", () => {
  const list = [
    alert({ id: "a", severity: "HIGH", kind: "x", ts: "2026-08-16T08:00:00Z" }),
    alert({ id: "b", severity: "HIGH", kind: "x", ts: "2026-08-16T12:00:00Z" }),
  ];
  const userA = markAllRead(EMPTY, buildNotifications(list, EMPTY));
  const userB: NotificationCursor = EMPTY;
  assert.equal(unreadCount(buildNotifications(list, userA)), 0, "user A read everything");
  assert.equal(unreadCount(buildNotifications(list, userB)), 2, "user B unaffected");
});

// --- TENANT_SCOPE / CROSS_TENANT_DENIED -------------------------------------
test("TENANT_SCOPE: OK tenant-scoped result yields notifications", () => {
  const n = buildNotificationsFromResult(
    okResult([alert({ id: "LATE_ITEM:1", severity: "HIGH", kind: "late" })]),
  );
  assert.equal(n.length, 1);
});
test("CROSS_TENANT_DENIED: non-OK / unavailable result yields NO notifications", () => {
  const unavailable = { ok: false, provenance: "UNAVAILABLE", error: "x" } as unknown as ServiceResult<UnifiedAlerts>;
  assert.deepEqual(buildNotificationsFromResult(unavailable), []);
  const notOk = {
    ok: true,
    provenance: "REAL",
    data: { resolutionStatus: "NO_TENANT", tenantId: null, alerts: [alert({ id: "x" })], summary: { total: 1, critical: 0, high: 0, warning: 0 }, unavailable: [] },
  } as unknown as ServiceResult<UnifiedAlerts>;
  assert.deepEqual(buildNotificationsFromResult(notOk), []);
});

// --- HEADER_BADGE 0 / 1 / 9+ -------------------------------------------------
test("HEADER_BADGE_0 / _1 / _9PLUS", () => {
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(9), "9");
  assert.equal(badgeText(10), "9+");
  assert.equal(badgeText(999), "9+");
  assert.equal(badgeText(-3), "");
});

// --- FILTER_APPROVALS / AGENTS / CHANTIERS + availableFilters ---------------
test("FILTER_* selects by category; availableFilters only shows present ones", () => {
  const n = buildNotifications([
    alert({ id: "APPROVAL_PENDING:1", severity: "HIGH", kind: "approval", source: "APPROVAL_PENDING" }),
    alert({ id: "DEAD_LETTER:1", severity: "HIGH", kind: "dead_letter", source: "DEAD_LETTER" }),
    alert({ id: "LATE_ITEM:1", severity: "HIGH", kind: "late", source: "LATE_ITEM" }),
    alert({ id: "CIRCUIT_OPEN:1", severity: "CRITICAL", kind: "circuit", source: "CIRCUIT_OPEN" }),
  ]);
  assert.deepEqual(filterNotifications(n, "approvals").map((x) => x.kind), ["approval"]);
  assert.deepEqual(filterNotifications(n, "agents").map((x) => x.kind).sort(), ["circuit", "dead_letter"]);
  assert.deepEqual(filterNotifications(n, "chantiers").map((x) => x.kind), ["late"]);
  assert.equal(filterNotifications(n, "critical").length, 1);
  assert.equal(filterNotifications(n, "alert").length, 3);
  // no 'systeme' items here ⇒ that filter is not offered
  const filters = availableFilters(n);
  assert.ok(filters.includes("all"));
  assert.ok(filters.includes("approvals"));
  assert.ok(filters.includes("agents"));
  assert.ok(filters.includes("chantiers"));
  assert.ok(!filters.includes("systeme"));
  // empty feed ⇒ only 'all'
  assert.deepEqual(availableFilters([]), ["all"]);
});

// --- storage clamp: bounded + fail-safe -------------------------------------
test("clampNotificationCursor + clampBehavior: fail-safe & bounded", () => {
  const c = clampNotificationCursor({ lastSeenAt: 42, readIds: ["ok", "", 5, "ok", "dup"] });
  assert.equal(c.lastSeenAt, null, "non-string lastSeenAt ⇒ null");
  assert.deepEqual(c.readIds, ["ok", "dup"], "junk dropped, deduped");
  const huge = clampNotificationCursor({ readIds: Array.from({ length: 900 }, (_, i) => `n${i}`) });
  assert.ok(huge.readIds.length <= 200, "bounded on read too");
  // behavior carries a valid default cursor
  assert.deepEqual(clampBehavior({}).notifications, { lastSeenAt: null, readIds: [] });
  assert.deepEqual(clampBehavior({ notifications: { lastSeenAt: "2026-01-01T00:00:00Z", readIds: ["a"] } }).notifications, {
    lastSeenAt: "2026-01-01T00:00:00Z",
    readIds: ["a"],
  });
});

// --- NO_LLM / NO_POLLING / NO_SCHEDULE / NO_NETWORK --------------------------
test("pure module: no fetch / network / LLM / timers / polling", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/notifications.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /setInterval|setTimeout/);
  assert.doesNotMatch(src, /supabase|openai|anthropic/i);
});

// --- CSS surface: badge + panel + responsive + RTL + theme guards -----------
test("CSS: notification badge/panel/filters/list + mobile sheet + reduced-motion", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  for (const cls of [
    ".hos-notif-badge",
    ".notif-overlay",
    ".notif-panel",
    ".notif-filters",
    ".notif-filter.is-active",
    ".notif-list",
    ".notif-item.is-critical",
    ".notif-unread-dot",
    ".notif-link",
  ]) {
    assert.ok(css.includes(cls), `missing CSS ${cls}`);
  }
  // full-screen sheet on mobile + reduced-motion/transparency guards
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.notif-panel/);
  assert.match(css, /data-reduce-motion="1"\][\s\S]*\.notif-panel/);
  // RTL-safe: logical properties, not hard left/right, for badge + dot
  assert.match(css, /\.hos-notif-badge[\s\S]*inset-inline-end/);
  assert.match(css, /\.notif-unread-dot[\s\S]*margin-inline-start/);
});
