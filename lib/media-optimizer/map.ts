import { formatAspect, normalizeWarnings } from "@/lib/media-optimizer/format";
import type {
  MediaBufferStatus,
  MediaJobStatus,
  MediaOptimizerJob,
  MediaOptimizerState,
  MediaPreview,
  MediaPreviewKind,
  MediaRightsStatus,
} from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Normalisation des charges utiles RPC (pure, testée).
 * Les clés de la migration v3 sont OPTIONNELLES : absentes, elles donnent
 * `v3: false` et des valeurs nulles — jamais de valeur par défaut « positive ».
 */

function rec(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

const BUFFER_STATUSES = ["draft", "sent", "deleted", "error"] as const;

/** Une ligne est « v3 » dès qu'elle porte au moins une des clés ajoutées par la migration v3. */
const V3_KEYS = ["is_test", "public_ready", "buffer_status", "has_previews", "pad_vertical", "caption"] as const;

export function hasV3Keys(raw: unknown): boolean {
  const j = rec(raw);
  return V3_KEYS.some((k) => k in j);
}

export function mapJob(raw: unknown): MediaOptimizerJob {
  const j = rec(raw);
  const v3 = hasV3Keys(j);
  const buffer = strOrNull(j.buffer_status);
  return {
    id: String(j.id),
    mediaId: strOrNull(j.media_id),
    sourceName: String(j.source_name ?? "—"),
    folderLabel: strOrNull(j.folder_label),
    kind: (strOrNull(j.kind) as MediaOptimizerJob["kind"]) ?? null,
    network: (strOrNull(j.network) ?? "instagram") as MediaOptimizerJob["network"],
    status: (strOrNull(j.status) ?? "discovered") as MediaJobStatus,
    rightsStatus: (strOrNull(j.rights_status) ?? "pending_review") as MediaRightsStatus,
    rightsNote: strOrNull(j.rights_note),
    trigger: (strOrNull(j.trigger) ?? "auto") as MediaOptimizerJob["trigger"],
    optimizerStatus: strOrNull(j.optimizer_status),
    sizeBefore: numOrNull(j.size_before),
    sizeAfter: numOrNull(j.size_after),
    reductionPct: numOrNull(j.reduction_pct),
    encodeSec: numOrNull(j.encode_sec),
    peakRamMb: numOrNull(j.peak_ram_mb),
    ssimMin: numOrNull(j.ssim_min),
    igOk: boolOrNull(j.ig_ok),
    fbOk: boolOrNull(j.fb_ok),
    error: strOrNull(j.error),
    attempts: numOrNull(j.attempts) ?? 0,
    updatedAt: String(j.updated_at ?? ""),
    v3,
    isTest: v3 ? boolOrNull(j.is_test) : null,
    publicReady: v3 ? boolOrNull(j.public_ready) : null,
    bufferStatus: v3 && buffer && (BUFFER_STATUSES as readonly string[]).includes(buffer) ? (buffer as MediaBufferStatus) : null,
    bufferPostId: v3 ? strOrNull(j.buffer_post_id) : null,
    caption: v3 ? strOrNull(j.caption) : null,
    draftError: v3 ? strOrNull(j.draft_error) : null,
    draftCheckedAt: v3 ? strOrNull(j.draft_checked_at) : null,
    aspect: v3 ? formatAspect(j.aspect) : null,
    warnings: v3 ? normalizeWarnings(j.warnings) : [],
    padVertical: v3 ? boolOrNull(j.pad_vertical) : null,
    hasPreviews: v3 ? boolOrNull(j.has_previews) : null,
  };
}

export function mapState(payload: Record<string, unknown>): MediaOptimizerState {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs.map(mapJob) : [];
  const v3 = jobs.length === 0 ? "unknown" : jobs.every((j) => j.v3) ? "present" : "absent";
  return {
    resolutionStatus: String(payload.resolution_status ?? "UNAUTHENTICATED"),
    // STOP actif par défaut : seule la valeur explicite `false` le désactive.
    publishStop: payload.publish_stop !== false,
    jobs,
    v3,
  };
}

const PREVIEW_KINDS: readonly string[] = ["orig", "opt", "pad916", "orig_crop", "opt_crop"];
const SAFE_MIME = /^image\/(jpeg|png|webp)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Ne garde que des images valides et sûres à injecter dans une URL `data:`. */
export function mapPreviews(raw: unknown): MediaPreview[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaPreview[] = [];
  for (const item of raw) {
    const p = rec(item);
    const kind = strOrNull(p.kind);
    const mime = strOrNull(p.mime) ?? "image/jpeg";
    const data = strOrNull(p.data_b64);
    if (!kind || !PREVIEW_KINDS.includes(kind) || !data || !SAFE_MIME.test(mime) || !BASE64.test(data)) continue;
    out.push({
      kind: kind as MediaPreviewKind,
      pos: numOrNull(p.pos) ?? 0,
      tSec: numOrNull(p.t_sec),
      mime,
      width: numOrNull(p.width),
      height: numOrNull(p.height),
      dataB64: data,
    });
  }
  return out.sort((a, b) => a.pos - b.pos);
}
