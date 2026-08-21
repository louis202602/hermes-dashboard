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
} from "@/lib/dashboard/preferences";

// `effectiveAppearance` is pure (folds animations → reduced motion) and now lives
// in the DOM-free contract; re-exported here so existing client imports keep working.
export { effectiveAppearance } from "@/lib/dashboard/preferences";

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
  "liquidGlass",
  "glasslevel",
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
  // Liquid Glass level → a numeric CSS custom property the glass rules read via calc()
  // (a data-* attribute can't feed calc()). Harmless when the mode is off.
  document.documentElement.style.setProperty("--glass-level", String(a.glassLevel));
}

/**
 * Mirror the appearance into the appearance cookie (a CACHE — the server DB row is
 * canonical). Cannot be HttpOnly: the pre-paint init script and this helper both read
 * it from JS. `Secure` is added on HTTPS so it is never sent in clear. Contains only
 * the appearance dataset (theme/accent/…) — no layout, no profiles, no sensitive data.
 */
export function writeAppearanceCookie(a: Appearance): void {
  if (typeof document === "undefined") return;
  const val = encodeURIComponent(serializeAppearanceCookie(a));
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? ";Secure"
      : "";
  document.cookie = `${APPEARANCE_COOKIE_NAME}=${val};path=/;max-age=31536000;SameSite=Lax${secure}`;
}
