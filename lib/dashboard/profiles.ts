/**
 * DASH-4D — Dashboard profiles / modes (pure, DOM-free).
 *
 * A profile is a saved dashboard configuration a user can switch between like a
 * focus mode: its own widget layout (order / visibility / sizes), context bar, and
 * an OPTIONAL partial appearance override (theme/accent…) layered on the global
 * appearance. Profiles are USER-SCOPED and persisted inside the existing
 * `dashboard_user_preferences.profiles` JSONB column — NO new table, NO new RPC.
 *
 * Curated Hermès presets (Direction/Commercial/Chantier/Finance) only SELECT and
 * reorder widgets that already exist in the registry — they never invent data. The
 * capability filter (DASH-4B) still applies on top, so a profile that lists a widget
 * the tenant can't use simply doesn't render it (no crash, no bypass).
 *
 * COST-FIRST: switching a profile is derived from already-loaded snapshots on the
 * client — 0 extra DB read, 0 LLM, 0 external call. A write happens only on an
 * explicit switch or profile edit, through the same optimistic-concurrency upsert.
 */

import {
  clampAppearance,
  type Appearance,
} from "@/lib/dashboard/preferences";
import {
  DEFAULT_LAYOUT,
  LAYOUT_SCHEMA_VERSION,
  clampLayout,
  registryIds,
  type LayoutPreferences,
} from "@/lib/dashboard/widgets";
import {
  WALLPAPER_POSITIONS,
  isValidWallpaperRef,
  type WallpaperFields,
} from "@/lib/dashboard/wallpapers";

/**
 * DASH-4I — UNIVERSAL profile ids. Legacy ids (direction/commercial/chantier/finance/
 * custom) are kept FIRST and unchanged so existing user preferences never break. The
 * rest are generic/specialized profiles that light up per tenant capabilities — Hermès
 * is NOT a BTP-only dashboard. Adding a vertical later = append one registry entry; no
 * per-client code. All ids are persisted keys, so this list only ever grows.
 */
export const PROFILE_IDS = [
  "direction",
  "commercial",
  "operations",
  "chantier",
  "immobilier",
  "restaurant",
  "ecommerce",
  "logistique",
  "finance",
  "marketing",
  "support",
  "custom",
] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const DEFAULT_PROFILE: ProfileId = "direction";
export const PROFILES_SCHEMA_VERSION = 1;

const PROFILE_SET = new Set<string>(PROFILE_IDS);
export function isProfileId(v: unknown): v is ProfileId {
  return typeof v === "string" && PROFILE_SET.has(v);
}

/**
 * How a profile earns its place in a tenant's switcher:
 * - "always"      → always offered (custom — the full, unfiltered dashboard).
 * - "transversal" → offered when the tenant has ANY exploitable capability (Direction).
 * - "capability"  → offered only when the tenant holds ≥1 of `requiredCapabilities`.
 * CAPABILITY-FIRST: the vertical only *orients*; capabilities are the truth. No profile
 * is gated on an industry/vertical field — there is no such branch anywhere.
 */
export type ProfileAvailability = "always" | "transversal" | "capability";
export type ProfileKind = "generic" | "specialized";

/**
 * DASH-4I — extensible PROFILE REGISTRY (same philosophy as the widget registry). A
 * ProfileDef is pure metadata: no business `if/else`. `requiredCapabilities` /
 * `optionalCapabilities` are functional capability TOKENS (see CAPABILITY_TOKENS), not
 * raw action keys, so a profile is portable across tenants and verticals. Unknown
 * `recommendedWidgets` ids are dropped when the preset layout is built, and the
 * per-tenant widget capability filter still applies on top (a listed widget the tenant
 * can't use simply doesn't render).
 */
export type ProfileDef = {
  id: ProfileId;
  labelKey: string;
  descriptionKey: string;
  /** Lucide icon name (registry metadata; UI may render it). */
  icon: string;
  kind: ProfileKind;
  availability: ProfileAvailability;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  recommendedWidgets: string[];
  /** Lower = shown earlier in the switcher. */
  priority: number;
};

