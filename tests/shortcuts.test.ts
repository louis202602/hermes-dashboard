import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { ProfilesState } from "../lib/dashboard/profiles.ts";
import { clampBehavior } from "../lib/dashboard/preferences.ts";
import {
  MAX_FAVORITES,
  MAX_QUICK_ACTIONS,
  NAV_SHORTCUTS,
  favoriteNavRef,
  favoriteWidgetRef,
  isValidDefaultHome,
  quickActionOptionIds,
  resolveFavorites,
  resolveHomeProfile,
  resolveQuickActions,
  toggleFavorite,
} from "../lib/dashboard/shortcuts.ts";

function profiles(active: ProfilesState["active"]): ProfilesState {
  return { active, byId: {}, wallpaper: {} as ProfilesState["wallpaper"], schemaVersion: 1 };
}

// --- nav catalog = REAL destinations only ------------------------------------
test("NAV_SHORTCUTS: only real routes/anchors", () => {
  const targets = NAV_SHORTCUTS.map((n) => n.target);
  assert.deepEqual(targets.sort(), ["#hermes-command", "/chantiers/carte", "/parametres/dashboard"]);
  for (const n of NAV_SHORTCUTS) assert.ok(n.labelKey.startsWith("shortcut."));
});

// --- C. default home ---------------------------------------------------------
test("resolveHomeProfile: openLastMode → last; else fixed profile; else fallback", () => {
  // openLastMode wins → last active (fixed default ignored)
  assert.equal(resolveHomeProfile({ openLastMode: true, defaultHome: "finance" }, profiles("commercial"), null), "commercial");
  // fixed profile
  assert.equal(resolveHomeProfile({ openLastMode: false, defaultHome: "finance" }, profiles(null), null), "finance");
  // nothing valid ⇒ last active / default
  assert.equal(resolveHomeProfile({ openLastMode: false, defaultHome: null }, profiles(null), null), "direction");
  assert.equal(resolveHomeProfile({ openLastMode: false, defaultHome: "garbage" }, profiles("commercial"), null), "commercial");
});

test("isValidDefaultHome: only real profiles (no trap-prone map redirect)", () => {
  assert.ok(isValidDefaultHome("finance"));
  assert.ok(!isValidDefaultHome("map"));
  assert.ok(!isValidDefaultHome("nope"));
  assert.ok(!isValidDefaultHome(null));
});

// --- A. quick actions --------------------------------------------------------
test("resolveQuickActions: nav + capability-gated, dedup, bounded; no dead entries", () => {
  const avail = ["hermes.qualification", "hermes.planning"];
  const res = resolveQuickActions(
    ["chat", "hermes.qualification", "hermes.qualification", "hermes.MISSING", "map"],
    avail,
  );
  assert.deepEqual(res.map((r) => r.kind), ["nav", "capability", "nav"]);
  assert.equal(res.find((r) => r.kind === "nav" && r.id === "chat")?.isRoute, false);
  assert.equal(res.find((r) => r.kind === "nav" && r.id === "map")?.isRoute, true);
  // unavailable capability dropped (capability-gated)
  assert.ok(!res.some((r) => r.kind === "capability" && r.id === "hermes.MISSING"));
  // bound
  const many = Array.from({ length: 30 }, (_, i) => `cap.${i}`);
  assert.ok(resolveQuickActions(many, many).length <= MAX_QUICK_ACTIONS);
});

test("quickActionOptionIds = nav ids + granted capability keys", () => {
  const ids = quickActionOptionIds(["cap.a"]);
  assert.ok(ids.includes("map") && ids.includes("chat") && ids.includes("settings") && ids.includes("cap.a"));
});

// --- B. favorites ------------------------------------------------------------
test("resolveFavorites: widget must be in registry (+visible flag), nav known; drop junk; bounded", () => {
  const reg = ["agenda", "cost", "alerts"];
  const visible = ["agenda", "alerts"];
  const res = resolveFavorites(
    [favoriteWidgetRef("agenda"), favoriteWidgetRef("cost"), favoriteWidgetRef("ghost"), favoriteNavRef("map"), favoriteNavRef("nope"), "junk"],
    reg,
    visible,
  );
  assert.deepEqual(res, [
    { kind: "widget", id: "agenda", visible: true },
    { kind: "widget", id: "cost", visible: false }, // in registry but hidden now
    { kind: "nav", id: "map", target: "/chantiers/carte", isRoute: true, labelKey: "shortcut.map" },
  ]);
});

test("toggleFavorite: add / remove / bounded", () => {
  let favs: string[] = [];
  favs = toggleFavorite(favs, "widget:agenda");
  assert.deepEqual(favs, ["widget:agenda"]);
  favs = toggleFavorite(favs, "widget:agenda"); // remove
  assert.deepEqual(favs, []);
  // bound
  let full = Array.from({ length: MAX_FAVORITES }, (_, i) => `widget:w${i}`);
  const before = full.length;
  full = toggleFavorite(full, "widget:overflow");
  assert.equal(full.length, before, "no growth beyond MAX_FAVORITES");
  assert.ok(!full.includes("widget:overflow"));
});

// --- storage clamp -----------------------------------------------------------
test("clampBehavior: new shortcut fields bounded & fail-safe", () => {
  const b = clampBehavior({
    defaultHome: 123,
    quickActions: ["a", "a", "", 5, "b"],
    favorites: Array.from({ length: 40 }, (_, i) => `widget:w${i}`),
  });
  assert.equal(b.defaultHome, null, "non-string ⇒ null");
  assert.deepEqual(b.quickActions, ["a", "b"], "deduped, junk dropped");
  assert.ok(b.favorites.length <= MAX_FAVORITES, "favorites bounded");
  assert.deepEqual(clampBehavior({}).quickActions, []);
  assert.deepEqual(clampBehavior({}).favorites, []);
  assert.equal(clampBehavior({}).defaultHome, null);
});

// --- purity ------------------------------------------------------------------
test("shortcuts: pure module (no fetch / network / LLM)", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/shortcuts.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /openai|anthropic|supabase/i);
});

test("CSS: favorites bar + settings chips present", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  for (const cls of [".favorites-bar", ".favorite-chip", ".settings-chips", ".settings-chip.is-active"]) {
    assert.ok(css.includes(cls), `missing CSS ${cls}`);
  }
});
