/**
 * DASH-4A — client-only helpers to apply an Appearance to `<html>` for LIVE PREVIEW
 * and to mirror it into the anti-FOUC cookie. DOM-touching (guards for SSR). The
 * pure mapping/serialisation lives in `preferences.ts`; this only performs the I/O.
 */

import { APPEARANCE_COOKIE_NAME } from "@/lib/theme";
import {
  appearanceToDataset,
  serializeAppearanceCookie,
  type Appearance,
  type Behavior,
} from "@/lib/dashboard/preferences";

const MANAGED_KEYS = [
  "theme",
  "accent",
  "contrast",
  "transparency",
  "blur",
  "radius",
  "shadow",
  "font",
  "textsize",
  "weight",
  "density",
  "reduceMotion",
  "reduceTransparency",
];

/** Resolve `theme:auto` to light/dark against the OS preference (client-only). */
export function resolveThemeAttr(theme: string): string {
  if (theme !== "auto") return theme;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}

/**
 * Fold behavior.animations into the effective appearance: turning animations off
 * enforces reduced motion (never the reverse — accessibility can only add safety).
 */
export function effectiveAppearance(
  appearance: Appearance,
  behavior: Behavior,
): Appearance {
  return {
    ...appearance,
    reduceMotion: appearance.reduceMotion || !behavior.animations,
  };
}

/** Apply the appearance to `<html>` data-* attributes (idempotent, cleans stale keys). */
export function applyAppearance(a: Appearance): void {
  if (typeof document === "undefined") return;
  const ds = document.documentElement.dataset;
  const next = appearanceToDataset(a);
  for (const k of MANAGED_KEYS) {
    if (!(k in next) && k in ds) delete ds[k];
  }
  for (const [k, v] of Object.entries(next)) {
    ds[k] = k === "theme" ? resolveThemeAttr(v) : v;
  }
}

/** Mirror the appearance into the (non-HttpOnly) cookie read by the init script. */
export function writeAppearanceCookie(a: Appearance): void {
  if (typeof document === "undefined") return;
  const val = encodeURIComponent(serializeAppearanceCookie(a));
  document.cookie = `${APPEARANCE_COOKIE_NAME}=${val};path=/;max-age=31536000;SameSite=Lax`;
}
