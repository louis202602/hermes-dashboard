import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_CONTEXT_SETTINGS,
  buildContextBarModel,
  formatClock,
  isCacheFresh,
  isValidTimeZone,
  offsetLabel,
  parseWeather,
  resolveTimezone,
  timezoneOffsetMinutes,
  weatherCodeInfo,
  WEATHER_TTL_MS,
} from "../lib/dashboard/contextBar.ts";

// Fixed instants — summer (DST on) and winter (DST off) — so every clock/offset
// assertion is deterministic and never depends on "now".
const SUMMER = new Date("2026-07-15T12:00:00Z");
const WINTER = new Date("2026-01-15T12:00:00Z");

// --- TIMEZONE_PARIS ---------------------------------------------------------
test("TIMEZONE_PARIS: Europe/Paris renders local wall clock (CEST +2)", () => {
  const c = formatClock(SUMMER, "Europe/Paris", "fr-FR");
  assert.equal(c.time, "14:00"); // 12:00Z + 2h
  assert.equal(c.offset, "UTC+2");
  assert.equal(timezoneOffsetMinutes(SUMMER, "Europe/Paris"), 120);
});

// --- TIMEZONE_NEW_YORK ------------------------------------------------------
test("TIMEZONE_NEW_YORK: America/New_York differs from Paris (EDT -4)", () => {
  const c = formatClock(SUMMER, "America/New_York", "fr-FR");
  assert.equal(c.time, "08:00"); // 12:00Z - 4h
  assert.equal(c.offset, "UTC-4");
  assert.equal(timezoneOffsetMinutes(SUMMER, "America/New_York"), -240);
});

// --- DST_SAFE ---------------------------------------------------------------
test("DST_SAFE: same zone, offset follows the season", () => {
  // Paris: +2 in July, +1 in January — the offset is computed per-instant.
  assert.equal(timezoneOffsetMinutes(SUMMER, "Europe/Paris"), 120);
  assert.equal(timezoneOffsetMinutes(WINTER, "Europe/Paris"), 60);
  assert.equal(formatClock(WINTER, "Europe/Paris", "fr-FR").time, "13:00");
  assert.equal(offsetLabel(WINTER, "Europe/Paris"), "UTC+1");
});

