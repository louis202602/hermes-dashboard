"use client";

import {
  Bell,
  Command,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import { useTheme } from "@/hooks/useTheme";

type HeaderProps = {
  onMenuClick?: () => void;
  userEmail?: string;
};

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || local.slice(0, 2) || "?").toUpperCase();
}

export default function Header({ onMenuClick, userEmail }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const email = userEmail ?? "";

  return (
    <header className="dashboard-header">
      <div className="header-left">
        <button
          type="button"
          className="header-icon-button header-menu-button"
          aria-label="Ouvrir le menu"
          onClick={onMenuClick}
        >
          <Menu size={20} strokeWidth={1.8} />
        </button>

        <span className="header-brand-mobile" aria-hidden="true">
          <HermesLogoSymbol size={24} />
        </span>

        <div className="header-title-block">
          <span className="header-eyebrow">CENTRE DE COMMANDE</span>
          <div className="header-title-row">
            <h1>Vue d’ensemble</h1>
            <span className="header-live-badge">
              <span className="header-live-dot" />
              En direct
            </span>
          </div>
        </div>
      </div>

      <div className="header-right">
        <label className="header-search">
          <Search size={17} strokeWidth={1.8} />
          <input
            type="search"
            placeholder="Rechercher dans Hermès OS…"
            aria-label="Rechercher dans Hermès OS"
          />
          <span className="header-search-shortcut">
            <Command size={12} strokeWidth={1.8} />
            K
          </span>
        </label>

        <button
          type="button"
          className="header-icon-button"
          aria-label={
            theme === "dark"
              ? "Activer le thème clair"
              : "Activer le thème sombre"
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
          className="header-icon-button header-notification-button"
          aria-label="Notifications"
        >
          <Bell size={19} strokeWidth={1.8} />
          <span className="header-notification-dot" />
        </button>

        <div className="header-profile">
          <div className="header-profile-avatar">
            {email ? initialsFromEmail(email) : "?"}
          </div>

          <div className="header-profile-copy">
            <strong>{email || "Utilisateur"}</strong>
            <span>Session Hermès OS</span>
          </div>

          <form action={signOutAction}>
            <button
              type="submit"
              className="header-icon-button"
              aria-label="Se déconnecter"
              title="Se déconnecter"
            >
              <LogOut size={18} strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
