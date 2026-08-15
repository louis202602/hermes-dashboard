import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  HERMES_DEFAULT_APPEARANCE,
  HERMES_DEFAULT_BEHAVIOR,
  HERMES_DEFAULT_PREFERENCES,
  appearanceToDataset,
  appearanceToHtmlAttrs,
  clampAppearance,
  clampRegional,
  datasetToAppearance,
  effectiveAppearance,
  parseAppearanceCookie,
  parsePreferences,
  resolvePreferences,
  serializeAppearanceCookie,
  type Appearance,
} from "../lib/dashboard/preferences.ts";
import { formatClock } from "../lib/dashboard/contextBar.ts";

// --- PREFERENCES_EMPTY_DEFAULTS --------------------------------------------
test("PREFERENCES_EMPTY_DEFAULTS: empty/unauth payload ⇒ Hermès defaults, no leak", () => {
  const p = parsePreferences({ resolution_status: "UNAUTHENTICATED" });
  assert.equal(p.resolutionStatus, "UNAUTHENTICATED");
  assert.deepEqual(p.appearance, HERMES_DEFAULT_APPEARANCE);
  assert.equal(p.version, 0);
  // A fully empty OK row also resolves to defaults.
  const q = parsePreferences({ resolution_status: "OK", tenant_id: "t", version: 0 });
  assert.deepEqual(q.appearance, HERMES_DEFAULT_APPEARANCE);
});

// --- PREFERENCES_USER_OVERRIDE ---------------------------------------------
test("PREFERENCES_USER_OVERRIDE: user override wins, other fields preserved", () => {
  const r = resolvePreferences(
    { appearance: { theme: "ocean", accent: "purple" } as Appearance },
    null,
  );
  assert.equal(r.appearance.theme, "ocean");
  assert.equal(r.appearance.accent, "purple");
  assert.equal(r.appearance.density, "comfortable"); // untouched default
});

// --- PREFERENCES_TENANT_FALLBACK -------------------------------------------
test("PREFERENCES_TENANT_FALLBACK: tenant default applies when user has none", () => {
  const r = resolvePreferences(null, {
    appearance: { theme: "graphite" } as Appearance,
  });
  assert.equal(r.appearance.theme, "graphite");
  // user overrides tenant when both present
  const r2 = resolvePreferences(
    { appearance: { theme: "solar" } as Appearance },
    { appearance: { theme: "graphite" } as Appearance },
  );
  assert.equal(r2.appearance.theme, "solar");
});

// --- CLAMP (fail-safe) ------------------------------------------------------
test("clampAppearance: invalid values collapse to Hermès default", () => {
  const a = clampAppearance({
    theme: "hacker",
    accent: "chartreuse",
    density: 42,
    reduceMotion: "yes",
    blur: "high",
  });
  assert.equal(a.theme, "dark");
  assert.equal(a.accent, "blue");
  assert.equal(a.density, "comfortable");
  assert.equal(a.reduceMotion, false);
  assert.equal(a.blur, "high"); // valid value kept
});

// --- THEME_LIGHT / DARK / AUTO + ACCENT + variants (dataset mapping) -------
test("appearanceToDataset: maps every axis; auto emitted verbatim", () => {
  const ds = appearanceToDataset({
    ...HERMES_DEFAULT_APPEARANCE,
    theme: "auto",
    accent: "cyan",
    contrast: "high",
    transparency: "solid",
    blur: "none",
    radius: "large",
    shadow: "subtle",
    font: "modern",
    textSize: "large",
    fontWeight: "strong",
    density: "compact",
    reduceMotion: true,
    reduceTransparency: true,
  });
  assert.equal(ds.theme, "auto"); // THEME_AUTO — resolved later by the client/init
  assert.equal(ds.accent, "cyan");
  assert.equal(ds.contrast, "high");
  assert.equal(ds.transparency, "solid");
  assert.equal(ds.blur, "none");
  assert.equal(ds.radius, "large");
  assert.equal(ds.shadow, "subtle");
  assert.equal(ds.font, "modern");
  assert.equal(ds.textsize, "large");
  assert.equal(ds.weight, "strong");
  assert.equal(ds.density, "compact");
  assert.equal(ds.reduceMotion, "1");
  assert.equal(ds.reduceTransparency, "1");
});

test("appearanceToDataset: reduce flags omitted when off", () => {
  const ds = appearanceToDataset(HERMES_DEFAULT_APPEARANCE);
  assert.equal("reduceMotion" in ds, false);
  assert.equal("reduceTransparency" in ds, false);
  assert.equal(ds.theme, "dark");
});

// --- ANTI_FOUC cookie roundtrip --------------------------------------------
test("cookie serialise/parse roundtrip (anti-FOUC contract)", () => {
  const a: Appearance = {
    ...HERMES_DEFAULT_APPEARANCE,
    theme: "midnight",
    accent: "green",
    density: "spacious",
    reduceMotion: true,
  };
  const cookie = serializeAppearanceCookie(a);
  assert.match(cookie, /theme:midnight/);
  assert.match(cookie, /accent:green/);
  assert.match(cookie, /density:spacious/);
  const parsed = parseAppearanceCookie(cookie);
  assert.equal(parsed.theme, "midnight");
  assert.equal(parsed.accent, "green");
  assert.equal(parsed.reduceMotion, "1");
  // junk pairs are ignored (defensive)
  const dirty = parseAppearanceCookie("theme:ocean;evil:<script>;x");
  assert.equal(dirty.theme, "ocean");
  assert.equal("evil" in dirty, false);
});

