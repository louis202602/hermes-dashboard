# Wallpaper assets — provenance

Two provenance groups live under `public/wallpapers/`:

## NASA — public domain (`space/espace-*.webp`)
- `espace-terre.webp`   — NASA Apollo 17 « Blue Marble » (AS17-148-22727), public domain
- `espace-horizon.webp` — NASA ISS Expedition 43 (iss043e091794), public domain
NASA imagery is public domain: https://www.nasa.gov/multimedia/guidelines/index.html

## Owner-provided assets (all other files)
Every other image under `public/wallpapers/<category>/` was **provided by the product
owner (Hermès OS)** as reference wallpapers to embed in the product. They were only
re-encoded to WebP and downscaled for thumbnails — no content was altered, no logo or
text was added or removed. Provenance is recorded honestly as owner-provided; it is
never fabricated as third-party stock.

### OWNER_PROVIDED_ASSET — flagged for easy future replacement

Three assets carry inherent third-party / product branding present in the supplied file
(never added or removed by us). They are marked `ownerBranded: true` in
`WALLPAPER_REGISTRY` so they can be swapped for neutral versions later without hunting —
drop a replacement WebP at the same path (+ its `-thumb.webp`) and the flag can be
cleared:

- `luxury/luxury-lounge-sunset-01.webp` — « HERMÈS OS » emblem on an in-scene screen
  (the owner's own product branding).
- `luxury/luxury-penthouse-01.webp` — « HERMÈS OS » emblem on an in-scene screen.
- `motorcycle/motorcycle-ducati-01.webp` — Ducati badging inherent to the motorcycle.