test("timezone validation + precedence user→tenant→UTC", () => {
  assert.equal(isValidTimeZone("Europe/Madrid"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);

  assert.deepEqual(
    resolveTimezone({ userTimezone: "America/New_York", tenantTimezone: "Europe/Paris" }),
    { timezone: "America/New_York", source: "user" },
  );
  assert.deepEqual(
    resolveTimezone({ userTimezone: null, tenantTimezone: "Europe/Paris" }),
    { timezone: "Europe/Paris", source: "tenant" },
  );
  // Invalid tenant zone must not break the clock — fall through to UTC.
  assert.deepEqual(
    resolveTimezone({ userTimezone: "nope", tenantTimezone: "nope" }),
    { timezone: "UTC", source: "fallback" },
  );
});

// --- WEATHER_SUCCESS --------------------------------------------------------
test("WEATHER_SUCCESS: Open-Meteo current payload parses fully", () => {
  const w = parseWeather({
    current: {
      temperature_2m: 24.3,
      weather_code: 0,
      precipitation: 0,
      wind_speed_10m: 12.5,
    },
  });
  assert.ok(w);
  assert.equal(w!.temperatureC, 24.3);
  assert.equal(w!.weatherCode, 0);
  assert.equal(w!.condition, "Ciel dégagé");
  assert.equal(w!.icon, "☀️");
  assert.equal(w!.precipitationMm, 0);
  assert.equal(w!.windKph, 12.5);

  // Rain + wind present in the mapping.
  const rainy = parseWeather({
    current: { temperature_2m: 9, weather_code: 63, precipitation: 2.4, wind_speed_10m: 30 },
  });
  assert.equal(rainy!.condition, "Pluie");
  assert.equal(rainy!.precipitationMm, 2.4);
  assert.equal(weatherCodeInfo(95).label, "Orage");
});

// --- WEATHER_UNAVAILABLE ----------------------------------------------------
test("WEATHER_UNAVAILABLE: malformed payloads yield null, never a fake reading", () => {
  assert.equal(parseWeather(null), null);
  assert.equal(parseWeather({}), null);
  assert.equal(parseWeather({ current: {} }), null);
  assert.equal(parseWeather({ current: { temperature_2m: "warm" } }), null);
  // Unknown code still parses (temp present) but labels honestly.
  const u = parseWeather({ current: { temperature_2m: 10, weather_code: 4242 } });
  assert.equal(u!.condition, "Conditions inconnues");
  assert.equal(u!.precipitationMm, null);
  assert.equal(u!.windKph, null);
});

// --- WEATHER_CACHE ----------------------------------------------------------
test("WEATHER_CACHE: freshness window is the 15-min TTL", () => {
  const now = 1_000_000_000_000;
  assert.equal(WEATHER_TTL_MS, 15 * 60 * 1000);
  assert.equal(isCacheFresh(now - 5 * 60 * 1000, now), true); // 5 min old
  assert.equal(isCacheFresh(now - 20 * 60 * 1000, now), false); // 20 min old
  assert.equal(isCacheFresh(now, now), true);
  assert.equal(isCacheFresh(Number.NaN, now), false);
});

// --- NO_LOCATION ------------------------------------------------------------
test("NO_LOCATION: no weather ⇒ UNAVAILABLE segment, clock still works on UTC", () => {
  const model = buildContextBarModel({
    settings: DEFAULT_CONTEXT_SETTINGS,
    timezone: "UTC",
    timezoneSource: "fallback",
    weather: null,
    costTodayUsd: 0,
    alertCount: 0,
    nextEvent: null,
  });
  assert.equal(model.weather.provenance, "UNAVAILABLE");
  assert.equal(model.settings.locationConfigured, false);
  assert.equal(formatClock(SUMMER, model.timezone, "fr-FR").time, "12:00");
});

// --- COST_AVAILABLE ---------------------------------------------------------
test("COST_AVAILABLE: real day exposure surfaces with SOURCE currency (USD)", () => {
  const model = buildContextBarModel({
    settings: DEFAULT_CONTEXT_SETTINGS,
    timezone: "Europe/Paris",
    timezoneSource: "tenant",
    weather: null,
    costTodayUsd: 0.02,
    alertCount: 1,
    nextEvent: null,
  });
  assert.equal(model.cost.provenance, "REAL");
  if (model.cost.provenance === "REAL") {
    assert.equal(model.cost.todayAmount, 0.02);
    assert.equal(model.cost.currency, "USD");
  }
  assert.equal(model.alerts.provenance, "REAL");
  if (model.alerts.provenance === "REAL") assert.equal(model.alerts.count, 1);
});

// --- COST_UNAVAILABLE -------------------------------------------------------
test("COST_UNAVAILABLE: null cost ⇒ UNAVAILABLE, no fabricated amount", () => {
  const model = buildContextBarModel({
    settings: DEFAULT_CONTEXT_SETTINGS,
    timezone: "UTC",
    timezoneSource: "fallback",
    weather: null,
    costTodayUsd: null,
    alertCount: null,
    nextEvent: null,
  });
  assert.equal(model.cost.provenance, "UNAVAILABLE");
  assert.equal(model.alerts.provenance, "UNAVAILABLE");
  assert.equal(model.nextEvent.provenance, "UNAVAILABLE");
});

// --- LIGHT / DARK / TABLET (design-system contract, deterministic proxy) -----
test("LIGHT/DARK/TABLET: bar is token-driven and has the tablet breakpoint", () => {
  const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  // The block exists and is painted from shared theme tokens (⇒ LIGHT + DARK
  // both covered, since tokens flip under [data-theme]).
  assert.match(css, /\.context-bar\s*\{/);
  assert.match(css, /\.context-bar[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.context-time[^}]*color:\s*var\(--text-primary\)/s);
  // No hardcoded hex colour inside the context-bar base rule.
  const barRule = css.slice(css.indexOf(".context-bar {"));
  const barBlock = barRule.slice(0, barRule.indexOf("}") + 1);
  assert.doesNotMatch(barBlock, /#[0-9a-fA-F]{3,8}\b/);
  // Galaxy Tab S7+ breakpoint hides the tablet-only details.
  assert.match(css, /@media \(max-width: 1460px\)[^@]*\.context-hide-tablet/s);
  // Mobile breakpoint present.
  assert.match(css, /@media \(max-width: 560px\)[^@]*\.context-hide-mobile/s);
});