export const PROFILE_REGISTRY: ProfileDef[] = [
  {
    id: "direction",
    labelKey: "profile.direction",
    descriptionKey: "profile.direction.desc",
    icon: "LayoutDashboard",
    kind: "generic",
    availability: "transversal",
    requiredCapabilities: [],
    optionalCapabilities: [],
    recommendedWidgets: ["system-health", "kpis", "alerts", "cost", "commercial", "agenda", "daily-summary"],
    priority: 10,
  },
  {
    id: "commercial",
    labelKey: "profile.commercial",
    descriptionKey: "profile.commercial.desc",
    icon: "TrendingUp",
    kind: "generic",
    availability: "capability",
    requiredCapabilities: ["crm", "sales", "leads", "pipeline", "quotes", "commerce", "ecommerce"],
    optionalCapabilities: ["marketing", "appointments"],
    recommendedWidgets: ["commercial", "agenda", "alerts", "tasks", "conversations", "quick-actions"],
    priority: 20,
  },
  {
    id: "operations",
    labelKey: "profile.operations",
    descriptionKey: "profile.operations.desc",
    icon: "Settings2",
    kind: "generic",
    availability: "capability",
    requiredCapabilities: ["operations", "worksites", "projects", "planning", "logistics", "fleet", "inventory", "purchasing", "production", "maintenance", "bookings"],
    optionalCapabilities: ["suppliers"],
    recommendedWidgets: ["agenda", "tasks", "alerts", "projects", "daily-summary", "recommended-actions"],
    priority: 30,
  },
  {
    id: "chantier",
    labelKey: "profile.chantier",
    descriptionKey: "profile.chantier.desc",
    icon: "HardHat",
    kind: "specialized",
    availability: "capability",
    requiredCapabilities: ["worksites", "field_operations"],
    optionalCapabilities: ["projects", "planning"],
    recommendedWidgets: ["chantiers-map", "projects", "agenda", "alerts", "tasks", "daily-summary"],
    priority: 40,
  },
  {
    id: "immobilier",
    labelKey: "profile.immobilier",
    descriptionKey: "profile.immobilier.desc",
    icon: "Building2",
    kind: "specialized",
    availability: "capability",
    requiredCapabilities: ["properties"],
    optionalCapabilities: ["leads", "appointments", "sales"],
    recommendedWidgets: ["commercial", "agenda", "alerts", "tasks", "conversations", "recommended-actions"],
    priority: 50,
  },
  {
    id: "restaurant",
    labelKey: "profile.restaurant",
    descriptionKey: "profile.restaurant.desc",
    icon: "UtensilsCrossed",
    kind: "specialized",
    availability: "capability",
    requiredCapabilities: ["restaurant", "bookings"],
    optionalCapabilities: ["inventory", "purchasing"],
    recommendedWidgets: ["agenda", "tasks", "alerts", "daily-summary", "recommended-actions", "quick-actions"],
    priority: 60,
  },
  {
    id: "ecommerce",
    labelKey: "profile.ecommerce",
    descriptionKey: "profile.ecommerce.desc",
    icon: "ShoppingCart",
    kind: "specialized",
    availability: "capability",
    requiredCapabilities: ["ecommerce", "commerce"],
    optionalCapabilities: ["inventory", "orders", "analytics"],
    recommendedWidgets: ["commercial", "kpis", "alerts", "tasks", "cost", "conversations"],
    priority: 70,
  },
  {
    id: "logistique",
    labelKey: "profile.logistique",
    descriptionKey: "profile.logistique.desc",
    icon: "Truck",
    kind: "specialized",
    availability: "capability",
    requiredCapabilities: ["logistics", "fleet"],
    optionalCapabilities: ["operations", "inventory"],
    recommendedWidgets: ["agenda", "tasks", "alerts", "projects", "daily-summary", "recommended-actions"],
    priority: 80,
  },
  {
    id: "finance",
    labelKey: "profile.finance",
    descriptionKey: "profile.finance.desc",
    icon: "Wallet",
    kind: "generic",
    availability: "capability",
    requiredCapabilities: ["finance", "invoicing", "accounting", "treasury", "quotes", "payments"],
    optionalCapabilities: ["management"],
    recommendedWidgets: ["cost", "kpis", "commercial", "alerts", "system-health"],
    priority: 90,
  },
  {
    id: "marketing",
    labelKey: "profile.marketing",
    descriptionKey: "profile.marketing.desc",
    icon: "Megaphone",
    kind: "generic",
    availability: "capability",
    requiredCapabilities: ["marketing", "social", "campaigns", "analytics"],
    optionalCapabilities: ["leads"],
    recommendedWidgets: ["commercial", "conversations", "agenda", "kpis", "recommended-actions"],
    priority: 100,
  },
  {
    id: "support",
    labelKey: "profile.support",
    descriptionKey: "profile.support.desc",
    icon: "LifeBuoy",
    kind: "generic",
    availability: "capability",
    requiredCapabilities: ["support", "sav", "tickets", "helpdesk", "appointments"],
    optionalCapabilities: ["documents"],
    recommendedWidgets: ["tasks", "alerts", "agenda", "conversations", "approvals", "quick-actions"],
    priority: 110,
  },
  {
    id: "custom",
    labelKey: "profile.custom",
    descriptionKey: "profile.custom.desc",
    icon: "SlidersHorizontal",
    kind: "generic",
    availability: "always",
    requiredCapabilities: [],
    optionalCapabilities: [],
    recommendedWidgets: [],
    priority: 999,
  },
];

