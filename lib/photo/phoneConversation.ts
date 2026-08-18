import type {
  PhotoCallDisposition,
  PhotoCallIntent,
  PhotoCallSlots,
  PhotoHandoffReason,
  PhotoMissingSlot,
  PhotoTurnDecision,
} from "@/types/photoPhone";

/**
 * PHOTO-P1 — Comportement conversationnel du standard téléphonique.
 *
 * DEUX INVARIANTS PRODUIT, tenus par du code déterministe et non par une
 * consigne de prompt (qu'un modèle peut ignorer) :
 *
 *  1. PAS DE QUESTIONNAIRE. L'agent extrait ce que le client donne
 *     spontanément et ne demande QUE le créneau manquant le plus utile — un
 *     seul à la fois. « Le mariage est prévu dans quel secteur ? » et jamais
 *     « Quel est votre nom ? Quelle est votre date ? Quel est votre budget ? ».
 *
 *  2. PAS D'INVENTION. Tarif, disponibilité, réservation, délai, promotion,
 *     prestation, condition commerciale : si l'information n'est pas dans la
 *     configuration ou la base, l'agent le dit et propose de transmettre. Le
 *     répertoire de phrases ci-dessous est BORNÉ : le modèle choisit une
 *     intention, il ne rédige pas d'affirmation commerciale libre.
 */

// --- Anti-hallucination ------------------------------------------------------

/** Sujets sur lesquels une réponse improvisée engagerait commercialement. */
export const NEVER_IMPROVISE = [
  "TARIF",
  "DISPONIBILITE",
  "RESERVATION",
  "DELAI",
  "PROMOTION",
  "PRESTATION",
  "CONDITION_COMMERCIALE",
] as const;

export type NeverImproviseTopic = (typeof NEVER_IMPROVISE)[number];

/** La phrase de repli, littérale et unique. */
export const UNCERTAIN_REPLY =
  "Je préfère ne pas vous donner une information approximative. " +
  "Je peux transmettre votre demande à Vanessa.";

const unicodeWord = (words: string[]) =>
  new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, "iu");

/**
 * Un sujet est répondable UNIQUEMENT si le studio l'a explicitement autorisé
 * ET que la donnée existe. Fail-closed : `hasGroundedAnswer=false` ⇒ refus.
 */
export function canAnswerTopic(
  topic: NeverImproviseTopic,
  allowedTopics: string[],
  hasGroundedAnswer: boolean,
): boolean {
  return allowedTopics.includes(topic) && hasGroundedAnswer;
}

// --- Détection d'intention et de transfert -----------------------------------

const RE_ASK_HUMAN = unicodeWord([
  "humain", "quelqu'un", "une personne", "vanessa", "responsable", "patron", "gérant",
]);
const RE_COMPLAINT = unicodeWord([
  "réclamation", "reclamation", "plainte", "scandaleux", "inadmissible",
  "remboursement", "rembourser", "avocat", "litige", "insatisfait", "déçu", "decu",
]);
const RE_CONFLICT = unicodeWord(["conflit", "procès", "proces", "tribunal", "mise en demeure"]);
const RE_CONTRACT = unicodeWord(["contrat", "clause", "cgv", "juridique", "résiliation", "resiliation"]);
const RE_SENSITIVE = unicodeWord([
  "décès", "deces", "décédé", "decede", "enterrement", "obsèques", "obseques",
  "hôpital", "hopital", "malade", "maladie", "divorce",
]);
const RE_PRICING = unicodeWord(["tarif", "prix", "combien", "coûte", "coute", "budget"]);
const RE_AVAILABILITY = unicodeWord(["disponible", "disponibilité", "disponibilite", "libre", "créneau", "creneau"]);
const RE_RESCHEDULE = unicodeWord(["reporter", "décaler", "decaler", "annuler", "changer la date"]);
const RE_EXISTING = unicodeWord(["ma séance", "ma seance", "mes photos", "ma galerie", "ma commande"]);

/**
 * Motif de transfert humain. L'ordre encode la gravité : une réclamation
 * l'emporte sur une simple question de prix prononcée dans la même phrase.
 */
