/**
 * PACK PHOTOVOLTAÏQUE — état de préparation d'une affaire (LOT PV-4).
 *
 * Module PUR : aucune I/O, aucun réseau, aucune IA, aucun `Date.now()`. Les
 * mêmes entrées donnent toujours la même sortie — c'est ce qui rend cet état
 * opposable. Un commercial doit pouvoir dire « le dossier n'est pas prêt PARCE
 * QUE » et non « Hermès dit que ce n'est pas prêt ».
 *
 * D'où le second retour, aussi important que l'état lui-même : la liste des
 * exigences manquantes. Un code opaque ne fait avancer personne.
 *
 * RÈGLE CENTRALE, non négociable : `READY_FOR_OFFER` exige une étude
 * `VALIDATED` **et** un chiffrage `VERIFIED`. Une étude `CALCULATED`, même
 * fraîche et même seule, ne suffit pas ; un chiffrage `NEEDS_REVIEW` non plus.
 * C'est exactement la distinction que PV-1 a rendue structurelle en base — la
 * défaire ici la rendrait cosmétique.
 */

export const PV_DEAL_STATES = [
  "BLOCKED",
  "INCOMPLETE",
  "READY_FOR_STUDY",
  "STUDY_REVIEW_REQUIRED",
  "READY_FOR_OFFER",
] as const;
export type PvDealState = (typeof PV_DEAL_STATES)[number];

/** Codes d'exigence manquante. Stables : ils sont affichés et traduits. */
export const PV_REQUIREMENTS = [
  "PROSPECT_OPTED_OUT",
  "PROSPECT_CLOSED",
  "NO_SITE",
  "SITE_ADDRESS_INCOMPLETE",
  "SITE_TECHNICAL_INCOMPLETE",
  "NO_ENERGY_DATA",
  "ENERGY_NOT_VERIFIED",
  "NO_STUDY",
  "STUDY_NOT_VALIDATED",
  "NO_ECONOMICS",
  "ECONOMICS_NOT_VERIFIED",
] as const;
export type PvRequirement = (typeof PV_REQUIREMENTS)[number];

export type PvReadinessInput = {
  prospect: { status: string; optedOut: boolean } | null;
  site: {
    addressLine1: string | null;
    postalCode: string | null;
    city: string | null;
    roofAreaUsableM2: number | null;
    azimuthDeg: number | null;
    tiltDeg: number | null;
  } | null;
  consumption: {
    annualConsumptionKwh: number | null;
    verificationStatus: string;
  } | null;
  /** Facture RETENUE (déjà filtrée sur VERIFIED côté façade), ou `null`. */
  verifiedBill: { consumptionKwh: number | null } | null;
  /** Étude RETENUE — VALIDATED uniquement. `null` si aucune ne l'est. */
  retainedStudy: { status: string } | null;
  /** Étude la plus récente, quel que soit son statut. Sert au diagnostic. */
  latestStudy: { status: string } | null;
  /** Chiffrage RETENU — VERIFIED uniquement, lié à l'étude retenue. */
  retainedEconomics: { status: string } | null;
  /** Existe-t-il au moins un chiffrage sur l'étude retenue ? */
  hasAnyEconomics: boolean;
};

export type PvReadiness = {
  state: PvDealState;
  missingRequirements: PvRequirement[];
  /** `true` quand une synthèse FINALE peut être produite. */
  canGenerateFinalPdf: boolean;
};

/** Statuts commerciaux qui ferment un dossier. Aucune étude ne les rouvre. */
const CLOSED_STATUSES = new Set(["LOST", "ARCHIVED", "UNQUALIFIED"]);

/** Statuts d'étude qui attendent explicitement un geste humain. */
const STUDY_AWAITING_HUMAN = new Set(["CALCULATED", "NEEDS_REVIEW"]);

