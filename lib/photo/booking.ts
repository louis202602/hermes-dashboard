/**
 * HERMÈS STUDIO — DEVIS → CONTRAT → ACOMPTE → RÉSERVATION.
 *
 * Le problème que cette machine résout tient en une phrase : **une date ne doit
 * jamais être réservée parce qu'un agent l'a dit**. Un LLM peut affirmer « c'est
 * noté, le 14 juin est à vous » avec une parfaite assurance et zéro paiement
 * derrière. Ici, la confirmation n'est pas une affirmation : c'est une
 * CONJONCTION DE FAITS VÉRIFIÉS, et chaque fait porte sa provenance.
 *
 * Deux garde-fous structurels :
 *
 *   1. Les transitions sont une TABLE, pas des `if`. Un saut d'étape est
 *      impossible : on ne peut pas passer de « devis envoyé » à « réservé ».
 *   2. `canConfirmBooking` n'accepte que des faits de provenance `VERIFIED`.
 *      Un acompte « déclaré payé » ne vaut rien ; seul un paiement confirmé par
 *      le prestataire compte. C'est la différence entre un système comptable et
 *      un système de bonne foi.
 *
 * Pur, sans I/O, sans horloge implicite : `now` est toujours un paramètre.
 */

// --- États --------------------------------------------------------------------

/**
 * Les 9 états du brief, plus `QUOTE_EXPIRED`.
 *
 * Cet ajout n'est pas une liberté : le brief exige « expiration / abandon » pour
 * les relances de devis. Sans état d'expiration, un devis mort resterait
 * éternellement `QUOTE_SENT` et continuerait d'alimenter les relances.
 */
