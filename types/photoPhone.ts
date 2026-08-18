/**
 * PHOTO-P1 — Contrats du standard téléphonique (PHOTO_PHONE_RECEPTIONIST).
 *
 * VERTICALISATION, PAS NOUVEL AGENT : le composant `agent_10_telephonie_entrant`
 * existe déjà au registre Hermès (flux ENTRANT, pendant de l'Agent 9 sortant).
 * Ces types décrivent le PROFIL « studio photographe » posé dessus, pas un
 * second orchestrateur vocal.
 */

/** Issue de l'appel — pilote le routage humain. */
export type PhotoCallDisposition =
  | "AI_HANDLED"
  | "CALLBACK_REQUESTED"
  | "LIVE_TRANSFER_REQUESTED"
  | "HUMAN_REQUIRED"
  | "EMERGENCY_STOP";

/** Motif de passage à l'humain. Chaque valeur est une règle explicite. */
export type PhotoHandoffReason =
  | "CLIENT_ASKED"
  | "COMPLAINT"
  | "CONFLICT"
  | "COMPLEX_CONTRACT"
  | "EMOTIONALLY_SENSITIVE"
  | "OUT_OF_CATALOG"
  | "LOW_CONFIDENCE"
  | "BOOKING_NEEDS_HUMAN"
  | "NONE";

export type PhotoCallStatus =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "ABANDONED";

/** Intention détectée. `UNKNOWN` déclenche la posture prudente, jamais un bluff. */
export type PhotoCallIntent =
  | "NEW_ENQUIRY"
  | "EXISTING_CLIENT"
  | "PRICING_QUESTION"
  | "AVAILABILITY_QUESTION"
  | "RESCHEDULE"
  | "COMPLAINT"
  | "OTHER"
  | "UNKNOWN";

/**
 * Créneaux d'information que l'agent extrait AU FIL de la conversation.
 *
 * INVARIANT PRODUIT : ce sont des créneaux à REMPLIR PASSIVEMENT, pas un
 * questionnaire à dérouler. L'agent ne redemande jamais une information déjà
 * donnée, et n'exige jamais un créneau pour continuer — un appel où seul le
 * prénom est connu reste un appel utile.
 */
export type PhotoCallSlots = {
  serviceType: string | null;
  requestedDate: string | null;
  location: string | null;
  budgetEur: number | null;
  firstName: string | null;
  phone: string | null;
  email: string | null;
};

/** Ce qui manque encore, par ordre de priorité conversationnelle. */
export type PhotoMissingSlot = keyof PhotoCallSlots;

export type PhotoCall = {
  callId: string;
  status: PhotoCallStatus;
  intent: PhotoCallIntent;
  disposition: PhotoCallDisposition;
  handoffReason: PhotoHandoffReason;
  slots: PhotoCallSlots;
  /** Résumé factuel généré en fin d'appel. Jamais l'audio, jamais le verbatim. */
  summary: string | null;
  leadId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  /** Coût réel de l'appel, remonté par le fournisseur. `null` si non rapporté. */
  costUsd: number | null;
};

/**
 * Configuration du standard, par tenant. Tout ce que l'agent a le droit de
 * dire vient d'ICI ou de la base — jamais de sa propre invention.
 */
export type PhotoPhoneConfig = {
  enabled: boolean;
  /** Nom prononcé à l'accueil. */
  studioName: string | null;
  greeting: string | null;
  /** Numéro de transfert humain. Sans lui, `LIVE_TRANSFER` est impossible. */
  transferNumber: string | null;
  /** Plages horaires où l'agent décroche (hors plage ⇒ message + rappel). */
  officeHours: PhotoOfficeHours[];
  /** AUTORISATION : l'agent a-t-il le droit de lire l'agenda ? */
  agendaLookupAllowed: boolean;
  /**
   * ÉTAT : l'agenda est-il réellement connecté (OAuth self-service du tenant) ?
   *
   * Distinct de l'autorisation ci-dessus. Aucun jeton n'est stocké ici — Hermès
   * ne détient jamais le mot de passe du tenant, seulement une autorisation
   * déléguée. Tant que c'est faux, aucune disponibilité ne peut être annoncée
   * ni aucun créneau confirmé.
   */
  calendarConnected: boolean;
  /** L'agent peut-il envoyer une confirmation SMS/email lui-même ? */
  confirmationSendAllowed: boolean;
  /** Sujets sur lesquels il a le droit de répondre. Tout le reste ⇒ humain. */
  allowedTopics: string[];
};

export type PhotoOfficeHours = {
  /** 1 = lundi … 7 = dimanche (ISO-8601). */
  weekday: number;
  fromMinutes: number;
  toMinutes: number;
};

/**
 * Décision du tour de parole : que fait l'agent maintenant.
 *
 * `say` est TOUJOURS choisi dans un répertoire borné côté application ; le
 * modèle ne compose jamais une affirmation commerciale libre.
 */
export type PhotoTurnDecision = {
  action: "ASK" | "ANSWER" | "CONFIRM" | "HANDOFF" | "CLOSE";
  /** Créneau visé quand `action = ASK`. */
  askFor: PhotoMissingSlot | null;
  disposition: PhotoCallDisposition;
  handoffReason: PhotoHandoffReason;
  /** Vrai si la demande sort du périmètre autorisé (⇒ jamais d'improvisation). */
  outOfScope: boolean;
};
