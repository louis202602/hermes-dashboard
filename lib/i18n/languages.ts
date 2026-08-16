/**
 * Client-safe i18n primitives — language list, resolution, direction, interpolation,
 * and a translator that works over a SINGLE already-resolved catalog.
 *
 * This module imports NO catalog VALUES (only the `Messages` *type*, which is elided at
 * build time). It is therefore safe to pull into the client bundle: the active catalog is
 * resolved server-side and handed to the client as plain data, so the client never ships
 * the other languages' catalogs. Keep it value-import-free from `./locales/*`.
 */
import type { Messages, MessageKey } from "@/lib/i18n/locales/fr";

export type { Messages, MessageKey };

export type LanguageCode = "fr" | "en" | "es" | "de" | "it" | "pt";

export type LanguageDef = {
  code: LanguageCode;
  /** Native name shown in the language picker. */
  label: string;
  dir: "ltr" | "rtl";
  /** Default BCP-47 locale when the user hasn't set an explicit locale override. */
  defaultLocale: string;
};

/**
 * Supported languages. Architecture is NOT capped at 6 — add a language by dropping a
 * `locales/<code>.ts` (typed `: Messages`, so the key set is enforced), one row here, and
 * one line in `index.ts`'s CATALOGS map. `dir: "rtl"` is honored end-to-end, so `ar`/`he`
 * slot in without a layout rewrite.
 */
export const LANGUAGES: LanguageDef[] = [
  { code: "fr", label: "Français", dir: "ltr", defaultLocale: "fr-FR" },
  { code: "en", label: "English", dir: "ltr", defaultLocale: "en-US" },
  { code: "es", label: "Español", dir: "ltr", defaultLocale: "es-ES" },
  { code: "de", label: "Deutsch", dir: "ltr", defaultLocale: "de-DE" },
  { code: "it", label: "Italiano", dir: "ltr", defaultLocale: "it-IT" },
  { code: "pt", label: "Português", dir: "ltr", defaultLocale: "pt-PT" },
];

export const DEFAULT_LANGUAGE: LanguageCode = "fr";

const SUPPORTED = new Set<string>(LANGUAGES.map((l) => l.code));

export function isSupportedLanguage(code: unknown): code is LanguageCode {
  return typeof code === "string" && SUPPORTED.has(code);
}

/** Normalize any locale/language token ("fr-FR", "EN", "pt_BR") to a base code. */
function baseCode(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  return input.toLowerCase().split(/[-_]/)[0];
}

/**
 * Resolve the active UI language. Priority: user language → tenant language →
 * (optional) browser language → Hermès default (fr). Each candidate is normalized and
 * kept only if supported.
 */
export function resolveLanguage(
  userLanguage?: string | null,
  tenantLanguage?: string | null,
  browserLanguage?: string | null,
): LanguageCode {
  for (const cand of [userLanguage, tenantLanguage, browserLanguage]) {
    const c = baseCode(cand);
    if (c && isSupportedLanguage(c)) return c;
  }
  return DEFAULT_LANGUAGE;
}

export function getLanguageDef(code: LanguageCode): LanguageDef {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function isRtl(code: LanguageCode): boolean {
  return getLanguageDef(code).dir === "rtl";
}

export type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in params ? String(params[k]) : m,
  );
}

/**
 * Translator over a SINGLE already-resolved catalog (the active language). Catalogs are
 * key-identical by construction (TypeScript enforces it), so the active catalog always
 * holds every key; a missing lookup falls back to the key string, never a crash. Used on
 * the client, where only the active catalog is present.
 */
export function makeClientTranslator(messages: Messages): TranslateFn {
  return (key, params) => interpolate(messages[key] ?? key, params);
}
