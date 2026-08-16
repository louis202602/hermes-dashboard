/**
 * DASH-4A — Dashboard user preferences: pure, DOM-free contract.
 *
 * Single source of truth for the shape, defaults, validation (clamping to allowed
 * values), the user→tenant→Hermès resolution, the `<html>` data-* mapping used for
 * live preview + anti-FOUC, and the compact cookie (de)serialisation. No I/O, no
 * LLM. Everything here is unit-tested and shared by the server (facade parsing,
 * cookie), the client (live apply), and the anti-FOUC init script's semantics.
 *
 * International note: the REGIONAL axis (language/locale/country/currency/timezone/
 * units/hourCycle) is kept strictly SEPARATE from visual appearance and layers as a
 * user override on top of the DASH-1 tenant defaults.
 */

// --- Allowed value sets (the clamp guarantees output is always one of these) ---

export const THEMES = [
  "dark",
  "light",
  "auto",
  "midnight",
  "graphite",
  "ocean",
  "solar",
  "minimal",
] as const;
export const ACCENTS = [
  "blue",
  "cyan",
  "purple",
  "green",
  "orange",
  "red",
  "neutral",
] as const;
export const CONTRASTS = ["standard", "high"] as const;
export const TRANSPARENCIES = ["glass", "soft", "solid"] as const;
export const BLURS = ["none", "low", "standard", "high"] as const;
export const RADII = ["small", "standard", "large"] as const;
export const SHADOWS = ["none", "subtle", "standard"] as const;
export const FONTS = ["hermes", "modern", "classic", "accessible"] as const;
export const TEXT_SIZES = ["compact", "standard", "large"] as const;
export const FONT_WEIGHTS = ["normal", "medium", "strong"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Contrast = (typeof CONTRASTS)[number];
export type Transparency = (typeof TRANSPARENCIES)[number];
export type Blur = (typeof BLURS)[number];
export type Radius = (typeof RADII)[number];
export type Shadow = (typeof SHADOWS)[number];
export type FontStyle = (typeof FONTS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type FontWeightPref = (typeof FONT_WEIGHTS)[number];
export type Density = (typeof DENSITIES)[number];

export type Appearance = {
  theme: Theme;
  accent: Accent;
  contrast: Contrast;
  transparency: Transparency;
  blur: Blur;
  radius: Radius;
  shadow: Shadow;
  font: FontStyle;
  textSize: TextSize;
  fontWeight: FontWeightPref;
  density: Density;
  reduceMotion: boolean;
  reduceTransparency: boolean;
};

/**
 * DASH-4F — per-user notification read-state cursor. A watermark (`lastSeenAt`) marks
 * everything up to that instant as read; `readIds` is a BOUNDED set for individually
 * marked items and for signals without a timestamp (never an unbounded history). Lives
 * inside the existing `behavior` JSONB — no new table, no new column, no new RPC.
 */
export type NotificationCursor = {
  lastSeenAt: string | null; // ISO instant; notifications with ts <= this are read
  readIds: string[]; // bounded list of canonical ids marked read individually
};

export const MAX_NOTIFICATION_READ_IDS = 200;

export const EMPTY_NOTIFICATION_CURSOR: NotificationCursor = {
  lastSeenAt: null,
  readIds: [],
};

export type Behavior = {
  sidebarCollapsed: boolean;
  animations: boolean;
  openLastMode: boolean;
  defaultWidget: string | null;
  notifications: NotificationCursor;
  // DASH-4H — personal shortcuts (bounded; validated at resolution against reality).
  defaultHome: string | null; // a profile id or "map" (opening screen); null ⇒ default
  quickActions: string[]; // selected quick-action ids (nav ids or capability keys)
  favorites: string[]; // favorite refs ("widget:<id>" | "nav:<navId>")
};

export const MAX_QUICK_ACTION_PREFS = 12;
export const MAX_FAVORITE_PREFS = 8;

/** User overrides of the DASH-1 regional axes. `null` ⇒ inherit tenant default. */
export type RegionalOverride = {
  language: string | null;
  locale: string | null;
  country: string | null;
  currency: string | null;
  timezone: string | null;
  temperatureUnit: "C" | "F" | null;
  windUnit: "kmh" | "mph" | null;
  hourCycle: "12h" | "24h" | null; // null ⇒ derive from locale
  showSeconds: boolean;
  dateFormat: "auto" | "short" | "long";
  firstDayOfWeek: "auto" | "monday" | "sunday";
};

export type DashboardPreferences = {
  resolutionStatus: string;
  tenantId: string | null;
  version: number;
  schemaVersion: number;
  appearance: Appearance;
  behavior: Behavior;
  regional: RegionalOverride;
  // layout / profiles land in DASH-4B/4D; carried opaque so the row survives.
  layout: Record<string, unknown>;
  profiles: Record<string, unknown>;
};

export const PREFERENCES_SCHEMA_VERSION = 1;

export const HERMES_DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  accent: "blue",
  contrast: "standard",
  transparency: "glass",
  blur: "standard",
  radius: "standard",
  shadow: "standard",
  font: "hermes",
  textSize: "standard",
  fontWeight: "normal",
  density: "comfortable",
  reduceMotion: false,
  reduceTransparency: false,
};

export const HERMES_DEFAULT_BEHAVIOR: Behavior = {
  sidebarCollapsed: false,
  animations: true,
  openLastMode: false,
  defaultWidget: null,
  notifications: { lastSeenAt: null, readIds: [] },
  defaultHome: null,
  quickActions: [],
  favorites: [],
};

export const HERMES_DEFAULT_REGIONAL: RegionalOverride = {
  language: null,
  locale: null,
  country: null,
  currency: null,
  timezone: null,
  temperatureUnit: null,
  windUnit: null,
  hourCycle: null,
  showSeconds: false,
  dateFormat: "auto",
  firstDayOfWeek: "auto",
};

export const HERMES_DEFAULT_PREFERENCES: DashboardPreferences = {
  resolutionStatus: "DEFAULT",
  tenantId: null,
  version: 0,
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  appearance: HERMES_DEFAULT_APPEARANCE,
  behavior: HERMES_DEFAULT_BEHAVIOR,
  regional: HERMES_DEFAULT_REGIONAL,
  layout: {},
  profiles: {},
};

// --- Clamping (fail-safe: any invalid value collapses to the Hermès default) ---

function pick<T extends readonly string[]>(
  set: T,
  v: unknown,
  fallback: T[number],
): T[number] {
  return typeof v === "string" && (set as readonly string[]).includes(v)
    ? (v as T[number])
    : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}

// --- Regional validators (deterministic, Intl-backed; NO network, NO list) ----

/** Valid IANA zone name — verified by asking Intl to build a formatter for it. */
function validTimeZoneOrNull(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s });
    return s;
  } catch {
    return null;
  }
}
/** Well-formed BCP-47 locale (e.g. "fr-FR"), canonicalised by Intl. */
function validLocaleOrNull(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(s);
    return canonical ?? null;
  } catch {
    return null;
  }
}
/** ISO 3166-1 alpha-2 country (two uppercase letters). */
function validCountryOrNull(v: unknown): string | null {
  const s = strOrNull(v);
  return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}
