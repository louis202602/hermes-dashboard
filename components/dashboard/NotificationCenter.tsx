"use client";

import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  availableFilters,
  filterNotifications,
  type Notification,
  type NotificationFilter,
} from "@/lib/dashboard/notifications";
import type { AlertSeverity } from "@/lib/dashboard/agenda";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";

type Props = {
  notifications: Notification[];
  visibleWidgetIds: string[];
  locale: string;
  onClose: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
};

function severityIcon(sev: AlertSeverity) {
  if (sev === "CRITICAL") return <AlertOctagon size={16} strokeWidth={1.9} />;
  if (sev === "HIGH") return <ShieldAlert size={16} strokeWidth={1.9} />;
  if (sev === "WARNING") return <AlertTriangle size={15} strokeWidth={1.8} />;
  return <Bell size={15} strokeWidth={1.8} />;
}

function formatWhen(ts: string | null, locale: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

export default function NotificationCenter({
  notifications,
  visibleWidgetIds,
  locale,
  onClose,
  onMarkAllRead,
  onMarkRead,
}: Props) {
  const { t, dir } = useI18n();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const visible = useMemo(() => new Set(visibleWidgetIds), [visibleWidgetIds]);

  const filters = availableFilters(notifications);
  const activeFilter = filters.includes(filter) ? filter : "all";
  const shown = filterNotifications(notifications, activeFilter);
  const hasUnread = notifications.some((n) => !n.read);

  // Escape closes; focus moves into the panel on open (a11y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="notif-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className="notif-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("notifications.title")}
        dir={dir}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="notif-head">
          <h2>{t("notifications.title")}</h2>
          <div className="notif-head-actions">
            <button
              type="button"
              className="notif-markall"
              aria-label={t("notifications.markAllRead")}
              title={t("notifications.markAllRead")}
              onClick={onMarkAllRead}
              disabled={!hasUnread}
            >
              <CheckCheck size={15} strokeWidth={1.9} aria-hidden />
              <span className="notif-markall-label">{t("notifications.markAllRead")}</span>
            </button>
            <button
              type="button"
              className="hos-icon-btn notif-close"
              aria-label={t("notifications.close")}
              onClick={onClose}
            >
              <X size={18} strokeWidth={1.9} />
            </button>
          </div>
        </div>

        {filters.length > 1 ? (
          <div className="notif-filters" role="tablist" aria-label={t("notifications.title")}>
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={activeFilter === f}
                className={`notif-filter${activeFilter === f ? " is-active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {t(`notifications.filter.${f}` as MessageKey)}
              </button>
            ))}
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="notif-empty">{t("notifications.empty")}</p>
        ) : (
          <ul className="notif-list">
            {shown.map((n) => {
              const when = formatWhen(n.ts, locale);
              const canLink = n.targetWidget !== null && visible.has(n.targetWidget);
              return (
                <li
                  key={n.id}
                  className={`notif-item is-${n.severity.toLowerCase()}${n.read ? " is-read" : ""}`}
                >
                  <span className="notif-sev" aria-hidden>
                    {severityIcon(n.severity)}
                  </span>
                  <div className="notif-body">
                    <div className="notif-item-top">
                      <strong className="notif-item-title">{n.title}</strong>
                      {!n.read ? (
                        <span className="notif-unread-dot" aria-label={t("notifications.unread")} />
                      ) : null}
                    </div>
                    {n.detail ? <span className="notif-detail">{n.detail}</span> : null}
                    <div className="notif-meta">
                      <span className="notif-cat">
                        {t(`notifications.category.${n.category}` as MessageKey)}
                      </span>
                      <span className="notif-sevlabel">
                        {t(`alerts.severity.${n.severity}` as MessageKey)}
                      </span>
                      {when ? <span className="notif-when">{when}</span> : null}
                    </div>
                  </div>
                  <div className="notif-actions">
                    {canLink ? (
                      <a
                        className="notif-link"
                        href={`#widget-${n.targetWidget}`}
                        onClick={() => {
                          onMarkRead(n.id);
                          onClose();
                        }}
                      >
                        <ArrowUpRight size={15} strokeWidth={1.9} aria-hidden />
                        <span>{t("notifications.viewSource")}</span>
                      </a>
                    ) : null}
                    {!n.read ? (
                      <button
                        type="button"
                        className="notif-read-btn"
                        aria-label={t("notifications.markRead")}
                        title={t("notifications.markRead")}
                        onClick={() => onMarkRead(n.id)}
                      >
                        <Check size={15} strokeWidth={1.9} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
