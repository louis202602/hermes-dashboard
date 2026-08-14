/**
 * DASH-1 — Command Center context bar: pure, DOM-free logic.
 *
 * No LLM, no I/O, no secrets. Time / date / timezone are **deterministic** via
 * `Intl` (zero network, DST-safe). Weather parsing is a pure transform over an
 * Open-Meteo payload. Everything here is unit-tested (`tests/context-bar.test.ts`)
 * and safe to import from server code, the client bar, and the test runner alike.
 *
 * International-ready by construction: LOCALE, COUNTRY, TIMEZONE and CURRENCY are
 * kept as **separate** fields — never conflated into a single "France" assumption.
 */

// --- International context settings -----------------------------------------

export type TimezoneSource = "user" | "tenant" | "fallback";

/**
 * Resolved per-tenant (later per-user) context. `timezone` is always a valid
 * IANA zone (falls back to `UTC`). `latitude`/`longitude` drive weather and are
 * null until an operator configures a location (never fabricated).
 */
export type ContextSettings = {
  resolutionStatus: string;
  tenantId: string | null;
  city: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  locale: string;
  country: string;
  currency: string;
  locationConfigured: boolean;
};

/** Neutral fallback used when no tenant row exists or the caller is anonymous. */
export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  resolutionStatus: "NO_TENANT",
  tenantId: null,
  city: null,
  timezone: "UTC",
  latitude: null,
  longitude: null,
  locale: "fr-FR",
  country: "FR",
  currency: "EUR",
  locationConfigured: false,
};

/** IANA validity via `Intl` — no network. Invalid / empty zone ⇒ false. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // Throws a RangeError for an unknown time zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Timezone precedence: **user → tenant → UTC**. Invalid zones are skipped so a
 * corrupt value never breaks the clock. The `source` lets the client decide
 * whether to opportunistically upgrade a `fallback` to the browser zone.
 */
export function resolveTimezone(input: {
  userTimezone?: string | null;
  tenantTimezone?: string | null;
}): { timezone: string; source: TimezoneSource } {
  if (isValidTimeZone(input.userTimezone)) {
    return { timezone: input.userTimezone as string, source: "user" };
  }
  if (isValidTimeZone(input.tenantTimezone)) {
    return { timezone: input.tenantTimezone as string, source: "tenant" };
  }
  return { timezone: "UTC", source: "fallback" };
}

/**
 * Offset of `timezone` from UTC, in minutes, for a specific instant. Computed by
 * comparing the wall-clock `Intl` rendering to the UTC instant, so it reflects
 * the **actual DST offset in effect** (e.g. Europe/Paris = +120 in summer, +60
 * in winter). Deterministic, no network.
 */
