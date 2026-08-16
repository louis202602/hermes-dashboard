/**
 * DASH-4F — Deterministic notification center (pure, DOM-free, no I/O, no LLM).
 *
 * The notification feed is DERIVED, client-side, from the SAME already-loaded
 * `get_unified_alerts` snapshot the dashboard renders (tenant-scoped, deduped and
 * severity-ranked server-side). We never fetch, never fabricate a signal, never
 * classify with an LLM: each notification is one real `UnifiedAlert`, mapped to a
 * category + an optional in-page deep-link by EXPLICIT rules on `source`/`kind`.
 *
 * Read/unread is a per-user cursor (watermark `lastSeenAt` + bounded `readIds`) stored
 * in the existing preferences `behavior` JSONB — no new table / RPC / column.
 */

import {
  dedupeAlerts,
  sortAlerts,
  type AlertSeverity,
  type UnifiedAlert,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import type { NotificationCursor } from "@/lib/dashboard/preferences";
import {
  EMPTY_NOTIFICATION_CURSOR,
  MAX_NOTIFICATION_READ_IDS,
} from "@/lib/dashboard/preferences";
import type { ServiceResult } from "@/types/hermes";

// --- Shape ------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  "approvals",
  "agents",
  "chantiers",
  "systeme",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Filters offered in the UI: two severity bands + one per real category. */
export const NOTIFICATION_FILTERS = [
  "all",
  "critical",
  "alert",
  "approvals",
  "agents",
  "chantiers",
  "systeme",
] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** Hard cap on the surfaced list — never a DB dump. */
export const MAX_NOTIFICATIONS = 50;

export type Notification = {
  id: string; // canonical (source:sourceId) — the dedupe + read key
  severity: AlertSeverity;
  kind: string;
  category: NotificationCategory;
  title: string;
  detail: string | null;
  ts: string | null;
  source: string;
  sourceId: string;
  read: boolean;
  /** Dashboard widget id to deep-link to, or null when there is no honest target. */
  targetWidget: string | null;
};

// --- Deterministic rules (no LLM) -------------------------------------------

/**
 * Map a unified alert to exactly ONE category by explicit rule. `kind` is the primary
 * discriminator (stable, emitted by `get_unified_alerts`); `source` is the fallback.
 * Anything unrecognised is a system signal — never dropped, never mis-fabricated.
 */
export function categoryForAlert(a: Pick<UnifiedAlert, "kind" | "source">): NotificationCategory {
  const kind = a.kind.toLowerCase();
  const source = a.source.toUpperCase();
  if (kind === "approval" || source.startsWith("APPROVAL")) return "approvals";
  if (kind === "late" || kind === "incident" || source === "LATE_ITEM" || source === "INCIDENT_OPEN")
    return "chantiers";
  if (kind === "circuit" || kind === "dead_letter" || source === "CIRCUIT_OPEN" || source === "DEAD_LETTER")
    return "agents";
  // budget / quota / anything else ⇒ system (cost & platform governance).
  return "systeme";
}

/**
 * The dashboard widget a notification should deep-link to (an in-page anchor). Returns
 * null when there is no matching widget, so the UI can render a plain (non-actionable)
 * item instead of a dead button.
 */
export function targetWidgetForAlert(a: Pick<UnifiedAlert, "kind" | "source">): string | null {
  const kind = a.kind.toLowerCase();
  const source = a.source.toUpperCase();
  if (kind === "approval" || source.startsWith("APPROVAL")) return "approvals";
  if (kind === "late" || kind === "incident" || source === "LATE_ITEM" || source === "INCIDENT_OPEN")
    return "projects";
  if (kind === "circuit" || source === "CIRCUIT_OPEN") return "resolver-status";
  if (kind === "dead_letter" || source === "DEAD_LETTER") return "agent-activity";
  if (kind === "budget" || kind === "quota" || source === "BUDGET" || source === "QUOTA_BLOCK")
    return "cost";
  return null;
}

// --- Cursor / read-state ----------------------------------------------------

type ReadTarget = Pick<Notification, "id" | "ts" | "severity">;

/**
 * The read identity is `${id}::${severity}` — NOT the bare canonical id. So an
 * aggravation on the SAME source (e.g. a WARNING budget alert that becomes CRITICAL)
 * has a DIFFERENT read key and correctly resurfaces as unread, never masked by the
 * old "read" state. Dedup still uses the bare id (see buildNotifications).
 */
export function readKey(n: Pick<Notification, "id" | "severity">): string {
  return `${n.id}::${n.severity}`;
}

/**
 * Read when the exact (id, severity) was marked, OR — for non-actionable INFO/WARNING
 * only — when covered by the time watermark. HIGH/CRITICAL are NEVER auto-read by the
 * watermark: an escalation to an actionable severity always demands attention (it is
 * cleared only by an explicit mark-read / mark-all-read of that exact severity).
 */
export function isRead(n: ReadTarget, cursor: NotificationCursor): boolean {
  if (cursor.readIds.includes(readKey(n))) return true;
  if (
    (n.severity === "INFO" || n.severity === "WARNING") &&
    n.ts &&
    cursor.lastSeenAt &&
    n.ts <= cursor.lastSeenAt
  ) {
    return true;
  }
  return false;
}

function capReadIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Keep the MOST RECENT ids (end of the array) within the bound.
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.length > MAX_NOTIFICATION_READ_IDS
    ? out.slice(out.length - MAX_NOTIFICATION_READ_IDS)
    : out;
}

