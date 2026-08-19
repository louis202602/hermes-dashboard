/**
 * HERMÈS STUDIO — RELANCE DES DEVIS & RÉCUPÉRATION DES APPELS MANQUÉS.
 *
 * Un appel manqué, pour une photographe, n'est pas un incident technique : c'est
 * un mariage qui part chez le confrère. Le brief demande donc de transformer
 * `ABANDONED` en lead qualifiable, sans jamais envoyer quoi que ce soit qu'on
 * n'ait pas le droit d'envoyer.
 *
 * Ce module ne DUPLIQUE rien : la garde anti-spam est `canFollowUp` (lot 6),
 * déjà appliquée AUSSI en base. Il ajoute exactement deux choses qui manquaient :
 *
 *   1. `MISSED_CALL` comme motif de relance à part entière — il a son propre
 *      plafond, donc récupérer un appel manqué ne consomme pas le quota d'une
 *      relance de devis, et inversement.
 *   2. Une CADENCE configurable par tenant, là où le lot 6 avait des seuils
 *      fixes. Les plafonds absolus, eux, restent des plafonds : la configuration
 *      peut RESSERRER, jamais élargir.
 *
 * Pur, sans I/O. `now` est toujours un paramètre.
 */

import { FOLLOW_UP_LIMITS, canFollowUp } from "@/lib/photo/leadScore";
import type { PhotoFollowUpReason } from "@/types/photoAcquisition";

// --- Cadence configurable ------------------------------------------------------

/**
 * Réglages de relance d'un studio. Chaque champ peut RESSERRER la règle globale,
 * jamais la desserrer — `effectiveCadence` s'en assure.
 *
 * Pourquoi ce sens unique : les plafonds du lot 6 sont aussi encodés en SQL. Une
 * configuration plus permissive que le SQL produirait une relance calculée comme
 * autorisée côté application puis rejetée en base — un bug silencieux. Ici, ce
 * qui passe l'application passe forcément la base.
 */
export type FollowUpCadence = {
  minHoursBetweenAny: number;
  maxTotalPerLead: number;
  maxPerReason: number;
  daysBeforeGivingUp: number;
};

export const DEFAULT_CADENCE: FollowUpCadence = {
  minHoursBetweenAny: FOLLOW_UP_LIMITS.MIN_HOURS_BETWEEN_ANY,
  maxTotalPerLead: FOLLOW_UP_LIMITS.MAX_TOTAL_PER_LEAD,
  maxPerReason: FOLLOW_UP_LIMITS.MAX_PER_REASON,
  daysBeforeGivingUp: FOLLOW_UP_LIMITS.DAYS_BEFORE_GIVING_UP,
};

export type CadenceOverrides = Partial<FollowUpCadence> | null | undefined;

/**
 * Cadence réellement appliquée. Un délai plus LONG est accepté, un délai plus
 * court est ignoré ; un plafond plus BAS est accepté, un plafond plus haut est
 * ignoré. Une valeur illisible retombe sur la valeur globale.
 */
export function effectiveCadence(overrides: CadenceOverrides): FollowUpCadence {
  const o = overrides ?? {};
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

  return {
    minHoursBetweenAny: Math.max(DEFAULT_CADENCE.minHoursBetweenAny, num(o.minHoursBetweenAny) ?? 0),
    maxTotalPerLead: Math.min(DEFAULT_CADENCE.maxTotalPerLead, num(o.maxTotalPerLead) ?? Infinity),
    maxPerReason: Math.min(DEFAULT_CADENCE.maxPerReason, num(o.maxPerReason) ?? Infinity),
    daysBeforeGivingUp: Math.min(
      DEFAULT_CADENCE.daysBeforeGivingUp,
      num(o.daysBeforeGivingUp) ?? Infinity,
    ),
  };
}

// --- Motifs -------------------------------------------------------------------

/**
 * Motif de récupération d'appel. Ajouté À LA FOIS au type `PhotoFollowUpReason`
 * et à la contrainte CHECK du lot 6 (non appliqué, donc librement modifiable) —
 * sinon l'application autoriserait une relance que la base rejetterait.
 */
