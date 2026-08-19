/**
 * HERMÈS STUDIO — CYCLE DE VIE CLIENT.
 *
 * C'est la brique la plus rentable pour une photographe : une grossesse annonce
 * une naissance, une naissance annonce un premier anniversaire, un mariage
 * annonce des séances de famille pendant dix ans. Transformer un client ponctuel
 * en client récurrent vaut plus que n'importe quelle campagne d'acquisition.
 *
 * C'est aussi la plus DANGEREUSE, et il faut le dire franchement : « grossesse »
 * et « naissance » sont des données de santé et de vie familiale. Un moteur qui
 * DEVINE ici ne fait pas une erreur commerciale, il fait une faute — écrire à
 * une femme au sujet d'une grossesse déduite, après une fausse couche, est
 * exactement le message qu'aucun système ne doit envoyer.
 *
 * D'où la règle qui structure tout ce module :
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ ON NE DÉDUIT JAMAIS UN ÉVÉNEMENT. On ne CHAÎNE que depuis un fait    │
 *   │ que la cliente a elle-même posé : une séance RÉALISÉE, ou une date   │
 *   │ qu'elle a communiquée. Jamais une inférence.                         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Une séance GROSSESSE livrée est un fait : la cliente est venue, elle a payé,
 * elle sait ce qu'elle a photographié. Enchaîner vers NAISSANCE est alors une
 * suite logique de SA démarche, pas une supposition sur son corps.
 *
 * Deuxième limite, honnête : `photo_client_members` ne stocke que
 * `birth_month` + `birth_year` — pas le jour. C'est une minimisation RGPD
 * délibérée. Les échéances calculées depuis une naissance sont donc précises au
 * MOIS, et ce module le dit (`precision: "MONTH"`) au lieu de fabriquer un jour.
 *
 * Pur, sans I/O. `now` est toujours un paramètre.
 */

// --- Faits admissibles ---------------------------------------------------------

/**
 * Les deux seules ancres autorisées. Il n'y en aura pas de troisième sans
 * décision explicite : chaque nouvelle ancre est une nouvelle façon de se
 * tromper sur la vie de quelqu'un.
 */
export const LIFECYCLE_ANCHORS = ["SESSION_DELIVERED", "MEMBER_BIRTH"] as const;
export type LifecycleAnchor = (typeof LIFECYCLE_ANCHORS)[number];

export type SessionAnchor = {
  kind: "SESSION_DELIVERED";
  /** `photo_sessions.session_type` — vocabulaire déjà en base. */
  sessionType: string;
  /** `photo_sessions.delivered_at`. Une séance NON livrée n'est pas une ancre. */
  deliveredAt: Date;
};

export type MemberBirthAnchor = {
  kind: "MEMBER_BIRTH";
  /** `photo_client_members.relation` (ex. « ENFANT »). */
  relation: string;
  /** 1–12. Le jour n'existe pas en base : minimisation RGPD assumée. */
  birthMonth: number;
  birthYear: number;
};

export type LifecycleFact = SessionAnchor | MemberBirthAnchor;

// --- Règles configurées par le studio ------------------------------------------

/**
 * « Après X, propose Y dans N mois. » C'est Vanessa qui l'écrit — le moteur
 * n'invente aucun enchaînement, même évident.
 */
export type LifecycleRule = {
  ruleId: string;
  anchor: LifecycleAnchor;
  /**
   * Valeur d'ancrage : type de séance (`MARIAGE`…) ou relation (`ENFANT`).
   * Comparaison stricte, jamais approchée.
   */
  anchorValue: string;
  offsetMonths: number;
  /** Prestation recommandée — doit exister au catalogue du studio. */
  recommendedService: string;
  /** Fenêtre d'anticipation : à partir de quand la proposer. */
  leadTimeDays: number;
  active: boolean;
};

// --- Consentement et contactabilité -------------------------------------------

export type ContactEligibility = {
  /** `photo_media_consent.status` — GRANTED / REVOKED / EXPIRED. */
  consentStatus: string | null;
  consentExpiresAt: Date | null;
  optedOut: boolean;
  /** Le client a-t-il un canal joignable (e-mail ou téléphone) ? */
  hasChannel: boolean;
};

export const CONTACT_REFUSAL_CODES = [
  "OPTED_OUT",
  "NO_CONSENT",
  "CONSENT_REVOKED",
  "CONSENT_EXPIRED",
  "NO_CHANNEL",
] as const;
export type ContactRefusalCode = (typeof CONTACT_REFUSAL_CODES)[number];

/**
 * Le client peut-il être sollicité ?
 *
 * FAIL-CLOSED : un consentement ABSENT vaut refus, pas « probablement d'accord ».
 * Une date d'expiration illisible vaut expiré.
 */
export function contactAllowed(
  e: ContactEligibility,
  now: Date,
): { allowed: boolean; code: ContactRefusalCode | "OK" } {
  if (e.optedOut) return { allowed: false, code: "OPTED_OUT" };
  if (e.consentStatus == null) return { allowed: false, code: "NO_CONSENT" };
  if (e.consentStatus === "REVOKED") return { allowed: false, code: "CONSENT_REVOKED" };
  if (e.consentStatus === "EXPIRED") return { allowed: false, code: "CONSENT_EXPIRED" };
  if (e.consentStatus !== "GRANTED") return { allowed: false, code: "NO_CONSENT" };
  if (e.consentExpiresAt != null) {
    if (Number.isNaN(e.consentExpiresAt.getTime())) {
      return { allowed: false, code: "CONSENT_EXPIRED" };
    }
    if (e.consentExpiresAt.getTime() <= now.getTime()) {
      return { allowed: false, code: "CONSENT_EXPIRED" };
    }
  }
  if (!e.hasChannel) return { allowed: false, code: "NO_CHANNEL" };
  return { allowed: true, code: "OK" };
}

