"use client";

import {
  scrimLevel,
  wallpaperClass,
  type WallpaperConfig,
} from "@/lib/dashboard/wallpapers";

/**
 * DASH-4E — the wallpaper canvas. A fixed, decorative layer painted BEHIND the
 * dashboard (z-index:-1, above the body atmosphere, below the glass widgets), plus a
 * readability scrim so text stays legible over any wallpaper. Built-in wallpapers are
 * pure CSS (0 asset). Returns null for "no wallpaper" and (for now) for user-image
 * refs — the image path lands in the next DASH-4E increment. Purely decorative:
 * aria-hidden, no pointer events, static (reduced-motion safe).
 */
export default function WallpaperLayer({ config }: { config: WallpaperConfig }) {
  const cls = wallpaperClass(config);
  if (!cls) return null;
  return (
    <div className={cls} aria-hidden data-wallpaper>
      <div className={`wallpaper-scrim scrim-${scrimLevel(config.scrim)}`} />
    </div>
  );
}