// --- REGIONAL override clamp (separate axis) --------------------------------
test("clampRegional: units/hourCycle/timezone override, junk dropped", () => {
  const r = clampRegional({
    locale: "en-US",
    timezone: "America/New_York",
    temperatureUnit: "F",
    windUnit: "mph",
    hourCycle: "12h",
    showSeconds: true,
    country: "US",
    currency: "USD",
    firstDayOfWeek: "sunday",
    dateFormat: "long",
    bogus: "x",
  });
  assert.equal(r.locale, "en-US");
  assert.equal(r.timezone, "America/New_York");
  assert.equal(r.temperatureUnit, "F");
  assert.equal(r.windUnit, "mph");
  assert.equal(r.hourCycle, "12h");
  assert.equal(r.showSeconds, true);
  assert.equal(r.firstDayOfWeek, "sunday");
  // invalid values → null / default
  const bad = clampRegional({ temperatureUnit: "K", hourCycle: "13h", firstDayOfWeek: "friday" });
  assert.equal(bad.temperatureUnit, null);
  assert.equal(bad.hourCycle, null);
  assert.equal(bad.firstDayOfWeek, "auto");
});

// --- REGIONAL Intl validation (IANA / locale / currency / country) ----------
test("clampRegional: IANA timezone / locale / currency / country validated by Intl", () => {
  const good = clampRegional({
    timezone: "Europe/Paris",
    locale: "fr-FR",
    currency: "eur", // lowercased input → uppercased ISO
    country: "fr", // lowercased alpha-2 → uppercased
  });
  assert.equal(good.timezone, "Europe/Paris");
  assert.equal(good.locale, "fr-FR");
  assert.equal(good.currency, "EUR");
  assert.equal(good.country, "FR");
  // Garbage in every field ⇒ null (never stored/consumed).
  const bad = clampRegional({
    timezone: "Mars/Olympus_Mons",
    locale: "not a locale!!",
    currency: "EUROS",
    country: "FRA",
  });
  assert.equal(bad.timezone, null);
  assert.equal(bad.locale, null);
  assert.equal(bad.currency, null);
  assert.equal(bad.country, null);
});

// --- SSR anti-FOUC: html attrs + dataset roundtrip --------------------------
test("appearanceToHtmlAttrs: data-* attributes for server-side first paint", () => {
  const attrs = appearanceToHtmlAttrs({
    ...HERMES_DEFAULT_APPEARANCE,
    theme: "ocean",
    accent: "cyan",
    textSize: "large",
    fontWeight: "strong",
    reduceMotion: true,
  });
  assert.equal(attrs["data-theme"], "ocean");
  assert.equal(attrs["data-accent"], "cyan");
  assert.equal(attrs["data-textsize"], "large");
  assert.equal(attrs["data-weight"], "strong");
  assert.equal(attrs["data-reduce-motion"], "1");
  // "auto" is emitted verbatim (the init script resolves it against the OS).
  const auto = appearanceToHtmlAttrs({ ...HERMES_DEFAULT_APPEARANCE, theme: "auto" });
  assert.equal(auto["data-theme"], "auto");
});

test("datasetToAppearance ∘ appearanceToDataset: lossless clamped roundtrip", () => {
  const a: Appearance = {
    ...HERMES_DEFAULT_APPEARANCE,
    theme: "midnight",
    accent: "purple",
    density: "spacious",
    reduceTransparency: true,
  };
  const back = datasetToAppearance(appearanceToDataset(a));
  assert.deepEqual(back, a);
});

// --- effectiveAppearance: animations off ⇒ reduced motion -------------------
test("effectiveAppearance: disabling animations enforces reduced motion", () => {
  const eff = effectiveAppearance(HERMES_DEFAULT_APPEARANCE, {
    ...HERMES_DEFAULT_BEHAVIOR,
    animations: false,
  });
  assert.equal(eff.reduceMotion, true);
  // Never the reverse: animations on + reduceMotion off ⇒ stays off.
  const eff2 = effectiveAppearance(HERMES_DEFAULT_APPEARANCE, HERMES_DEFAULT_BEHAVIOR);
  assert.equal(eff2.reduceMotion, false);
});

// --- SHOW_SECONDS (clock) ---------------------------------------------------
test("SHOW_SECONDS: formatClock includes seconds only when requested", () => {
  const instant = new Date("2026-07-15T12:00:30Z");
  const without = formatClock(instant, "Europe/Paris", "fr-FR", { showSeconds: false });
  const withSec = formatClock(instant, "Europe/Paris", "fr-FR", { showSeconds: true });
  assert.equal(without.time, "14:00");
  assert.match(withSec.time, /14:00:30/);
});

// --- default preferences shape ---------------------------------------------
test("HERMES_DEFAULT_PREFERENCES is stable + schema-versioned", () => {
  assert.equal(HERMES_DEFAULT_PREFERENCES.schemaVersion, 1);
  assert.equal(HERMES_DEFAULT_PREFERENCES.appearance.theme, "dark");
  assert.equal(HERMES_DEFAULT_PREFERENCES.behavior.animations, true);
  assert.equal(HERMES_DEFAULT_PREFERENCES.regional.showSeconds, false);
});

// --- CSS contract: tokens + settings surface exist (LIGHT/DARK/TABLET/MOBILE) -
test("CSS: personalization tokens + settings surface present, token-driven", () => {
  const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /html\[data-theme="midnight"\]/);
  assert.match(css, /html\[data-accent="cyan"\]/);
  assert.match(css, /html\[data-density="compact"\]/);
  assert.match(css, /html\[data-reduce-motion="1"\]/);
  assert.match(css, /html\[data-blur="none"\]/);
  assert.match(css, /\.settings-section/);
  assert.match(css, /\.settings-switch/);
  // responsive: settings collapses to one column on tablet/mobile
  assert.match(css, /@media \(max-width: 820px\)[^@]*\.settings-body/s);
});