const PROFILE_BY_ID = new Map<ProfileId, ProfileDef>(PROFILE_REGISTRY.map((p) => [p.id, p]));

export function profileDef(id: ProfileId): ProfileDef | undefined {
  return PROFILE_BY_ID.get(id);
}

/** Build a preset layout: recommended widgets first & visible, everything else hidden. */
function presetLayout(recommended: string[]): LayoutPreferences {
  const ids = registryIds();
  const known = recommended.filter((id) => ids.includes(id));
  const seen = new Set(known);
  const rest = ids.filter((id) => !seen.has(id));
  return {
    order: [...known, ...rest],
    hidden: rest, // focus mode: only the recommended widgets are shown
    sizes: {},
    context: {},
    schemaVersion: LAYOUT_SCHEMA_VERSION,
  };
}

/** The Hermès default layout for a profile that the user has never customized. */
export function presetLayoutFor(id: ProfileId): LayoutPreferences {
  const recommended = PROFILE_BY_ID.get(id)?.recommendedWidgets ?? [];
  if (id === "custom" || recommended.length === 0) return { ...DEFAULT_LAYOUT };
  return presetLayout(recommended);
}

// --- CAPABILITY MODEL --------------------------------------------------------

/**
 * Canonical vocabulary of FUNCTIONAL capability tokens the profile engine reasons about.
 * These are business capabilities (not raw action keys), shared across every vertical.
 * A tenant "has" a token when a granted capability derives it (CAPABILITY_TOKEN_RULES).
 */
export const CAPABILITY_TOKENS = [
  "crm", "sales", "leads", "pipeline", "quotes", "commerce", "ecommerce", "orders",
  "invoicing", "accounting", "treasury", "finance", "payments",
  "projects", "worksites", "field_operations", "planning", "operations", "production", "maintenance",
  "inventory", "purchasing", "suppliers", "logistics", "fleet",
  "support", "sav", "tickets", "helpdesk", "marketing", "social", "campaigns", "analytics",
  "appointments", "bookings", "documents", "hr", "recruitment", "properties", "restaurant", "management",
] as const;
export type CapabilityToken = (typeof CAPABILITY_TOKENS)[number];

