/**
 * DASH-4E — Dashboard wallpapers (pure, DOM-free).
 *
 * A wallpaper dresses the dashboard BEHIND the translucent widgets/cards. Two things
 * live here: the registry of Hermès built-in wallpapers (stable ids + category) and
 * the per-profile / global resolution + clamping of a wallpaper config. The visual of
 * each built-in is a CSS class in globals.css (`.wallpaper-<id>`) — NO image asset, NO
 * network, so the built-ins cost 0 bytes of egress and 0 €. A readability SCRIM is
 * always available so a light wallpaper never makes text unreadable; critical status
 * colours (error/warning/success/critical) are semantic tokens, never wallpaper-derived.
 *
 * COST-FIRST: built-ins are local CSS. User images (a future increment) reuse the
 * existing private storage + signed-URL infra — no second upload system. 0 LLM.
 */

export const WALLPAPER_CATEGORIES = [
  "hermes", // CSS gradient art — sober, premium (0 asset)
  "abstrait", // CSS gradient art + real abstract photos (liquid glass / chrome / energy)
  "paysage", // PHOTO — landscapes (montagne, forêt, plage, côte…)
  "espace", // PHOTO — space (real planets, galaxy, Earth) incl. NASA public domain
  "ville", // PHOTO — cityscapes
  "luxe", // PHOTO — luxury interiors / villas
  "yacht", // PHOTO — yachts (extensible; empty until provided)
  "automobile", // PHOTO — cars
  "moto", // PHOTO — motorcycles
  "technologie", // PHOTO — technology (extensible; empty until provided)
  "user", // user uploads
] as const;
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];

/** Photo categories (real images, never CSS gradient art) in gallery display order. */
export const PHOTO_CATEGORIES: WallpaperCategory[] = [
  "paysage",
  "espace",
  "ville",
  "luxe",
  "yacht",
  "automobile",
  "moto",
  "technologie",
];

export type WallpaperDef = {
  id: string;
  category: WallpaperCategory;
  /** "gradient" = pure CSS built-in (0 asset). "image" = real image asset. */
  kind: "gradient" | "image";
  /** Default readability scrim (0..1) suited to this wallpaper's brightness. */
  defaultScrim: number;
  /** For kind:"image": the full-quality local asset path (served from /public). */
  asset?: string;
  /** For kind:"image": a lightweight thumbnail path for the gallery (lazy-loaded). */
  thumb?: string;
  /** For kind:"image": human-readable source + LICENCE (never fabricated). */
  provenance?: string;
  /** For kind:"image": per-image focal point (0..1) so the subject stays framed. */
  focalX?: number;
  focalY?: number;
  /**
   * OWNER_PROVIDED_ASSET marker: the source image carries inherent third-party/product
   * branding (e.g. a Ducati badge, the « HERMÈS OS » emblem on an in-scene screen) that
   * was present in the file the owner supplied — never added or removed by us. Flagged so
   * these specific assets can be swapped for neutral versions later without hunting.
   */
  ownerBranded?: boolean;
};

/** Honest provenance for every owner-supplied photo (details in PROVENANCE.md). */
const OWNER_PROVENANCE = "Fourni par le propriétaire (Hermès OS)";

/** Build a real-image WallpaperDef from a /public path base (no ".webp" suffix). */
function img(
  id: string,
  category: WallpaperCategory,
  pathBase: string,
  defaultScrim: number,
  focalX: number,
  focalY: number,
): WallpaperDef {
  return {
    id,
    category,
    kind: "image",
    defaultScrim,
    asset: `/wallpapers/${pathBase}.webp`,
    thumb: `/wallpapers/${pathBase}-thumb.webp`,
    provenance: OWNER_PROVENANCE,
    focalX,
    focalY,
  };
}

/**
 * Wallpaper registry.
 *
 * - `hermes` / `abstrait`: pure-CSS gradient art (`.wallpaper-<id>`, 0 asset, 0 egress).
 *   The former "espace/montagne/mer/tropical" GRADIENTS are RECLASSIFIED under `abstrait`
 *   — they are stylised atmospheres, NOT photographs (ids kept stable so existing user
 *   prefs keep working).
 * - Photo categories carry REAL images only (kind:"image"), each with an HD asset, a
 *   lightweight thumbnail, an honest provenance (never fabricated) and a focal point.
 *   `espace` also ships real NASA public-domain photos; every owner-provided asset is
 *   recorded as owner-provided in public/wallpapers/PROVENANCE.md.
 */
