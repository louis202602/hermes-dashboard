import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Import catalogs directly (relative). They only TYPE-import each other, so the
// type-stripping node runner loads them with no runtime alias resolution. The engine
// (index.ts) uses the @/ alias for the app, so its resolve/interpolate logic is
// mirrored here (a few lines) to keep the pure contract unit-tested.
import { fr } from "../lib/i18n/locales/fr.ts";
import { en } from "../lib/i18n/locales/en.ts";
import { es } from "../lib/i18n/locales/es.ts";
import { de } from "../lib/i18n/locales/de.ts";
import { it } from "../lib/i18n/locales/it.ts";
import { pt } from "../lib/i18n/locales/pt.ts";

const CATALOGS: Record<string, Record<string, string>> = { fr, en, es, de, it, pt };
const SUPPORTED = new Set(Object.keys(CATALOGS));

// mirrors lib/i18n resolveLanguage
function baseCode(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  return input.toLowerCase().split(/[-_]/)[0];
}
function resolveLanguage(u?: string | null, t?: string | null, b?: string | null): string {
  for (const c of [u, t, b]) {
    const x = baseCode(c);
    if (x && SUPPORTED.has(x)) return x;
  }
  return "fr";
}
function interpolate(tpl: string, params?: Record<string, string | number>): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
function makeT(code: string) {
  const cat = CATALOGS[code] ?? fr;
  return (key: string, params?: Record<string, string | number>) =>
    interpolate(cat[key] ?? fr[key] ?? key, params);
}

// --- CATALOG_KEYS_MATCH / MISSING_TRANSLATION_KEYS = 0 ----------------------
test("CATALOG_KEYS_MATCH: every language has exactly the fr key set", () => {
  const frKeys = Object.keys(fr).sort();
  assert.ok(frKeys.length > 100);
  for (const code of Object.keys(CATALOGS)) {
    const keys = Object.keys(CATALOGS[code]).sort();
    assert.deepEqual(keys, frKeys, `catalog ${code} keys differ from fr`);
    for (const k of keys) assert.ok(CATALOGS[code][k].length > 0, `${code}.${k} empty`);
  }
});

// --- LANGUAGE_FR/EN/ES/DE/IT/PT ---------------------------------------------
test("LANGUAGE_*: a known key is translated per language", () => {
  assert.equal(makeT("fr")("common.back"), "Retour");
  assert.equal(makeT("en")("common.back"), "Back");
  assert.equal(makeT("es")("common.back"), "Volver");
  assert.equal(makeT("de")("common.back"), "Zurück");
  assert.equal(makeT("it")("common.back"), "Indietro");
  assert.equal(makeT("pt")("common.back"), "Voltar");
});

// --- UNKNOWN_LANGUAGE_FALLBACK ----------------------------------------------
test("resolveLanguage: normalization + fallback chain", () => {
  assert.equal(resolveLanguage("en"), "en");
  assert.equal(resolveLanguage("pt-BR"), "pt");
  assert.equal(resolveLanguage("DE_de"), "de");
  assert.equal(resolveLanguage("xx"), "fr");
  assert.equal(resolveLanguage(null, "es-ES"), "es");
  assert.equal(resolveLanguage(null, null, "it-IT"), "it");
  assert.equal(resolveLanguage(null, null, null), "fr");
});

// --- MISSING_KEY_FALLBACK ---------------------------------------------------
test("makeTranslator: missing key ⇒ default catalog ⇒ key (never crash)", () => {
  assert.equal(makeT("de")("does.not.exist"), "does.not.exist");
  assert.equal(makeT("de")("common.save.saved"), "Gespeichert");
});

// --- interpolation ----------------------------------------------------------
test("interpolation: {params} substituted, unknown left intact", () => {
  assert.equal(makeT("en")("context.alerts.other", { count: 3 }), "3 alerts");
  assert.match(makeT("en")("settings.widget.hide", { name: "KPIs" }), /KPIs/);
  assert.equal(makeT("fr")("common.back"), "Retour");
});

// --- NO_LLM / NO_EXTERNAL_TRANSLATION_API -----------------------------------
test("i18n is static: no fetch / network / LLM in engine or catalogs", () => {
  for (const rel of ["../lib/i18n/index.ts", "../lib/i18n/locales/fr.ts", "../lib/i18n/locales/de.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /https?:\/\//);
    assert.doesNotMatch(src, /openai|anthropic|translate\.googleapis|deepl/i);
  }
});
