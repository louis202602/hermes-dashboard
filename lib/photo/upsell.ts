/**
 * HERMÈS STUDIO — UPSELL & RECOMMANDATIONS.
 *
 * La règle du brief est nette : « Elle ne doit jamais inventer un produit, un
 * prix ou une remise. » Une consigne de prompt ne suffit pas — un LLM sûr de lui
 * proposera « l'album 250 € » qui n'existe pas, et Vanessa devra l'honorer.
 *
 * La garantie est donc STRUCTURELLE : une proposition se construit à partir
 * d'une ligne du catalogue réel (`photo_service_offerings`), et une ligne sans
 * prix ferme ne produit AUCUNE proposition chiffrée. Le montant n'est pas
 * « vérifié » après coup : il n'existe pas ailleurs que dans le catalogue.
 *
 * Le moteur est DÉTERMINISTE : mêmes faits ⇒ même proposition. L'IA peut
 * détecter une opportunité ; elle ne fixe ni le produit ni le prix.
 *
 * Pur, sans I/O. Réutilise `photo_upsell_opportunities` (déjà en base) plutôt
 * que de créer une seconde table d'opportunités.
 */

// --- Catalogue -----------------------------------------------------------------

/**
 * Une offre complémentaire, telle qu'elle existe RÉELLEMENT chez le studio.
 * `priceEur` nullable à dessein : « prix sur devis » est un état légitime, et
 * c'est lui qui empêche de chiffrer.
 */
export type UpsellOffering = {
  offeringId: string;
  /** `photo_upsell_opportunities.kind` — vocabulaire déjà en base. */
  kind: string;
  label: string;
  priceEur: number | null;
  active: boolean;
  /** Le studio autorise-t-il une proposition automatique de cette offre ? */
  autoProposable: boolean;
};

/** Moments de proposition prévus par le brief. Il n'y en a pas d'autre. */
export const UPSELL_MOMENTS = ["AFTER_BOOKING", "AFTER_DELIVERY"] as const;
export type UpsellMoment = (typeof UPSELL_MOMENTS)[number];

// --- Règles configurées par le studio ------------------------------------------

/**
 * Une règle dit : « à tel moment, pour tel type de séance, propose telle offre ».
 * C'est Vanessa qui les écrit. Le moteur ne fait que les appliquer.
 */
export type UpsellRule = {
  ruleId: string;
  moment: UpsellMoment;
  /** Types de séance concernés. Vide ⇒ tous. */
  sessionTypes: string[];
  offeringId: string;
  /** Priorité d'affichage. Plus bas = proposé en premier. */
  priority: number;
  active: boolean;
};

export type UpsellContext = {
  moment: UpsellMoment;
  sessionType: string;
  /** Offres déjà proposées à ce client pour cette séance (anti-répétition). */
  alreadyProposedOfferingIds: string[];
  /** Le client s'est-il opposé aux sollicitations commerciales ? */
  optedOut: boolean;
  /** Nombre maximum de propositions simultanées. Fail-closed si absent. */
  maxProposals: number | null;
};

export type UpsellProposal = {
  offeringId: string;
  kind: string;
  label: string;
  /** `null` ⇒ « prix sur devis ». JAMAIS un montant estimé. */
  amountEur: number | null;
  /** `true` ⇒ chiffrable ; `false` ⇒ à faire chiffrer par Vanessa. */
  quotable: boolean;
  ruleId: string;
};

export const UPSELL_REFUSAL_CODES = [
  "OPTED_OUT",
  "NO_ACTIVE_RULE",
  "OFFERING_UNKNOWN",
  "OFFERING_INACTIVE",
  "NOT_AUTO_PROPOSABLE",
  "ALREADY_PROPOSED",
  "MAX_PROPOSALS_UNKNOWN",
] as const;
export type UpsellRefusalCode = (typeof UPSELL_REFUSAL_CODES)[number];

/**
 * Construit les propositions. Renvoie AUSSI les refus, avec leur motif : une
 * règle qui ne produit rien doit être diagnosticable, pas silencieuse.
 *
 * Ordre déterministe : priorité, puis identifiant d'offre. Deux exécutions sur
 * les mêmes données donnent la même liste, dans le même ordre.
 */
