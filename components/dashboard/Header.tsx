"use client";

import { Bell, Menu, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import NotificationCenter from "@/components/dashboard/NotificationCenter";
import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import {
  applyAppearance,
  resolveThemeAttr,
  writeAppearanceCookie,
} from "@/lib/dashboard/applyAppearance";
import { badgeText, unreadCount, type Notification } from "@/lib/dashboard/notifications";
import {
  HERMES_DEFAULT_APPEARANCE,
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
} from "@/lib/dashboard/preferences";
import { useI18n } from "@/lib/i18n/I18nProvider";

type HeaderProps = {
  onMenuClick?: () => void;
  userEmail?: string;
  appearance?: Appearance;
  preferencesVersion?: number;
  // DASH-4F — notification center (derived client-side from already-loaded alerts).
  notifications?: Notification[];
  visibleWidgetIds?: string[];
  locale?: string;
  onMarkAllRead?: () => void;
  onMarkRead?: (n: Notification) => void;
};

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || local.slice(0, 2) || "?").toUpperCase();
}

export default function Header({
  onMenuClick,
  userEmail,
  appearance = HERMES_DEFAULT_APPEARANCE,
  preferencesVersion = 0,
  notifications = [],
  visibleWidgetIds = [],
  locale = "fr-FR",
  onMarkAllRead,
  onMarkRead,
}: HeaderProps) {
  const email = userEmail ?? "";
  const { t } = useI18n();
  const router = useRouter();
  const [appr, setAppr] = useState<Appearance>(appearance);
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const versionRef = useRef<number>(preferencesVersion);
  // Return focus to the bell when the panel closes (a11y).
  const closeNotif = () => {
    setNotifOpen(false);
    bellRef.current?.focus();
  };
  const unread = unreadCount(notifications);
  const badge = badgeText(unread);
  // Effective light/dark for the icon (resolves auto/named themes at click time).
  const isLight = resolveThemeAttr(appr.theme) === "light";

  // Quick light/dark toggle — CANONICAL: it goes through the very same optimistic
  // upsert (and version) as the Settings page, applies live, and mirrors the cookie.
  // On VERSION_CONFLICT (another device wrote first) it refreshes to the canonical
  // server state instead of silently overwriting — no parallel write path.
  const toggle = () => {
    const next: Appearance = { ...appr, theme: isLight ? "dark" : "light" };
    setAppr(next);
    applyAppearance(next);
    writeAppearanceCookie(next);
    void saveDashboardPreferencesAction(
      { appearance: next, schema_version: PREFERENCES_SCHEMA_VERSION },
      versionRef.current,
    ).then((r) => {
      if (r.ok && typeof r.version === "number") {
        versionRef.current = r.version;
      } else if (r.status === "VERSION_CONFLICT") {
        if (typeof r.version === "number") versionRef.current = r.version;
        router.refresh(); // pull canonical appearance; AppearanceSync reconciles
      }
    });
  };

  return (
    <header className="hos-topbar">
      <div className="hos-topbar-left">
        <button
          type="button"
          className="hos-icon-btn hos-menu-btn"
          aria-label={t("header.menu")}
          onClick={onMenuClick}
        >
          <Menu size={20} strokeWidth={1.8} />
        </button>
        <span className="hos-topbar-brand" aria-hidden="true">
          <HermesLogoSymbol size={22} />
        </span>
      </div>

      <div className="hos-topbar-right">
        <button
          type="button"
          className="hos-icon-btn"
          aria-label={isLight ? t("header.theme.toDark") : t("header.theme.toLight")}
          onClick={toggle}
        >
          {isLight ? (
            <Moon size={19} strokeWidth={1.8} />
          ) : (
            <Sun size={19} strokeWidth={1.8} />
          )}
        </button>

        <Link
          href="/parametres/dashboard"
          className="hos-icon-btn"
          aria-label={t("header.settings")}
          title={t("header.settings")}
        >
          <Settings size={19} strokeWidth={1.8} />
        </Link>

        <button
          ref={bellRef}
          type="button"
          className="hos-icon-btn hos-notif-btn"
          aria-label={
            unread > 0
              ? t("notifications.badgeAria", { count: String(unread) })
              : t("header.notifications")
          }
          aria-haspopup="dialog"
          aria-expanded={notifOpen}
          onClick={() => setNotifOpen((v) => !v)}
        >
          <Bell size={19} strokeWidth={1.8} />
          {badge ? (
            <span className="hos-notif-badge" aria-hidden>
              {badge}
            </span>
          ) : null}
        </button>

        <span className="hos-userchip" title={email || undefined}>
          <span className="hos-avatar sm">{email ? initials(email) : "?"}</span>
        </span>
      </div>

      {notifOpen ? (
        <NotificationCenter
          notifications={notifications}
          visibleWidgetIds={visibleWidgetIds}
          locale={locale}
          onClose={closeNotif}
          onMarkAllRead={() => {
            onMarkAllRead?.();
          }}
          onMarkRead={(n) => onMarkRead?.(n)}
        />
      ) : null}
    </header>
  );
}
