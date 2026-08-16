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
  "hermes",
  "espace",
  "montagne",
  "mer",
  "tropical",
  "user",
] as const;
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];

export type WallpaperDef = {
  id: string;
  category: WallpaperCategory;
  /** "gradient" = pure CSS built-in (0 asset). "image" = asset/signed-URL. */
  kind: "gradient" | "image";
  /** Default readability scrim (0..1) suited to this wallpaper's brightness. */
  defaultScrim: number;
  /** For kind:"image" built-ins: the local asset path (served from /public). */
  asset?: string;
};

/**
 * Built-in wallpapers shipped in this increment — all pure CSS (`.wallpaper-<id>`), all
 * dark-to-mid so text stays readable with a light scrim. Photographic families
 * (montagne / mer / tropical) and user uploads are the next DASH-4E increment; their
 * ids will slot into this same registry with kind:"image" — no architecture change.
 */
export const WALLPAPER_REGISTRY: WallpaperDef[] = [
  // Hermès / abstract (sober, premium)
  { id: "hermes-noir", category: "hermes", kind: "gradient", defaultScrim: 0.15 },
  { id: "hermes-bleu-nuit", category: "hermes", kind: "gradient", defaultScrim: 0.18 },
  { id: "hermes-graphite", category: "hermes", kind: "gradient", defaultScrim: 0.15 },
  { id: "hermes-azur", category: "hermes", kind: "gradient", defaultScrim: 0.22 },
  { id: "hermes-solaire", category: "hermes", kind: "gradient", defaultScrim: 0.28 },
  { id: "hermes-aurora", category: "hermes", kind: "gradient", defaultScrim: 0.2 },
  // Espace / planète — spatial LANDSCAPE only (atmosphere + stars), NO central object.
  { id: "espace-atmosphere", category: "espace", kind: "gradient", defaultScrim: 0.2 },
  { id: "espace-etoiles", category: "espace", kind: "gradient", defaultScrim: 0.15 },
  { id: "espace-planete", category: "espace", kind: "gradient", defaultScrim: 0.2 },
  // Montagne / neige — premium CSS art (photo built-ins are a documented manifest).
  { id: "montagne-neige", category: "montagne", kind: "gradient", defaultScrim: 0.34 },
  { id: "montagne-alpine", category: "montagne", kind: "gradient", defaultScrim: 0.3 },
  { id: "montagne-crepuscule", category: "montagne", kind: "gradient", defaultScrim: 0.3 },
  // Mer / Méditerranée
  { id: "mer-profonde", category: "mer", kind: "gradient", defaultScrim: 0.22 },
  { id: "mer-turquoise", category: "mer", kind: "gradient", defaultScrim: 0.34 },
  { id: "mer-couchant", category: "mer", kind: "gradient", defaultScrim: 0.3 },
  // Tropical / soleil
  { id: "tropical-couchant", category: "tropical", kind: "gradient", defaultScrim: 0.3 },
  { id: "tropical-palmiers", category: "tropical", kind: "gradient", defaultScrim: 0.32 },
  { id: "tropical-plage", category: "tropical", kind: "gradient", defaultScrim: 0.36 },
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

export function wallpapersByCategory(category: WallpaperCategory): WallpaperDef[] {
  return WALLPAPER_REGISTRY.filter((w) => w.category === category);
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
