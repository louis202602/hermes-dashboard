/**
 * i18n engine — pure, DOM-free. Static catalogs (no LLM, no external API, no network).
 * The active language is resolved from the user's canonical preference
 * (`dashboard_user_preferences.regional.language`) with a clear fallback chain; the UI
 * label lookup falls back to the default catalog then the key itself, never crashing.
 */
import { fr, type MessageKey, type Messages } from "@/lib/i18n/locales/fr";
import { en } from "@/lib/i18n/locales/en";
import { es } from "@/lib/i18n/locales/es";
import { de } from "@/lib/i18n/locales/de";
import { it } from "@/lib/i18n/locales/it";
import { pt } from "@/lib/i18n/locales/pt";

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
 * `locales/<code>.ts` (typed `: Messages`, so the key set is enforced) + one row here.
 * `dir: "rtl"` is honored end-to-end, so `ar`/`he` slot in without a layout rewrite.
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

const CATALOGS: Record<LanguageCode, Messages> = { fr, en, es, de, it, pt };
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

export function getCatalog(code: LanguageCode): Messages {
  return CATALOGS[code] ?? CATALOGS[DEFAULT_LANGUAGE];
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in params ? String(params[k]) : m,
  );
}

export type TranslateFn = (
  key: MessageKey,
  params?: Record<string, string | number>,
) => string;

/**
 * Build a `t` for a language. Missing key ⇒ default catalog ⇒ the key string
 * (never a crash). Params interpolate `{name}` placeholders.
 */
export function makeTranslator(code: LanguageCode): TranslateFn {
  const catalog = getCatalog(code);
  const fallback = CATALOGS[DEFAULT_LANGUAGE];
  return (key, params) =>
    interpolate(catalog[key] ?? fallback[key] ?? key, params);
}

export function isRtl(code: LanguageCode): boolean {
  return getLanguageDef(code).dir === "rtl";
}
