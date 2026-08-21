import type {
  PhotoConversionStatus,
  PhotoFollowUpReason,
  PhotoLeadNextAction,
  PhotoLeadStatus,
  PhotoScoreFactor,
  PhotoServiceType,
} from "@/types/photoAcquisition";

/**
 * PHOTO-P1 — Scoring de lead DÉTERMINISTE et relances anti-spam.
 *
 * Aucun LLM n'intervient ici, et c'est délibéré : un score commercial doit être
 * reproductible, explicable ligne à ligne, et identique en base et à l'écran.
 * Chaque point attribué sort avec sa raison (`PhotoScoreFactor`), pour que la
 * photographe puisse contester le classement plutôt que le subir.
 *
 * Ce module est le MIROIR applicatif de `hermes_os.derive_photo_lead_score`
 * (lot 6). La base reste l'autorité ; ce fichier sert au rendu et aux tests.
 */

/** Barème. Volontairement petit : chaque ligne doit se justifier en une phrase. */
export const LEAD_SCORE_RULES = {
  /** Un moyen de rappel est la condition de base d'un lead exploitable. */
  HAS_PHONE: 20,
  HAS_EMAIL: 10,
  /** Une date demandée = une intention datée, le signal le plus fort. */
  HAS_REQUESTED_DATE: 25,
  /** Une date proche (≤ 120 j) convertit nettement mieux qu'un projet lointain. */
  DATE_WITHIN_120_DAYS: 10,
  HAS_LOCATION: 10,
  /** Un budget annoncé par le prospect lui-même — jamais estimé à sa place. */
  HAS_BUDGET: 15,
  /** Prestation à forte valeur : mariage / événement. */
  HIGH_VALUE_SERVICE: 10,
  /** Recommandation : la meilleure source, mesurée dans tous les studios. */
  REFERRAL_SOURCE: 10,
} as const;

const HIGH_VALUE_SERVICES: ReadonlySet<PhotoServiceType> = new Set<PhotoServiceType>([
  "MARIAGE",
  "EVENEMENT",
]);

export type LeadScoreInput = {
  phone: string | null;
  email: string | null;
  requestedDate: string | null;
  location: string | null;
  budgetEur: number | null;
  serviceType: PhotoServiceType;
  source: string;
  /** Référence temporelle, injectée pour rester testable et déterministe. */
  now: Date;
};

const isFilled = (v: string | null): boolean => typeof v === "string" && v.trim().length > 0;

