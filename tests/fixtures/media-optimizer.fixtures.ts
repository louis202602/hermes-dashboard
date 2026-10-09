/**
 * FIXTURE DE TEST — données FICTIVES, utilisées uniquement par les tests unitaires
 * et le harnais de captures d'écran (scripts/media-optimizer-harness). Elles ne
 * doivent JAMAIS être importées par du code de production ni présentées comme réelles.
 * Format = charge utile brute de la RPC `get_media_optimizer_state` (snake_case).
 */

const BASE = {
  media_id: null,
  folder_label: "FIXTURE DE TEST / Chantiers",
  network: "instagram",
  trigger: "manual",
  optimizer_status: null,
  size_before: null,
  size_after: null,
  reduction_pct: null,
  encode_sec: null,
  peak_ram_mb: null,
  ssim_min: null,
  ig_ok: null,
  fb_ok: null,
  error: null,
  attempts: 0,
  params_version: 1,
  updated_at: "2026-10-09T08:30:00Z",
  rights_status: "pending_review",
  rights_note: null,
};

const V3_EMPTY = {
  is_test: false,
  public_ready: false,
  buffer_status: null,
  buffer_post_id: null,
  caption: null,
  draft_error: null,
  draft_checked_at: null,
  aspect: null,
  warnings: [] as unknown[],
  pad_vertical: false,
  has_previews: false,
};

export const FIXTURE_JOBS_V3 = [
  {
    ...BASE, ...V3_EMPTY,
    id: "11111111-1111-4111-8111-111111111111",
    source_name: "FIXTURE DE TEST — pose-panneaux-toiture.mp4",
    kind: "video", status: "optimized", rights_status: "authorized", rights_note: "Tourné par l’équipe, accord interne",
    size_before: 412_000_000, size_after: 38_400_000, reduction_pct: 90.7, encode_sec: 84.2, peak_ram_mb: 912, ssim_min: 0.962,
    ig_ok: true, fb_ok: true, is_test: true, public_ready: true, buffer_status: "draft",
    buffer_post_id: "FIXTURE-post-0001", draft_checked_at: "2026-10-09T08:42:00Z",
    caption: "FIXTURE DE TEST — Installation de 12 panneaux solaires à Marseille : du chantier à la production, en images. #solaire #marseille #heliosolar",
    aspect: "16:9", pad_vertical: true, has_previews: true,
  },
  {
    ...BASE, ...V3_EMPTY,
    id: "22222222-2222-4222-8222-222222222222",
    source_name: "FIXTURE DE TEST — onduleur-garage-très-long-nom-de-fichier-pour-tester-le-retour-à-la-ligne.mov",
    kind: "video", status: "blocked", network: "facebook",
    size_before: 1_900_000_000, size_after: 120_000_000, reduction_pct: 93.7, ig_ok: false, fb_ok: true,
    error: "Durée supérieure à la limite Instagram Reels (FIXTURE)",
    aspect: "4:3", warnings: ["Format 4:3 : bandes noires probables en vertical", { message: "Débit audio faible" }],
    has_previews: true,
  },
  {
    ...BASE, ...V3_EMPTY,
    id: "33333333-3333-4333-8333-333333333333",
    source_name: "FIXTURE DE TEST — facade-nord.jpg", kind: "photo", status: "queued",
    size_before: 6_200_000,
  },
  {
    ...BASE, ...V3_EMPTY,
    id: "44444444-4444-4444-8444-444444444444",
    source_name: "FIXTURE DE TEST — avant-apres-toiture.jpg", kind: "photo", status: "ready_to_publish",
    rights_status: "authorized", rights_note: "Accord client signé",
    size_before: 5_100_000, size_after: 1_450_000, reduction_pct: 71.6, ig_ok: true, fb_ok: true,
    public_ready: false, buffer_status: "error", draft_error: "Buffer a refusé l’image : lien public absent (FIXTURE)",
    draft_checked_at: "2026-10-09T09:05:00Z", caption: "FIXTURE DE TEST — Avant / après.", aspect: "1:1",
  },
  {
    ...BASE, ...V3_EMPTY,
    id: "55555555-5555-4555-8555-555555555555",
    source_name: "FIXTURE DE TEST — drone-mas.mp4", kind: "video", status: "failed", rights_status: "rejected", rights_note: "Image d’un tiers",
    size_before: 880_000_000, attempts: 3, error: "Encodage interrompu : mémoire insuffisante (FIXTURE)",
  },
];

/** Même charge utile SANS les clés de la migration v3 (migration non appliquée). */
export const FIXTURE_JOBS_V2 = FIXTURE_JOBS_V3.slice(0, 3).map((j) => {
  const copy: Record<string, unknown> = { ...j };
  for (const k of Object.keys(V3_EMPTY)) delete copy[k];
  return copy;
});

export const FIXTURE_STATE_V3 = { resolution_status: "OK", publish_stop: true, provenance: "REAL", jobs: FIXTURE_JOBS_V3 };
export const FIXTURE_STATE_V2 = { resolution_status: "OK", publish_stop: true, provenance: "REAL", jobs: FIXTURE_JOBS_V2 };

/** PNG 1×1 valide (base64) — FIXTURE DE TEST. */
export const FIXTURE_PIXEL_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
