"use client";

import { Bell, HelpCircle, Menu, Moon, Sun } from "lucide-react";

import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import { useTheme } from "@/hooks/useTheme";

type HeaderProps = {
  onMenuClick?: () => void;
  userEmail?: string;
};

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || local.slice(0, 2) || "?").toUpperCase();
}

export default function Header({ onMenuClick, userEmail }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const email = userEmail ?? "";

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
          aria-label={
            theme === "dark" ? "Activer le thème clair" : "Activer le thème sombre"
          }
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <Sun size={19} strokeWidth={1.8} />
          ) : (
            <Moon size={19} strokeWidth={1.8} />
          )}
        </button>

        <button
          type="button"
          className="hos-icon-btn"
          aria-label="Notifications"
          disabled
          title="Bientôt disponible"
        >
          <Bell size={19} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="hos-icon-btn"
          aria-label="Aide"
          disabled
          title="Bientôt disponible"
        >
          <HelpCircle size={19} strokeWidth={1.8} />
        </button>

        <span className="hos-userchip" title={email || undefined}>
          <span className="hos-avatar sm">{email ? initials(email) : "?"}</span>
        </span>
      </div>
    </header>
  );
}
