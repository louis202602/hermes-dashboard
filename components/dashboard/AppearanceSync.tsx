"use client";

import { useEffect } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import {
  applyAppearance,
  effectiveAppearance,
  writeAppearanceCookie,
} from "@/lib/dashboard/applyAppearance";
import {
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
  type Behavior,
} from "@/lib/dashboard/preferences";
import { THEME_STORAGE_KEY } from "@/lib/theme";

type Props = {
  appearance: Appearance;
  behavior: Behavior;
  version: number;
};

/**
 * Applies the SERVER-CANONICAL appearance to `<html>` on the dashboard (the init
 * script already applied the cookie pre-paint; this reconciles with the server so a
 * change made on another device wins on load), refreshes the cookie mirror, keeps a
 * `theme:auto` clock synced to the OS, and performs the one-time legacy
 * `localStorage("hermes-theme")` → server migration for existing users.
 */
export default function AppearanceSync({ appearance, behavior, version }: Props) {
  useEffect(() => {
    let eff = effectiveAppearance(appearance, behavior);

    // One-time migration: no server row yet (version 0) but a legacy theme exists.
    if (version === 0) {
      try {
        const legacy = localStorage.getItem(THEME_STORAGE_KEY);
        if (legacy === "light" || legacy === "dark") {
          if (appearance.theme === "dark" && legacy !== "dark") {
            eff = { ...eff, theme: legacy };
            // Persist once so the server becomes canonical (best-effort).
            void saveDashboardPreferencesAction(
              {
                appearance: { ...appearance, theme: legacy },
                schema_version: PREFERENCES_SCHEMA_VERSION,
              },
              0,
            );
          }
        }
      } catch {
        /* localStorage unavailable — keep server appearance */
      }
    }

    applyAppearance(eff);
    writeAppearanceCookie(eff);
    // Keep localStorage cache in sync (fallback if the cookie is ever cleared).
    try {
      if (eff.theme === "light" || eff.theme === "dark") {
        localStorage.setItem(THEME_STORAGE_KEY, eff.theme);
      }
    } catch {
      /* ignore */
    }

    // When theme is "auto", follow OS changes live (no polling, event-driven).
    if (appearance.theme === "auto" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => applyAppearance(effectiveAppearance(appearance, behavior));
      mq.addEventListener?.("change", onChange);
      return () => mq.removeEventListener?.("change", onChange);
    }
    return undefined;
  }, [appearance, behavior, version]);

  return null;
}
