"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  makeTranslator,
  type LanguageCode,
  type TranslateFn,
} from "@/lib/i18n";

type I18nValue = { t: TranslateFn; lang: LanguageCode; dir: "ltr" | "rtl" };

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Client i18n context. The active language is resolved SERVER-side (from the user's
 * canonical preference) and passed down, so the client only ever carries the active
 * catalog. Switching language is a server round-trip (router.refresh) — robust, no
 * divergence, no extra catalogs shipped.
 */
export function I18nProvider({
  lang,
  dir,
  children,
}: {
  lang: LanguageCode;
  dir: "ltr" | "rtl";
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ t: makeTranslator(lang), lang, dir }),
    [lang, dir],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Defensive: never crash if a component renders outside the provider.
    return { t: (k) => String(k), lang: "fr", dir: "ltr" };
  }
  return ctx;
}
