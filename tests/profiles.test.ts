import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Real production modules. profiles.ts imports siblings via "@/..."; the test runner's
// ts-alias hook (tests/ts-alias.mjs, loaded via --import) resolves those to the repo root.
import {
  PROFILE_IDS,
  DEFAULT_PROFILE,
  clampProfiles,
  resolveActiveProfile,
  presetLayoutFor,
  effectiveProfileLayout,
  effectiveProfileAppearance,
  setActiveProfile,
  setProfileLayout,
  setProfileAppearance,
  resetProfile,
  renameProfile,
  EMPTY_PROFILES_STATE,
  type ProfilesState,
} from "../lib/dashboard/profiles.ts";
import {
  registryIds,
  resolveWidgetLayout,
  DEFAULT_LAYOUT,
  type LayoutPreferences,
} from "../lib/dashboard/widgets.ts";
import { HERMES_DEFAULT_APPEARANCE } from "../lib/dashboard/preferences.ts";

const ALL = new Set(registryIds());

// --- DEFAULT PRESETS ---------------------------------------------------------
test("DEFAULT_PROFILE_* presets: priority widgets visible & first, rest hidden", () => {
  const cases: Record<string, string> = {
    direction: "system-health",
    commercial: "commercial",
    chantier: "chantiers-map",
    finance: "cost",
  };
  for (const [id, firstVisible] of Object.entries(cases)) {
    const layout = presetLayoutFor(id as never);
    const { visible, items } = resolveWidgetLayout(layout, ALL);
    assert.equal(visible[0], firstVisible, `${id} first visible`);
    assert.ok(visible.length >= 4 && visible.length <= 6, `${id} focuses a handful`);
    // every registry id still present in the resolved order (nothing lost)
    assert.equal(items.length, registryIds().length, `${id} keeps full registry order`);
    // hidden ones are really hidden
    assert.ok(items.some((it) => it.hidden), `${id} hides non-priority widgets`);
  }
});

test("DEFAULT_PROFILE_CUSTOM: full standard dashboard (default layout)", () => {
  const layout = presetLayoutFor("custom");
  assert.deepEqual(layout, { ...DEFAULT_LAYOUT });
  const { visible } = resolveWidgetLayout(layout, ALL);
  // custom shows the standard set (all except defaultHidden like chantiers-map)
  assert.ok(visible.includes("kpis"));
  assert.ok(!visible.includes("chantiers-map"), "heavy opt-in stays hidden in custom");
});

// --- SWITCH + ACTIVE + FALLBACK ----------------------------------------------
test("SWITCH_PROFILE + ACTIVE_PROFILE fallback (unknown id, empty state)", () => {
  const s0 = clampProfiles({ active: "commercial", byId: {} });
  assert.equal(s0.active, "commercial");
  const s1 = setActiveProfile(s0, "finance");
  assert.equal(s1.active, "finance");
  assert.equal(s0.active, "commercial", "immutability: original unchanged");

  // unknown/corrupt active id -> null -> resolve fallback
  const bad = clampProfiles({ active: "nope" });
  assert.equal(bad.active, null);
  assert.equal(resolveActiveProfile(bad, null), DEFAULT_PROFILE); // no global layout -> direction
});

test("PROFILE_UNKNOWN_ID_FALLBACK: null active + existing global layout -> custom", () => {
  const globalLayout: LayoutPreferences = {
    order: ["cost", "kpis"], hidden: ["audit"], sizes: {}, context: {}, schemaVersion: 1,
  };
  assert.equal(resolveActiveProfile(EMPTY_PROFILES_STATE, globalLayout), "custom");
  assert.equal(resolveActiveProfile(EMPTY_PROFILES_STATE, null), DEFAULT_PROFILE);
});

