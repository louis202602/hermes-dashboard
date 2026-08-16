"use client";

import {
  DEFAULT_WALLPAPER_REF,
  scrimLevel,
  wallpaperClass,
  type WallpaperConfig,
} from "@/lib/dashboard/wallpapers";

/**
 * DASH-4E — the wallpaper canvas. A fixed, decorative layer painted BEHIND the
 * dashboard (z-index:-1, above the body atmosphere, below the glass widgets), plus a
 * readability scrim so text stays legible over any wallpaper.
 *
 * Three render paths: a pure-CSS built-in (class), a user/photo image (signed URL via
 * inline background-image, CSP-safe), and a clean fallback to the Hermès default
 * gradient when an image ref has no usable URL (expired signed URL / missing asset) —
 * so a broken/expired image NEVER yields a broken screen. Purely decorative:
 * aria-hidden, no pointer events, static (reduced-motion safe).
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

  if (imageUrl) {
    // Sanitize for a CSS url() context (defense in depth; signed URLs are already safe).
    const safe = imageUrl.replace(/["\\)]/g, "");
    return (
      <div
        className={`wallpaper-layer wallpaper-image pos-${config.position}`}
        style={{ backgroundImage: `url("${safe}")` }}
        aria-hidden
        data-wallpaper
      >
        {scrim}
      </div>
    );
  }

  // Image/user ref but no usable URL ⇒ Hermès default gradient (never a broken screen).
  return (
    <div className={`wallpaper-layer wallpaper-${DEFAULT_WALLPAPER_REF} pos-center`} aria-hidden data-wallpaper>
      {scrim}
    </div>
  );
}