export const BOOKING_STATES = [
  "QUOTE_DRAFT",
  "QUOTE_SENT",
  "QUOTE_ACCEPTED",
  "QUOTE_EXPIRED",
  "CONTRACT_PENDING",
  "CONTRACT_SIGNED",
  "DEPOSIT_PENDING",
  "DEPOSIT_PAID",
  "BOOKING_CONFIRMED",
  "CANCELLED",
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

const STATE_SET = new Set<string>(BOOKING_STATES);
export function isBookingState(v: unknown): v is BookingState {
  return typeof v === "string" && STATE_SET.has(v);
}

/**
 * TABLE des transitions. Tout ce qui n'y figure pas est interdit — y compris
 * les retours en arrière : un contrat signé ne redevient pas un brouillon, il
 * s'annule.
 *
 * `CANCELLED` est joignable depuis tout état non terminal : une annulation est
 * toujours possible, c'est un droit du client.
 */
export const BOOKING_TRANSITIONS: Record<BookingState, BookingState[]> = {
  QUOTE_DRAFT: ["QUOTE_SENT", "CANCELLED"],
  QUOTE_SENT: ["QUOTE_ACCEPTED", "QUOTE_EXPIRED", "CANCELLED"],
  QUOTE_ACCEPTED: ["CONTRACT_PENDING", "CANCELLED"],
  // Un devis expiré n'est pas mort : on peut en réémettre un. C'est le SEUL
  // retour en arrière autorisé, et il repart d'un brouillon neuf.
  QUOTE_EXPIRED: ["QUOTE_DRAFT", "CANCELLED"],
  CONTRACT_PENDING: ["CONTRACT_SIGNED", "CANCELLED"],
  CONTRACT_SIGNED: ["DEPOSIT_PENDING", "CANCELLED"],
  DEPOSIT_PENDING: ["DEPOSIT_PAID", "CANCELLED"],
  DEPOSIT_PAID: ["BOOKING_CONFIRMED", "CANCELLED"],
  BOOKING_CONFIRMED: ["CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: BookingState, to: BookingState): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

/** États depuis lesquels plus rien ne peut avancer. */
export const TERMINAL_STATES: BookingState[] = ["CANCELLED"];

/**
 * Correspondance avec `photo_sessions.status`, qui EXISTE déjà en base et dont
 * le vocabulaire ne doit pas être dupliqué. Seul `BOOKING_CONFIRMED` autorise
 * `BOOKED` : c'est le point de jonction entre le commerce et la production.
 */
export const SESSION_STATUS_FOR: Partial<Record<BookingState, string>> = {
  QUOTE_DRAFT: "QUALIFIED",
  QUOTE_SENT: "QUOTED",
  QUOTE_ACCEPTED: "QUOTED",
  QUOTE_EXPIRED: "QUOTED",
  CONTRACT_PENDING: "QUOTED",
  CONTRACT_SIGNED: "QUOTED",
  DEPOSIT_PENDING: "QUOTED",
  DEPOSIT_PAID: "QUOTED",
  BOOKING_CONFIRMED: "BOOKED",
  CANCELLED: "CANCELLED",
};

// --- Provenance ---------------------------------------------------------------

/**
 * D'où vient un fait. C'est LA notion qui empêche la réservation sur parole.
 *
 *   VERIFIED — confirmé par une source externe vérifiable (webhook du
 *              prestataire de paiement, horodatage de signature).
 *   DECLARED — quelqu'un l'a affirmé (client, agent, LLM). Sans valeur ici.
 *   UNKNOWN  — non renseigné.
 */
export type FactProvenance = "VERIFIED" | "DECLARED" | "UNKNOWN";

export type VerifiedFact = {
  provenance: FactProvenance;
  /** Horodatage de la vérification. Absent ⇒ le fait ne compte pas. */
  at: Date | null;
  /** Référence externe opposable (id de paiement, id de signature). */
  reference: string | null;
};

const EMPTY_FACT: VerifiedFact = { provenance: "UNKNOWN", at: null, reference: null };

/** Un fait ne compte que s'il est vérifié, daté ET référencé. Les trois. */
export function factHolds(fact: VerifiedFact | null | undefined): boolean {
  const f = fact ?? EMPTY_FACT;
  return f.provenance === "VERIFIED" && f.at instanceof Date && !Number.isNaN(f.at.getTime())
    && typeof f.reference === "string" && f.reference.length > 0;
}

// --- Acompte : configurable, jamais inventé -----------------------------------

/**
 * Règle d'acompte du studio. `percent` OU `fixedEur`, jamais les deux : deux
 * règles simultanées produiraient deux montants selon l'ordre de lecture.
 */
export type DepositRule = {
  percent: number | null;
  fixedEur: number | null;
  /** Plancher facultatif, appliqué APRÈS le pourcentage. */
  minEur: number | null;
};

export type DepositComputation =
  | { ok: true; amountEur: number; basis: "PERCENT" | "FIXED" }
  | { ok: false; code: "NO_RULE" | "AMBIGUOUS_RULE" | "NO_TOTAL" | "INVALID_RULE" };

/**
 * Montant d'acompte exigible. Renvoie une ERREUR plutôt qu'un montant par
 * défaut : un acompte de 0 € inventé confirmerait une réservation gratuite.
 */
export function computeDeposit(
  totalEur: number | null,
  rule: DepositRule | null | undefined,
): DepositComputation {
  const r = rule ?? { percent: null, fixedEur: null, minEur: null };
  const hasPercent = typeof r.percent === "number" && Number.isFinite(r.percent);
  const hasFixed = typeof r.fixedEur === "number" && Number.isFinite(r.fixedEur);

  if (hasPercent && hasFixed) return { ok: false, code: "AMBIGUOUS_RULE" };
  if (!hasPercent && !hasFixed) return { ok: false, code: "NO_RULE" };

  if (hasFixed) {
    if ((r.fixedEur as number) < 0) return { ok: false, code: "INVALID_RULE" };
    return { ok: true, amountEur: round2(r.fixedEur as number), basis: "FIXED" };
  }

  const pct = r.percent as number;
  if (pct <= 0 || pct > 100) return { ok: false, code: "INVALID_RULE" };
  if (typeof totalEur !== "number" || !Number.isFinite(totalEur) || totalEur < 0) {
    // Pas de total ⇒ pas de pourcentage possible. On refuse, on n'estime pas.
    return { ok: false, code: "NO_TOTAL" };
  }
  const raw = (totalEur * pct) / 100;
  const floored =
    typeof r.minEur === "number" && Number.isFinite(r.minEur) ? Math.max(raw, r.minEur) : raw;
  // Un acompte ne dépasse jamais le total : une règle mal saisie ne doit pas
  // produire une demande absurde.
  return { ok: true, amountEur: round2(Math.min(floored, totalEur)), basis: "PERCENT" };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- La porte de la réservation ------------------------------------------------

export type BookingRequirements = {
  contractRequired: boolean;
  signatureRequired: boolean;
  depositRequired: boolean;
  /** Une approbation humaine (SW15) est-elle exigée pour cette prestation ? */
  humanApprovalRequired: boolean;
};

export type BookingConditions = {
  state: BookingState;
  requirements: BookingRequirements;
  /** Signature du contrat — doit être VERIFIED pour compter. */
  signature: VerifiedFact | null;
  /** Encaissement de l'acompte — doit être VERIFIED pour compter. */
  depositPayment: VerifiedFact | null;
  depositExpectedEur: number | null;
  depositReceivedEur: number | null;
  /** Approbation SW15 résolue favorablement, si exigée. */
  humanApproval: VerifiedFact | null;
  /** La date demandée est-elle encore libre à l'agenda ? `null` = inconnu. */
  dateAvailable: boolean | null;
  now: Date;
};

export type BookingGateResult =
  | { allowed: true }
  | { allowed: false; blockers: BookingBlocker[] };

export const BOOKING_BLOCKERS = [
  "WRONG_STATE",
  "CONTRACT_NOT_SIGNED",
  "SIGNATURE_NOT_TRACEABLE",
  "DEPOSIT_NOT_VERIFIED",
  "DEPOSIT_INSUFFICIENT",
  "DEPOSIT_AMOUNT_UNKNOWN",
  "HUMAN_APPROVAL_MISSING",
  "DATE_NOT_AVAILABLE",
  "DATE_AVAILABILITY_UNKNOWN",
] as const;
export type BookingBlocker = (typeof BOOKING_BLOCKERS)[number];

/**
 * LA PORTE. Renvoie TOUS les obstacles, pas seulement le premier : une
 * photographe doit savoir d'un coup d'œil ce qui manque, pas le découvrir un
 * refus à la fois.
 *
 * FAIL-CLOSED intégral. Chaque `null` non résolu bloque :
 *   * disponibilité de la date inconnue ⇒ blocage (et non « probablement libre ») ;
 *   * montant d'acompte inconnu ⇒ blocage (et non « sans doute payé ») ;
 *   * fait non vérifié ⇒ blocage, quelle que soit l'assurance de l'agent.
 */
export function canConfirmBooking(c: BookingConditions): BookingGateResult {
  const blockers: BookingBlocker[] = [];

  if (c.state !== "DEPOSIT_PAID") blockers.push("WRONG_STATE");

  if (c.requirements.contractRequired || c.requirements.signatureRequired) {
    if (!factHolds(c.signature)) {
      blockers.push(
        c.signature?.provenance === "DECLARED"
          ? "SIGNATURE_NOT_TRACEABLE"
          : "CONTRACT_NOT_SIGNED",
      );
    }
  }

  if (c.requirements.depositRequired) {
    if (!factHolds(c.depositPayment)) {
      blockers.push("DEPOSIT_NOT_VERIFIED");
    }
    if (typeof c.depositExpectedEur !== "number" || !Number.isFinite(c.depositExpectedEur)) {
      blockers.push("DEPOSIT_AMOUNT_UNKNOWN");
    } else if (
      typeof c.depositReceivedEur !== "number" ||
      !Number.isFinite(c.depositReceivedEur) ||
      c.depositReceivedEur + 0.001 < c.depositExpectedEur
    ) {
      blockers.push("DEPOSIT_INSUFFICIENT");
    }
  }

  if (c.requirements.humanApprovalRequired && !factHolds(c.humanApproval)) {
    blockers.push("HUMAN_APPROVAL_MISSING");
  }

  if (c.dateAvailable === false) blockers.push("DATE_NOT_AVAILABLE");
  else if (c.dateAvailable === null) blockers.push("DATE_AVAILABILITY_UNKNOWN");

  return blockers.length === 0 ? { allowed: true } : { allowed: false, blockers };
}

/**
 * Prochaine étape à proposer — pour l'interface et pour l'agent, avec les MÊMES
 * règles. Ne « saute » jamais : si l'étape courante n'est pas remplie, elle est
 * répétée plutôt que contournée.
 */
export function nextBookingAction(c: BookingConditions): {
  action: string;
  state: BookingState;
} {
  switch (c.state) {
    case "QUOTE_DRAFT":
      return { action: "SEND_QUOTE", state: c.state };
    case "QUOTE_SENT":
      return { action: "AWAIT_QUOTE_RESPONSE", state: c.state };
    case "QUOTE_EXPIRED":
      return { action: "REISSUE_QUOTE", state: c.state };
    case "QUOTE_ACCEPTED":
      return c.requirements.contractRequired
        ? { action: "PREPARE_CONTRACT", state: c.state }
        : { action: "REQUEST_DEPOSIT", state: c.state };
    case "CONTRACT_PENDING":
      return { action: "AWAIT_SIGNATURE", state: c.state };
    case "CONTRACT_SIGNED":
      return c.requirements.depositRequired
        ? { action: "REQUEST_DEPOSIT", state: c.state }
        : { action: "CONFIRM_BOOKING", state: c.state };
    case "DEPOSIT_PENDING":
      return { action: "AWAIT_DEPOSIT", state: c.state };
    case "DEPOSIT_PAID":
      return canConfirmBooking(c).allowed
        ? { action: "CONFIRM_BOOKING", state: c.state }
        : { action: "RESOLVE_BLOCKERS", state: c.state };
    case "BOOKING_CONFIRMED":
      return { action: "PREPARE_SESSION", state: c.state };
    case "CANCELLED":
      return { action: "NONE", state: c.state };
  }
}

/**
 * Un devis a-t-il expiré ? Sans date de validité, la réponse est NON — on ne
 * périme pas un devis sur une durée devinée.
 */
export function isQuoteExpired(expiresAt: Date | null, now: Date): boolean {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() <= now.getTime();
}
