"use client";

import {
  DEFAULT_WALLPAPER_REF,
  scrimLevel,
  wallpaperAsset,
  wallpaperClass,
  type WallpaperConfig,
} from "@/lib/dashboard/wallpapers";

/**
 * DASH-4E — the wallpaper canvas. A fixed, decorative layer painted BEHIND the
 * dashboard (z-index:-1, above the body atmosphere, below the glass widgets), plus a
 * readability scrim so text stays legible over any wallpaper.
 *
 * Three render paths: a pure-CSS built-in (class), an image — either a built-in photo
 * (local /public asset, e.g. the real NASA space photos) or a user upload (signed URL) —
 * painted via inline background-image (CSP-safe), and a clean fallback to the Hermès
 * default gradient when an image ref has no usable URL (expired signed URL / missing
 * asset) — so a broken/expired image NEVER yields a broken screen. Image wallpapers use
 * `background-size: cover` (from CSS) plus a focal point (focalX/focalY) so the subject
 * stays framed across viewports. Purely decorative: aria-hidden, no pointer events,
 * static (reduced-motion safe).
 */
export default function WallpaperLayer({
  config,
  imageUrl,
}: {
  config: WallpaperConfig;
  imageUrl?: string | null;
}) {
  const gradientCls = wallpaperClass(config);
  const scrim = <div className={`wallpaper-scrim scrim-${scrimLevel(config.scrim)}`} />;

  if (gradientCls) {
    return (
      <div className={gradientCls} aria-hidden data-wallpaper>
        {scrim}
      </div>
    );
  }

  // Image source: a signed user upload takes precedence; otherwise a built-in photo's
  // local /public asset (same-origin, needs no signing).
  const src = imageUrl ?? wallpaperAsset(config.ref);
  if (src) {
    // Sanitize for a CSS url() context (defense in depth; signed URLs are already safe).
    const safe = src.replace(/["\\)]/g, "");
    // Focal point (0..1 → %) keeps the subject framed under `cover`. It overrides the
    // coarse pos-* class, which is retained as a graceful fallback if focal is absent.
    const focal = `${Math.round(config.focalX * 100)}% ${Math.round(config.focalY * 100)}%`;
    return (
      <div
        className={`wallpaper-layer wallpaper-image pos-${config.position}`}
        style={{ backgroundImage: `url("${safe}")`, backgroundPosition: focal }}
        aria-hidden
        data-wallpaper
      >
        {scrim}
      </div>
    );
  }

  // User-image ref but no usable signed URL ⇒ Hermès default gradient (never broken).
  return (
    <div className={`wallpaper-layer wallpaper-${DEFAULT_WALLPAPER_REF} pos-center`} aria-hidden data-wallpaper>
      {scrim}
    </div>
  );
}