/**
 * Bridge from REAL granted action keys → functional capability tokens. This is the ONLY
 * place raw namespaces are mapped to capabilities — a single data table, not scattered
 * `if/else`. Rules match by action-key PREFIX and their tokens are unioned; extend it as
 * the capability catalog grows (a new `crm.*` domain automatically enables the tokens).
 */
export const CAPABILITY_TOKEN_RULES: { prefix: string; tokens: CapabilityToken[] }[] = [
  // BTP / worksites (the catalog that exists today)
  { prefix: "btp.qualification", tokens: ["leads", "sales", "quotes"] },
  { prefix: "btp.planning", tokens: ["planning", "projects", "operations"] },
  { prefix: "btp.suivi", tokens: ["worksites", "field_operations", "projects", "operations"] },
  { prefix: "btp.", tokens: ["worksites", "projects", "planning", "operations"] },
  // forward-looking vertical namespaces (light up automatically when granted)
  { prefix: "immo.", tokens: ["properties", "leads", "sales", "appointments"] },
  { prefix: "crm.", tokens: ["crm", "leads", "sales", "pipeline"] },
  { prefix: "sales.", tokens: ["sales", "quotes", "pipeline"] },
  { prefix: "finance.", tokens: ["finance", "accounting", "treasury"] },
  { prefix: "invoicing.", tokens: ["invoicing", "finance"] },
  { prefix: "accounting.", tokens: ["accounting", "finance"] },
  { prefix: "resto.", tokens: ["restaurant", "bookings", "inventory"] },
  { prefix: "restaurant.", tokens: ["restaurant", "bookings", "inventory"] },
  { prefix: "booking", tokens: ["bookings", "appointments"] },
  { prefix: "ecommerce.", tokens: ["ecommerce", "commerce", "inventory", "orders"] },
  { prefix: "retail.", tokens: ["commerce", "inventory", "sales"] },
  { prefix: "shop.", tokens: ["commerce", "ecommerce", "orders"] },
  { prefix: "inventory.", tokens: ["inventory", "purchasing"] },
  { prefix: "logistics.", tokens: ["logistics", "fleet", "operations"] },
  { prefix: "fleet.", tokens: ["fleet", "logistics"] },
  { prefix: "support.", tokens: ["support", "sav", "tickets"] },
  { prefix: "sav.", tokens: ["sav", "support"] },
  { prefix: "marketing.", tokens: ["marketing", "social", "campaigns"] },
  { prefix: "hr.", tokens: ["hr", "recruitment"] },
];

const CAPABILITY_TOKEN_SET = new Set<string>(CAPABILITY_TOKENS);

/**
 * Derive the tenant's functional capability tokens from its granted action keys. Pure,
 * deterministic, allocation-light. A key already equal to a known token is kept as-is
 * (so callers/tests may pass tokens directly), and every prefix rule it matches unions
 * its tokens. Unknown namespaces contribute nothing (safe, no crash).
 */
export function deriveCapabilityTokens(capabilityKeys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of capabilityKeys) {
    const key = String(raw);
    if (CAPABILITY_TOKEN_SET.has(key)) out.add(key); // already a token
    for (const rule of CAPABILITY_TOKEN_RULES) {
      if (key.startsWith(rule.prefix)) for (const tk of rule.tokens) out.add(tk);
    }
  }
  return out;
}

/** Is a single profile offered given the tenant's capability tokens? (pure, tenant-safe) */
export function isProfileAvailable(def: ProfileDef, tokens: Set<string>): boolean {
  switch (def.availability) {
    case "always":
      return true;
    case "transversal":
      return tokens.size > 0; // Direction: any exploitable capability
    case "capability":
      return def.requiredCapabilities.some((t) => tokens.has(t));
  }
}