export function buildUpsellProposals(
  rules: readonly UpsellRule[],
  catalog: readonly UpsellOffering[],
  ctx: UpsellContext,
): { proposals: UpsellProposal[]; refusals: { ruleId: string; code: UpsellRefusalCode }[] } {
  const refusals: { ruleId: string; code: UpsellRefusalCode }[] = [];

  if (ctx.optedOut) {
    return { proposals: [], refusals: rules.map((r) => ({ ruleId: r.ruleId, code: "OPTED_OUT" })) };
  }
  if (typeof ctx.maxProposals !== "number" || !Number.isFinite(ctx.maxProposals) || ctx.maxProposals < 1) {
    // Sans plafond connu, on ne propose rien : un plafond deviné se transforme
    // vite en dix propositions d'affilée.
    return {
      proposals: [],
      refusals: rules.map((r) => ({ ruleId: r.ruleId, code: "MAX_PROPOSALS_UNKNOWN" })),
    };
  }

  const byId = new Map(catalog.map((o) => [o.offeringId, o]));
  const already = new Set(ctx.alreadyProposedOfferingIds);
  const proposals: UpsellProposal[] = [];

  const candidates = [...rules].sort(
    (a, b) => a.priority - b.priority || a.offeringId.localeCompare(b.offeringId),
  );

  for (const rule of candidates) {
    if (!rule.active || rule.moment !== ctx.moment) {
      refusals.push({ ruleId: rule.ruleId, code: "NO_ACTIVE_RULE" });
      continue;
    }
    if (rule.sessionTypes.length > 0 && !rule.sessionTypes.includes(ctx.sessionType)) {
      refusals.push({ ruleId: rule.ruleId, code: "NO_ACTIVE_RULE" });
      continue;
    }
    const offering = byId.get(rule.offeringId);
    if (!offering) {
      refusals.push({ ruleId: rule.ruleId, code: "OFFERING_UNKNOWN" });
      continue;
    }
    if (!offering.active) {
      refusals.push({ ruleId: rule.ruleId, code: "OFFERING_INACTIVE" });
      continue;
    }
    if (!offering.autoProposable) {
      refusals.push({ ruleId: rule.ruleId, code: "NOT_AUTO_PROPOSABLE" });
      continue;
    }
    if (already.has(offering.offeringId)) {
      refusals.push({ ruleId: rule.ruleId, code: "ALREADY_PROPOSED" });
      continue;
    }
    if (proposals.length >= ctx.maxProposals) break;

    const priced = typeof offering.priceEur === "number" && Number.isFinite(offering.priceEur);
    proposals.push({
      offeringId: offering.offeringId,
      kind: offering.kind,
      label: offering.label,
      // Le prix vient du catalogue OU n'existe pas. Il n'y a pas de troisième cas.
      amountEur: priced ? (offering.priceEur as number) : null,
      quotable: priced,
      ruleId: rule.ruleId,
    });
  }

  return { proposals, refusals };
}

// --- Mesure --------------------------------------------------------------------

export type UpsellCounters = {
  offered: number;
  accepted: number;
  revenueEur: number;
  /** `null` quand rien n'a été proposé : 0 % serait un taux faux. */
  conversionRate: number | null;
};

/**
 * Compte à partir des STATUTS réels de `photo_upsell_opportunities`.
 * `DETECTED` n'est pas `offered` : détecter n'est pas proposer.
 */
export function upsellCounters(
  rows: readonly { status: string; revenueGeneratedEur: number | null }[],
): UpsellCounters {
  let offered = 0;
  let accepted = 0;
  let revenueEur = 0;
  for (const r of rows) {
    if (r.status === "PROPOSED" || r.status === "ACCEPTED" || r.status === "DECLINED" || r.status === "EXPIRED") {
      offered += 1;
    }
    if (r.status === "ACCEPTED") {
      accepted += 1;
      if (typeof r.revenueGeneratedEur === "number" && Number.isFinite(r.revenueGeneratedEur)) {
        revenueEur += r.revenueGeneratedEur;
      }
    }
  }
  return {
    offered,
    accepted,
    revenueEur: Math.round(revenueEur * 100) / 100,
    conversionRate: offered > 0 ? accepted / offered : null,
  };
}

// --- Parrainage ----------------------------------------------------------------

export const REFERRAL_STATES = [
  "REFERRED",
  "LEAD_CREATED",
  "CONVERTED",
  "REWARD_DUE",
  "REWARD_GRANTED",
  "EXPIRED",
] as const;
export type ReferralState = (typeof REFERRAL_STATES)[number];

export type ReferralRewardRule = {
  /** `null` ⇒ aucune récompense configurée. On n'en invente pas. */
  amountEur: number | null;
  /** Récompense due seulement après conversion RÉELLE (lead payé). */
  requiresPaidConversion: boolean;
  active: boolean;
};

export type ReferralInput = {
  state: ReferralState;
  /** Le filleul a-t-il réellement payé ? Vérifié, pas déclaré. */
  refereePaid: boolean;
  rule: ReferralRewardRule | null;
};

export type ReferralOutcome = {
  nextState: ReferralState;
  rewardEur: number | null;
  code: "OK" | "NO_RULE" | "RULE_INACTIVE" | "NOT_CONVERTED" | "NO_REWARD_CONFIGURED" | "TERMINAL";
};

/**
 * Attribution d'une récompense de parrainage.
 *
 * L'attribution du filleul au parrain est une écriture de LIEN (toujours faite,
 * elle documente d'où vient le lead). La RÉCOMPENSE, elle, est conditionnelle :
 * sans règle configurée, elle vaut `null` — jamais un montant par défaut.
 */
export function resolveReferral(input: ReferralInput): ReferralOutcome {
  if (input.state === "REWARD_GRANTED" || input.state === "EXPIRED") {
    return { nextState: input.state, rewardEur: null, code: "TERMINAL" };
  }
  if (!input.rule) return { nextState: input.state, rewardEur: null, code: "NO_RULE" };
  if (!input.rule.active) {
    return { nextState: input.state, rewardEur: null, code: "RULE_INACTIVE" };
  }
  if (input.rule.requiresPaidConversion && !input.refereePaid) {
    return { nextState: input.state, rewardEur: null, code: "NOT_CONVERTED" };
  }
  if (typeof input.rule.amountEur !== "number" || !Number.isFinite(input.rule.amountEur)) {
    // Conversion acquise, mais aucun montant configuré : on marque la
    // récompense comme DUE et on laisse Vanessa décider. On ne chiffre pas.
    return { nextState: "REWARD_DUE", rewardEur: null, code: "NO_REWARD_CONFIGURED" };
  }
  return { nextState: "REWARD_DUE", rewardEur: input.rule.amountEur, code: "OK" };
}
