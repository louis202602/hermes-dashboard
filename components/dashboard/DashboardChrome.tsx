"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import AppearanceSync from "@/components/dashboard/AppearanceSync";
import FavoritesBar from "@/components/dashboard/FavoritesBar";
import Header from "@/components/dashboard/Header";
import { NotificationsProvider } from "@/components/dashboard/NotificationsContext";
import ProfileSwitcher from "@/components/dashboard/ProfileSwitcher";
import Sidebar from "@/components/dashboard/Sidebar";
import TenantSwitcher from "@/components/dashboard/TenantSwitcher";
import WallpaperLayer from "@/components/dashboard/WallpaperLayer";
import type { UnifiedAlerts } from "@/lib/dashboard/agenda";
import { useNotificationCursor } from "@/lib/dashboard/useNotificationCursor";
import {
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
  type Behavior,
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
import type { NavEntry } from "@/lib/verticals/navigation";
import type { DashboardTenant } from "@/services/hermes/tenants";
import type { ServiceResult } from "@/types/hermes";

type DashboardChromeProps = {
  userEmail: string;
  appearance: Appearance;
  behavior: Behavior;
  preferencesVersion: number;
  locale: string;
  profiles: ProfilesState;
  activeProfile: ProfileId;
  availableProfiles: ProfileId[];
  wallpaperUrls: Record<string, string>;
  alerts: ServiceResult<UnifiedAlerts>;
  navigation: NavEntry[];
  tenants: DashboardTenant[];
  activeTenantId: string | null;
  children: React.ReactNode;
};

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
  navigation,
  tenants,
  activeTenantId,
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

  const effectiveAppearance = useMemo(
    () => effectiveProfileAppearance(appearance, profiles, activeProfile),
    [appearance, profiles, activeProfile],
  );
  const wallpaper = useMemo(
    () => resolveWallpaper(profileWallpaperFields(profiles, activeProfile), profiles.wallpaper),
    [profiles, activeProfile],
  );
  const wallpaperActive = wallpaper.ref !== DEFAULT_WALLPAPER_REF;
  useEffect(() => {
    const el = document.documentElement;
    if (wallpaperActive) el.setAttribute("data-wallpaper-active", "true");
    else el.removeAttribute("data-wallpaper-active");
    return () => el.removeAttribute("data-wallpaper-active");
  }, [wallpaperActive]);

  const { notifications, onMarkRead, onMarkAllRead } = useNotificationCursor(
    alerts,
    behavior,
    preferencesVersion,
    versionRef,
  );

  const profileNames = useMemo(() => {
    const out: Partial<Record<ProfileId, string | null>> = {};
    for (const [id, cfg] of Object.entries(profiles.byId)) {
      out[id as ProfileId] = cfg?.name ?? null;
    }
    return out;
  }, [profiles]);

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
      <WallpaperLayer config={wallpaper} imageUrl={wallpaperUrls[activeProfile] ?? null} />
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
          navigation={navigation}
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
          <TenantSwitcher tenants={tenants} activeTenantId={activeTenantId} />

          <ProfileSwitcher
            active={activeProfile}
            available={availableProfiles}
            names={profileNames}
            onSelect={onSelectProfile}
          />

          <FavoritesBar
            favorites={behavior.favorites}
            registryWidgetIds={WIDGET_REGISTRY.map((w) => w.id)}
            visibleWidgetIds={[]}
          />

          <NotificationsProvider
            value={{ notifications, onMarkRead, onMarkAllRead, locale }}
          >
            {children}
          </NotificationsProvider>
        </div>
      </div>
    </main>
  );
}