/**
 * CAPABILITY-FIRST profile availability. Input is the tenant's functional capability
 * TOKENS (derive them from granted action keys with `deriveCapabilityTokens`, or pass a
 * token set directly). Returns the offered profile ids sorted by priority.
 *
 * - `custom` is always offered (the full dashboard).
 * - Direction is offered whenever the tenant has any exploitable capability.
 * - Every other profile is offered only when the tenant holds one of its required
 *   capabilities — so a restaurant never sees a Chantier profile, an e-commerce never
 *   sees a BTP one, etc. TENANT-SAFE: a profile a tenant can't use is never listed.
 * - `capabilitiesKnown=false` (snapshot unavailable) ⇒ fail-open (offer all) so a
 *   transient error never HIDES a profile.
 */
export function availableProfiles(
  capabilityTokens: Iterable<string>,
  capabilitiesKnown = true,
): ProfileId[] {
  const sorted = [...PROFILE_REGISTRY].sort((a, b) => a.priority - b.priority);
  if (!capabilitiesKnown) return sorted.map((p) => p.id);
  const tokens = capabilityTokens instanceof Set ? capabilityTokens : new Set(capabilityTokens);
  return sorted.filter((p) => isProfileAvailable(p, tokens)).map((p) => p.id);
}

/** Ensure a candidate profile is currently available; else a deterministic fallback. */
export function fallbackProfile(candidate: ProfileId, availableIds: ProfileId[]): ProfileId {
  if (availableIds.includes(candidate)) return candidate;
  if (availableIds.includes(DEFAULT_PROFILE)) return DEFAULT_PROFILE;
  if (availableIds.includes("custom")) return "custom";
  return availableIds[0] ?? DEFAULT_PROFILE;
}

export type ProfileConfig = {
  /** User-customized layout for this profile. `null` ⇒ use the preset (or global for custom). */
  layout: LayoutPreferences | null;
  /** Partial appearance override layered on the GLOBAL appearance (empty ⇒ none). */
  appearance: Partial<Appearance>;
  /** Optional rename (mainly for the custom profile). */
  name: string | null;
  /** DASH-4E — per-profile wallpaper (built-in id or "user:<key>") + display params. */
  wallpaperRef: string | null;
  wallpaperScrim: number | null;
  wallpaperPosition: string | null;
  wallpaperFocalX: number | null;
  wallpaperFocalY: number | null;
};

export type ProfilesState = {
  /** Active profile, or `null` when the user has never chosen one (resolve with global layout). */
  active: ProfileId | null;
  byId: Partial<Record<ProfileId, ProfileConfig>>;
  /** DASH-4E — global default wallpaper (applied when a profile sets no wallpaper). */
  wallpaper: WallpaperFields;
  schemaVersion: number;
};

export const EMPTY_PROFILES_STATE: ProfilesState = {
  active: null,
  byId: {},
  wallpaper: {},
  schemaVersion: PROFILES_SCHEMA_VERSION,
};

// --- Parse / clamp the persisted JSONB (fail-safe) ---------------------------

function strOrNull(v: unknown, max = 64): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** Keep only the appearance keys that are actually present + valid (partial override). */
export function clampAppearanceOverride(input: unknown): Partial<Appearance> {
  const a = (input ?? {}) as Record<string, unknown>;
  const present = Object.keys(a);
  if (present.length === 0) return {};
  // Clamp a full appearance built from the override, then keep only provided keys.
  const full = clampAppearance(a);
  const out: Partial<Appearance> = {};
  for (const k of present) {
    if (k in full) (out as Record<string, unknown>)[k] = (full as Record<string, unknown>)[k];
  }
  return out;
}

function num01OrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(1, Math.max(0, v))
    : null;
}

/** Keep only the valid flat wallpaper fields (fail-safe; unknown ref ⇒ dropped). */
function clampWallpaperFields(c: Record<string, unknown>): WallpaperFields {
  return {
    wallpaperRef: isValidWallpaperRef(c.wallpaperRef) ? (c.wallpaperRef as string) : null,
    wallpaperScrim: num01OrNull(c.wallpaperScrim),
    wallpaperPosition: WALLPAPER_POSITIONS.includes(
      c.wallpaperPosition as (typeof WALLPAPER_POSITIONS)[number],
    )
      ? (c.wallpaperPosition as string)
      : null,
    wallpaperFocalX: num01OrNull(c.wallpaperFocalX),
    wallpaperFocalY: num01OrNull(c.wallpaperFocalY),
  };
}

