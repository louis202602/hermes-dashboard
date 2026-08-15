/**
 * Theme primitives shared between the server layout (SSR appearance + anti-FOUC
 * script) and the client apply helpers. Single source of truth for the low-level
 * theme contract. No business logic — only technical primitives.
 *
 * Precedence (DASH-4A): the SERVER resolves the canonical appearance and injects the
 * `data-*` attributes onto `<html>` before the response is sent (see
 * `resolveInitialAppearance` + `app/layout.tsx`). The init script below only does the
 * two things the server genuinely cannot: resolve OS-driven `theme:auto`, and bridge a
 * legacy `localStorage` theme for users who predate the cookie — both before paint.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "hermes-theme";
export const DEFAULT_THEME: Theme = "dark";

/** DASH-4A cookie carrying the full appearance (dataset "k:v;k:v") — a client cache. */
export const APPEARANCE_COOKIE_NAME = "hermes-appearance";

/**
 * DASH-4A anti-FOUC (pre-paint, nonce'd). The server already SSR'd `data-theme` etc.
 * onto `<html>` from the canonical DB row, so a brand-new device paints correctly on
 * the FIRST frame. This tiny script only: (1) bridges a legacy `hermes-theme`
 * localStorage value for users who never wrote the appearance cookie yet, and
 * (2) resolves `theme:auto` against `prefers-color-scheme` — the one thing the server
 * cannot compute. Static string so it injects verbatim under the strict CSP.
 */
export const APPEARANCE_INIT_SCRIPT = `(function(){try{var d=document.documentElement,ds=d.dataset;if(!/(?:^|;\\s*)${APPEARANCE_COOKIE_NAME}=/.test(document.cookie)){var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){ds.theme=t;}}if(ds.theme==="auto"){ds.theme=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";}if(!ds.theme){ds.theme="${DEFAULT_THEME}";}}catch(e){try{document.documentElement.dataset.theme="${DEFAULT_THEME}";}catch(_){}}})();`;
