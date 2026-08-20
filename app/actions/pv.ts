"use server";

import { revalidatePath } from "next/cache";

import {
  promotePvBillExtraction,
  purgePvDocuments,
  setPvEconomicsStatus,
  setPvStudyStatus,
  softDeletePvDocument,
  uploadPvDocument,
  upsertPvEconomics,
  upsertPvStudy,
  upsertPvStudyAssumptions,
  verifyPvConsumptionProfile,
  registerPvEnergyBill,
  setPvProspectStatus,
  upsertPvConsumptionProfile,
  upsertPvProspect,
  upsertPvSite,
  validatePvStudy,
  verifyPvEconomics,
  verifyPvEnergyBill,
} from "@/services/hermes/pv";
import type { PvWriteOutcome } from "@/types/pv";

/**
 * PACK PHOTOVOLTAÏQUE — Server Actions du LOT PV-2.
 *
 * Même règle que la verticale photo : elles ne DÉCIDENT rien. Elles lisent un
 * formulaire, appellent une façade `SECURITY DEFINER`, et traduisent son code de
 * retour en une phrase honnête. Aucune n'accepte de `tenant_id` — il n'existe
 * aucun champ pour cela, sur aucun formulaire.
 *
 * Un refus n'est JAMAIS présenté comme un succès : `TRANSITION_REFUSED` et
 * `VALIDATION_REFUSED` remontent tels quels jusqu'à l'écran.
 */

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucune entreprise n’est associée à votre compte.",
  ACCESS_DENIED: "Accès refusé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION: "Plusieurs entreprises disponibles : sélection requise.",
  NOT_FOUND: "Élément introuvable.",
  MISSING_TYPE: "Le type de prospect est requis.",
  MISSING_SITE: "Le site est requis.",
  MISSING_PROSPECT: "Le prospect est requis.",
  INVALID_PROSPECT:
    "Prospect invalide : un nom (ou une raison sociale) et un contact — téléphone ou e-mail — sont obligatoires.",
  INVALID_SITE: "Site invalide : l’adresse, le code postal et la ville sont obligatoires.",
  INVALID_PROFILE: "Profil de consommation invalide.",
  INVALID_BILL: "Facture invalide.",
  INVALID_DOCUMENT: "Document invalide.",
  INVALID_REFERENCE: "Référence invalide.",
  TRANSITION_REFUSED: "Cette transition de statut n’est pas autorisée.",
  VALIDATION_REFUSED:
    "Validation refusée par la base : seul un utilisateur authentifié peut valider, et seulement en son propre nom.",
  DOCUMENT_NOT_FOUND: "Document introuvable.",
  PATH_OUT_OF_SCOPE: "Chemin de stockage refusé.",
  BAD_MIME: "Format de fichier non autorisé.",
  BAD_SIZE: "Fichier trop volumineux.",
  BAD_DOC_TYPE: "Type de document invalide.",
  DUPLICATE_OBJECT: "Ce document est déjà référencé.",
  RPC_ERROR: "Le service est indisponible. Réessayez plus tard.",
  // — PV-3 —
  UPLOAD_FAILED: "Le téléversement a échoué.",
  MISSING_FILE: "Aucun fichier sélectionné.",
  MISSING_STUDY: "L’étude est requise.",
  INVALID_STUDY: "Étude invalide : vérifiez la cohérence batterie / puissances.",
  INVALID_ASSUMPTIONS: "Hypothèses invalides.",
  INVALID_ECONOMICS: "Chiffrage invalide : les montants ne peuvent pas être négatifs.",
  DUPLICATE_VERSION: "Une étude portant cette version existe déjà pour ce site.",
  USE_VALIDATION_FACADE:
    "La validation humaine passe par le bouton dédié — pas par un changement de statut.",
  NOT_DELETED: "Ce document n’a pas été supprimé : il n’est pas purgeable.",
  ALREADY_PURGED: "Ce document a déjà été purgé.",
};

export type PvActionState = {
  phase: "idle" | "ok" | "error";
  code?: string;
  message?: string;
  id?: string;
};

export const PV_INITIAL_STATE: PvActionState = { phase: "idle" };

