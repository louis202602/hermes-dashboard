import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  WALLPAPER_REGISTRY,
  WALLPAPER_CATEGORIES,
  DEFAULT_WALLPAPER_REF,
  wallpaperById,
  isBuiltinWallpaper,
  isUserWallpaperRef,
  isValidWallpaperRef,
  clampWallpaper,
  resolveWallpaper,
  scrimLevel,
  wallpaperClass,
  wallpapersByCategory,
} from "../lib/dashboard/wallpapers.ts";

test("registry: stable ids, valid categories, default is a real built-in", () => {
  const ids = WALLPAPER_REGISTRY.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  for (const w of WALLPAPER_REGISTRY) {
    assert.ok(WALLPAPER_CATEGORIES.includes(w.category));
    assert.ok(w.defaultScrim >= 0 && w.defaultScrim <= 1);
  }
  assert.ok(isBuiltinWallpaper(DEFAULT_WALLPAPER_REF));
  assert.ok(wallpaperById(DEFAULT_WALLPAPER_REF));
});

test("ref validation: built-in vs user-namespaced vs junk", () => {
  assert.ok(isBuiltinWallpaper("hermes-graphite"));
  assert.ok(!isBuiltinWallpaper("nope"));
  assert.ok(isUserWallpaperRef("user:abc123"));
  assert.ok(!isUserWallpaperRef("hermes-graphite"));
  assert.ok(isValidWallpaperRef("hermes-noir"));
  assert.ok(isValidWallpaperRef("user:xyz"));
  assert.ok(!isValidWallpaperRef("random/thing"));
  assert.ok(!isValidWallpaperRef(42));
});

test("clampWallpaper: fail-safe, scrim/position/focal bounded", () => {
  const c = clampWallpaper({ wallpaperRef: "espace-atmosphere", wallpaperScrim: 5, wallpaperPosition: "top", wallpaperFocalX: -1, wallpaperFocalY: 0.7 });
  assert.equal(c.ref, "espace-atmosphere");
  assert.equal(c.scrim, 1, "scrim clamped to 1");
  assert.equal(c.position, "top");
  assert.equal(c.focalX, 0, "focalX clamped to 0");
  assert.equal(c.focalY, 0.7);
  // invalid ref ⇒ null ref, default scrim
  const bad = clampWallpaper({ wallpaperRef: "ghost", wallpaperPosition: "diagonal" });
  assert.equal(bad.ref, null);
  assert.equal(bad.position, "center", "invalid position ⇒ center");
});

test("resolveWallpaper: profile → global → Hermès default", () => {
  // profile wins
  assert.equal(
    resolveWallpaper({ wallpaperRef: "hermes-azur" }, { wallpaperRef: "espace-etoiles" }).ref,
    "hermes-azur",
  );
  // profile empty ⇒ global
  assert.equal(
    resolveWallpaper({ wallpaperRef: null }, { wallpaperRef: "espace-etoiles" }).ref,
    "espace-etoiles",
  );
  // both empty ⇒ Hermès default
  assert.equal(resolveWallpaper(null, null).ref, DEFAULT_WALLPAPER_REF);
  // invalid everywhere ⇒ Hermès default (never crash)
  assert.equal(resolveWallpaper({ wallpaperRef: "x" }, { wallpaperRef: "y" }).ref, DEFAULT_WALLPAPER_REF);
});

test("scrimLevel: monotonic discrete buckets 0..3", () => {
  assert.equal(scrimLevel(0), 0);
  assert.equal(scrimLevel(0.15), 1);
  assert.equal(scrimLevel(0.3), 2);
  assert.equal(scrimLevel(0.9), 3);
});

test("wallpaperClass: built-in ⇒ class, user/none ⇒ null (image path is future)", () => {
  assert.match(wallpaperClass(clampWallpaper({ wallpaperRef: "hermes-noir", wallpaperPosition: "bottom" }))!, /wallpaper-hermes-noir/);
  assert.match(wallpaperClass(clampWallpaper({ wallpaperRef: "hermes-noir", wallpaperPosition: "bottom" }))!, /pos-bottom/);
  assert.equal(wallpaperClass(clampWallpaper({ wallpaperRef: "user:abc" })), null);
  assert.equal(wallpaperClass(clampWallpaper({})), null);
});

test("categories: hermes + espace populated in this increment", () => {
  assert.ok(wallpapersByCategory("hermes").length >= 4);
  assert.ok(wallpapersByCategory("espace").length >= 1);
});

test("pure module: no fetch / network / LLM", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/wallpapers.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /supabase|openai|anthropic/i);
});