export const WALLPAPER_REGISTRY: WallpaperDef[] = [
  // --- Hermès (CSS, sober premium) ---
  { id: "hermes-noir", category: "hermes", kind: "gradient", defaultScrim: 0.15 },
  { id: "hermes-bleu-nuit", category: "hermes", kind: "gradient", defaultScrim: 0.18 },
  { id: "hermes-graphite", category: "hermes", kind: "gradient", defaultScrim: 0.15 },
  { id: "hermes-azur", category: "hermes", kind: "gradient", defaultScrim: 0.22 },
  { id: "hermes-solaire", category: "hermes", kind: "gradient", defaultScrim: 0.28 },
  { id: "hermes-aurora", category: "hermes", kind: "gradient", defaultScrim: 0.2 },
  // --- Abstrait (CSS atmospheres — reclassified gradients, NOT photos) ---
  { id: "espace-atmosphere", category: "abstrait", kind: "gradient", defaultScrim: 0.2 },
  { id: "espace-etoiles", category: "abstrait", kind: "gradient", defaultScrim: 0.15 },
  { id: "espace-planete", category: "abstrait", kind: "gradient", defaultScrim: 0.2 },
  { id: "montagne-neige", category: "abstrait", kind: "gradient", defaultScrim: 0.34 },
  { id: "montagne-alpine", category: "abstrait", kind: "gradient", defaultScrim: 0.3 },
  { id: "montagne-crepuscule", category: "abstrait", kind: "gradient", defaultScrim: 0.3 },
  { id: "mer-profonde", category: "abstrait", kind: "gradient", defaultScrim: 0.22 },
  { id: "mer-turquoise", category: "abstrait", kind: "gradient", defaultScrim: 0.34 },
  { id: "mer-couchant", category: "abstrait", kind: "gradient", defaultScrim: 0.3 },
  { id: "tropical-couchant", category: "abstrait", kind: "gradient", defaultScrim: 0.3 },
  { id: "tropical-palmiers", category: "abstrait", kind: "gradient", defaultScrim: 0.32 },
  { id: "tropical-plage", category: "abstrait", kind: "gradient", defaultScrim: 0.36 },
  // --- Abstrait (REAL photos — owner-provided) ---
  img("abstract-liquid-glass-01", "abstrait", "abstract/abstract-liquid-glass-01", 0.24, 0.5, 0.5),
  img("abstract-chrome-01", "abstrait", "abstract/abstract-chrome-01", 0.32, 0.5, 0.5),
  img("abstract-energy-01", "abstrait", "abstract/abstract-energy-01", 0.22, 0.5, 0.5),
  // --- Paysage (REAL photos — owner-provided) ---
  img("landscape-snow-peaks-01", "paysage", "landscape/landscape-snow-peaks-01", 0.4, 0.6, 0.5),
  img("landscape-snow-valley-01", "paysage", "landscape/landscape-snow-valley-01", 0.4, 0.5, 0.5),
  img("landscape-mountain-lake-01", "paysage", "landscape/landscape-mountain-lake-01", 0.38, 0.5, 0.45),
  img("landscape-forest-stream-01", "paysage", "landscape/landscape-forest-stream-01", 0.34, 0.5, 0.5),
  img("landscape-tropical-beach-01", "paysage", "landscape/landscape-tropical-beach-01", 0.4, 0.5, 0.5),
  img("landscape-med-coast-01", "paysage", "landscape/landscape-med-coast-01", 0.4, 0.5, 0.5),
  // --- Espace (REAL photos — NASA public domain + owner-provided) ---
  {
    id: "espace-terre",
    category: "espace",
    kind: "image",
    defaultScrim: 0.28,
    asset: "/wallpapers/space/espace-terre.webp",
    thumb: "/wallpapers/space/espace-terre-thumb.webp",
    provenance: "NASA — Apollo 17 « Blue Marble » (AS17-148-22727) — domaine public",
    focalX: 0.5,
    focalY: 0.5,
  },
  {
    id: "espace-horizon",
    category: "espace",
    kind: "image",
    defaultScrim: 0.24,
    asset: "/wallpapers/space/espace-horizon.webp",
    thumb: "/wallpapers/space/espace-horizon-thumb.webp",
    provenance: "NASA — ISS Expedition 43 (iss043e091794) — domaine public",
    focalX: 0.5,
    focalY: 0.45,
  },
  img("space-ringed-planet-01", "espace", "space/space-ringed-planet-01", 0.22, 0.45, 0.45),
  img("space-galaxy-01", "espace", "space/space-galaxy-01", 0.2, 0.5, 0.45),
  img("space-earth-night-01", "espace", "space/space-earth-night-01", 0.22, 0.4, 0.55),
  // --- Ville (REAL photos — owner-provided) ---
  img("city-dubai-night-01", "ville", "city/city-dubai-night-01", 0.26, 0.5, 0.4),
  img("city-tokyo-neon-01", "ville", "city/city-tokyo-neon-01", 0.24, 0.5, 0.45),
  // --- Luxe (REAL photos — owner-provided) ---
  img("luxury-villa-01", "luxe", "luxury/luxury-villa-01", 0.3, 0.6, 0.5),
  // ownerBranded: « HERMÈS OS » emblem on an in-scene screen (inherent to the source).
  { ...img("luxury-lounge-sunset-01", "luxe", "luxury/luxury-lounge-sunset-01", 0.3, 0.5, 0.5), ownerBranded: true },
  { ...img("luxury-penthouse-01", "luxe", "luxury/luxury-penthouse-01", 0.26, 0.5, 0.5), ownerBranded: true },
  // --- Automobile (REAL photo — owner-provided) ---
  img("supercar-01", "automobile", "automotive/supercar-01", 0.3, 0.5, 0.6),
  // --- Moto (REAL photo — owner-provided) ---
  // ownerBranded: Ducati badging inherent to the depicted motorcycle in the source.
  { ...img("motorcycle-ducati-01", "moto", "motorcycle/motorcycle-ducati-01", 0.26, 0.5, 0.55), ownerBranded: true },
];