export function timezoneOffsetMinutes(instant: Date, timezone: string): number {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  // `hour` can be 24 at midnight in some engines — normalize to 0.
  const hour = m.hour === 24 ? 0 : m.hour;
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** `UTC`, `UTC+2`, `UTC-4:30` … derived from the DST-aware offset. */
export function offsetLabel(instant: Date, timezone: string): string {
  const mins = timezoneOffsetMinutes(instant, timezone);
  if (mins === 0) return "UTC";
  const sign = mins > 0 ? "+" : "-";
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${h}${mm ? ":" + String(mm).padStart(2, "0") : ""}`;
}

/**
 * Deterministic 24h clock + short date for an IANA zone + locale. DST-safe:
 * `Intl` applies the offset in effect at `instant`. Never touches "now" itself,
 * so it is fully testable with a fixed instant.
 */
export function formatClock(
  instant: Date,
  timezone: string,
  locale = "fr-FR",
): { time: string; date: string; offset: string } {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(instant);
  return { time, date, offset: offsetLabel(instant, tz) };
}

// --- Weather (Open-Meteo, no key, no secret) --------------------------------

export type WeatherSnapshot = {
  temperatureC: number;
  weatherCode: number;
  condition: string;
  icon: string;
  precipitationMm: number | null;
  windKph: number | null;
};

/** Server-cache TTL for the weather read — 15 min (COST-FIRST: no per-render call). */
export const WEATHER_TTL_MS = 15 * 60 * 1000;

/** Pure freshness check for a cached weather entry. */
export function isCacheFresh(
  fetchedAtMs: number,
  nowMs: number,
  ttlMs: number = WEATHER_TTL_MS,
): boolean {
  return Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs < ttlMs;
}

/** WMO weather-interpretation code → French label + emoji. */
export function weatherCodeInfo(code: number): { label: string; icon: string } {
  const table: Record<number, { label: string; icon: string }> = {
    0: { label: "Ciel dégagé", icon: "☀️" },
    1: { label: "Peu nuageux", icon: "🌤️" },
    2: { label: "Partiellement nuageux", icon: "⛅" },
    3: { label: "Couvert", icon: "☁️" },
    45: { label: "Brouillard", icon: "🌫️" },
    48: { label: "Brouillard givrant", icon: "🌫️" },
    51: { label: "Bruine légère", icon: "🌦️" },
    53: { label: "Bruine", icon: "🌦️" },
    55: { label: "Bruine dense", icon: "🌦️" },
    56: { label: "Bruine verglaçante", icon: "🌧️" },
    57: { label: "Bruine verglaçante dense", icon: "🌧️" },
    61: { label: "Pluie faible", icon: "🌧️" },
    63: { label: "Pluie", icon: "🌧️" },
    65: { label: "Pluie forte", icon: "🌧️" },
    66: { label: "Pluie verglaçante", icon: "🌧️" },
    67: { label: "Pluie verglaçante forte", icon: "🌧️" },
    71: { label: "Neige faible", icon: "🌨️" },
    73: { label: "Neige", icon: "🌨️" },
    75: { label: "Neige forte", icon: "❄️" },
    77: { label: "Grains de neige", icon: "🌨️" },
    80: { label: "Averses faibles", icon: "🌦️" },
    81: { label: "Averses", icon: "🌦️" },
    82: { label: "Averses violentes", icon: "⛈️" },
    85: { label: "Averses de neige", icon: "🌨️" },
    86: { label: "Averses de neige fortes", icon: "❄️" },
    95: { label: "Orage", icon: "⛈️" },
    96: { label: "Orage avec grêle", icon: "⛈️" },
    99: { label: "Orage violent avec grêle", icon: "⛈️" },
  };
  return table[code] ?? { label: "Conditions inconnues", icon: "🌡️" };
}

/**
 * Pure transform of an Open-Meteo `current` payload into a snapshot. Returns
 * `null` for any malformed / missing payload so callers surface an honest
 * UNAVAILABLE rather than a fabricated reading.
 */
export function parseWeather(payload: unknown): WeatherSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const current = (payload as { current?: unknown }).current;
  if (!current || typeof current !== "object") return null;
  const c = current as Record<string, unknown>;
  const temp = c.temperature_2m;
  if (typeof temp !== "number" || !Number.isFinite(temp)) return null;
  const code = typeof c.weather_code === "number" ? c.weather_code : -1;
  const info = weatherCodeInfo(code);
  return {
    temperatureC: temp,
    weatherCode: code,
    condition: info.label,
    icon: info.icon,
    precipitationMm:
      typeof c.precipitation === "number" && Number.isFinite(c.precipitation)
        ? c.precipitation
        : null,
    windKph:
      typeof c.wind_speed_10m === "number" && Number.isFinite(c.wind_speed_10m)
        ? c.wind_speed_10m
        : null,
  };
}

// --- Cost / alerts / agenda segment provenance ------------------------------

export type Provenanced<T> =
  | ({ provenance: "REAL" } & T)
  | { provenance: "UNAVAILABLE" };

export type ContextCost = {
  todayAmount: number;
  currency: string; // SOURCE currency of the measured spend (SW23 → USD)
};

export type ContextAlerts = { count: number };

export type ContextNextEvent = { label: string; whenLabel: string | null };

/**
 * Assemble the bar view model from already-fetched, real signals. Nothing here
 * invents a value: absent inputs collapse to `UNAVAILABLE`. Cost keeps its
 * SOURCE currency — converting to the tenant display currency needs a real FX
 * rate (a later slice), never a made-up one.
 */
export function buildContextBarModel(input: {
  settings: ContextSettings;
  timezone: string;
  timezoneSource: TimezoneSource;
  weather: WeatherSnapshot | null;
  costTodayUsd: number | null;
  alertCount: number | null;
  nextEvent: ContextNextEvent | null;
}): {
  settings: ContextSettings;
  timezone: string;
  timezoneSource: TimezoneSource;
  weather: Provenanced<{ snapshot: WeatherSnapshot }>;
  cost: Provenanced<ContextCost>;
  alerts: Provenanced<ContextAlerts>;
  nextEvent: Provenanced<ContextNextEvent>;
} {
  return {
    settings: input.settings,
    timezone: input.timezone,
    timezoneSource: input.timezoneSource,
    weather: input.weather
      ? { provenance: "REAL", snapshot: input.weather }
      : { provenance: "UNAVAILABLE" },
    cost:
      input.costTodayUsd !== null && Number.isFinite(input.costTodayUsd)
        ? {
            provenance: "REAL",
            todayAmount: input.costTodayUsd,
            currency: "USD",
          }
        : { provenance: "UNAVAILABLE" },
    alerts:
      input.alertCount !== null && Number.isFinite(input.alertCount)
        ? { provenance: "REAL", count: input.alertCount }
        : { provenance: "UNAVAILABLE" },
    nextEvent: input.nextEvent
      ? { provenance: "REAL", ...input.nextEvent }
      : { provenance: "UNAVAILABLE" },
  };
}

export type ContextBarModel = ReturnType<typeof buildContextBarModel>;

/** Ordered segment keys — the seam a future DASH-4 personalization layer filters. */
export const CONTEXT_BAR_SEGMENTS = [
  "location",
  "clock",
  "weather",
  "agenda",
  "alerts",
  "cost",
] as const;

export type ContextBarSegment = (typeof CONTEXT_BAR_SEGMENTS)[number];