export const MISSED_CALL_REASON: PhotoFollowUpReason = "MISSED_CALL";

/** Alias de lisibilité : le vocabulaire est celui du lot 6, non dupliqué. */
export type RecoveryReason = PhotoFollowUpReason;

// --- Récupération d'appel manqué ----------------------------------------------

/**
 * Ce qu'on sait d'un appel non abouti. Volontairement pauvre : un appel manqué
 * n'apporte qu'un numéro et un horodatage — tout le reste serait de l'invention.
 */
export type MissedCallInput = {
  /** `photo_calls.status`. Seul `ABANDONED` est un appel manqué. */
  callStatus: string;
  callerPhone: string | null;
  /** Le numéro correspond-il à un lead existant ? (déduplication déjà faite) */
  existingLeadId: string | null;
  /** Le lead a-t-il exprimé une opposition ? */
  optedOut: boolean;
  /** Relances déjà envoyées, tous motifs confondus. */
  sentTotal: number;
  /** Relances déjà envoyées pour la récupération d'appel. */
  sentForMissedCall: number;
  lastFollowUpAt: string | null;
  /** Le studio autorise-t-il l'envoi automatique de SMS ? Faux par défaut. */
  smsAllowed: boolean;
  /** Le numéro est-il exploitable (non masqué) ? */
  callerPhoneUsable: boolean;
  cadence: FollowUpCadence;
  now: Date;
};

