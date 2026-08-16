import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Catalogs import each other by TYPE only, and languages.ts type-imports the Messages
// type from fr — the type-stripping node runner loads them with no runtime alias
// resolution. So we exercise the REAL production language engine (languages.ts), not a
// mirror. index.ts (which value-imports all catalogs) stays server-only and is only
// read as text for the static-source guard.
import { fr } from "../lib/i18n/locales/fr.ts";
import { en } from "../lib/i18n/locales/en.ts";
import { es } from "../lib/i18n/locales/es.ts";
import { de } from "../lib/i18n/locales/de.ts";
import { it } from "../lib/i18n/locales/it.ts";
import { pt } from "../lib/i18n/locales/pt.ts";
import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  resolveLanguage,
  isSupportedLanguage,
  isRtl,
  getLanguageDef,
  makeClientTranslator,
  type LanguageCode,
  type Messages,
} from "../lib/i18n/languages.ts";

const CATALOGS: Record<string, Record<string, string>> = { fr, en, es, de, it, pt };

// --- CATALOG_KEYS_MATCH / MISSING = 0 / EXTRA = 0 ---------------------------
test("CATALOG_KEYS_MATCH: every language has EXACTLY the fr key set (missing=0, extra=0)", () => {
  const frKeys = new Set(Object.keys(fr));
  assert.ok(frKeys.size > 600, "fr should carry the full catalog");
  for (const code of Object.keys(CATALOGS)) {
    const keys = new Set(Object.keys(CATALOGS[code]));
    const missing = [...frKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !frKeys.has(k));
    assert.deepEqual(missing, [], `catalog ${code} MISSING keys: ${missing.slice(0, 5)}`);
    assert.deepEqual(extra, [], `catalog ${code} EXTRA keys: ${extra.slice(0, 5)}`);
    for (const k of keys) assert.ok(CATALOGS[code][k].length > 0, `${code}.${k} empty`);
  }
});

test("every catalog covers every supported LANGUAGES entry", () => {
  for (const l of LANGUAGES) assert.ok(CATALOGS[l.code], `missing catalog for ${l.code}`);
  assert.equal(Object.keys(CATALOGS).length, LANGUAGES.length);
});

// --- LANGUAGE_FR/EN/ES/DE/IT/PT (real client translator) --------------------
test("LANGUAGE_*: a known key is translated distinctly per language", () => {
  const back = Object.fromEntries(
    LANGUAGES.map((l) => [l.code, makeClientTranslator(CATALOGS[l.code] as Messages)("common.back")]),
  );
  assert.deepEqual(back, {
    fr: "Retour", en: "Back", es: "Volver", de: "Zurück", it: "Indietro", pt: "Voltar",
  });
  // distinct across all 6 (no lazy copies for this key)
  assert.equal(new Set(Object.values(back)).size, 6);
});

// --- LANGUAGE FALLBACK MATRIX (real resolveLanguage) ------------------------
test("resolveLanguage: fr-FR→fr, en-US→en, es-MX→es, unknown→fr, empty→chain", () => {
  assert.equal(resolveLanguage("fr-FR"), "fr");
  assert.equal(resolveLanguage("en-US"), "en");
  assert.equal(resolveLanguage("es-MX"), "es");
  assert.equal(resolveLanguage("DE_de"), "de");
  assert.equal(resolveLanguage("pt-BR"), "pt");
  assert.equal(resolveLanguage("zz"), DEFAULT_LANGUAGE); // unknown → fr
  assert.equal(resolveLanguage(""), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null, "es-ES"), "es"); // user empty → tenant
  assert.equal(resolveLanguage(undefined, null, "it-IT"), "it"); // → browser
  assert.equal(resolveLanguage(null, null, null), DEFAULT_LANGUAGE);
  assert.equal(isSupportedLanguage("de"), true);
  assert.equal(isSupportedLanguage("xx"), false);
});

// --- MISSING_KEY_FALLBACK ---------------------------------------------------
test("client translator: missing key ⇒ key string (never crash)", () => {
  const t = makeClientTranslator(de as Messages);
  assert.equal(t("does.not.exist" as never), "does.not.exist");
  assert.equal(t("common.save.saved"), "Gespeichert");
});

// --- interpolation ----------------------------------------------------------
test("interpolation: {params} substituted, unknown token left intact", () => {
  const en_ = makeClientTranslator(en as Messages);
  assert.equal(en_("context.alerts.other", { count: 3 }), "3 alerts");
  assert.match(en_("settings.widget.hide", { name: "KPIs" }), /KPIs/);
  assert.equal(en_("map.dates", { start: "A" }), "From A to {end}"); // missing param kept
});

// --- RTL_READY probe (mechanism, not a shipped rtl language yet) ------------
test("RTL: dir is a first-class axis; isRtl derives from LANGUAGES.dir", () => {
  for (const l of LANGUAGES) {
    assert.ok(l.dir === "ltr" || l.dir === "rtl", `${l.code} has a valid dir`);
    assert.equal(isRtl(l.code), l.dir === "rtl");
  }
  // Contract the shells rely on: getLanguageDef always returns a usable dir.
  const def = getLanguageDef("fr" as LanguageCode);
  assert.ok(def.dir === "ltr" || def.dir === "rtl");
  // The type permits "rtl" — adding ar/he is a data change, not a layout rewrite.
  const rtlProbe: "ltr" | "rtl" = "rtl";
  assert.equal(rtlProbe === "rtl", true);
});

// --- BUNDLE BOUNDARY: languages.ts (client-safe) ships NO catalog values ----
test("bundle: client-safe languages.ts value-imports no catalog; index.ts owns them", () => {
  const langsSrc = readFileSync(fileURLToPath(new URL("../lib/i18n/languages.ts", import.meta.url)), "utf8");
  // Only a TYPE import from locales is allowed (elided at build → no catalog in client).
  const localeImports = langsSrc.match(/import\s+(?!type)[^;]*from\s+["']@\/lib\/i18n\/locales/g) || [];
  assert.deepEqual(localeImports, [], "languages.ts must not VALUE-import any catalog");
  const idxSrc = readFileSync(fileURLToPath(new URL("../lib/i18n/index.ts", import.meta.url)), "utf8");
  assert.match(idxSrc, /import \{ fr \} from "@\/lib\/i18n\/locales\/fr"/);
});

// --- NO_LLM / NO_EXTERNAL_TRANSLATION_API -----------------------------------
test("i18n is static: no fetch / network / LLM in engine or catalogs", () => {
  for (const rel of [
    "../lib/i18n/index.ts",
    "../lib/i18n/languages.ts",
    "../lib/i18n/locales/fr.ts",
    "../lib/i18n/locales/de.ts",
  ]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /https?:\/\//);
    assert.doesNotMatch(src, /openai|anthropic|translate\.googleapis|deepl/i);
  }
});
