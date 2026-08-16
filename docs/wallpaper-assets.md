# Wallpaper assets manifest

The dashboard dresses the space **behind** the translucent widgets with a wallpaper.
One system, two kinds (no second uploader):

1. **CSS-gradient art** (`kind:"gradient"`) — 0 asset, 0 egress, `.wallpaper-<id>` in
   `app/globals.css`, registered in `lib/dashboard/wallpapers.ts`. Kept only in the
   **Hermès** and **Abstrait** categories.
2. **Real image assets** (`kind:"image"`) — a local file under `public/wallpapers/…`
   (built-in photos) **or** a private user upload (`user:<storage-path>`, signed URL).
   Rendered by `WallpaperLayer` via `background-image` + `background-size: cover` and a
   per-image **focal point** (`focalX`/`focalY`) so the subject stays framed on every
   viewport.

## Categories (taxonomy)

`hermes`, `abstrait`, `paysage`, `espace`, `ville`, `luxe`, `yacht`, `automobile`,
`moto`, `technologie`, `user`. The gallery shows a tab only for categories that actually
hold a wallpaper (`populatedCategories()`), so `yacht` / `technologie` stay defined and
extensible without a dead tab until real photos are provided.

## Real image wallpapers shipped

All optimized to **WebP** at native resolution (≤ ~500 KB HD) with a lazy-loaded
**~480 px thumbnail** (`<name>-thumb.webp`). Provenance is recorded honestly in
`public/wallpapers/PROVENANCE.md` — never fabricated.

| category | id | file (`public/wallpapers/…`) |
|----------|----|------------------------------|
| paysage | `landscape-snow-peaks-01`     | `landscape/landscape-snow-peaks-01.webp` |
| paysage | `landscape-snow-valley-01`    | `landscape/landscape-snow-valley-01.webp` |
| paysage | `landscape-mountain-lake-01`  | `landscape/landscape-mountain-lake-01.webp` |
| paysage | `landscape-forest-stream-01`  | `landscape/landscape-forest-stream-01.webp` |
| paysage | `landscape-tropical-beach-01` | `landscape/landscape-tropical-beach-01.webp` |
| paysage | `landscape-med-coast-01`      | `landscape/landscape-med-coast-01.webp` |
| espace  | `espace-terre`                | `space/espace-terre.webp` — **NASA public domain** |
| espace  | `espace-horizon`              | `space/espace-horizon.webp` — **NASA public domain** |
| espace  | `space-ringed-planet-01`      | `space/space-ringed-planet-01.webp` |
| espace  | `space-galaxy-01`             | `space/space-galaxy-01.webp` |
| espace  | `space-earth-night-01`        | `space/space-earth-night-01.webp` |
| ville   | `city-dubai-night-01`         | `city/city-dubai-night-01.webp` |
| ville   | `city-tokyo-neon-01`          | `city/city-tokyo-neon-01.webp` |
| luxe    | `luxury-villa-01`             | `luxury/luxury-villa-01.webp` |
| luxe    | `luxury-lounge-sunset-01`     | `luxury/luxury-lounge-sunset-01.webp` |
| luxe    | `luxury-penthouse-01`         | `luxury/luxury-penthouse-01.webp` |
| automobile | `supercar-01`              | `automotive/supercar-01.webp` |
| moto    | `motorcycle-ducati-01`        | `motorcycle/motorcycle-ducati-01.webp` |
| abstrait | `abstract-liquid-glass-01`   | `abstract/abstract-liquid-glass-01.webp` |
| abstrait | `abstract-chrome-01`         | `abstract/abstract-chrome-01.webp` |
| abstrait | `abstract-energy-01`         | `abstract/abstract-energy-01.webp` |

## Provenance & licence (product owner rule)

- `space/espace-terre.webp` and `space/espace-horizon.webp` are **NASA public-domain**
  imagery (see https://www.nasa.gov/multimedia/guidelines/index.html).
- Every other image was **provided by the product owner (Hermès OS)** as reference
  wallpapers to embed in the product. Only WebP re-encoding + thumbnail downscaling was
  applied — no content altered, no logo/text added or removed. Provenance is recorded as
  owner-provided; **never fabricated as third-party stock**.
- Do NOT integrate any image scraped from a generic web search. Use only assets whose
  licence clearly permits product embedding (owner-provided, commissioned/owned, public
  domain, or an org-owned stock licence).

To add a new real wallpaper: drop `public/wallpapers/<dir>/<name>.webp` + its
`<name>-thumb.webp`, then add one `img("<id>", "<category>", "<dir>/<name>", scrim,
focalX, focalY)` entry to `WALLPAPER_REGISTRY` and its `wallpaper.name.<id>` label to the
6 locale catalogs. The render path, gallery thumbnail, focal point and lazy-load are
already implemented — no other code change is needed.

## Abstrait — CSS gradient atmospheres (reclassified, NOT photos)

The former `espace-*` / `montagne-*` / `mer-*` / `tropical-*` **gradients** are stylised
atmospheres, not photographs. They live under **Abstrait** (alongside the real abstract
photos) so they are never presented as landscape photos. Ids are kept stable so existing
user preferences keep working: `espace-atmosphere`, `espace-etoiles`, `espace-planete`,
`montagne-neige`, `montagne-alpine`, `montagne-crepuscule`, `mer-profonde`,
`mer-turquoise`, `mer-couchant`, `tropical-couchant`, `tropical-palmiers`,
`tropical-plage`.

## Hermès — CSS gradient art (sober premium)

`hermes-noir`, `hermes-bleu-nuit`, `hermes-graphite` (default), `hermes-azur`,
`hermes-solaire`, `hermes-aurora`.

## User photo wallpapers — storage & lifecycle

- **Storage**: reuses the existing PRIVATE bucket `hermes-chat-attachments` and its
  `storage.objects` RLS (`foldername[1]=tenant`, `foldername[2]=auth.uid()`), so
  `${tenant}/${user}/wallpapers/<uuid>/<safe>` is already covered — **no migration, no
  new bucket, no new table, no new RPC**. Cross-user / cross-tenant access is denied by
  the same policy.
- **Reads**: short-TTL signed URLs minted server-side per load; the canonical preference
  is the `user:<storage-path>` ref, never a signed URL. A missing/expired URL falls back
  to global → Hermès default (never a broken screen).
- **ORPHAN_POLICY (no cron / no GC — COST-FIRST)**: deleting a personal photo removes its
  object immediately (ownership re-checked). Uploading a replacement deletes the profile's
  previous own object iff no other profile and not the global default still references it.
