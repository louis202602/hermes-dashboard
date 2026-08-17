"use client";

import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import type { UnifiedAlerts } from "@/lib/dashboard/agenda";
import {
  buildNotificationsFromResult,
  markAllRead as markAllNotificationsRead,
  markRead as markNotificationRead,
  type Notification,
} from "@/lib/dashboard/notifications";
import {
  PREFERENCES_SCHEMA_VERSION,
  type Behavior,
  type NotificationCursor,
} from "@/lib/dashboard/preferences";
import type { ServiceResult } from "@/types/hermes";

/**
 * The single source of truth for the notification read-state cursor, shared by the header
 * bell (in the chrome) and the /notifications page. The feed is DERIVED client-side from
 * the already-loaded `alerts` snapshot (0 extra DB read, 0 polling, 0 LLM); the read
 * cursor is persisted in the existing `behavior` JSONB through the SAME optimistic upsert
 * as the rest of the preferences (debounced; VERSION_CONFLICT ⇒ reload for canonical).
 */
export function useNotificationCursor(
  alerts: ServiceResult<UnifiedAlerts>,
  behavior: Behavior,
  preferencesVersion: number,
  // Optional SHARED version counter. When the chrome also persists profiles from the same
  // component, it passes its ref here so cursor + profile writes advance ONE counter —
  // avoiding the version divergence (independent counters → spurious VERSION_CONFLICT
  // reloads) fixed in the wallpaper apply work. Standalone callers (the /notifications
  // page) omit it and the hook keeps its own.
  sharedVersionRef?: MutableRefObject<number>,
): {
  notifications: Notification[];
  onMarkRead: (n: Notification) => void;
  onMarkAllRead: () => void;
} {
  const [cursor, setCursor] = useState<NotificationCursor>(behavior.notifications);
  const cursorRef = useRef<NotificationCursor>(behavior.notifications);
  const ownVersionRef = useRef<number>(preferencesVersion);
  const versionRef = sharedVersionRef ?? ownVersionRef;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifications = useMemo(
    () => buildNotificationsFromResult(alerts, cursor),
    [alerts, cursor],
  );

  const persist = useCallback(
    (next: NotificationCursor) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const res = await saveDashboardPreferencesAction(
          {
            behavior: { ...behavior, notifications: next },
            schema_version: PREFERENCES_SCHEMA_VERSION,
          },
          versionRef.current,
        );
        if (res.ok && typeof res.version === "number") {
          versionRef.current = res.version;
        } else if (res.status === "VERSION_CONFLICT") {
          window.location.reload();
        }
      }, 500);
    },
    [behavior, versionRef],
  );

  const apply = useCallback(
    (next: NotificationCursor) => {
      cursorRef.current = next;
      setCursor(next);
      persist(next);
    },
    [persist],
  );

  const onMarkAllRead = useCallback(
    () => apply(markAllNotificationsRead(cursorRef.current, notifications)),
    [apply, notifications],
  );
  const onMarkRead = useCallback(
    (n: Notification) => apply(markNotificationRead(cursorRef.current, n)),
    [apply],
  );

  return { notifications, onMarkRead, onMarkAllRead };
}