function toState(result: PvWriteOutcome): PvActionState {
  if (result.ok) return { phase: "ok", code: result.code, id: result.id ?? undefined };
  return {
    phase: "error",
    code: result.code,
    message: ERROR_MESSAGES[result.code] ?? "Action refusée.",
  };
}

function text(form: FormData, key: string): string | null {
  const v = String(form.get(key) ?? "").trim();
  return v.length > 0 ? v : null;
}

function decimal(form: FormData, key: string): number | null {
  const raw = text(form, key);
  if (raw === null) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Créer un prospect PV depuis le formulaire de la liste. */
export async function createPvProspectAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const result = await upsertPvProspect({
    prospectType: text(formData, "prospect_type"),
    firstName: text(formData, "first_name"),
    lastName: text(formData, "last_name"),
    companyName: text(formData, "company_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    source: text(formData, "source"),
    sourceDetail: text(formData, "source_detail"),
    contactConsent: formData.get("contact_consent") === "on",
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath("/etudes");
  return toState(result);
}

/** Modifier un prospect existant. Le statut n'est PAS modifiable ici. */
export async function updatePvProspectAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvProspect({
    prospectId,
    firstName: text(formData, "first_name"),
    lastName: text(formData, "last_name"),
    companyName: text(formData, "company_name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    contactConsent: formData.get("contact_consent") === "on" ? true : null,
    qualificationScore: decimal(formData, "qualification_score"),
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath(`/etudes/${prospectId}`);
  return toState(result);
}

/** Faire avancer un prospect dans la machine à états. */
export async function setPvProspectStatusAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  const status = text(formData, "status");
  if (prospectId === null || status === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvProspectStatus(prospectId, status);
  if (result.ok) revalidatePath(`/etudes/${prospectId}`);
  return toState(result);
}

/** Créer un site rattaché à un prospect. */
export async function createPvSiteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "MISSING_PROSPECT", message: ERROR_MESSAGES.MISSING_PROSPECT };
  }
  const result = await upsertPvSite({
    prospectId,
    label: text(formData, "label"),
    addressLine1: text(formData, "address_line1"),
    postalCode: text(formData, "postal_code"),
    city: text(formData, "city"),
    buildingType: text(formData, "building_type"),
    roofType: text(formData, "roof_type"),
    roofMaterial: text(formData, "roof_material"),
    roofCondition: text(formData, "roof_condition"),
    roofAreaTotalM2: decimal(formData, "roof_area_total_m2"),
    roofAreaUsableM2: decimal(formData, "roof_area_usable_m2"),
    azimuthDeg: decimal(formData, "azimuth_deg"),
    tiltDeg: decimal(formData, "tilt_deg"),
    shadingLevel: text(formData, "shading_level"),
    heightM: decimal(formData, "height_m"),
    accessDifficulty: text(formData, "access_difficulty"),
    technicalNotes: text(formData, "technical_notes"),
  });
  if (result.ok) revalidatePath(`/etudes/${prospectId}`);
  return toState(result);
}

/** Modifier les caractéristiques techniques d'un site. */
export async function updatePvSiteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  if (siteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvSite({
    siteId,
    label: text(formData, "label"),
    addressLine1: text(formData, "address_line1"),
    postalCode: text(formData, "postal_code"),
    city: text(formData, "city"),
    buildingType: text(formData, "building_type"),
    roofType: text(formData, "roof_type"),
    roofMaterial: text(formData, "roof_material"),
    roofCondition: text(formData, "roof_condition"),
    roofAreaTotalM2: decimal(formData, "roof_area_total_m2"),
    roofAreaUsableM2: decimal(formData, "roof_area_usable_m2"),
    azimuthDeg: decimal(formData, "azimuth_deg"),
    tiltDeg: decimal(formData, "tilt_deg"),
    shadingLevel: text(formData, "shading_level"),
    shadingLossPct: decimal(formData, "shading_loss_pct"),
    heightM: decimal(formData, "height_m"),
    accessDifficulty: text(formData, "access_difficulty"),
    technicalNotes: text(formData, "technical_notes"),
  });
  if (result.ok) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Enregistrer ou mettre à jour le profil de consommation d'un site. */
export async function savePvConsumptionAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  const profileId = text(formData, "profile_id");
  if (siteId === null && profileId === null) {
    return { phase: "error", code: "MISSING_SITE", message: ERROR_MESSAGES.MISSING_SITE };
  }
  const result = await upsertPvConsumptionProfile({
    profileId,
    siteId,
    energySupplier: text(formData, "energy_supplier"),
    subscribedPowerKva: decimal(formData, "subscribed_power_kva"),
    annualConsumptionKwh: decimal(formData, "annual_consumption_kwh"),
    annualCostEur: decimal(formData, "annual_cost_eur"),
    unitPriceEurKwh: decimal(formData, "unit_price_eur_kwh"),
    tariffOption: text(formData, "tariff_option"),
    deliveryPointRef: text(formData, "delivery_point_ref"),
    periodStart: text(formData, "period_start"),
    periodEnd: text(formData, "period_end"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Enregistrer une facture énergie (valeurs saisies par un humain). */
export async function registerPvBillAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  if (siteId === null) {
    return { phase: "error", code: "MISSING_SITE", message: ERROR_MESSAGES.MISSING_SITE };
  }
  const result = await registerPvEnergyBill({
    siteId,
    supplier: text(formData, "supplier"),
    periodStart: text(formData, "period_start"),
    periodEnd: text(formData, "period_end"),
    issuedOn: text(formData, "issued_on"),
    amountTtcEur: decimal(formData, "amount_ttc_eur"),
    consumptionKwh: decimal(formData, "consumption_kwh"),
    subscribedPowerKva: decimal(formData, "subscribed_power_kva"),
    tariffOption: text(formData, "tariff_option"),
    deliveryPointRef: text(formData, "delivery_point_ref"),
  });
  if (result.ok) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/**
 * Promouvoir une lecture IA vers sa facture. La facture passe `NEEDS_REVIEW` —
 * jamais `VERIFIED`. Promouvoir n'est pas certifier.
 */
export async function promotePvExtractionAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const extractionId = text(formData, "extraction_id");
  const siteId = text(formData, "site_id");
  if (extractionId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await promotePvBillExtraction(extractionId);
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Vérification HUMAINE d'une facture. L'acteur est `auth.uid()`, imposé en base. */
export async function verifyPvBillAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const billId = text(formData, "bill_id");
  const siteId = text(formData, "site_id");
  if (billId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await verifyPvEnergyBill(billId, {
    reject: formData.get("decision") === "reject",
    reason: text(formData, "reason"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Validation HUMAINE d'une étude. Une étude préparée par l'IA ne peut pas s'auto-valider. */
export async function validatePvStudyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const studyId = text(formData, "study_id");
  const siteId = text(formData, "site_id");
  if (studyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await validatePvStudy(studyId, {
    reject: formData.get("decision") === "reject",
    reason: text(formData, "reason"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Vérification HUMAINE d'un chiffrage économique. */
export async function verifyPvEconomicsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const economicsId = text(formData, "economics_id");
  const siteId = text(formData, "site_id");
  if (economicsId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await verifyPvEconomics(economicsId, {
    reject: formData.get("decision") === "reject",
    reason: text(formData, "reason"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

// --- PV-3 : documents ---------------------------------------------------------

/**
 * Téléverser un document PV. Les octets passent par le SERVEUR — le navigateur
 * ne choisit ni le tenant, ni le bucket, ni le chemin final. Le chemin est
 * attribué par la base et revalidé à la finalisation.
 */
export async function uploadPvDocumentAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  const docType = text(formData, "doc_type");
  const file = formData.get("file");

  if (siteId === null) {
    return { phase: "error", code: "MISSING_SITE", message: ERROR_MESSAGES.MISSING_SITE };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { phase: "error", code: "MISSING_FILE", message: ERROR_MESSAGES.MISSING_FILE };
  }

  const result = await uploadPvDocument({
    siteId,
    docType: docType ?? "AUTRE",
    filename: file.name,
    mimeType: file.type,
    bytes: await file.arrayBuffer(),
  });
  if (result.ok) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Suppression LOGIQUE d'un document. Les octets restent jusqu'à la purge. */
export async function deletePvDocumentAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const documentId = text(formData, "document_id");
  const siteId = text(formData, "site_id");
  if (documentId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await softDeletePvDocument(documentId);
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/**
 * PURGE des octets des documents supprimés logiquement. Geste APPELABLE, jamais
 * automatique : aucun worker, aucun scheduler. Idempotente.
 */
export async function purgePvDocumentsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  const report = await purgePvDocuments();
  if (siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return {
    phase: report.failed > 0 ? "error" : "ok",
    code: "PURGE",
    message:
      report.failed > 0
        ? `${report.purged} purgé(s), ${report.failed} en échec sur ${report.examined} examiné(s).`
        : `${report.purged} document(s) purgé(s) sur ${report.examined} examiné(s).`,
  };
}

// --- PV-3 : validations et travail manuel -------------------------------------

/** Vérification HUMAINE d'un profil de consommation. */
export async function verifyPvConsumptionAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const profileId = text(formData, "profile_id");
  const siteId = text(formData, "site_id");
  if (profileId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await verifyPvConsumptionProfile(profileId, {
    reject: formData.get("decision") === "reject",
    reason: text(formData, "reason"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Créer une étude À LA MAIN. Elle naît en DRAFT — jamais autrement. */
export async function createPvStudyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  if (siteId === null) {
    return { phase: "error", code: "MISSING_SITE", message: ERROR_MESSAGES.MISSING_SITE };
  }
  const result = await upsertPvStudy({
    siteId,
    targetPowerKwc: decimal(formData, "target_power_kwc"),
    panelCount: decimal(formData, "panel_count"),
    panelUnitPowerW: decimal(formData, "panel_unit_power_w"),
    panelBrand: text(formData, "panel_brand"),
    panelReference: text(formData, "panel_reference"),
    inverterType: text(formData, "inverter_type"),
    inverterBrand: text(formData, "inverter_brand"),
    inverterReference: text(formData, "inverter_reference"),
    microinverterCount: decimal(formData, "microinverter_count"),
    hasBattery: formData.get("has_battery") === "on",
    batteryCapacityKwh: decimal(formData, "battery_capacity_kwh"),
    batteryPowerKw: decimal(formData, "battery_power_kw"),
    annualProductionKwh: decimal(formData, "annual_production_kwh"),
    specificYieldKwhKwc: decimal(formData, "specific_yield_kwh_kwc"),
    selfConsumptionRatePct: decimal(formData, "self_consumption_rate_pct"),
    selfProductionRatePct: decimal(formData, "self_production_rate_pct"),
    surplusKwh: decimal(formData, "surplus_kwh"),
    systemLossesPct: decimal(formData, "system_losses_pct"),
    calculationMethod: text(formData, "calculation_method"),
    source: text(formData, "source"),
    sourceReference: text(formData, "source_reference"),
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Modifier une étude existante. Le statut n'est PAS touché ici. */
export async function updatePvStudyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const studyId = text(formData, "study_id");
  const siteId = text(formData, "site_id");
  if (studyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvStudy({
    studyId,
    targetPowerKwc: decimal(formData, "target_power_kwc"),
    panelCount: decimal(formData, "panel_count"),
    panelUnitPowerW: decimal(formData, "panel_unit_power_w"),
    panelBrand: text(formData, "panel_brand"),
    inverterType: text(formData, "inverter_type"),
    inverterBrand: text(formData, "inverter_brand"),
    hasBattery: formData.get("has_battery") === "on",
    batteryCapacityKwh: decimal(formData, "battery_capacity_kwh"),
    batteryPowerKw: decimal(formData, "battery_power_kw"),
    annualProductionKwh: decimal(formData, "annual_production_kwh"),
    specificYieldKwhKwc: decimal(formData, "specific_yield_kwh_kwc"),
    selfConsumptionRatePct: decimal(formData, "self_consumption_rate_pct"),
    selfProductionRatePct: decimal(formData, "self_production_rate_pct"),
    surplusKwh: decimal(formData, "surplus_kwh"),
    systemLossesPct: decimal(formData, "system_losses_pct"),
    calculationMethod: text(formData, "calculation_method"),
    source: text(formData, "source"),
    notes: text(formData, "notes"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Enregistrer les hypothèses d'une étude — colonnes typées, pas un blob. */
export async function savePvAssumptionsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const studyId = text(formData, "study_id");
  const siteId = text(formData, "site_id");
  if (studyId === null) {
    return { phase: "error", code: "MISSING_STUDY", message: ERROR_MESSAGES.MISSING_STUDY };
  }
  const result = await upsertPvStudyAssumptions({
    studyId,
    energyPriceEurKwh: decimal(formData, "energy_price_eur_kwh"),
    energyPriceInflationPct: decimal(formData, "energy_price_inflation_pct"),
    analysisHorizonYears: decimal(formData, "analysis_horizon_years"),
    discountRatePct: decimal(formData, "discount_rate_pct"),
    panelDegradationPctYear: decimal(formData, "panel_degradation_pct_year"),
    systemLossesPct: decimal(formData, "system_losses_pct"),
    surplusSalePriceEurKwh: decimal(formData, "surplus_sale_price_eur_kwh"),
    subsidyTotalEur: decimal(formData, "subsidy_total_eur"),
    subsidyScheme: text(formData, "subsidy_scheme"),
    vatRatePct: decimal(formData, "vat_rate_pct"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Avancer le statut d'une étude, via la machine à états. Jamais VALIDATED. */
export async function setPvStudyStatusAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const studyId = text(formData, "study_id");
  const siteId = text(formData, "site_id");
  const status = text(formData, "status");
  if (studyId === null || status === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvStudyStatus(studyId, status);
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Créer un chiffrage À LA MAIN. Il naît en DRAFT. */
export async function createPvEconomicsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const studyId = text(formData, "study_id");
  const siteId = text(formData, "site_id");
  if (studyId === null) {
    return { phase: "error", code: "MISSING_STUDY", message: ERROR_MESSAGES.MISSING_STUDY };
  }
  const result = await upsertPvEconomics({
    studyId,
    investmentHtEur: decimal(formData, "investment_ht_eur"),
    investmentTtcEur: decimal(formData, "investment_ttc_eur"),
    subsidyTotalEur: decimal(formData, "subsidy_total_eur"),
    netCostEur: decimal(formData, "net_cost_eur"),
    year1SavingsEur: decimal(formData, "year1_savings_eur"),
    surplusRevenueEur: decimal(formData, "surplus_revenue_eur"),
    annualGainEur: decimal(formData, "annual_gain_eur"),
    simpleRoiPct: decimal(formData, "simple_roi_pct"),
    paybackYears: decimal(formData, "payback_years"),
    npvEur: decimal(formData, "npv_eur"),
    irrPct: decimal(formData, "irr_pct"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Modifier un chiffrage existant. */
export async function updatePvEconomicsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const economicsId = text(formData, "economics_id");
  const siteId = text(formData, "site_id");
  if (economicsId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvEconomics({
    economicsId,
    investmentHtEur: decimal(formData, "investment_ht_eur"),
    investmentTtcEur: decimal(formData, "investment_ttc_eur"),
    subsidyTotalEur: decimal(formData, "subsidy_total_eur"),
    netCostEur: decimal(formData, "net_cost_eur"),
    year1SavingsEur: decimal(formData, "year1_savings_eur"),
    surplusRevenueEur: decimal(formData, "surplus_revenue_eur"),
    annualGainEur: decimal(formData, "annual_gain_eur"),
    simpleRoiPct: decimal(formData, "simple_roi_pct"),
    paybackYears: decimal(formData, "payback_years"),
    npvEur: decimal(formData, "npv_eur"),
    irrPct: decimal(formData, "irr_pct"),
  });
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}

/** Avancer le statut d'un chiffrage. Jamais VERIFIED. */
export async function setPvEconomicsStatusAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const economicsId = text(formData, "economics_id");
  const siteId = text(formData, "site_id");
  const status = text(formData, "status");
  if (economicsId === null || status === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvEconomicsStatus(economicsId, status);
  if (result.ok && siteId) revalidatePath(`/etudes/sites/${siteId}`);
  return toState(result);
}