export const RECOVERY_ACTIONS = [
  "NONE",
  "CREATE_LEAD",
  "UPDATE_LEAD",
  "SEND_SMS",
  "PREPARE_CALLBACK",
  "QUEUE_FOR_HUMAN",
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export type RecoveryDecision = {
  /** Le lead doit-il être créé ou mis à jour ? Toujours autorisé : c'est une
   *  écriture interne, pas un message. */
  leadAction: "CREATE_LEAD" | "UPDATE_LEAD" | "NONE";
  /** L'action de CONTACT décidée. Le point sensible. */
  contactAction: RecoveryAction;
  /** Pourquoi. Toujours renseigné, y compris en cas de refus. */
  code: string;
};

/**
 * Décide quoi faire d'un appel manqué.
 *
 * L'ORDRE compte, et il est délibéré : on sépare ce qui est INTERNE (créer le
 * lead — toujours permis, aucun message ne part) de ce qui est SORTANT (envoyer
 * un SMS — soumis à autorisation, opposition et anti-spam).
 *
 * Conséquence voulue : même quand aucun message n'est permis, le lead est
 * enregistré. Vanessa voit l'appel manqué dans son tableau et rappelle
 * elle-même. Le pire cas n'est jamais « on a perdu l'appel ».
 */
export function decideMissedCallRecovery(input: MissedCallInput): RecoveryDecision {
  if (input.callStatus !== "ABANDONED") {
    return { leadAction: "NONE", contactAction: "NONE", code: "NOT_A_MISSED_CALL" };
  }

  // Sans numéro exploitable, il n'y a ni lead identifiable ni rappel possible.
  if (!input.callerPhoneUsable || !input.callerPhone) {
    return { leadAction: "NONE", contactAction: "QUEUE_FOR_HUMAN", code: "CALLER_UNKNOWN" };
  }

  const leadAction = input.existingLeadId ? "UPDATE_LEAD" : "CREATE_LEAD";

  // Opposition : rien ne part, mais le lead est tout de même tenu à jour.
  if (input.optedOut) {
    return { leadAction, contactAction: "NONE", code: "OPTED_OUT" };
  }

  const gate = canFollowUp({
    reason: MISSED_CALL_REASON,
    sentForThisReason: input.sentForMissedCall,
    sentTotal: input.sentTotal,
    lastFollowUpAt: input.lastFollowUpAt,
    optedOut: input.optedOut,
    now: input.now,
  });

  // Plafonds resserrés par le studio : appliqués EN PLUS de la garde globale.
  const overCadence =
    input.sentTotal >= input.cadence.maxTotalPerLead ||
    input.sentForMissedCall >= input.cadence.maxPerReason ||
    tooSoon(input.lastFollowUpAt, input.cadence.minHoursBetweenAny, input.now);

  if (!gate.allowed || overCadence) {
    // Épuisé côté automatique ⇒ la main revient à l'humaine, pas au silence.
    return { leadAction, contactAction: "PREPARE_CALLBACK", code: gate.allowed ? "CADENCE_EXHAUSTED" : gate.code };
  }

  // SMS non autorisé par le studio ⇒ on prépare un rappel, on n'envoie rien.
  if (!input.smsAllowed) {
    return { leadAction, contactAction: "PREPARE_CALLBACK", code: "SMS_NOT_ALLOWED" };
  }

  return { leadAction, contactAction: "SEND_SMS", code: "OK" };
}

function tooSoon(lastAt: string | null, minHours: number, now: Date): boolean {
  if (!lastAt) return false;
  const last = new Date(lastAt);
  if (Number.isNaN(last.getTime())) return true; // date illisible ⇒ on refuse
  return (now.getTime() - last.getTime()) / 3_600_000 < minHours;
}

// --- Cycle de vie d'un devis relancé ------------------------------------------

export const QUOTE_FOLLOW_UP_STAGES = [
  "SENT",
  "FIRST_REMINDER",
  "SECOND_REMINDER",
  "EXPIRED",
  "ABANDONED",
] as const;
export type QuoteFollowUpStage = (typeof QUOTE_FOLLOW_UP_STAGES)[number];

export type QuoteFollowUpInput = {
  quoteSentAt: Date | null;
  quoteExpiresAt: Date | null;
  /** Dernière réponse entrante du client, s'il y en a eu une. */
  lastInboundAt: Date | null;
  remindersSent: number;
  cadence: FollowUpCadence;
  now: Date;
};

/**
 * Où en est un devis sans réponse : envoyé → 1ʳᵉ relance → 2ᵈᵉ → expiration →
 * abandon. C'est la séquence exacte du brief.
 *
 * Une réponse entrante SORT de la séquence : un client qui a répondu n'est plus
 * un client à relancer, c'est une conversation en cours.
 */
export function quoteFollowUpStage(input: QuoteFollowUpInput): {
  stage: QuoteFollowUpStage | "NOT_APPLICABLE";
  reason: RecoveryReason | null;
} {
  if (!isDate(input.quoteSentAt)) return { stage: "NOT_APPLICABLE", reason: null };
  if (isDate(input.lastInboundAt)) return { stage: "NOT_APPLICABLE", reason: null };

  const daysSinceSent = daysBetween(input.quoteSentAt, input.now);
  if (daysSinceSent >= input.cadence.daysBeforeGivingUp) {
    return { stage: "ABANDONED", reason: null };
  }

  if (isDate(input.quoteExpiresAt) && input.quoteExpiresAt.getTime() <= input.now.getTime()) {
    return { stage: "EXPIRED", reason: null };
  }

  // Expiration proche : le motif le plus urgent l'emporte sur « pas de réponse ».
  if (isDate(input.quoteExpiresAt)) {
    const daysToExpiry = daysBetween(input.now, input.quoteExpiresAt);
    if (daysToExpiry >= 0 && daysToExpiry <= 7) {
      return {
        stage: input.remindersSent >= 1 ? "SECOND_REMINDER" : "FIRST_REMINDER",
        reason: "OFFER_EXPIRING",
      };
    }
  }

  if (input.remindersSent >= input.cadence.maxTotalPerLead) {
    return { stage: "ABANDONED", reason: null };
  }
  if (input.remindersSent >= 1) return { stage: "SECOND_REMINDER", reason: "NO_REPLY" };
  return { stage: "FIRST_REMINDER", reason: "QUOTE_UNSIGNED" };
}

function isDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
