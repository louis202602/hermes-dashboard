"use client";

import NotificationCenter from "@/components/dashboard/NotificationCenter";
import type { UnifiedAlerts } from "@/lib/dashboard/agenda";
import type { Behavior } from "@/lib/dashboard/preferences";
import { useNotificationCursor } from "@/lib/dashboard/useNotificationCursor";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  alerts: ServiceResult<UnifiedAlerts>;
  behavior: Behavior;
  preferencesVersion: number;
  locale: string;
};

/**
 * /notifications page view. Owns the read-state cursor via the SAME hook as the header
 * bell (one implementation), and renders the SAME NotificationCenter list inline
 * (variant="page"). No deep-links to widgets here (the épuré Home has no widget grid), so
 * `visibleWidgetIds` is empty.
 */
export default function NotificationsView({
  alerts,
  behavior,
  preferencesVersion,
  locale,
}: Props) {
  const { notifications, onMarkRead, onMarkAllRead } = useNotificationCursor(
    alerts,
    behavior,
    preferencesVersion,
  );

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
