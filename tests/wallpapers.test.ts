import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  WALLPAPER_REGISTRY,
  WALLPAPER_CATEGORIES,
  PHOTO_CATEGORIES,
  DEFAULT_WALLPAPER_REF,
  wallpaperById,
  isBuiltinWallpaper,
  isUserWallpaperRef,
  isValidWallpaperRef,
  clampWallpaper,
  resolveWallpaper,
  scrimLevel,
  wallpaperClass,
  wallpaperAsset,
  wallpaperThumb,
  wallpapersByCategory,
  populatedCategories,
  userWallpaperPath,
  userWallpaperPrefix,
  isOwnedWallpaperPath,
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

test("categories: hermes = CSS only; photo categories ship REAL images", () => {
  // Hermès is pure CSS gradient art.
  const hermes = wallpapersByCategory("hermes");
  assert.ok(hermes.length >= 1 && hermes.every((w) => w.kind === "gradient"));
  // Every photo category that is populated holds real images (never gradients).
  for (const c of ["paysage", "espace", "ville", "luxe", "automobile", "moto"] as const) {
    const list = wallpapersByCategory(c);
    assert.ok(list.length >= 1, `${c} has wallpapers`);
    assert.ok(list.every((w) => w.kind === "image"), `${c} entries are real images`);
  }
  // Abstrait mixes reclassified CSS gradients + real abstract photos.
  const abstrait = wallpapersByCategory("abstrait");
  assert.ok(abstrait.some((w) => w.kind === "gradient"), "abstrait keeps CSS art");
  assert.ok(abstrait.some((w) => w.kind === "image"), "abstrait has real photos too");
});

test("populatedCategories: only non-empty categories, canonical order, excludes user", () => {
  const cats = populatedCategories();
  assert.ok(!cats.includes("user" as never), "user is not a gallery tab");
  // yacht/technologie ship no photo yet ⇒ absent (extensible, no dead tab).
  assert.ok(!cats.includes("yacht" as never));
  assert.ok(!cats.includes("technologie" as never));
  // present, populated ones appear:
  for (const c of ["hermes", "abstrait", "paysage", "espace", "ville", "luxe", "automobile", "moto"] as const) {
    assert.ok(cats.includes(c), `${c} is a tab`);
  }
  // canonical order preserved (subsequence of WALLPAPER_CATEGORIES)
  let j = 0;
  for (const c of cats) {
    while (j < WALLPAPER_CATEGORIES.length && WALLPAPER_CATEGORIES[j] !== c) j++;
    assert.ok(j < WALLPAPER_CATEGORIES.length, `${c} in canonical order`);
  }
});

