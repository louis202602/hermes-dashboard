/**
 * PHOTO-P1 — Contrats de l'acquisition (leads, campagnes, entonnoir).
 *
 * Ces types décrivent UNIQUEMENT ce que les façades renvoient réellement.
 * Aucun champ n'est « estimé » : un chiffre non mesurable est `null`, jamais 0
 * ni une valeur plausible — la distinction NOT_MEASURED / 0 est un invariant
 * produit (cf. `PhotoFunnel.provenance`).
 */

/** Origine du lead. `MANUAL_IMPORT` couvre la reprise d'un fichier existant. */
export type PhotoLeadSource =
  | "WEBSITE"
  | "LANDING_PAGE"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "GOOGLE"
  | "FORM"
  | "INBOUND_CALL"
  | "REFERRAL"
  | "MANUAL_IMPORT"
  | "OTHER";

/**
 * Prestation demandée. `AUTRE` est le point d'extension : le libellé métier
 * réel vit dans `photo_service_offerings`, configurable par tenant, pour que
 * l'ajout d'une prestation ne demande AUCUNE migration.
 */
export type PhotoServiceType =
  | "MARIAGE"
  | "GROSSESSE"
  | "NAISSANCE"
  | "FAMILLE"
  | "PORTRAIT"
  | "EVENEMENT"
  | "MINI_SEANCE"
  | "AUTRE";

/** Cycle de vie commercial : Source → Lead → Qualification → Devis → … */
export type PhotoLeadStatus =
  | "NEW"
  | "QUALIFYING"
  | "QUALIFIED"
  | "QUOTED"
  | "FOLLOW_UP"
  | "BOOKED"
  | "PAID"
  | "LOST"
  | "UNQUALIFIED";

/** Issue commerciale, séparée du statut courant pour l'attribution SW19. */
export type PhotoConversionStatus = "OPEN" | "WON" | "LOST" | "EXPIRED";

/** Prochaine action recommandée — un CODE stable, jamais une phrase générée. */
export type PhotoLeadNextAction =
  | "NONE"
  | "QUALIFY"
  | "SEND_QUOTE"
  | "FOLLOW_UP_NO_REPLY"
  | "FOLLOW_UP_QUOTE_UNSIGNED"
  | "CALL_BACK"
  | "CONFIRM_BOOKING"
  | "OFFER_EXPIRING"
  | "AWAIT_HUMAN";

/** Motif de relance. Sert de clé d'anti-répétition (un motif = une relance). */
export type PhotoFollowUpReason =
  | "NEW_REQUEST"
  | "NO_REPLY"
  | "QUOTE_SENT"
  | "QUOTE_UNSIGNED"
  | "CALLBACK_REQUESTED"
  | "OFFER_EXPIRING"
  | "BOOKING_TO_CONFIRM";

export type PhotoLead = {
  leadId: string;
  source: PhotoLeadSource;
  campaignKey: string | null;
  serviceType: PhotoServiceType;
  firstName: string | null;
  /** RGPD : le nom de famille est facultatif et n'est jamais exigé pour qualifier. */
  lastName: string | null;
  phone: string | null;
  email: string | null;
  requestedDate: string | null;
  location: string | null;
  /** `null` = le prospect n'a pas donné de budget. Jamais estimé à sa place. */
  budgetEur: number | null;
  status: PhotoLeadStatus;
  /** Score déterministe 0..100. `factors` explique CHAQUE point attribué. */
  leadScore: number;
  scoreFactors: PhotoScoreFactor[];
  nextAction: PhotoLeadNextAction;
  conversionStatus: PhotoConversionStatus;
  /** CA réellement encaissé et rattaché à ce lead. 0 tant que rien n'est payé. */
  revenueAttributedEur: number;
  createdAt: string;
};

/** Une contribution au score, avec sa raison. Rend le score auditable. */
export type PhotoScoreFactor = {
  code: string;
  points: number;
  label: string;
};

export type PhotoCampaign = {
  campaignKey: string;
  label: string;
  source: PhotoLeadSource;
  /** Dépense RÉELLE saisie par la photographe. `null` = non renseignée. */
  spendEur: number | null;
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
};

/**
 * Entonnoir mesuré. TOUS les champs dérivent de lignes réelles.
 *
 * `cac` et `roas` sont `null` — et non 0 — quand la dépense n'est pas
 * renseignée : un CAC de 0 € serait un mensonge, pas une absence de donnée.
 */
export type PhotoFunnel = {
  periodFrom: string;
  periodTo: string;
  leads: number;
  qualifiedLeads: number;
  quotes: number;
  bookings: number;
  revenueEur: number;
  costEur: number | null;
  /** Coût d'acquisition client = coût / réservations. `null` si non calculable. */
  cacEur: number | null;
  /** Return on ad spend = CA / coût. `null` si non calculable. */
  roas: number | null;
  /** Réservations / leads, en fraction [0..1]. `null` si aucun lead. */
  conversionRate: number | null;
  bySource: PhotoFunnelBySource[];
  provenance: "REAL" | "UNAVAILABLE";
};

export type PhotoFunnelBySource = {
  source: PhotoLeadSource;
  leads: number;
  bookings: number;
  revenueEur: number;
  costEur: number | null;
  cacEur: number | null;
  roas: number | null;
};

/** Une relance DUE, prête à être préparée — jamais envoyée automatiquement. */
export type PhotoFollowUpDue = {
  leadId: string;
  firstName: string | null;
  serviceType: PhotoServiceType;
  reason: PhotoFollowUpReason;
  dueSince: string;
  /** Nombre de relances déjà envoyées pour CE motif (plafonné côté service). */
  alreadySent: number;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "PHONE" | "NONE";
};