/** ISO 4217-style currency (three uppercase letters, accepted by Intl). */
function validCurrencyOrNull(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s || !/^[A-Za-z]{3}$/.test(s)) return null;
  const up = s.toUpperCase();
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: up });
    return up;
  } catch {
    return null;
  }
}

export function clampAppearance(input: unknown): Appearance {
  const a = (input ?? {}) as Record<string, unknown>;
  const d = HERMES_DEFAULT_APPEARANCE;
  return {
    theme: pick(THEMES, a.theme, d.theme),
    accent: pick(ACCENTS, a.accent, d.accent),
    contrast: pick(CONTRASTS, a.contrast, d.contrast),
    transparency: pick(TRANSPARENCIES, a.transparency, d.transparency),
    blur: pick(BLURS, a.blur, d.blur),
    radius: pick(RADII, a.radius, d.radius),
    shadow: pick(SHADOWS, a.shadow, d.shadow),
    font: pick(FONTS, a.font, d.font),
    textSize: pick(TEXT_SIZES, a.textSize, d.textSize),
    fontWeight: pick(FONT_WEIGHTS, a.fontWeight, d.fontWeight),
    density: pick(DENSITIES, a.density, d.density),
    reduceMotion: bool(a.reduceMotion, d.reduceMotion),
    reduceTransparency: bool(a.reduceTransparency, d.reduceTransparency),
  };
}

/**
 * Fail-safe clamp for the notification cursor: a valid ISO-ish `lastSeenAt` (or null)
 * and a de-duplicated, length-bounded `readIds` (garbage / oversized ids dropped). The
 * bound guarantees the stored JSONB can never grow without limit.
 */