function clampProfileConfig(input: unknown): ProfileConfig {
  const c = (input ?? {}) as Record<string, unknown>;
  const hasLayout =
    c.layout != null && typeof c.layout === "object" && !Array.isArray(c.layout);
  const wp = clampWallpaperFields(c);
  return {
    layout: hasLayout ? clampLayout(c.layout) : null,
    appearance: clampAppearanceOverride(c.appearance),
    name: strOrNull(c.name),
    wallpaperRef: wp.wallpaperRef ?? null,
    wallpaperScrim: wp.wallpaperScrim ?? null,
    wallpaperPosition: wp.wallpaperPosition ?? null,
    wallpaperFocalX: wp.wallpaperFocalX ?? null,
    wallpaperFocalY: wp.wallpaperFocalY ?? null,
  };
}

export function clampProfiles(input: unknown): ProfilesState {
  const p = (input ?? {}) as Record<string, unknown>;
  const byId: Partial<Record<ProfileId, ProfileConfig>> = {};
  const rawById = (p.byId ?? {}) as Record<string, unknown>;
  for (const id of PROFILE_IDS) {
    if (rawById[id] && typeof rawById[id] === "object") {
      byId[id] = clampProfileConfig(rawById[id]);
    }
  }
  return {
    active: isProfileId(p.active) ? p.active : null,
    byId,
    wallpaper: clampWallpaperFields((p.wallpaper ?? {}) as Record<string, unknown>),
    schemaVersion: Number(p.schemaVersion ?? PROFILES_SCHEMA_VERSION) || PROFILES_SCHEMA_VERSION,
  };
}

// --- Resolution --------------------------------------------------------------

function isNonEmptyLayout(l: LayoutPreferences | null | undefined): boolean {
  if (!l) return false;
  return (
    (l.order?.length ?? 0) > 0 ||
    (l.hidden?.length ?? 0) > 0 ||
    Object.keys(l.sizes ?? {}).length > 0 ||
    Object.keys(l.context ?? {}).length > 0
  );
}

/**
 * The active profile id. If the user never chose one: fall back to `custom` when they
 * already had a customized global layout (pre-4D users keep their dashboard), else the
 * Hermès default (`direction`). An unknown/corrupt active id also falls back safely.
 */
export function resolveActiveProfile(
  state: ProfilesState,
  globalLayout: LayoutPreferences | null,
): ProfileId {
  if (isProfileId(state.active)) return state.active;
  return isNonEmptyLayout(globalLayout) ? "custom" : DEFAULT_PROFILE;
}

/**
 * Effective layout for a profile: the user's saved layout for it, else the preset
 * (custom falls back to the global layout for pre-4D continuity, then the default).
 */
export function effectiveProfileLayout(
  state: ProfilesState,
  activeId: ProfileId,
  globalLayout: LayoutPreferences | null,
): LayoutPreferences {
  const saved = state.byId[activeId]?.layout;
  if (saved) return saved;
  if (activeId === "custom") return globalLayout ?? { ...DEFAULT_LAYOUT };
  return presetLayoutFor(activeId);
}

/** Effective appearance for a profile = global appearance + this profile's override. */
export function effectiveProfileAppearance(
  globalAppearance: Appearance,
  state: ProfilesState,
  activeId: ProfileId,
): Appearance {
  const override = state.byId[activeId]?.appearance ?? {};
  return clampAppearance({ ...globalAppearance, ...override });
}

// --- Pure mutators (return a new state; caller persists `{ profiles: next }`) --

export function setActiveProfile(state: ProfilesState, id: ProfileId): ProfilesState {
  return { ...state, active: id };
}

