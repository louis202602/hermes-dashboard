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
  "abstrait", // CSS gradient art — atmospheres/ambiances (0 asset)
  "montagne", // PHOTO category (real images)
  "mer", // PHOTO category (real images)
  "tropical", // PHOTO category (real images)
  "espace", // PHOTO category (real images)
  "user", // user uploads
] as const;
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];

/** Categories that must show REAL photographs (never CSS gradient art). */
export const PHOTO_CATEGORIES: WallpaperCategory[] = ["montagne", "mer", "tropical", "espace"];

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
};

/**
 * Wallpaper registry.
 *
 * - `hermes` / `abstrait`: pure-CSS gradient art (`.wallpaper-<id>`, 0 asset, 0 egress).
 *   The former "espace/montagne/mer/tropical" GRADIENTS are RECLASSIFIED here — they are
 *   stylised atmospheres, NOT photographs, so they are no longer presented as landscape
 *   photos (ids are kept stable so existing user prefs keep working).
 * - Photo categories (`montagne`/`mer`/`tropical`/`espace`) carry REAL images only
 *   (kind:"image"). `espace` ships real NASA public-domain photos. `montagne`/`mer`/
 *   `tropical` are prepared SLOTS — the exact files to provide are in
 *   docs/wallpaper-assets.md; provenance is NEVER fabricated.
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
  // --- Espace (REAL photos — NASA, public domain) ---
  {
    id: "espace-terre",
    category: "espace",
    kind: "image",
    defaultScrim: 0.28,
    asset: "/wallpapers/space/espace-terre.webp",
    thumb: "/wallpapers/space/espace-terre-thumb.webp",
    provenance: "NASA — Apollo 17 « Blue Marble » (AS17-148-22727) — domaine public",
  },
  {
    id: "espace-horizon",
    category: "espace",
    kind: "image",
    defaultScrim: 0.24,
    asset: "/wallpapers/space/espace-horizon.webp",
    thumb: "/wallpapers/space/espace-horizon-thumb.webp",
    provenance: "NASA — ISS Expedition 43 (iss043e091794) — domaine public",
  },
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
  focalX: number; // 0..1 (reserved; position covers V1)
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
    focalX: num01(w.wallpaperFocalX, 0.5),
    focalY: num01(w.wallpaperFocalY, 0.5),
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

/** True when a PHOTO category still has no real image shipped (gallery shows a note). */
export function photoCategoryPending(category: WallpaperCategory): boolean {
  return (
    PHOTO_CATEGORIES.includes(category) &&
    WALLPAPER_REGISTRY.every((w) => w.category !== category || w.kind !== "image")
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
