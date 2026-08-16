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

export const PROFILE_IDS = [
  "direction",
  "commercial",
  "chantier",
  "finance",
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
 * Curated priority widgets per preset — the "focus" of each mode. These ids MUST
 * exist in the widget registry; unknown ids are dropped on build (fail-safe). Every
 * other registry widget is hidden by default in that mode (the user can re-add it).
 * `custom` has no priority list — it is the full standard dashboard.
 */
const PRESET_PRIORITY: Record<Exclude<ProfileId, "custom">, string[]> = {
  direction: ["system-health", "alerts", "cost", "agent-activity", "commercial", "agenda"],
  commercial: ["commercial", "agenda", "alerts", "tasks", "conversations"],
  chantier: ["chantiers-map", "agenda", "alerts", "projects", "tasks"],
  finance: ["cost", "kpis", "commercial", "alerts", "system-health"],
};

/** Build a preset layout: priority widgets first & visible, everything else hidden. */
function presetLayout(priority: string[]): LayoutPreferences {
  const ids = registryIds();
  const known = priority.filter((id) => ids.includes(id));
  const seen = new Set(known);
  const rest = ids.filter((id) => !seen.has(id));
  return {
    order: [...known, ...rest],
    hidden: rest, // focus mode: only the priority widgets are shown
    sizes: {},
    context: {},
    schemaVersion: LAYOUT_SCHEMA_VERSION,
  };
}

/** The Hermès default layout for a profile that the user has never customized. */
export function presetLayoutFor(id: ProfileId): LayoutPreferences {
  if (id === "custom") return { ...DEFAULT_LAYOUT };
  return presetLayout(PRESET_PRIORITY[id]);
}

export type ProfileConfig = {
  /** User-customized layout for this profile. `null` ⇒ use the preset (or global for custom). */
  layout: LayoutPreferences | null;
  /** Partial appearance override layered on the GLOBAL appearance (empty ⇒ none). */
  appearance: Partial<Appearance>;
  /** Optional rename (mainly for the custom profile). */
  name: string | null;
  /** DASH-4E reservation — a wallpaper reference per profile. Unused in 4D. */
  wallpaperRef: string | null;
};

export type ProfilesState = {
  /** Active profile, or `null` when the user has never chosen one (resolve with global layout). */
  active: ProfileId | null;
  byId: Partial<Record<ProfileId, ProfileConfig>>;
  schemaVersion: number;
};

export const EMPTY_PROFILES_STATE: ProfilesState = {
  active: null,
  byId: {},
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

function clampProfileConfig(input: unknown): ProfileConfig {
  const c = (input ?? {}) as Record<string, unknown>;
  const hasLayout =
    c.layout != null && typeof c.layout === "object" && !Array.isArray(c.layout);
  return {
    layout: hasLayout ? clampLayout(c.layout) : null,
    appearance: clampAppearanceOverride(c.appearance),
    name: strOrNull(c.name),
    wallpaperRef: strOrNull(c.wallpaperRef, 256),
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
  const current: ProfileConfig =
    state.byId[id] ?? { layout: null, appearance: {}, name: null, wallpaperRef: null };
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

/** Reset ONLY this profile (drop its saved config) — reverts it to the preset/global. */
export function resetProfile(state: ProfilesState, id: ProfileId): ProfilesState {
  if (!state.byId[id]) return state;
  const byId = { ...state.byId };
  delete byId[id];
  return { ...state, byId };
}