// --- Le moteur -----------------------------------------------------------------

export type LifecycleOpportunity = {
  /** NEXT_LIFECYCLE_OPPORTUNITY */
  opportunity: string;
  /** TARGET_DATE — calculée depuis une date RÉELLE, jamais estimée. */
  targetDate: Date;
  /** Précision honnête de la cible : au jour, ou seulement au mois. */
  precision: "DAY" | "MONTH";
  /** RECOMMENDED_SERVICE — issu de la règle, donc du catalogue. */
  recommendedService: string;
  /** CONTACT_ALLOWED */
  contactAllowed: boolean;
  contactCode: ContactRefusalCode | "OK";
  /** NEXT_ACTION */
  nextAction: "WAIT" | "PREPARE_CAMPAIGN" | "ASK_HUMAN" | "NONE";
  ruleId: string;
  /** Le fait sur lequel repose la proposition — pour l'audit. */
  basedOn: LifecycleAnchor;
};

/**
 * Prochaines opportunités, triées par échéance.
 *
 * Ce que ce moteur ne fait PAS, et c'est volontaire :
 *   * il ne suppose pas qu'une séance GROSSESSE donnera une naissance —
 *     il applique une règle que Vanessa a écrite, et seulement si elle l'a écrite ;
 *   * il ne fabrique pas de date : sans ancre datée, pas d'opportunité ;
 *   * il ne contourne jamais le consentement — une opportunité non contactable
 *     est TOUT DE MÊME rendue, mais avec `contactAllowed: false` et
 *     `nextAction: "ASK_HUMAN"`. Vanessa la voit, Hermès n'écrit pas.
 */
export function nextLifecycleOpportunities(
  facts: readonly LifecycleFact[],
  rules: readonly LifecycleRule[],
  eligibility: ContactEligibility,
  now: Date,
): LifecycleOpportunity[] {
  const contact = contactAllowed(eligibility, now);
  const out: LifecycleOpportunity[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;
    for (const fact of facts) {
      if (fact.kind !== rule.anchor) continue;

      const anchorMatches =
        fact.kind === "SESSION_DELIVERED"
          ? fact.sessionType === rule.anchorValue
          : fact.relation === rule.anchorValue;
      if (!anchorMatches) continue;

      const anchor = anchorDate(fact);
      if (anchor === null) continue; // ancre illisible ⇒ aucune opportunité

      const targetDate = addMonths(anchor.date, rule.offsetMonths);
      const openFrom = new Date(targetDate.getTime() - rule.leadTimeDays * 86_400_000);

      out.push({
        opportunity: `${rule.anchorValue}_TO_${rule.recommendedService}`,
        targetDate,
        precision: anchor.precision,
        recommendedService: rule.recommendedService,
        contactAllowed: contact.allowed,
        contactCode: contact.code,
        nextAction: resolveNextAction(now, openFrom, targetDate, contact.allowed),
        ruleId: rule.ruleId,
        basedOn: rule.anchor,
      });
    }
  }

  // Tri déterministe : échéance, puis règle. Deux exécutions ⇒ même ordre.
  return out.sort(
    (a, b) => a.targetDate.getTime() - b.targetDate.getTime() || a.ruleId.localeCompare(b.ruleId),
  );
}

function resolveNextAction(
  now: Date,
  openFrom: Date,
  targetDate: Date,
  allowed: boolean,
): LifecycleOpportunity["nextAction"] {
  // Une échéance dépassée depuis longtemps n'est plus une opportunité : relancer
  // sur le premier anniversaire d'un enfant qui en a trois est un faux pas.
  const daysPast = (now.getTime() - targetDate.getTime()) / 86_400_000;
  if (daysPast > 90) return "NONE";
  if (now.getTime() < openFrom.getTime()) return "WAIT";
  return allowed ? "PREPARE_CAMPAIGN" : "ASK_HUMAN";
}

/**
 * Date d'ancrage + précision honnête.
 * Une naissance n'ayant que mois + année, on ancre au 1ᵉʳ du mois et on le DIT.
 */
function anchorDate(fact: LifecycleFact): { date: Date; precision: "DAY" | "MONTH" } | null {
  if (fact.kind === "SESSION_DELIVERED") {
    if (!(fact.deliveredAt instanceof Date) || Number.isNaN(fact.deliveredAt.getTime())) return null;
    return { date: fact.deliveredAt, precision: "DAY" };
  }
  const { birthMonth: m, birthYear: y } = fact;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(y) || y < 1900 || y > 2200) return null;
  return { date: new Date(Date.UTC(y, m - 1, 1)), precision: "MONTH" };
}

/**
 * Ajoute des mois sans déborder : +1 mois au 31 janvier donne le 28/29 février,
 * pas le 3 mars. Un anniversaire décalé de trois jours dans un message client
 * se remarque.
 */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      m + months,
      Math.min(d, lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}
