"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import AppearanceSync from "@/components/dashboard/AppearanceSync";
import FavoritesBar from "@/components/dashboard/FavoritesBar";
import Header from "@/components/dashboard/Header";
import ProfileSwitcher from "@/components/dashboard/ProfileSwitcher";
import Sidebar from "@/components/dashboard/Sidebar";
import WallpaperLayer from "@/components/dashboard/WallpaperLayer";
import type { UnifiedAlerts } from "@/lib/dashboard/agenda";
import {
  buildNotificationsFromResult,
  markAllRead as markAllNotificationsRead,
  markRead as markNotificationRead,
  type Notification,
} from "@/lib/dashboard/notifications";
import {
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
  type Behavior,
  type NotificationCursor,
} from "@/lib/dashboard/preferences";
import {
  effectiveProfileAppearance,
  profileWallpaperFields,
  setActiveProfile,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import { WIDGET_REGISTRY } from "@/lib/dashboard/widgets";
import { DEFAULT_WALLPAPER_REF, resolveWallpaper } from "@/lib/dashboard/wallpapers";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { ServiceResult } from "@/types/hermes";

type DashboardChromeProps = {
  userEmail: string;
  // GLOBAL appearance (active-profile overrides layer on top, client-side).
  appearance: Appearance;
  behavior: Behavior;
  preferencesVersion: number;
  locale: string;
  // DASH-4D: profiles / modes (user-scoped) + the active one, driven client-side so a
  // mode switch recomposes the wallpaper + appearance from state (0 extra fetch).
  profiles: ProfilesState;
  activeProfile: ProfileId;
  // DASH-4I: the profiles offered to THIS tenant (capability/vertical-filtered).
  availableProfiles: ProfileId[];
  // DASH-4E: signed URLs for profiles whose wallpaper is a user image (by profile id).
  wallpaperUrls: Record<string, string>;
  // DASH-4F: the notification feed is DERIVED client-side from this already-loaded
  // alerts snapshot (0 extra DB read, 0 polling, 0 LLM).
  alerts: ServiceResult<UnifiedAlerts>;
  children: React.ReactNode;
};

/**
 * The SINGLE dashboard chrome — sidebar, header, wallpaper canvas, appearance sync,
 * profile switcher, favorites bar and the responsive/mobile shell. It is mounted ONCE
 * by the route-group layout (`app/(dashboard)/layout.tsx`) and wraps every page in the
 * group via `{children}`; pages render ONLY their own content. No chrome is copied per
 * page. Widget editing lives in Paramètres (`/parametres/dashboard`), not here.
 */
export default function DashboardChrome({
  userEmail,
  appearance,
  behavior,
  preferencesVersion,
  locale,
  profiles: initialProfiles,
  activeProfile: initialActiveProfile,
  availableProfiles,
  wallpaperUrls,
  alerts,
  children,
}: DashboardChromeProps) {
  const { t, dir } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(behavior.sidebarCollapsed);

  const [profiles, setProfilesState] = useState<ProfilesState>(initialProfiles);
  const [activeProfile, setActiveState] = useState<ProfileId>(initialActiveProfile);
  const versionRef = useRef<number>(preferencesVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profilesRef = useRef<ProfilesState>(initialProfiles);
  const activeRef = useRef<ProfileId>(initialActiveProfile);

  // Effective (active-profile) appearance + wallpaper, derived client-side. A mode
  // switch recomposes both instantly from state — 0 fetch (built-ins are pure CSS).
  const effectiveAppearance = useMemo(
    () => effectiveProfileAppearance(appearance, profiles, activeProfile),
    [appearance, profiles, activeProfile],
  );
  const wallpaper = useMemo(
    () => resolveWallpaper(profileWallpaperFields(profiles, activeProfile), profiles.wallpaper),
    [profiles, activeProfile],
  );
  // A CUSTOM wallpaper would otherwise be masked by the page's opaque anthracite
  // background. When (and only when) a wallpaper is actually selected, flag <html> so the
  // page background goes transparent and the WallpaperLayer becomes the sole backdrop —
  // behind the glass cards, which keep their own semi-transparent surfaces. With no custom
  // wallpaper the flag is absent, so the historical Hermès anthracite is unchanged. The
  // flag is scoped to the mounted dashboard (removed on unmount → other routes untouched).
  const wallpaperActive = wallpaper.ref !== DEFAULT_WALLPAPER_REF;
  useEffect(() => {
    const el = document.documentElement;
    if (wallpaperActive) el.setAttribute("data-wallpaper-active", "true");
    else el.removeAttribute("data-wallpaper-active");
    return () => el.removeAttribute("data-wallpaper-active");
  }, [wallpaperActive]);

  // DASH-4F — notification center, derived from the SAME already-loaded alerts snapshot.
  // On the épuré Home there is no widget grid, so no notification deep-links to a widget
  // target: `visibleWidgetIds` is empty and the bell simply lists the alerts.
  const [cursor, setCursor] = useState<NotificationCursor>(behavior.notifications);
  const cursorRef = useRef<NotificationCursor>(behavior.notifications);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifications = useMemo(
    () => buildNotificationsFromResult(alerts, cursor),
    [alerts, cursor],
  );
  const persistCursor = useCallback(
    (next: NotificationCursor) => {
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(async () => {
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
    [behavior],
  );
  const applyCursor = useCallback(
    (next: NotificationCursor) => {
      cursorRef.current = next;
      setCursor(next);
      persistCursor(next);
    },
    [persistCursor],
  );
  const onMarkAllRead = useCallback(
    () => applyCursor(markAllNotificationsRead(cursorRef.current, notifications)),
    [applyCursor, notifications],
  );
  const onMarkRead = useCallback(
    (n: Notification) => applyCursor(markNotificationRead(cursorRef.current, n)),
    [applyCursor],
  );

  const profileNames = useMemo(() => {
    const out: Partial<Record<ProfileId, string | null>> = {};
    for (const [id, cfg] of Object.entries(profiles.byId)) {
      out[id as ProfileId] = cfg?.name ?? null;
    }
    return out;
  }, [profiles]);

  // Persist the profiles sub-object through the SAME optimistic upsert as the rest of the
  // preferences (shared version, VERSION_CONFLICT ⇒ reload). Debounced; a write happens
  // only on a real switch, never on render.
  const persistProfiles = useCallback((next: ProfilesState) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveDashboardPreferencesAction(
        { profiles: next, schema_version: PREFERENCES_SCHEMA_VERSION },
        versionRef.current,
      );
      if (res.ok && typeof res.version === "number") {
        versionRef.current = res.version;
      } else if (res.status === "VERSION_CONFLICT") {
        window.location.reload();
      }
    }, 500);
  }, []);

  const applyProfiles = useCallback(
    (next: ProfilesState) => {
      profilesRef.current = next;
      setProfilesState(next);
      persistProfiles(next);
    },
    [persistProfiles],
  );

  // Switch mode: instant client recompose (wallpaper + appearance), persisted in the
  // background. Uses the latest ref so concurrent updates never race on a stale closure.
  const onSelectProfile = useCallback(
    (id: ProfileId) => {
      if (id === activeRef.current) return;
      activeRef.current = id;
      setActiveState(id);
      applyProfiles(setActiveProfile(profilesRef.current, id));
    },
    [applyProfiles],
  );

  return (
    <main dir={dir} className={`dashboard-shell${collapsed ? " is-collapsed" : ""}`}>
      {/* DASH-4E: the wallpaper canvas behind the glass content (per active profile). */}
      <WallpaperLayer config={wallpaper} imageUrl={wallpaperUrls[activeProfile] ?? null} />
      {/* DASH-4A: reconcile server-canonical appearance on load + keep the cookie mirror
          fresh (the init script already applied it pre-paint). Renders nothing. */}
      <AppearanceSync
        appearance={effectiveAppearance}
        behavior={behavior}
        version={preferencesVersion}
      />

      <div className={`dashboard-sidebar-wrapper ${mobileMenuOpen ? "is-open" : ""}`}>
        <Sidebar
          userEmail={userEmail}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          onNavigate={() => setMobileMenuOpen(false)}
        />
      </div>

      {mobileMenuOpen ? (
        <button
          type="button"
          className="dashboard-mobile-overlay"
          aria-label={t("header.menu.close")}
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <div className="dashboard-main">
        <Header
          userEmail={userEmail}
          onMenuClick={() => setMobileMenuOpen((value) => !value)}
          appearance={effectiveAppearance}
          preferencesVersion={preferencesVersion}
          notifications={notifications}
          visibleWidgetIds={[]}
          locale={locale}
          onMarkAllRead={onMarkAllRead}
          onMarkRead={onMarkRead}
        />

        <div className="dashboard-content">
          {/* Z1 — quick dashboard-mode switcher. Switching recomposes the wallpaper +
              appearance client-side (0 extra fetch), persisted in the background. */}
          <ProfileSwitcher
            active={activeProfile}
            available={availableProfiles}
            names={profileNames}
            onSelect={onSelectProfile}
          />

          {/* User favorites (real nav shortcuts). Renders nothing when empty. */}
          <FavoritesBar
            favorites={behavior.favorites}
            registryWidgetIds={WIDGET_REGISTRY.map((w) => w.id)}
            visibleWidgetIds={[]}
          />

          {/* The page content (Command Center / future métier pages). */}
          {children}
        </div>
      </div>
    </main>
  );
}
