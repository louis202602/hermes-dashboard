/**
 * Theme primitives shared between the server layout (anti-FOUC script) and the
 * client `useTheme` hook. Single source of truth for the theme contract.
 *
 * No business logic here — only technical primitives.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "hermes-theme";
export const THEME_CHANGE_EVENT = "hermes-theme-change";
export const DEFAULT_THEME: Theme = "dark";

/**
 * Inline script executed before the first paint to apply the persisted theme and
 * avoid a flash of the wrong theme (FOUC). Kept as a static string so it can be
 * injected verbatim in the root layout with a CSP nonce. Defaults to `dark` when
 * no preference is stored.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:"${DEFAULT_THEME}";}catch(e){document.documentElement.dataset.theme="${DEFAULT_THEME}";}})();`;