export function clampNotificationCursor(input: unknown): NotificationCursor {
  const c = (input ?? {}) as Record<string, unknown>;
  const lastSeenAt =
    typeof c.lastSeenAt === "string" &&
    c.lastSeenAt.length > 0 &&
    c.lastSeenAt.length <= 40
      ? c.lastSeenAt
      : null;
  const raw = Array.isArray(c.readIds) ? c.readIds : [];
  const readIds: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string" || v.length === 0 || v.length > 200) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    readIds.push(v);
    if (readIds.length >= MAX_NOTIFICATION_READ_IDS) break;
  }
  return { lastSeenAt, readIds };
}

/** De-duplicated, length-and-count-bounded list of short id strings (fail-safe). */
function clampStringList(v: unknown, maxItems: number, maxLen = 80): string[] {
  const raw = Array.isArray(v) ? v : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || x.length === 0 || x.length > maxLen) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function clampBehavior(input: unknown): Behavior {
  const b = (input ?? {}) as Record<string, unknown>;
  const d = HERMES_DEFAULT_BEHAVIOR;
  return {
    sidebarCollapsed: bool(b.sidebarCollapsed, d.sidebarCollapsed),
    animations: bool(b.animations, d.animations),
    openLastMode: bool(b.openLastMode, d.openLastMode),
    defaultWidget: strOrNull(b.defaultWidget),
    notifications: clampNotificationCursor(b.notifications),
    defaultHome: strOrNull(b.defaultHome),
    quickActions: clampStringList(b.quickActions, MAX_QUICK_ACTION_PREFS),
    favorites: clampStringList(b.favorites, MAX_FAVORITE_PREFS),
  };
}

export function clampRegional(input: unknown): RegionalOverride {
  const r = (input ?? {}) as Record<string, unknown>;
  return {
    language: validLocaleOrNull(r.language),
    locale: validLocaleOrNull(r.locale),
    country: validCountryOrNull(r.country),
    currency: validCurrencyOrNull(r.currency),
    timezone: validTimeZoneOrNull(r.timezone),
    temperatureUnit:
      r.temperatureUnit === "C" || r.temperatureUnit === "F"
        ? r.temperatureUnit
        : null,
    windUnit:
      r.windUnit === "kmh" || r.windUnit === "mph" ? r.windUnit : null,
    hourCycle:
      r.hourCycle === "12h" || r.hourCycle === "24h" ? r.hourCycle : null,
    showSeconds: bool(r.showSeconds, false),
    dateFormat: pick(["auto", "short", "long"] as const, r.dateFormat, "auto"),
    firstDayOfWeek: pick(
      ["auto", "monday", "sunday"] as const,
      r.firstDayOfWeek,
      "auto",
    ),
  };
}

// --- Resolution: user override → tenant default → Hermès default -------------

/**
 * Deep-merge, override-wins, then clamp. Each layer is a (partial) preferences
 * object; `undefined`/missing keys inherit the layer below. Appearance/behavior/
 * regional are merged field-by-field so a single user toggle doesn't wipe the rest.
 */
export function resolvePreferences(
  user: Partial<DashboardPreferences> | null,
  tenant: Partial<DashboardPreferences> | null,
): DashboardPreferences {
  const mergeAppearance = {
    ...HERMES_DEFAULT_APPEARANCE,
    ...(tenant?.appearance ?? {}),
    ...(user?.appearance ?? {}),
  };
  const mergeBehavior = {
    ...HERMES_DEFAULT_BEHAVIOR,
    ...(tenant?.behavior ?? {}),
    ...(user?.behavior ?? {}),
  };
  const mergeRegional = {
    ...HERMES_DEFAULT_REGIONAL,
    ...(tenant?.regional ?? {}),
    ...(user?.regional ?? {}),
  };
  return {
    resolutionStatus: user?.resolutionStatus ?? "OK",
    tenantId: user?.tenantId ?? tenant?.tenantId ?? null,
    version: user?.version ?? 0,
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    appearance: clampAppearance(mergeAppearance),
    behavior: clampBehavior(mergeBehavior),
    regional: clampRegional(mergeRegional),
    layout: (user?.layout ?? tenant?.layout ?? {}) as Record<string, unknown>,
    profiles: (user?.profiles ?? {}) as Record<string, unknown>,
  };
}

// --- `<html>` data-* mapping (live preview + anti-FOUC) ----------------------

/**
 * Map appearance → the exact `data-*` attributes applied to `<html>`. `theme:auto`
 * is emitted verbatim; the client/init-script resolves it against
 * prefers-color-scheme (kept out of here so this stays pure/deterministic).
 */
