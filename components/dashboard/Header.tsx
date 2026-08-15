"use client";

import { Bell, Menu, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import {
  applyAppearance,
  resolveThemeAttr,
  writeAppearanceCookie,
} from "@/lib/dashboard/applyAppearance";
import {
  HERMES_DEFAULT_APPEARANCE,
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
} from "@/lib/dashboard/preferences";

type HeaderProps = {
  onMenuClick?: () => void;
  userEmail?: string;
  appearance?: Appearance;
  preferencesVersion?: number;
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
}: HeaderProps) {
  const email = userEmail ?? "";
  const [appr, setAppr] = useState<Appearance>(appearance);
  const versionRef = useRef<number>(preferencesVersion);
  // Effective light/dark for the icon (resolves auto/named themes at click time).
  const isLight = resolveThemeAttr(appr.theme) === "light";

  // Quick light/dark toggle — CANONICAL: applies live, mirrors the cookie, and
  // persists server-side (optimistic version) so it survives reload + syncs.
  const toggle = () => {
    const next: Appearance = { ...appr, theme: isLight ? "dark" : "light" };
    setAppr(next);
    applyAppearance(next);
    writeAppearanceCookie(next);
    void saveDashboardPreferencesAction(
      { appearance: next, schema_version: PREFERENCES_SCHEMA_VERSION },
      versionRef.current,
    ).then((r) => {
      if (r.ok && typeof r.version === "number") versionRef.current = r.version;
    });
  };

  return (
    <header className="hos-topbar">
      <div className="hos-topbar-left">
        <button
          type="button"
          className="hos-icon-btn hos-menu-btn"
          aria-label="Ouvrir le menu"
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
          aria-label={isLight ? "Activer le thème sombre" : "Activer le thème clair"}
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
          aria-label="Paramètres du dashboard"
          title="Paramètres du dashboard"
        >
          <Settings size={19} strokeWidth={1.8} />
        </Link>

        <button
          type="button"
          className="hos-icon-btn"
          aria-label="Notifications"
          disabled
          title="Bientôt disponible"
        >
          <Bell size={19} strokeWidth={1.8} />
        </button>

        <span className="hos-userchip" title={email || undefined}>
          <span className="hos-avatar sm">{email ? initials(email) : "?"}</span>
        </span>
      </div>
    </header>
  );
}
