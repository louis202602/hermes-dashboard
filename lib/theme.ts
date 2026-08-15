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

/** DASH-4A cookie carrying the full appearance (dataset "k:v;k:v"), read before paint. */
export const APPEARANCE_COOKIE_NAME = "hermes-appearance";

/**
 * DASH-4A anti-FOUC: apply the full appearance (theme/accent/density/font/…) to
 * `<html>` BEFORE first paint. Reads the `hermes-appearance` cookie (server-canonical
 * mirror, multi-device); resolves `theme:auto` against prefers-color-scheme; falls
 * back to the legacy `hermes-theme` localStorage for existing users; defaults to
 * ${DEFAULT_THEME}. Static string so it injects verbatim under the nonce'd CSP.
 */
export const APPEARANCE_INIT_SCRIPT = `(function(){try{var d=document.documentElement,ds=d.dataset;var m=document.cookie.match(/(?:^|;\\s*)${APPEARANCE_COOKIE_NAME}=([^;]*)/);if(m){var parts=decodeURIComponent(m[1]).split(";");for(var i=0;i<parts.length;i++){var p=parts[i],j=p.indexOf(":");if(j>0){var k=p.slice(0,j),v=p.slice(j+1);if(/^[a-zA-Z]+$/.test(k)&&/^[a-zA-Z0-9-]+$/.test(v)){if(k==="theme"&&v==="auto"){v=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";}ds[k]=v;}}}}else{var t=localStorage.getItem("${THEME_STORAGE_KEY}");ds.theme=(t==="light"||t==="dark")?t:"${DEFAULT_THEME}";}if(!ds.theme){ds.theme="${DEFAULT_THEME}";}}catch(e){document.documentElement.dataset.theme="${DEFAULT_THEME}";}})();`;
