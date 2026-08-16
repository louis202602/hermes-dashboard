# Wallpaper assets manifest

The dashboard dresses the space **behind** the translucent widgets with a wallpaper.
Two mechanisms coexist (one system, no second uploader):

1. **CSS-gradient art** (`kind:"gradient"`) — 0 asset, 0 egress, defined as
   `.wallpaper-<id>` in `app/globals.css`, registered in `lib/dashboard/wallpapers.ts`.
2. **Real image assets** (`kind:"image"`) — a local file under `public/wallpapers/…`
   (built-in photos) **or** a private user upload (`user:<storage-path>`, signed URL).
   Rendered by `WallpaperLayer` via `background-image` + `background-size: cover` and a
   focal point (`focalX`/`focalY`) so the subject stays framed on every viewport.

## Photo categories (`montagne` / `mer` / `tropical` / `espace`)

These categories must show **real photographs**, never gradient art. Provenance is
**never fabricated** — a slot ships only once a clearly-licensed / public-domain file
with a verifiable source is available.

### Shipped — Espace (real NASA photos, public domain)

| id              | asset                                   | thumbnail                                     | source / licence |
|-----------------|-----------------------------------------|-----------------------------------------------|------------------|
| `espace-terre`  | `public/wallpapers/space/espace-terre.webp`  | `espace-terre-thumb.webp`  | NASA — Apollo 17 « Blue Marble » (AS17-148-22727) — **public domain** |
| `espace-horizon`| `public/wallpapers/space/espace-horizon.webp`| `espace-horizon-thumb.webp`| NASA — ISS Expedition 43 (iss043e091794) — **public domain** |

NASA imagery is public domain (see <https://www.nasa.gov/multimedia/guidelines/index.html>);
provenance above is real and verifiable. Files are optimized WebP (≤ ~500 KB HD,
~2560 px long edge) with a lightweight ~480 px thumbnail loaded lazily in the gallery.

### To be PROVIDED — Montagne / Mer / Tropical (prepared slots)

The environment could not legally source ground-level premium photos for these three
categories with a per-image licence that can be verified, so — per the product owner —
**no provenance is fabricated**. The gallery shows an honest "photos to be provided"
note (`wallpaper.photoPending`) until the files below are dropped in.

To activate a slot: drop the file at the path shown, add its `~480 px` thumbnail
alongside (`<name>-thumb.webp`), and add one `kind:"image"` entry to
`WALLPAPER_REGISTRY` with a **real** `provenance`. No other code change is needed — the
render path, gallery thumbnail, focal point and lazy-load are already implemented.

| id (proposed)      | category | file to provide                                 | subject |
|--------------------|----------|-------------------------------------------------|---------|
| `montagne-neige-photo`      | montagne | `public/wallpapers/mountain/montagne-neige.webp`      | snowy peaks, cool light |
| `montagne-alpine-photo`     | montagne | `public/wallpapers/mountain/montagne-alpine.webp`     | alpine valley / snowy forest |
| `montagne-crepuscule-photo` | montagne | `public/wallpapers/mountain/montagne-crepuscule.webp` | mountain sunset |
| `mer-profonde-photo`        | mer      | `public/wallpapers/sea/mer-profonde.webp`             | deep-blue Mediterranean horizon |
| `mer-turquoise-photo`       | mer      | `public/wallpapers/sea/mer-turquoise.webp`            | turquoise cove / coast |
| `mer-couchant-photo`        | mer      | `public/wallpapers/sea/mer-couchant.webp`             | sea sunset over the horizon |
| `tropical-plage-photo`      | tropical | `public/wallpapers/tropical/tropical-plage.webp`      | premium turquoise beach + palms |
| `tropical-couchant-photo`   | tropical | `public/wallpapers/tropical/tropical-couchant.webp`   | tropical beach at sunset |

**Licence rule (product owner):** do NOT integrate any image scraped from a generic web
search. Use only assets whose licence clearly permits product embedding (commissioned /
owned shots, public domain, or an org-owned stock licence) **or** files the owner
provides. Prefer dark-biased frames for readability, or pair a lighter frame with a
higher default scrim.

## Abstrait (CSS gradient atmospheres — reclassified, NOT photos)

The former `espace-*` / `montagne-*` / `mer-*` / `tropical-*` **gradients** are stylised
atmospheres, not photographs. They are reclassified under the **Abstrait** category so
they are never presented as landscape photos. Ids are kept stable so existing user
preferences keep working:

- `espace-atmosphere`, `espace-etoiles`, `espace-planete`
- `montagne-neige`, `montagne-alpine`, `montagne-crepuscule`
- `mer-profonde`, `mer-turquoise`, `mer-couchant`
- `tropical-couchant`, `tropical-palmiers`, `tropical-plage`

## Hermès (CSS gradient art — sober premium)

`hermes-noir`, `hermes-bleu-nuit`, `hermes-graphite` (default), `hermes-azur`,
`hermes-solaire`, `hermes-aurora`.

## User photo wallpapers — storage & lifecycle

- **Storage**: reuses the existing PRIVATE bucket `hermes-chat-attachments` and its
  `storage.objects` RLS. The RLS gate checks `foldername[1]=tenant` and
  `foldername[2]=auth.uid()`, so the path `${tenant}/${user}/wallpapers/<uuid>/<safe>`
  is already covered — **no migration, no new bucket, no new table, no new RPC**.
  Cross-user and cross-tenant access is denied by the same policy.
- **Reads**: short-TTL signed URLs minted server-side per load; the canonical preference
  is the `user:<storage-path>` ref, never a signed URL. A missing/expired URL falls back
  to global → Hermès default (never a broken screen).
- **ORPHAN_POLICY (no cron / no GC — COST-FIRST)**: deleting a personal photo removes its
  object immediately (ownership re-checked server-side). Uploading a replacement to a
  profile deletes the profile's previous own object **iff no other profile and not the
  global default still reference it**. This bounds stored user wallpaper objects to
  **≤ the number of profiles** without any scheduler or worker.
