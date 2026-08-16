"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  makeClientTranslator,
  type LanguageCode,
  type Messages,
  type TranslateFn,
} from "@/lib/i18n/languages";

type I18nValue = { t: TranslateFn; lang: LanguageCode; dir: "ltr" | "rtl" };

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Client i18n context. The active language AND its catalog are resolved SERVER-side (from
 * the user's canonical preference) and passed down as data, so the client only ever
 * carries the ONE active catalog — never the other languages. Switching language is a
 * server round-trip (router.refresh) — robust, no divergence, no extra catalogs shipped.
 */
export function I18nProvider({
  lang,
  dir,
  messages,
  children,
}: {
  lang: LanguageCode;
  dir: "ltr" | "rtl";
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ t: makeClientTranslator(messages), lang, dir }),
    [messages, lang, dir],
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
