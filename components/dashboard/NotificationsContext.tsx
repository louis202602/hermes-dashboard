"use client";

import { createContext, useContext } from "react";

import type { Notification } from "@/lib/dashboard/notifications";

export type NotificationsContextValue = {
  notifications: Notification[];
  onMarkRead: (n: Notification) => void;
  onMarkAllRead: () => void;
  locale: string;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Shares the ONE notification cursor owned by the chrome (DashboardChrome) with the
 * /notifications page. Both the header bell and the page list read the same feed, the
 * same read-state, and advance the same version counter — no divergence, no spurious
 * VERSION_CONFLICT reload from two independent cursors on the same screen.
 */
export const NotificationsProvider = NotificationsContext.Provider;

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within the dashboard chrome");
  }
  return ctx;
}