/** The Hermès default wallpaper id when nothing is chosen (subtle, always readable). */
export const DEFAULT_WALLPAPER_REF: string = "hermes-graphite";
export const WALLPAPERS_SCHEMA_VERSION = 1;

const REGISTRY_IDS = new Set(WALLPAPER_REGISTRY.map((w) => w.id));

export function wallpaperById(id: string | null | undefined): WallpaperDef | undefined {
  return id ? WALLPAPER_REGISTRY.find((w) => w.id === id) : undefined;
}
export function isBuiltinWallpaper(id: unknown): boolean {
  return typeof id === "string" && REGISTRY_IDS.has(id);
}
/** User-uploaded wallpaper refs are namespaced "user:<storageKey>" (future increment). */
export function isUserWallpaperRef(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("user:");
}
/** A ref is valid if it is a known built-in OR a user-namespaced key. */
export function isValidWallpaperRef(id: unknown): id is string {
  return isBuiltinWallpaper(id) || isUserWallpaperRef(id);
}

export const WALLPAPER_POSITIONS = ["center", "top", "bottom"] as const;
export type WallpaperPosition = (typeof WALLPAPER_POSITIONS)[number];

/** Resolved, render-ready wallpaper configuration. */
export type WallpaperConfig = {
  ref: string | null; // null ⇒ no wallpaper (plain background)
  scrim: number; // 0..1 readability overlay
  position: WallpaperPosition;
  focalX: number; // 0..1 focal point for kind:"image" (cover framing)
  focalY: number;
};

/**
 * Flat wallpaper fields as persisted on a profile config / the global default. Kept flat
 * (wallpaperRef/wallpaperScrim/…) so they layer additively onto the existing profiles
 * JSONB with no destructive migration (DASH-4D reserved wallpaperRef).
 */
export type WallpaperFields = {
  wallpaperRef?: string | null;
  wallpaperScrim?: number | null;
  wallpaperPosition?: string | null;
  wallpaperFocalX?: number | null;
  wallpaperFocalY?: number | null;
};