test("photo categories: real images carry a local asset, thumb + honest provenance", () => {
  const photos = WALLPAPER_REGISTRY.filter((w) => w.kind === "image");
  assert.ok(photos.length >= 1);
  for (const w of photos) {
    // Real images live in a PHOTO category or in "abstrait" (mixed CSS + abstract photos).
    assert.ok(
      PHOTO_CATEGORIES.includes(w.category) || w.category === "abstrait",
      `${w.id} is in a photo/abstrait category`,
    );
    assert.match(w.asset ?? "", /^\/wallpapers\//, `${w.id} has a /public asset path`);
    assert.match(w.thumb ?? "", /^\/wallpapers\//, `${w.id} has a thumbnail path`);
    assert.ok((w.provenance ?? "").length > 0, `${w.id} declares provenance (never fabricated)`);
  }
});

test("wallpaperAsset / wallpaperThumb: image ⇒ paths, gradient/user ⇒ null", () => {
  assert.match(wallpaperAsset("espace-terre") ?? "", /espace-terre\.webp$/);
  assert.match(wallpaperThumb("espace-terre") ?? "", /espace-terre-thumb\.webp$/);
  assert.equal(wallpaperAsset("hermes-noir"), null, "gradient has no asset");
  assert.equal(wallpaperThumb("hermes-noir"), null, "gradient has no thumb");
  assert.equal(wallpaperAsset("user:abc"), null);
  assert.equal(wallpaperThumb(null), null);
});

test("image wallpapers carry a per-image focal point; clamp uses it as the default", () => {
  // Every real image declares a focal point in 0..1.
  for (const w of WALLPAPER_REGISTRY.filter((x) => x.kind === "image")) {
    assert.ok(typeof w.focalX === "number" && w.focalX >= 0 && w.focalX <= 1, `${w.id} focalX`);
    assert.ok(typeof w.focalY === "number" && w.focalY >= 0 && w.focalY <= 1, `${w.id} focalY`);
  }
  // With no user-set focal, clampWallpaper falls back to the def's focal (subject framing).
  const supercar = wallpaperById("supercar-01")!;
  const c = clampWallpaper({ wallpaperRef: "supercar-01" });
  assert.equal(c.focalX, supercar.focalX);
  assert.equal(c.focalY, supercar.focalY);
  // An explicit user focal still wins over the def default.
  const c2 = clampWallpaper({ wallpaperRef: "supercar-01", wallpaperFocalX: 0.1, wallpaperFocalY: 0.2 });
  assert.equal(c2.focalX, 0.1);
  assert.equal(c2.focalY, 0.2);
});

test("image wallpaper renders via URL, not a gradient class", () => {
  // kind:"image" ⇒ no gradient class (WallpaperLayer uses the asset/URL path instead)
  assert.equal(wallpaperClass(clampWallpaper({ wallpaperRef: "espace-terre" })), null);
  assert.equal(wallpaperClass(clampWallpaper({ wallpaperRef: "supercar-01" })), null);
});

// --- SECURITY: user wallpaper ownership / traversal guard ---------------------
test("userWallpaperPath extracts the storage path from a user ref", () => {
  assert.equal(userWallpaperPath("user:T/U/wallpapers/x/y.jpg"), "T/U/wallpapers/x/y.jpg");
  assert.equal(userWallpaperPath("hermes-noir"), null);
  assert.equal(userWallpaperPath(null), null);
});

test("isOwnedWallpaperPath: only the caller's own tenant/user prefix; rejects traversal & cross-*", () => {
  const T = "tenant-1", U = "user-1";
  const prefix = userWallpaperPrefix(T, U);
  assert.equal(prefix, "tenant-1/user-1/wallpapers/");
  // own path OK
  assert.ok(isOwnedWallpaperPath(`${prefix}abc/w.jpg`, T, U));
  // cross-tenant / cross-user REJECTED
  assert.ok(!isOwnedWallpaperPath("tenant-2/user-1/wallpapers/a/w.jpg", T, U));
  assert.ok(!isOwnedWallpaperPath("tenant-1/user-2/wallpapers/a/w.jpg", T, U));
  // not under wallpapers/ (e.g. a chat attachment path) REJECTED
  assert.ok(!isOwnedWallpaperPath("tenant-1/user-1/att/a/w.jpg", T, U));
  // traversal / absolute / backslash REJECTED
  assert.ok(!isOwnedWallpaperPath(`${prefix}../../etc/passwd`, T, U));
  assert.ok(!isOwnedWallpaperPath(`/${prefix}a/w.jpg`, T, U));
  assert.ok(!isOwnedWallpaperPath(`${prefix}a\\w.jpg`, T, U));
  assert.ok(!isOwnedWallpaperPath("", T, U));
});

test("OWNER_PROVIDED_ASSET: brand-bearing images are flagged for easy replacement", () => {
  const branded = WALLPAPER_REGISTRY.filter((w) => w.ownerBranded);
  const ids = branded.map((w) => w.id).sort();
  assert.deepEqual(ids, ["luxury-lounge-sunset-01", "luxury-penthouse-01", "motorcycle-ducati-01"]);
  // The flag only ever rides on a real owner-provided image (never a gradient).
  assert.ok(branded.every((w) => w.kind === "image"));
});

test("every registered image asset + thumbnail exists on disk under /public", () => {
  const pub = fileURLToPath(new URL("../public", import.meta.url));
  for (const w of WALLPAPER_REGISTRY.filter((x) => x.kind === "image")) {
    for (const p of [w.asset, w.thumb]) {
      assert.ok(p, `${w.id} declares a path`);
      // asset paths are /public-relative and must be real files (no dangling registry).
      assert.ok(existsSync(`${pub}${p}`), `${p} exists on disk`);
    }
  }
});

test("pure module: no fetch / network / LLM", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/wallpapers.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /supabase|openai|anthropic/i);
});