/** Mark one notification read at its CURRENT severity (bounded, de-duplicated). */
export function markRead(
  cursor: NotificationCursor,
  n: Pick<Notification, "id" | "severity">,
): NotificationCursor {
  const k = readKey(n);
  if (!n.id || cursor.readIds.includes(k)) return cursor;
  return { lastSeenAt: cursor.lastSeenAt, readIds: capReadIds([...cursor.readIds, k]) };
}

/**
 * Mark everything currently surfaced as read: advance the watermark to the newest ts
 * (covers INFO/WARNING without storing their keys) and store the (id, severity) key of
 * every item NOT covered by that watermark — i.e. HIGH/CRITICAL and any un-timestamped
 * item. Bounded + idempotent. A later escalation gets a new key and resurfaces.
 */
export function markAllRead(
  cursor: NotificationCursor,
  notifications: Notification[],
): NotificationCursor {
  let newest = cursor.lastSeenAt;
  for (const n of notifications) {
    if (n.ts && (!newest || n.ts > newest)) newest = n.ts;
  }
  const coveredByWatermark = (n: ReadTarget): boolean =>
    (n.severity === "INFO" || n.severity === "WARNING") &&
    !!n.ts &&
    !!newest &&
    n.ts <= newest;
  const keys = notifications.filter((n) => !coveredByWatermark(n)).map(readKey);
  return { lastSeenAt: newest, readIds: capReadIds([...cursor.readIds, ...keys]) };
}

// --- Build / count / filter -------------------------------------------------

/** Derive the surfaced notification list from unified alerts (deduped, ranked, capped). */
export function buildNotifications(
  alerts: UnifiedAlert[],
  cursor: NotificationCursor = EMPTY_NOTIFICATION_CURSOR,
): Notification[] {
  const ranked = sortAlerts(dedupeAlerts(alerts)).slice(0, MAX_NOTIFICATIONS);
  return ranked.map((a) => ({
    id: a.id,
    severity: a.severity,
    kind: a.kind,
    category: categoryForAlert(a),
    title: a.title,
    detail: a.detail,
    ts: a.ts,
    source: a.source,
    sourceId: a.sourceId,
    read: isRead(a, cursor),
    targetWidget: targetWidgetForAlert(a),
  }));
}

/**
 * Tenant-safe entry point: notifications ONLY from an OK, tenant-scoped alerts result.
 * An unavailable / non-OK snapshot (unauthenticated, other tenant, error) yields an
 * empty feed — a notification can never leak across tenants because the source RPC is
 * itself tenant-scoped and this is a pure transform of it.
 */
export function buildNotificationsFromResult(
  result: ServiceResult<UnifiedAlerts>,
  cursor: NotificationCursor = EMPTY_NOTIFICATION_CURSOR,
): Notification[] {
  if (!result.ok || result.data.resolutionStatus !== "OK") return [];
  return buildNotifications(result.data.alerts, cursor);
}

export function unreadCount(notifications: Notification[]): number {
  return notifications.reduce((n, x) => (x.read ? n : n + 1), 0);
}

/** Header badge text: "" when 0, the number up to 9, then "9+". */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 9 ? "9+" : String(Math.floor(count));
}

export function matchesFilter(n: Notification, filter: NotificationFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "critical":
      return n.severity === "CRITICAL";
    case "alert":
      return n.severity === "HIGH" || n.severity === "WARNING";
    default:
      return n.category === filter;
  }
}

export function filterNotifications(
  notifications: Notification[],
  filter: NotificationFilter,
): Notification[] {
  return notifications.filter((n) => matchesFilter(n, filter));
}

/**
 * Only the filters that actually have matching notifications (plus "all"), in a stable
 * order — so the UI never shows an empty tab for a category that isn't present.
 */
export function availableFilters(notifications: Notification[]): NotificationFilter[] {
  return NOTIFICATION_FILTERS.filter(
    (f) => f === "all" || notifications.some((n) => matchesFilter(n, f)),
  );
}
