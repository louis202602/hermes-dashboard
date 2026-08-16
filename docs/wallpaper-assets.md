# DASH-4E — Wallpaper assets manifest

This dashboard ships **premium CSS-gradient wallpapers** (0 asset, 0 egress) in every
category, plus **user-uploaded photo wallpapers** (private storage, reused infra).

## What ships in the code (no assets needed)

Pure-CSS built-ins (`.wallpaper-<id>` in `app/globals.css`, registered in
`lib/dashboard/wallpapers.ts`):

- **Hermès** — `hermes-noir`, `hermes-bleu-nuit`, `hermes-graphite`, `hermes-azur`, `hermes-solaire`, `hermes-aurora`
- **Espace** — `espace-atmosphere`, `espace-etoiles`, `espace-planete`
- **Montagne** — `montagne-neige`, `montagne-alpine`, `montagne-crepuscule`
- **Mer** — `mer-profonde`, `mer-turquoise`, `mer-couchant`
- **Tropical** — `tropical-couchant`, `tropical-palmiers`, `tropical-plage`

These are stylized gradient art, not photographs.

## What remains to be PROVIDED (real photographs)

To add true photographic built-ins, drop licensed image files under
`public/wallpapers/<category>/` and register them in `WALLPAPER_REGISTRY` with
`kind: "image"` + `asset: "/wallpapers/<category>/<file>.webp"`. The render path
(`WallpaperLayer`, `wallpaperAsset`, `kind:"image"`) is already implemented — no code
change beyond the registry entries.

> IMPORTANT (per product owner): do NOT integrate photos whose licence does not clearly
> permit product embedding. Provenance must be real — never fabricated. Recommended:
> commissioned/owned shots, or clearly-licensed stock (e.g. an org-owned licence).

Suggested set to source (WebP, ~2560px long edge, < ~400 KB each, dark-biased for
readability or paired with a higher default scrim):

| id (proposed)          | category  | subject                                   |
|------------------------|-----------|-------------------------------------------|
| `montagne-photo-1`     | montagne  | snowy peaks, cool light                   |
| `montagne-photo-2`     | montagne  | alpine valley / winter                    |
| `mer-photo-1`          | mer       | deep blue Mediterranean horizon           |
| `mer-photo-2`          | mer       | coastal cliffs / cove                     |
| `tropical-photo-1`     | tropical  | palms + golden light                      |
| `tropical-photo-2`     | tropical  | tropical beach at sunset                  |
| `espace-photo-1`       | espace    | planet limb + atmosphere from space (NO central object/holograms) |

Each asset should have a lightweight thumbnail (the gallery can also reuse the full
image scaled). Add `img-src`/asset paths are already allowed (served from `/public`).