// --- ISOLATION ---------------------------------------------------------------
test("PROFILE_LAYOUT_ISOLATION: editing one profile never touches another", () => {
  let s: ProfilesState = clampProfiles({ active: "direction" });
  const custom: LayoutPreferences = {
    order: ["agenda", "kpis"], hidden: [], sizes: { agenda: "large" }, context: {}, schemaVersion: 1,
  };
  s = setProfileLayout(s, "direction", custom);
  // direction now uses its saved layout; commercial still uses its preset
  assert.deepEqual(effectiveProfileLayout(s, "direction", null), custom);
  assert.deepEqual(effectiveProfileLayout(s, "commercial", null), presetLayoutFor("commercial"));
  assert.equal(s.byId.commercial, undefined, "commercial untouched");
});

test("PROFILE_APPEARANCE_ISOLATION: per-profile theme override, others unaffected", () => {
  let s: ProfilesState = clampProfiles({ active: "chantier" });
  s = setProfileAppearance(s, "chantier", { theme: "ocean" });
  s = setProfileAppearance(s, "finance", { theme: "minimal", accent: "neutral" });
  const chantierApp = effectiveProfileAppearance(HERMES_DEFAULT_APPEARANCE, s, "chantier");
  const financeApp = effectiveProfileAppearance(HERMES_DEFAULT_APPEARANCE, s, "finance");
  const directionApp = effectiveProfileAppearance(HERMES_DEFAULT_APPEARANCE, s, "direction");
  assert.equal(chantierApp.theme, "ocean");
  assert.equal(chantierApp.accent, HERMES_DEFAULT_APPEARANCE.accent, "only theme overridden");
  assert.equal(financeApp.theme, "minimal");
  assert.equal(financeApp.accent, "neutral");
  assert.deepEqual(directionApp, HERMES_DEFAULT_APPEARANCE, "no override -> global appearance");
});

// --- CAPABILITY FILTER + UNKNOWN WIDGET SAFETY -------------------------------
test("PROFILE_CAPABILITY_FILTER: profile widget unavailable on tenant -> not visible, no crash", () => {
  const available = new Set([...ALL].filter((id) => id !== "cost")); // tenant lacks 'cost'
  const layout = presetLayoutFor("finance"); // finance lists cost as its first priority
  const { visible, items } = resolveWidgetLayout(layout, available);
  assert.ok(!visible.includes("cost"), "unavailable widget filtered out");
  assert.equal(items.find((it) => it.id === "cost")?.available, false);
  assert.ok(visible.length > 0, "profile still renders its available widgets");
});

test("PROFILE_UNKNOWN_WIDGET_SAFE: junk ids in a persisted profile layout are dropped", () => {
  const s = clampProfiles({
    active: "custom",
    byId: { custom: { layout: { order: ["kpis", "__ghost__", 42], hidden: ["nope"] } } },
  });
  const layout = effectiveProfileLayout(s, "custom", null);
  const { items, visible } = resolveWidgetLayout(layout, ALL);
  // Safety is enforced at resolve: only registry ids survive, ghost/junk ignored.
  assert.equal(items.length, registryIds().length, "resolves cleanly, no ghost widget");
  assert.ok(items.every((it) => registryIds().includes(it.id)), "no non-registry id rendered");
  assert.ok(!visible.includes("__ghost__" as never) && !visible.includes("nope" as never));
});

// --- RESET (scoped) ----------------------------------------------------------
test("PROFILE_RESET_SCOPED: reset drops only that profile, others + global intact", () => {
  let s: ProfilesState = clampProfiles({ active: "direction" });
  s = setProfileLayout(s, "direction", { order: ["kpis"], hidden: [], sizes: {}, context: {}, schemaVersion: 1 });
  s = setProfileAppearance(s, "commercial", { theme: "graphite" });
  s = resetProfile(s, "direction");
  assert.equal(s.byId.direction, undefined, "direction config removed");
  assert.ok(s.byId.commercial, "commercial config untouched");
  // reverts to preset
  assert.deepEqual(effectiveProfileLayout(s, "direction", null), presetLayoutFor("direction"));
});