function num01(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** Parse persisted flat wallpaper fields into a typed WallpaperConfig (fail-safe). */
export function clampWallpaper(input: unknown): WallpaperConfig {
  const w = (input ?? {}) as Record<string, unknown>;
  const ref = isValidWallpaperRef(w.wallpaperRef) ? (w.wallpaperRef as string) : null;
  const def = wallpaperById(ref);
  const position = WALLPAPER_POSITIONS.includes(w.wallpaperPosition as WallpaperPosition)
    ? (w.wallpaperPosition as WallpaperPosition)
    : "center";
  return {
    ref,
    scrim: num01(w.wallpaperScrim, def?.defaultScrim ?? 0.2),
    position,
    // Fall back to the image's per-def focal point when the config sets none, so each
    // real photo stays framed on its subject across viewports.
    focalX: num01(w.wallpaperFocalX, def?.focalX ?? 0.5),
    focalY: num01(w.wallpaperFocalY, def?.focalY ?? 0.5),
  };
}

/** True when the config carries any explicit wallpaper choice (for the merge below). */
function hasWallpaper(input: unknown): boolean {
  const w = (input ?? {}) as Record<string, unknown>;
  return isValidWallpaperRef(w.wallpaperRef);
}

/**
 * Resolve the effective wallpaper: PROFILE choice → GLOBAL default → Hermès default.
 * Only a config that actually sets a ref participates; scrim/position come from whichever
 * layer supplies the ref (so a profile fully owns its look). `null` ⇒ Hermès default.
 */
export function resolveWallpaper(
  profileFields: WallpaperFields | null | undefined,
  globalFields: WallpaperFields | null | undefined,
  hermesDefaultRef: string = DEFAULT_WALLPAPER_REF,
): WallpaperConfig {
  if (hasWallpaper(profileFields)) return clampWallpaper(profileFields);
  if (hasWallpaper(globalFields)) return clampWallpaper(globalFields);
  return clampWallpaper({ wallpaperRef: hermesDefaultRef });
}

/** Discrete scrim level (0..3) for a CSS class — avoids per-value inline styles. */
export function scrimLevel(scrim: number): 0 | 1 | 2 | 3 {
  const s = num01(scrim, 0.2);
  if (s <= 0.08) return 0;
  if (s <= 0.2) return 1;
  if (s <= 0.35) return 2;
  return 3;
}

/** CSS class list for a GRADIENT built-in (image built-ins & user images use a URL). */
export function wallpaperClass(config: WallpaperConfig): string | null {
  const def = wallpaperById(config.ref);
  if (!def || def.kind !== "gradient") return null;
  return `wallpaper-layer wallpaper-${config.ref} pos-${config.position}`;
}

/** Local asset path for an image BUILT-IN (served from /public), else null. */
export function wallpaperAsset(ref: string | null | undefined): string | null {
  const def = wallpaperById(ref);
  return def?.kind === "image" ? (def.asset ?? null) : null;
}

/** Lightweight thumbnail path for an image wallpaper (falls back to the full asset). */
export function wallpaperThumb(ref: string | null | undefined): string | null {
  const def = wallpaperById(ref);
  if (def?.kind !== "image") return null;
  return def.thumb ?? def.asset ?? null;
}

export function wallpapersByCategory(category: WallpaperCategory): WallpaperDef[] {
  return WALLPAPER_REGISTRY.filter((w) => w.category === category);
}

/**
 * Selectable categories, in canonical order, that actually hold at least one wallpaper.
 * Drives the gallery tabs — empty/extensible categories (yacht, technologie until photos
 * are provided) simply don't appear, so the taxonomy stays extensible with no dead tabs.
 * `user` is excluded (uploads have their own control, not a gallery tab).
 */
export function populatedCategories(): Exclude<WallpaperCategory, "user">[] {
  return WALLPAPER_CATEGORIES.filter(
    (c): c is Exclude<WallpaperCategory, "user"> =>
      c !== "user" && WALLPAPER_REGISTRY.some((w) => w.category === c),
  );
}

// --- User-uploaded wallpapers: ref = "user:<storagePath>" --------------------

/** The storage path inside a user wallpaper ref ("user:tenant/user/wallpapers/…"). */
export function userWallpaperPath(ref: string | null | undefined): string | null {
  return isUserWallpaperRef(ref) ? (ref as string).slice("user:".length) : null;
}

/**
 * Ownership + traversal guard: a user wallpaper path MUST live under the caller's
 * own tenant/user wallpapers prefix. Rejects "..", absolute paths, and any path that
 * is not exactly `${tenantId}/${userId}/wallpapers/…` — so a user can never sign or
 * delete another tenant's / user's object by crafting a ref.
 */
export function userWallpaperPrefix(tenantId: string, userId: string): string {
  return `${tenantId}/${userId}/wallpapers/`;
}
export function isOwnedWallpaperPath(
  path: string,
  tenantId: string,
  userId: string,
): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
  return path.startsWith(userWallpaperPrefix(tenantId, userId));
}
