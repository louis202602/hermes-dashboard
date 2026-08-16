/**
 * i18n engine (server side) — pure, DOM-free. Static catalogs (no LLM, no external API,
 * no network). This module imports ALL catalogs, so it must only be pulled into the
 * SERVER bundle: server components resolve the active catalog with `getCatalog(...)` and
 * pass it to `<I18nProvider messages={...}>`, so the client only ever ships one catalog.
 * Client code must import language primitives from `@/lib/i18n/languages` instead.
 */
import { fr } from "@/lib/i18n/locales/fr";
import { en } from "@/lib/i18n/locales/en";
import { es } from "@/lib/i18n/locales/es";
import { de } from "@/lib/i18n/locales/de";
import { it } from "@/lib/i18n/locales/it";
import { pt } from "@/lib/i18n/locales/pt";
import {
  DEFAULT_LANGUAGE,
  interpolate,
  type LanguageCode,
  type Messages,
  type TranslateFn,
} from "@/lib/i18n/languages";

// Re-export the client-safe API so existing server-side imports keep working.
export * from "@/lib/i18n/languages";

const CATALOGS: Record<LanguageCode, Messages> = { fr, en, es, de, it, pt };

export function getCatalog(code: LanguageCode): Messages {
  return CATALOGS[code] ?? CATALOGS[DEFAULT_LANGUAGE];
}

/**
 * Server-side translator with a default-catalog fallback (catalog[key] ⇒ fr[key] ⇒ key).
 * The client uses `makeClientTranslator` over the single active catalog instead.
 */
export function makeTranslator(code: LanguageCode): TranslateFn {
  const catalog = getCatalog(code);
  const fallback = CATALOGS[DEFAULT_LANGUAGE];
  return (key, params) =>
    interpolate(catalog[key] ?? fallback[key] ?? key, params);
}
