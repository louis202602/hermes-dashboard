/**
 * PHOTO-P0 — Présentation de l'état d'une séance (pur, sans DOM, sans I/O).
 *
 * ATTENTION AU PÉRIMÈTRE : la LOGIQUE d'état (quel est le prochain geste, est-il
 * bloqué) est calculée par l'unique service `hermes_os.compute_photo_session_state`
 * et arrive déjà décidée dans `PhotoSessionState`. Ce module ne fait que
 * TRADUIRE des codes en libellés, en liens et en pourcentage d'avancement.
 * Il ne rejoue aucune règle métier.
 *
 * Le seul élément dupliqué est la table des rangs de statut, nécessaire pour
 * trier une LISTE de séances (où l'on n'a que le statut, pas l'état complet).
 * Un test compare cette table au CHECK de la migration pour empêcher toute
 * dérive silencieuse entre le SQL et le TS.
 */

import type {
  PhotoNextAction,
  PhotoSessionState,
  PhotoSessionStatus,
} from "@/types/photo";

/** Rang canonique — miroir de `hermes_os.photo_session_status_rank`. */
export const PHOTO_STATUS_RANK: Record<PhotoSessionStatus, number> = {
  DRAFT: 0,
  QUALIFIED: 1,
  QUOTED: 2,
  BOOKED: 3,
  SHOT: 4,
  IMPORTED: 5,
  CULLED: 6,
  SELECTION_APPROVED: 7,
  EDIT_PREPARED: 8,
  EDIT_APPROVED: 9,
  EXPORTED: 10,
  GALLERY_DRAFT: 11,
  DELIVERED: 12,
  CLOSED: 13,
  CANCELLED: -1,
};

/** Dernier rang de la ligne de progression (CLOSED). */
export const PHOTO_STATUS_MAX_RANK = 13;

export function photoStatusRank(status: string): number | null {
  return status in PHOTO_STATUS_RANK
    ? PHOTO_STATUS_RANK[status as PhotoSessionStatus]
    : null;
}

export const PHOTO_STATUS_LABEL: Record<PhotoSessionStatus, string> = {
  DRAFT: "Brouillon",
  QUALIFIED: "Qualifiée",
  QUOTED: "Devis envoyé",
  BOOKED: "Réservée",
  SHOT: "Séance réalisée",
  IMPORTED: "Photos importées",
  CULLED: "Tri effectué",
  SELECTION_APPROVED: "Sélection validée",
  EDIT_PREPARED: "Retouche préparée",
  EDIT_APPROVED: "Retouche validée",
  EXPORTED: "Export prêt",
  GALLERY_DRAFT: "Galerie en brouillon",
  DELIVERED: "Livrée",
  CLOSED: "Clôturée",
  CANCELLED: "Annulée",
};

export const PHOTO_NEXT_ACTION_LABEL: Record<PhotoNextAction, string> = {
  MARK_SHOT: "Déclarer la séance réalisée",
  IMPORT_ASSETS: "Importer les photos",
  FINISH_IMPORT: "Terminer l’import",
  RUN_CULLING_PASS1: "Lancer le tri",
  REVIEW_CULLING: "Passer le tri en revue",
  APPROVE_SELECTION: "Valider la sélection",
  PREPARE_EDIT: "Préparer la retouche",
  APPROVE_EDIT: "Valider la retouche",
  EXPORT: "Exporter les photos",
  PREPARE_GALLERY: "Préparer la galerie",
  PUBLISH_GALLERY: "Publier la galerie",
  CLOSE_SESSION: "Clôturer la séance",
  NONE: "Rien à faire",
};

/** Explication honnête d'un blocage — jamais un bouton qui ne ferait rien. */
export const PHOTO_BLOCKED_LABEL: Record<string, string> = {
  N8N_CONSUMER_REQUIRED:
    "Cette étape attend son agent d’exécution (non disponible pour le moment).",
};

/**
 * Le geste suivant est-il réellement exécutable maintenant ? Faux si l'état dit
 * qu'il dépend d'un runner absent — l'UI affiche alors une explication, jamais
 * un bouton inerte.
 */
export function isNextActionAvailable(state: PhotoSessionState | null): boolean {
  if (!state || !state.ok) return false;
  if (state.nextAction === "NONE") return false;
  return state.blockedBy === null;
}

/** Destination du geste suivant, ou null s'il n'est pas exécutable ici. */
export function nextActionHref(
  sessionId: string,
  action: PhotoNextAction,
): string | null {
  switch (action) {
    case "IMPORT_ASSETS":
    case "FINISH_IMPORT":
    case "RUN_CULLING_PASS1":
    case "REVIEW_CULLING":
    case "APPROVE_SELECTION":
      return `/seances/${sessionId}/tri`;
    case "MARK_SHOT":
      return `/seances/${sessionId}`;
    default:
      return null;
  }
}

/** Avancement [0..100] sur la ligne de progression. CANCELLED ⇒ 0. */
export function photoProgressPercent(status: string): number {
  const rank = photoStatusRank(status);
  if (rank === null || rank < 0) return 0;
  return Math.round((rank / PHOTO_STATUS_MAX_RANK) * 100);
}

/**
 * Reste-t-il des photos à trancher ? Sert au badge « à revoir » ; dérivé du
 * compteur serveur, jamais recalculé à partir des items affichés (une grille
 * bornée ne reflète pas forcément toute la séance).
 */
export function undecidedCount(state: PhotoSessionState | null): number {
  return state?.counters.undecided ?? 0;
}

/**
 * Résumé du tri pour l'en-tête de la revue. Purement descriptif : « gardées »
 * et « écartées » comptent des DÉCISIONS HUMAINES, pas des suppressions —
 * aucun fichier n'est jamais supprimé par Hermès.
 */
export function cullingSummary(state: PhotoSessionState | null): {
  total: number;
  decided: number;
  undecided: number;
  kept: number;
  discarded: number;
  protectedCount: number;
} {
  const c = state?.counters;
  const total = c?.verdicts ?? 0;
  const undecided = c?.undecided ?? 0;
  return {
    total,
    decided: Math.max(0, total - undecided),
    undecided,
    kept: c?.kept ?? 0,
    discarded: c?.discarded ?? 0,
    protectedCount: c?.protected ?? 0,
  };
}
