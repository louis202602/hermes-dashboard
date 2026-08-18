"use client";

import NotificationCenter from "@/components/dashboard/NotificationCenter";
import { useNotifications } from "@/components/dashboard/NotificationsContext";

/**
 * /notifications page view. Reuses the ONE notification cursor owned by the chrome (via
 * context) and the SAME NotificationCenter list rendered inline (variant="page"). No
 * second cursor, so the header bell and this page never diverge. No widget deep-links on
 * the épuré Home, so `visibleWidgetIds` is empty.
 */
export default function NotificationsView() {
  const { notifications, onMarkRead, onMarkAllRead, locale } = useNotifications();

  return (
    <NotificationCenter
      variant="page"
      notifications={notifications}
      visibleWidgetIds={[]}
      locale={locale}
      onClose={() => {}}
      onMarkAllRead={onMarkAllRead}
      onMarkRead={onMarkRead}
    />
  );
}