export function appearanceToDataset(a: Appearance): Record<string, string> {
  const ds: Record<string, string> = {
    theme: a.theme,
    accent: a.accent,
    contrast: a.contrast,
    transparency: a.transparency,
    blur: a.blur,
    radius: a.radius,
    shadow: a.shadow,
    font: a.font,
    textsize: a.textSize,
    weight: a.fontWeight,
    density: a.density,
  };
  if (a.reduceMotion) ds.reduceMotion = "1";
  if (a.reduceTransparency) ds.reduceTransparency = "1";
  return ds;
}

/**
 * Fold behavior.animations into the effective appearance: turning animations off
 * enforces reduced motion (never the reverse — accessibility can only add safety).
 * Pure: shared by the server (SSR anti-FOUC) and the client (live apply).
 */
export function effectiveAppearance(
  appearance: Appearance,
  behavior: Behavior,
): Appearance {
  return {
    ...appearance,
    reduceMotion: appearance.reduceMotion || !behavior.animations,
  };
}

/** Inverse of `appearanceToDataset`: a data-* record → a clamped Appearance. */
export function datasetToAppearance(ds: Record<string, string>): Appearance {
  return clampAppearance({
    theme: ds.theme,
    accent: ds.accent,
    contrast: ds.contrast,
    transparency: ds.transparency,
    blur: ds.blur,
    radius: ds.radius,
    shadow: ds.shadow,
    font: ds.font,
    textSize: ds.textsize,
    fontWeight: ds.weight,
    density: ds.density,
    reduceMotion: ds.reduceMotion === "1",
    reduceTransparency: ds.reduceTransparency === "1",
  });
}

// Dataset key → real `data-*` attribute name (for SSR onto <html>).
const HTML_ATTR_KEYS: Record<string, string> = {
  theme: "data-theme",
  accent: "data-accent",
  contrast: "data-contrast",
  transparency: "data-transparency",
  blur: "data-blur",
  radius: "data-radius",
  shadow: "data-shadow",
  font: "data-font",
  textsize: "data-textsize",
  weight: "data-weight",
  density: "data-density",
  reduceMotion: "data-reduce-motion",
  reduceTransparency: "data-reduce-transparency",
};

/**
 * Appearance → a `{ "data-theme": …, … }` record ready to spread onto the server
 * `<html>` element so the FIRST paint already carries the user's real appearance
 * (no flash on a brand-new device). `theme:"auto"` is emitted verbatim; the tiny
 * init script resolves it against the OS pre-paint (the server can't know it).
 */
export function appearanceToHtmlAttrs(a: Appearance): Record<string, string> {
  const ds = appearanceToDataset(a);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ds)) {
    out[HTML_ATTR_KEYS[k] ?? `data-${k.toLowerCase()}`] = v;
  }
  return out;
}

// --- Compact cookie (anti-FOUC). Format: "k:v;k:v" of dataset pairs ----------

export const APPEARANCE_COOKIE = "hermes-appearance";

export function serializeAppearanceCookie(a: Appearance): string {
  const ds = appearanceToDataset(a);
  return Object.entries(ds)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/** Parse the cookie back to a dataset record (defensive; ignores junk pairs). */
export function parseAppearanceCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(raw).split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (/^[a-zA-Z]+$/.test(k) && /^[a-zA-Z0-9-]+$/.test(v)) out[k] = v;
  }
  return out;
}

// --- Parse the RPC payload (snake_case jsonb) into typed preferences ----------

export function parsePreferences(payload: unknown): DashboardPreferences {
  const p = (payload ?? {}) as Record<string, unknown>;
  const status = String(p.resolution_status ?? "DEFAULT");
  if (status !== "OK") {
    // Unauthenticated / no-tenant / empty ⇒ Hermès defaults, no leak.
    return { ...HERMES_DEFAULT_PREFERENCES, resolutionStatus: status };
  }
  return {
    resolutionStatus: "OK",
    tenantId: strOrNull(p.tenant_id),
    version: Number(p.version ?? 0) || 0,
    schemaVersion: Number(p.schema_version ?? PREFERENCES_SCHEMA_VERSION) || 1,
    appearance: clampAppearance(p.appearance),
    behavior: clampBehavior(p.behavior),
    regional: clampRegional(p.regional),
    layout: (p.layout ?? {}) as Record<string, unknown>,
    profiles: (p.profiles ?? {}) as Record<string, unknown>,
  };
}