export function detectHandoffReason(utterance: string): PhotoHandoffReason {
  const t = utterance ?? "";
  if (RE_CONFLICT.test(t)) return "CONFLICT";
  if (RE_COMPLAINT.test(t)) return "COMPLAINT";
  if (RE_SENSITIVE.test(t)) return "EMOTIONALLY_SENSITIVE";
  if (RE_CONTRACT.test(t)) return "COMPLEX_CONTRACT";
  if (RE_ASK_HUMAN.test(t)) return "CLIENT_ASKED";
  return "NONE";
}

export function detectIntent(utterance: string): PhotoCallIntent {
  const t = utterance ?? "";
  if (RE_COMPLAINT.test(t) || RE_CONFLICT.test(t)) return "COMPLAINT";
  if (RE_RESCHEDULE.test(t)) return "RESCHEDULE";
  if (RE_EXISTING.test(t)) return "EXISTING_CLIENT";
  if (RE_AVAILABILITY.test(t)) return "AVAILABILITY_QUESTION";
  if (RE_PRICING.test(t)) return "PRICING_QUESTION";
  if (t.trim().length === 0) return "UNKNOWN";
  return "NEW_ENQUIRY";
}

const HANDOFF_TO_DISPOSITION: Record<PhotoHandoffReason, PhotoCallDisposition> = {
  CLIENT_ASKED: "LIVE_TRANSFER_REQUESTED",
  COMPLAINT: "HUMAN_REQUIRED",
  CONFLICT: "HUMAN_REQUIRED",
  COMPLEX_CONTRACT: "HUMAN_REQUIRED",
  EMOTIONALLY_SENSITIVE: "HUMAN_REQUIRED",
  OUT_OF_CATALOG: "CALLBACK_REQUESTED",
  // Forte incertitude ⇒ HUMAIN, et non un simple rappel : si l'agent n'a pas
  // compris l'appelant, il a pu tout aussi mal entendre son NUMÉRO. Promettre
  // un rappel sur une donnée dont on doute reviendrait à perdre l'appel en
  // silence ; escalader vers un humain ne présume, lui, d'aucune capture.
  LOW_CONFIDENCE: "HUMAN_REQUIRED",
  BOOKING_NEEDS_HUMAN: "CALLBACK_REQUESTED",
  NONE: "AI_HANDLED",
};

/**
 * Sans numéro de transfert configuré, un transfert direct est IMPOSSIBLE : on
 * dégrade honnêtement en rappel plutôt que de promettre un transfert qui
 * échouerait au nez du client.
 */
export function dispositionFor(
  reason: PhotoHandoffReason,
  transferNumber: string | null,
): PhotoCallDisposition {
  const d = HANDOFF_TO_DISPOSITION[reason];
  if (d === "LIVE_TRANSFER_REQUESTED" && !transferNumber) return "CALLBACK_REQUESTED";
  return d;
}

// --- Créneaux : quoi demander ensuite ----------------------------------------

/**
 * Ordre de priorité conversationnelle. Ce n'est PAS l'ordre d'un formulaire :
 * c'est l'ordre dans lequel une vraie photographe a besoin des informations.
 * Le nom de famille n'y figure pas du tout (minimisation RGPD).
 */
export const SLOT_PRIORITY: readonly PhotoMissingSlot[] = [
  "serviceType",
  "requestedDate",
  "location",
  "firstName",
  "phone",
  "budgetEur",
  "email",
] as const;

const slotFilled = (slots: PhotoCallSlots, k: PhotoMissingSlot): boolean => {
  const v = slots[k];
  if (v === null || v === undefined) return false;
  return typeof v === "string" ? v.trim().length > 0 : true;
};

/**
 * Le prochain créneau à demander, ou `null` si tout est connu.
 *
 * Un SEUL parcours, dans l'ordre de `SLOT_PRIORITY` : on épuise le PROJET
 * (prestation → date → lieu) avant de demander l'IDENTITÉ (prénom → téléphone),
 * puis seulement le confort (budget → e-mail).
 *
 * C'est délibérément l'ordre d'une vraie conversation, et non celui d'un
 * formulaire : après « mon mariage le 12 juin », on enchaîne sur « dans quel
 * secteur ? » — on ne coupe pas pour réclamer un nom. Une version antérieure
 * priorisait les créneaux « essentiels au rappel » et demandait le prénom à ce
 * moment-là : c'était précisément le réflexe de questionnaire que ce module
 * doit interdire.
 */
