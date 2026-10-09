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
}

export interface MediaOptimizerState {
  resolutionStatus: string;
  /** STOP publication : vrai par défaut, y compris si la base ne répond pas. */
  publishStop: boolean;
  jobs: MediaOptimizerJob[];
}

export type MediaWriteOutcome = { ok: boolean; code: string };
