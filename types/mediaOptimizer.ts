/**
 * MEDIA-OPT — Types du module Hermès Media Optimizer (Hermès Visibility OS).
 * Le module ne publie jamais : il prépare des médias pour Buffer.
 */
export type MediaJobStatus =
  | "discovered"
  | "technically_usable"
  | "queued"
  | "processing"
  | "optimized"
  | "ready_to_publish"
  | "blocked"
  | "failed";

export type MediaRightsStatus = "pending_review" | "authorized" | "rejected";

export interface MediaOptimizerJob {
  id: string;
  mediaId: string | null;
  sourceName: string;
  folderLabel: string | null;
  kind: "video" | "photo" | null;
  network: "instagram" | "facebook";
  status: MediaJobStatus;
  rightsStatus: MediaRightsStatus;
  rightsNote: string | null;
  trigger: "auto" | "manual";
  optimizerStatus: string | null;
  sizeBefore: number | null;
  sizeAfter: number | null;
  reductionPct: number | null;
  encodeSec: number | null;
  peakRamMb: number | null;
  ssimMin: number | null;
  igOk: boolean | null;
  fbOk: boolean | null;
  error: string | null;
  attempts: number;
  updatedAt: string;
  /**
   * Champs de la migration v3. `v3 === false` : la base n'a pas renvoyé ces clés
   * (migration non appliquée) — ils valent alors tous `null`/vide et l'UI masque
   * les sections concernées au lieu d'afficher un faux contenu.
   */
  v3: boolean;
  isTest: boolean | null;
  publicReady: boolean | null;
  bufferStatus: MediaBufferStatus | null;
  bufferPostId: string | null;
  caption: string | null;
  draftError: string | null;
  draftCheckedAt: string | null;
  aspect: string | null;
  warnings: string[];
  padVertical: boolean | null;
  hasPreviews: boolean | null;
}

export type MediaBufferStatus = "draft" | "sent" | "deleted" | "error";

export type MediaPreviewKind = "orig" | "opt" | "pad916" | "orig_crop" | "opt_crop";

export interface MediaPreview {
  kind: MediaPreviewKind;
  pos: number;
  tSec: number | null;
  mime: string;
  width: number | null;
  height: number | null;
  dataB64: string;
}

export type MediaPreviewsResult =
  | { ok: true; previews: MediaPreview[] }
  | { ok: false; code: "RPC_ERROR" | "NO_TENANT" | "UNAUTHENTICATED" | "INVALID_ID" | "UNKNOWN" };

export interface MediaOptimizerState {
  resolutionStatus: string;
  /** STOP publication : vrai par défaut, y compris si la base ne répond pas. */
  publishStop: boolean;
  jobs: MediaOptimizerJob[];
  /** « present » si toutes les lignes portent les clés v3, « absent » si aucune, « unknown » s'il n'y a aucune ligne. */
  v3: "present" | "absent" | "unknown";
}

export type MediaWriteOutcome = { ok: boolean; code: string };
