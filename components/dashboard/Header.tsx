"use client";

import {
  Bell,
  ChevronDown,
  Command,
  Menu,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { useSyncExternalStore } from "react";

type HeaderProps = {
  onMenuClick?: () => void;
};

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "hermes-theme";
const THEME_CHANGE_EVENT = "hermes-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

export default function Header({ onMenuClick }: HeaderProps) {
  const theme = useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

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

        <button type="button" className="header-profile">
          <div className="header-profile-avatar">LP</div>

          <div className="header-profile-copy">
            <strong>Louis Preira</strong>
            <span>Fondateur HelioSolar</span>
          </div>

          <ChevronDown size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