export function nextSlotToAsk(slots: PhotoCallSlots): PhotoMissingSlot | null {
  for (const k of SLOT_PRIORITY) {
    if (!slotFilled(slots, k)) return k;
  }
  return null;
}

export function missingSlots(slots: PhotoCallSlots): PhotoMissingSlot[] {
  return SLOT_PRIORITY.filter((k) => !slotFilled(slots, k));
}

/** Un appel est exploitable dès qu'on peut recontacter la personne. */
export function isActionableLead(slots: PhotoCallSlots): boolean {
  return slotFilled(slots, "phone") || slotFilled(slots, "email");
}

// --- Décision de tour --------------------------------------------------------

export type TurnInput = {
  utterance: string;
  slots: PhotoCallSlots;
  transferNumber: string | null;
  allowedTopics: string[];
  /** Le sujet abordé a-t-il une réponse ancrée dans la donnée réelle ? */
  hasGroundedAnswer: boolean;
  /** Confiance de compréhension [0..1] remontée par la couche vocale. */
  confidence: number;
  /**
   * L'agenda de la photographe est-il RÉELLEMENT connecté (OAuth self-service) ?
   *
   * Distinct d'une autorisation : elle peut avoir autorisé la lecture d'agenda
   * sans avoir encore cliqué « Connecter ». Tant que c'est faux, aucune
   * disponibilité ne peut être annoncée ni aucun créneau confirmé — quoi que
   * dise `hasGroundedAnswer`, qui dépend de l'appelant. Ce verrou est ici pour
   * que l'invariant ne repose pas sur la discipline du code appelant.
   */
  agendaConnected: boolean;
};

/** Sous ce seuil, on ne devine pas : on fait rappeler. */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;

/**
 * LA décision du tour. Ordre volontaire : sécurité humaine d'abord, puis
 * incertitude, puis périmètre, puis seulement la conversation utile.
 */
export function decideTurn(input: TurnInput): PhotoTurnDecision {
  const explicit = detectHandoffReason(input.utterance);
  if (explicit !== "NONE") {
    return {
      action: "HANDOFF",
      askFor: null,
      disposition: dispositionFor(explicit, input.transferNumber),
      handoffReason: explicit,
      outOfScope: false,
    };
  }

  if (input.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      action: "HANDOFF",
      askFor: null,
      disposition: dispositionFor("LOW_CONFIDENCE", input.transferNumber),
      handoffReason: "LOW_CONFIDENCE",
      outOfScope: false,
    };
  }

  const intent = detectIntent(input.utterance);
  const topic: NeverImproviseTopic | null =
    intent === "PRICING_QUESTION"
      ? "TARIF"
      : intent === "AVAILABILITY_QUESTION"
        ? "DISPONIBILITE"
        : null;

  // Verrou agenda : sans connexion OAuth effective, une question de
  // disponibilité ne peut JAMAIS aboutir à une réponse ni à une confirmation,
  // même si l'appelant prétend disposer d'une donnée ancrée. On enregistre la
  // demande et on fait rappeler — on n'invente pas un créneau.
  if (topic === "DISPONIBILITE" && !input.agendaConnected) {
    return {
      action: "HANDOFF",
      askFor: null,
      disposition: dispositionFor("BOOKING_NEEDS_HUMAN", input.transferNumber),
      handoffReason: "BOOKING_NEEDS_HUMAN",
      outOfScope: true,
    };
  }

  if (topic && !canAnswerTopic(topic, input.allowedTopics, input.hasGroundedAnswer)) {
    return {
      action: "HANDOFF",
      askFor: null,
      disposition: dispositionFor("OUT_OF_CATALOG", input.transferNumber),
      handoffReason: "OUT_OF_CATALOG",
      outOfScope: true,
    };
  }

  if (topic) {
    return {
      action: "ANSWER",
      askFor: null,
      disposition: "AI_HANDLED",
      handoffReason: "NONE",
      outOfScope: false,
    };
  }

  const ask = nextSlotToAsk(input.slots);
  if (ask) {
    return {
      action: "ASK",
      askFor: ask,
      disposition: "AI_HANDLED",
      handoffReason: "NONE",
      outOfScope: false,
    };
  }

  return {
    action: "CLOSE",
    askFor: null,
    disposition: "AI_HANDLED",
    handoffReason: "NONE",
    outOfScope: false,
  };
}