// --- MULTI-DEVICE round-trip (server JSONB) ----------------------------------
test("MULTI_DEVICE_PROFILE: state survives a DB JSONB round-trip unchanged", () => {
  let s: ProfilesState = clampProfiles({ active: "commercial" });
  s = setProfileLayout(s, "commercial", { order: ["commercial", "agenda"], hidden: ["audit"], sizes: { commercial: "large" }, context: { cost: false }, schemaVersion: 1 });
  s = setProfileAppearance(s, "commercial", { accent: "green" });
  s = renameProfile(s, "custom", "Mon tableau");
  const roundTripped = clampProfiles(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(roundTripped, s, "clamp(serialize(state)) === state");
  assert.equal(roundTripped.byId.custom?.name, "Mon tableau");
});

// --- Concurrency: edit A then switch B (mirrors the shell's ref-based writer) --
test("PENDING_WRITE_SAFE / NO_CROSS_PROFILE_WRITE / NO_LOST_EDIT", () => {
  const base = clampProfiles({ active: "direction" });
  const editedLayout: LayoutPreferences = {
    order: ["kpis"], hidden: [], sizes: {}, context: {}, schemaVersion: 1,
  };
  // Edit while A (direction) is active …
  const afterEdit = setProfileLayout(base, "direction", editedLayout);
  // … then immediately switch to B (commercial) from the POST-EDIT state (the shell
  // reads profilesRef.current, so the switch always sees the just-made edit).
  const afterSwitch = setActiveProfile(afterEdit, "commercial");
  assert.equal(afterSwitch.active, "commercial", "switch applied");
  assert.deepEqual(afterSwitch.byId.direction?.layout, editedLayout, "A's edit preserved under A");
  assert.equal(afterSwitch.byId.commercial?.layout ?? null, null, "edit NOT written to B");
  // The single merged object the debounce persists still yields A's edit for A.
  assert.deepEqual(effectiveProfileLayout(afterSwitch, "direction", null), editedLayout);
});

// --- DASH-4E: per-profile wallpaper fields round-trip; invalid refs drop safely ---
test("WALLPAPER per-profile fields round-trip; invalid ref dropped; scrim/position clamp", () => {
  const s = clampProfiles({
    active: "direction",
    byId: {
      direction: { wallpaperRef: "hermes-graphite", wallpaperScrim: 0.3, wallpaperPosition: "top", appearance: { theme: "midnight" } },
      custom: { wallpaperRef: "user:abc123", wallpaperScrim: 2 /*clamped→1*/, wallpaperPosition: "sideways" /*invalid→null*/ },
      chantier: { wallpaperRef: "not-a-wallpaper" /*invalid→null*/ },
    },
    wallpaper: { wallpaperRef: "espace-atmosphere", wallpaperScrim: 0.2 },
  });
  assert.equal(s.byId.direction?.wallpaperRef, "hermes-graphite");
  assert.equal(s.byId.direction?.wallpaperPosition, "top");
  assert.equal(s.byId.custom?.wallpaperRef, "user:abc123", "user-namespaced ref accepted");
  assert.equal(s.byId.custom?.wallpaperScrim, 1, "scrim clamped to 0..1");
  assert.equal(s.byId.custom?.wallpaperPosition, null, "invalid position dropped");
  assert.equal(s.byId.chantier?.wallpaperRef, null, "unknown ref dropped (fail-safe)");
  assert.equal(s.wallpaper.wallpaperRef, "espace-atmosphere", "global default wallpaper");
  const rt = clampProfiles(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(rt, s, "wallpaper fields survive a DB JSONB round-trip (multi-device)");
});

// --- COST-FIRST: pure module, no I/O -----------------------------------------
test("NO_EXTRA_DB_FETCH: profiles module is pure (no fetch/network/LLM)", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/profiles.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /supabase|rpc\(|openai|anthropic/i);
});

// --- exhaustive id list ------------------------------------------------------
test("PROFILE_IDS is the expected closed set", () => {
  assert.deepEqual([...PROFILE_IDS], ["direction", "commercial", "chantier", "finance", "custom"]);
});