function isPositive(n: number | null | undefined): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isPresent(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * L'état d'une affaire, et POURQUOI elle n'est pas plus avancée.
 *
 * Ordre de priorité : `BLOCKED` prime sur tout — un prospect perdu ou désinscrit
 * n'a pas d'état d'avancement, il a un état d'arrêt. Ensuite le plus haut niveau
 * réellement atteint.
 *
 * `missingRequirements` est TOUJOURS renseignée quand l'état n'est pas
 * `READY_FOR_OFFER` : elle liste ce qui manque pour monter, dans l'ordre où on
 * le traite réellement (site, énergie, étude, chiffrage).
 */
export function resolvePvReadiness(input: PvReadinessInput): PvReadiness {
  const missing: PvRequirement[] = [];

  // --- Arrêt commercial : rien d'autre ne compte -----------------------------
  if (input.prospect === null) {
    return { state: "INCOMPLETE", missingRequirements: ["NO_SITE"], canGenerateFinalPdf: false };
  }
  if (input.prospect.optedOut) {
    return {
      state: "BLOCKED",
      missingRequirements: ["PROSPECT_OPTED_OUT"],
      canGenerateFinalPdf: false,
    };
  }
  if (CLOSED_STATUSES.has(input.prospect.status)) {
    return {
      state: "BLOCKED",
      missingRequirements: ["PROSPECT_CLOSED"],
      canGenerateFinalPdf: false,
    };
  }

  // --- Site ------------------------------------------------------------------
  const site = input.site;
  if (site === null) {
    missing.push("NO_SITE");
  } else {
    if (!isPresent(site.addressLine1) || !isPresent(site.postalCode) || !isPresent(site.city)) {
      missing.push("SITE_ADDRESS_INCOMPLETE");
    }
    // Minimum TECHNIQUE d'une étude : surface exploitable, azimut, inclinaison.
    // Sans ces trois-là, aucun productible ne peut être établi — ni par un
    // humain, ni par un moteur. L'azimut peut valoir 0 (plein nord) : on teste
    // la PRÉSENCE, pas la vérité.
    const azimuthOk = site.azimuthDeg !== null && Number.isFinite(site.azimuthDeg);
    const tiltOk = site.tiltDeg !== null && Number.isFinite(site.tiltDeg);
    if (!isPositive(site.roofAreaUsableM2) || !azimuthOk || !tiltOk) {
      missing.push("SITE_TECHNICAL_INCOMPLETE");
    }
  }

  // --- Énergie ---------------------------------------------------------------
  // Deux chemins légitimes, un seul suffit : un profil de consommation VÉRIFIÉ,
  // ou une facture VÉRIFIÉE. Une consommation saisie mais non vérifiée n'est pas
  // qualifiée — c'est une déclaration, pas une donnée retenue.
  const consumptionQualified =
    input.consumption !== null &&
    isPositive(input.consumption.annualConsumptionKwh) &&
    input.consumption.verificationStatus === "VERIFIED";
  const billQualified =
    input.verifiedBill !== null && isPositive(input.verifiedBill.consumptionKwh);

  if (!consumptionQualified && !billQualified) {
    const hasAnyEnergy =
      (input.consumption !== null && isPositive(input.consumption.annualConsumptionKwh)) ||
      input.verifiedBill !== null;
    missing.push(hasAnyEnergy ? "ENERGY_NOT_VERIFIED" : "NO_ENERGY_DATA");
  }

  // --- Étude -----------------------------------------------------------------
  const studyValidated = input.retainedStudy !== null && input.retainedStudy.status === "VALIDATED";
  if (!studyValidated) {
    missing.push(input.latestStudy === null ? "NO_STUDY" : "STUDY_NOT_VALIDATED");
  }

  // --- Chiffrage -------------------------------------------------------------
  const economicsVerified =
    input.retainedEconomics !== null && input.retainedEconomics.status === "VERIFIED";
  if (!economicsVerified) {
    missing.push(input.hasAnyEconomics ? "ECONOMICS_NOT_VERIFIED" : "NO_ECONOMICS");
  }

  // --- État ------------------------------------------------------------------
  if (missing.length === 0) {
    return { state: "READY_FOR_OFFER", missingRequirements: [], canGenerateFinalPdf: true };
  }

  const siteReady =
    !missing.includes("NO_SITE") &&
    !missing.includes("SITE_ADDRESS_INCOMPLETE") &&
    !missing.includes("SITE_TECHNICAL_INCOMPLETE");
  const energyReady =
    !missing.includes("NO_ENERGY_DATA") && !missing.includes("ENERGY_NOT_VERIFIED");

  // Une étude qui attend un humain prime sur « prêt à étudier » : le geste
  // suivant n'est pas de préparer une étude, c'est de trancher celle qui existe.
  if (input.latestStudy !== null && STUDY_AWAITING_HUMAN.has(input.latestStudy.status)) {
    return { state: "STUDY_REVIEW_REQUIRED", missingRequirements: missing, canGenerateFinalPdf: false };
  }
  if (siteReady && energyReady) {
    return { state: "READY_FOR_STUDY", missingRequirements: missing, canGenerateFinalPdf: false };
  }
  return { state: "INCOMPLETE", missingRequirements: missing, canGenerateFinalPdf: false };
}

/** Libellés français des états. Le vocabulaire d'écran, en un seul endroit. */
export const PV_DEAL_STATE_LABELS: Record<PvDealState, string> = {
  BLOCKED: "Dossier arrêté",
  INCOMPLETE: "Dossier incomplet",
  READY_FOR_STUDY: "Prêt pour l’étude",
  STUDY_REVIEW_REQUIRED: "Étude à trancher",
  READY_FOR_OFFER: "Prêt pour la proposition",
};

/** Libellés des exigences manquantes — actionnables, pas descriptifs. */
export const PV_REQUIREMENT_LABELS: Record<PvRequirement, string> = {
  PROSPECT_OPTED_OUT: "Le prospect s’est désinscrit : aucune démarche possible.",
  PROSPECT_CLOSED: "Le dossier est perdu, non qualifié ou archivé.",
  NO_SITE: "Aucun site d’implantation n’est rattaché au prospect.",
  SITE_ADDRESS_INCOMPLETE: "L’adresse du site est incomplète (adresse, code postal, ville).",
  SITE_TECHNICAL_INCOMPLETE:
    "Le relevé technique est incomplet : surface exploitable, azimut et inclinaison sont requis.",
  NO_ENERGY_DATA: "Aucune consommation ni facture d’énergie n’est enregistrée.",
  ENERGY_NOT_VERIFIED:
    "La consommation existe mais n’est pas vérifiée : elle ne peut pas fonder un chiffrage.",
  NO_STUDY: "Aucune étude n’a été créée pour ce site.",
  STUDY_NOT_VALIDATED: "Aucune étude n’est validée par un humain.",
  NO_ECONOMICS: "Aucun chiffrage économique n’est rattaché à l’étude retenue.",
  ECONOMICS_NOT_VERIFIED: "Le chiffrage n’est pas vérifié par un humain.",
};