/** Jours calendaires entre `now` et une date ISO. `null` si la date est invalide. */
export function daysUntil(isoDate: string | null, now: Date): number | null {
  if (!isFilled(isoDate)) return null;
  const target = new Date(`${(isoDate as string).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/**
 * Score 0..100 + justification. Le total est borné : ajouter une règle ne peut
 * pas faire déborder l'échelle ni dévaluer silencieusement les autres.
 */
export function scoreLead(input: LeadScoreInput): {
  score: number;
  factors: PhotoScoreFactor[];
} {
  const factors: PhotoScoreFactor[] = [];
  const add = (code: keyof typeof LEAD_SCORE_RULES, label: string) => {
    factors.push({ code, points: LEAD_SCORE_RULES[code], label });
  };

  if (isFilled(input.phone)) add("HAS_PHONE", "Un numéro permet de rappeler");
  if (isFilled(input.email)) add("HAS_EMAIL", "Une adresse e-mail permet d’envoyer un devis");

  const days = daysUntil(input.requestedDate, input.now);
  if (days !== null) {
    add("HAS_REQUESTED_DATE", "Une date est demandée");
    // Une date PASSÉE ne vaut pas le bonus de proximité : elle signale plutôt
    // une demande périmée qu'une urgence.
    if (days >= 0 && days <= 120) {
      add("DATE_WITHIN_120_DAYS", "La date est proche (moins de 4 mois)");
    }
  }

  if (isFilled(input.location)) add("HAS_LOCATION", "Le lieu est connu");
  if (typeof input.budgetEur === "number" && input.budgetEur > 0) {
    add("HAS_BUDGET", "Le prospect a annoncé un budget");
  }
  if (HIGH_VALUE_SERVICES.has(input.serviceType)) {
    add("HIGH_VALUE_SERVICE", "Prestation à forte valeur");
  }
  if (input.source === "REFERRAL") {
    add("REFERRAL_SOURCE", "Vient d’une recommandation");
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), factors };
}

// --- Prochaine action --------------------------------------------------------

export type NextActionInput = {
  status: PhotoLeadStatus;
  conversionStatus: PhotoConversionStatus;
  /** Dernier contact SORTANT (relance, devis…). */
  lastOutboundAt: string | null;
  /** Dernière réponse ENTRANTE du prospect. */
  lastInboundAt: string | null;
  quoteSentAt: string | null;
  quoteExpiresAt: string | null;
  callbackRequestedAt: string | null;
  bookingConfirmed: boolean;
  now: Date;
};

/**
 * Prochaine action. La PREMIÈRE condition vraie gagne — l'ordre encode la
 * priorité commerciale, et rend la fonction lisible sans exécuter le code.
 */
export function nextLeadAction(input: NextActionInput): PhotoLeadNextAction {
  if (input.conversionStatus === "WON" && !input.bookingConfirmed) return "CONFIRM_BOOKING";
  if (input.conversionStatus === "LOST" || input.conversionStatus === "EXPIRED") return "NONE";
  if (input.status === "LOST" || input.status === "UNQUALIFIED") return "NONE";

  // Un rappel explicitement demandé passe avant tout le reste : c'est le
  // prospect qui a fixé le rendez-vous, pas nous.
  if (isFilled(input.callbackRequestedAt)) return "CALL_BACK";

  if (input.status === "NEW" || input.status === "QUALIFYING") return "QUALIFY";
  if (input.status === "QUALIFIED" && !isFilled(input.quoteSentAt)) return "SEND_QUOTE";

  if (isFilled(input.quoteSentAt)) {
    const daysToExpiry = daysUntil(input.quoteExpiresAt, input.now);
    if (daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7) return "OFFER_EXPIRING";
    if (!isFilled(input.lastInboundAt)) return "FOLLOW_UP_QUOTE_UNSIGNED";
  }

  if (isFilled(input.lastOutboundAt) && !isFilled(input.lastInboundAt)) {
    return "FOLLOW_UP_NO_REPLY";
  }
  return "NONE";
}

// --- Anti-spam ---------------------------------------------------------------

/**
 * Garde-fous de relance. Ce ne sont pas des réglages cosmétiques : ils sont la
 * différence entre une relance commerciale et du spam, et ils sont appliqués
 * AUSSI en base (lot 6) pour qu'aucun appelant ne puisse les contourner.
 */
export const FOLLOW_UP_LIMITS = {
  /** Jamais deux relances, tous motifs confondus, à moins de 72 h d'écart. */
  MIN_HOURS_BETWEEN_ANY: 72,
  /** Au plus 3 relances au total sur la vie d'un lead. */
  MAX_TOTAL_PER_LEAD: 3,
  /** Au plus 1 relance par motif : un motif épuisé ne revient pas. */
  MAX_PER_REASON: 1,
  /** Un lead sans réponse après la dernière relance autorisée est clos. */
  DAYS_BEFORE_GIVING_UP: 45,
} as const;

export type FollowUpGateInput = {
  reason: PhotoFollowUpReason;
  sentForThisReason: number;
  sentTotal: number;
  lastFollowUpAt: string | null;
  optedOut: boolean;
  now: Date;
};

export type FollowUpGate = {
  allowed: boolean;
  code:
    | "OK"
    | "OPTED_OUT"
    | "TOO_SOON"
    | "REASON_EXHAUSTED"
    | "TOTAL_EXHAUSTED";
};

/**
 * Décide si UNE relance est permise. Fail-closed : au moindre doute (date
 * illisible), on refuse — ne pas relancer est toujours récupérable, spammer
 * ne l'est pas.
 */
export function canFollowUp(input: FollowUpGateInput): FollowUpGate {
  if (input.optedOut) return { allowed: false, code: "OPTED_OUT" };
  if (input.sentTotal >= FOLLOW_UP_LIMITS.MAX_TOTAL_PER_LEAD) {
    return { allowed: false, code: "TOTAL_EXHAUSTED" };
  }
  if (input.sentForThisReason >= FOLLOW_UP_LIMITS.MAX_PER_REASON) {
    return { allowed: false, code: "REASON_EXHAUSTED" };
  }
  if (isFilled(input.lastFollowUpAt)) {
    const last = new Date(input.lastFollowUpAt as string);
    if (Number.isNaN(last.getTime())) return { allowed: false, code: "TOO_SOON" };
    const hours = (input.now.getTime() - last.getTime()) / 3_600_000;
    if (hours < FOLLOW_UP_LIMITS.MIN_HOURS_BETWEEN_ANY) {
      return { allowed: false, code: "TOO_SOON" };
    }
  }
  return { allowed: true, code: "OK" };
}

// --- Entonnoir ---------------------------------------------------------------

/**
 * CAC / ROAS / taux. `null` (et NON 0) dès qu'un dénominateur manque : afficher
 * « CAC 0 € » pour une campagne sans dépense renseignée serait un chiffre faux,
 * pas une absence de mesure.
 */
export function funnelRatios(input: {
  leads: number;
  bookings: number;
  revenueEur: number;
  costEur: number | null;
}): { cacEur: number | null; roas: number | null; conversionRate: number | null } {
  const { leads, bookings, revenueEur, costEur } = input;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    cacEur: costEur !== null && bookings > 0 ? round2(costEur / bookings) : null,
    roas: costEur !== null && costEur > 0 ? round2(revenueEur / costEur) : null,
    conversionRate: leads > 0 ? Math.round((bookings / leads) * 10_000) / 10_000 : null,
  };
}