function withConfig(
  state: ProfilesState,
  id: ProfileId,
  mut: (c: ProfileConfig) => ProfileConfig,
): ProfilesState {
  const current: ProfileConfig = state.byId[id] ?? {
    layout: null,
    appearance: {},
    name: null,
    wallpaperRef: null,
    wallpaperScrim: null,
    wallpaperPosition: null,
    wallpaperFocalX: null,
    wallpaperFocalY: null,
  };
  return { ...state, byId: { ...state.byId, [id]: mut(current) } };
}

/** Persist a full layout into a profile (e.g. an edit made while it is active). */
export function setProfileLayout(
  state: ProfilesState,
  id: ProfileId,
  layout: LayoutPreferences,
): ProfilesState {
  return withConfig(state, id, (c) => ({ ...c, layout }));
}

/** Merge a partial appearance override into a profile (empty patch value clears a key). */
export function setProfileAppearance(
  state: ProfilesState,
  id: ProfileId,
  patch: Partial<Appearance>,
): ProfilesState {
  return withConfig(state, id, (c) => {
    const merged = { ...c.appearance, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (merged as Record<string, unknown>)[k];
    }
    return { ...c, appearance: clampAppearanceOverride(merged) };
  });
}

export function renameProfile(
  state: ProfilesState,
  id: ProfileId,
  name: string | null,
): ProfilesState {
  return withConfig(state, id, (c) => ({ ...c, name: name ? name.slice(0, 64) : null }));
}

/**
 * DASH-4E — patch this profile's wallpaper fields (ref/scrim/position/focal). Only keys
 * PRESENT in `fields` are changed; each is clamped (invalid ⇒ null). A partial patch
 * (e.g. just the ref) never wipes the other wallpaper fields.
 */
export function setProfileWallpaper(
  state: ProfilesState,
  id: ProfileId,
  fields: WallpaperFields,
): ProfilesState {
  const f = fields as Record<string, unknown>;
  return withConfig(state, id, (c) => {
    const next: ProfileConfig = { ...c };
    if ("wallpaperRef" in f)
      next.wallpaperRef = isValidWallpaperRef(f.wallpaperRef) ? (f.wallpaperRef as string) : null;
    if ("wallpaperScrim" in f) next.wallpaperScrim = num01OrNull(f.wallpaperScrim);
    if ("wallpaperPosition" in f)
      next.wallpaperPosition = WALLPAPER_POSITIONS.includes(
        f.wallpaperPosition as (typeof WALLPAPER_POSITIONS)[number],
      )
        ? (f.wallpaperPosition as string)
        : null;
    if ("wallpaperFocalX" in f) next.wallpaperFocalX = num01OrNull(f.wallpaperFocalX);
    if ("wallpaperFocalY" in f) next.wallpaperFocalY = num01OrNull(f.wallpaperFocalY);
    return next;
  });
}

/** DASH-4E — set the GLOBAL default wallpaper (applied when a profile sets none). */
export function setGlobalWallpaper(
  state: ProfilesState,
  fields: WallpaperFields,
): ProfilesState {
  return { ...state, wallpaper: clampWallpaperFields(fields as Record<string, unknown>) };
}

/** DASH-4E — the flat wallpaper fields of a profile config (for resolution). */
export function profileWallpaperFields(
  state: ProfilesState,
  id: ProfileId,
): WallpaperFields {
  const c = state.byId[id];
  return {
    wallpaperRef: c?.wallpaperRef ?? null,
    wallpaperScrim: c?.wallpaperScrim ?? null,
    wallpaperPosition: c?.wallpaperPosition ?? null,
    wallpaperFocalX: c?.wallpaperFocalX ?? null,
    wallpaperFocalY: c?.wallpaperFocalY ?? null,
  };
}

/** Reset ONLY this profile (drop its saved config) — reverts it to the preset/global. */
export function resetProfile(state: ProfilesState, id: ProfileId): ProfilesState {
  if (!state.byId[id]) return state;
  const byId = { ...state.byId };
  delete byId[id];
  return { ...state, byId };
}
