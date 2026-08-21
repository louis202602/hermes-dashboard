/**
 * PHOTO-P0 — Contrats consommés depuis les façades `public.get_photo_*` /
 * `public.*_photo_*`. Le backend reste la source de vérité : le frontend ne
 * définit aucun schéma métier, il ne fait que typer ce que les RPC renvoient.
 */

import type { TenantResolutionStatus } from "@/types/hermes";

/** Statuts d'une séance — miroir exact du CHECK de `photo_sessions.status`. */
export const PHOTO_SESSION_STATUSES = [
  "DRAFT",
  "QUALIFIED",
  "QUOTED",
  "BOOKED",
  "SHOT",
  "IMPORTED",
  "CULLED",
  "SELECTION_APPROVED",
  "EDIT_PREPARED",
  "EDIT_APPROVED",
  "EXPORTED",
  "GALLERY_DRAFT",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
] as const;
export type PhotoSessionStatus = (typeof PHOTO_SESSION_STATUSES)[number];

/** Types de séance — miroir du CHECK de `photo_sessions.session_type`. */
export const PHOTO_SESSION_TYPES = [
  "MARIAGE",
  "FAMILLE",
  "GROSSESSE",
  "NAISSANCE",
  "PORTRAIT",
  "EVENEMENT",
  "ENTREPRISE",
  "AUTRE",
] as const;
export type PhotoSessionType = (typeof PHOTO_SESSION_TYPES)[number];

/** Codes d'action renvoyés par `hermes_os.compute_photo_session_state`. */
export const PHOTO_NEXT_ACTIONS = [
  "MARK_SHOT",
  "IMPORT_ASSETS",
  "FINISH_IMPORT",
  "RUN_CULLING_PASS1",
  "REVIEW_CULLING",
  "APPROVE_SELECTION",
  "PREPARE_EDIT",
  "APPROVE_EDIT",
  "EXPORT",
  "PREPARE_GALLERY",
  "PUBLISH_GALLERY",
  "CLOSE_SESSION",
  "NONE",
] as const;
export type PhotoNextAction = (typeof PHOTO_NEXT_ACTIONS)[number];

/** Verdicts de tri. Ce sont des SUGGESTIONS : aucune n'efface de fichier. */
export type PhotoVerdict =
  | "KEEP_SUGGESTION"
  | "REJECTED_SUGGESTION"
  | "BEST_OF_SERIES";

export type PhotoHumanDecision = "KEEP" | "DISCARD";

/** État Studio Director d'une séance (projection SQL déterministe, 0 IA). */
export type PhotoSessionState = {
  ok: boolean;
  sessionId: string | null;
  status: PhotoSessionStatus | null;
  statusRank: number | null;
  nextAction: PhotoNextAction;
  /** Non nul quand l'étape suivante dépend d'un runner n8n indisponible. */
  blockedBy: string | null;
  counters: {
    assets: number;
    proxyReady: number;
    proxyFailed: number;
    signals: number;
    verdicts: number;
    undecided: number;
    kept: number;
    discarded: number;
    protected: number;
    bestOfSeries: number;
    instructions: number;
  };
};

export type PhotoTodayCounters = {
  sessionsActive: number;
  sessionsToImport: number;
  sessionsAwaitingShot: number;
  photosAwaitingReview: number;
  upsellOpportunities: number;
  upsellPotentialEur: number;
};

export type PhotoTodaySession = {
  sessionId: string;
  title: string | null;
  clientName: string;
  sessionType: PhotoSessionType;
  status: PhotoSessionStatus;
  scheduledAt: string | null;
  state: PhotoSessionState;
};

export type PhotoToday = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  tenantId: string | null;
  counters: PhotoTodayCounters;
  sessions: PhotoTodaySession[];
};

export type PhotoSessionRow = {
  sessionId: string;
  clientId: string;
  clientName: string;
  title: string | null;
  sessionType: PhotoSessionType;
  status: PhotoSessionStatus;
  scheduledAt: string | null;
  locationLabel: string | null;
  quoteAmountEur: number | null;
  assetCount: number;
  undecidedCount: number;
};

export type PhotoSessions = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  tenantId: string | null;
  sessions: PhotoSessionRow[];
};

export type PhotoInstruction = {
  id: string;
  instruction: string;
  kind: "PROTECT" | "PREFER" | "EXCLUDE";
  keyword: string;
  isGlobal: boolean;
  createdAt: string | null;
};

export type PhotoSessionDetail = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  found: boolean;
  session: {
    sessionId: string;
    title: string | null;
    sessionType: PhotoSessionType;
    status: PhotoSessionStatus;
    scheduledAt: string | null;
    locationLabel: string | null;
    notes: string | null;
    quoteAmountEur: number | null;
    depositPaidEur: number;
    balancePaidEur: number;
    shotAt: string | null;
    importedAt: string | null;
    culledAt: string | null;
    selectionApprovedAt: string | null;
    deliveredAt: string | null;
  } | null;
  client: { clientId: string; displayName: string; preferredChannel: string; lifetimeValueEur: number } | null;
  instructions: PhotoInstruction[];
  state: PhotoSessionState | null;
};

/** Une photo dans la grille de revue. `proxyUrl` est une URL SIGNÉE à TTL court,
 *  mintée côté serveur — jamais une URL publique. */
export type PhotoReviewItem = {
  assetId: string;
  filename: string;
  capturedAt: string | null;
  proxyUrl: string | null;
  thumbUrl: string | null;
  proxyStatus: "PENDING" | "READY" | "FAILED" | "PURGED";
  verdict: PhotoVerdict | null;
  score: number | null;
  reasonCode: string | null;
  isProtected: boolean;
  humanDecision: PhotoHumanDecision | null;
  sharpness: number | null;
};

export type PhotoCullingReview = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  found: boolean;
  sessionId: string | null;
  items: PhotoReviewItem[];
  state: PhotoSessionState | null;
};

export type PhotoClientRow = {
  clientId: string;
  displayName: string;
  status: string;
  preferredChannel: string;
  lifetimeValueEur: number;
  followUpDate: string | null;
  sessionCount: number;
  lastSessionAt: string | null;
  memberCount: number;
  hasActiveConsent: boolean;
};

export type PhotoClients = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  tenantId: string | null;
  clients: PhotoClientRow[];
};

/** Instantané de valeur SW19. `null` = NON MESURÉ — jamais un chiffre inventé. */
export type PhotoValueSnapshot = {
  resolutionStatus: TenantResolutionStatus | "MODULE_DISABLED";
  baselineProvenance: "REAL" | "NOT_MEASURED";
  baselineValue: number | null;
  baselineUnit: string | null;
  photosReviewed: number;
  sessionsProcessed: number;
  grossTimeSavedMinutes: number | null;
  supervisionMinutes: number;
  netTimeSavedMinutes: number | null;
  provenance: "DERIVED" | "UNAVAILABLE";
};

/** État d'activation de la verticale pour le tenant appelant. */
export type PhotoModuleState = {
  resolutionStatus: TenantResolutionStatus;
  tenantId: string | null;
  enabled: boolean;
};

/** Résultat générique d'une écriture par façade. */
export type PhotoWriteOutcome = {
  ok: boolean;
  code: string;
  data?: Record<string, unknown>;
};
