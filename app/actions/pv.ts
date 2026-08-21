"use server";

import { revalidatePath } from "next/cache";

import { randomUUID } from "node:crypto";

import {
  acceptPvQuote,
  addPvMaterialRequirement,
  applyPvSurveyMeasurement,
  cancelPvPurchaseOrder,
  confirmPvMaterialRequirement,
  createPvPurchaseOrder,
  deletePvPurchaseOrderLine,
  derivePvMaterialRequirements,
  dismissPvMaterialRequirement,
  markPvPurchaseOrderOrdered,
  recordPvPurchaseReceipt,
  setPvMaterialActive,
  setPvPurchaseOrderReady,
  upsertPvMaterial,
  upsertPvPurchaseOrderLine,
  upsertPvSupplier,
  upsertPvSupplierPrice,
  cancelPvQuote,
  createPvQuote,
  deletePvQuoteLine,
  expirePvQuotes,
  generatePvQuotePdf,
  generatePvStudySummary,
  generatePvSurveyReport,
  promotePvBillExtraction,
  purgePvDocuments,
  setPvEconomicsStatus,
  setPvStudyStatus,
  softDeletePvDocument,
  uploadPvDocument,
  upsertPvEconomics,
  upsertPvStudy,
  planPvSiteSurvey,
  refusePvQuote,
  resolvePvSurveyFinding,
  revisePvQuote,
  sendPvQuote,
  setPvQuoteReady,
  setPvSurveyStatus,
  updatePvQuote,
  upsertPvQuoteLine,
  upsertPvSurveyContext,
  upsertPvSurveyElectrical,
  upsertPvSurveyRoof,
  upsertPvStudyAssumptions,
  verifyPvConsumptionProfile,
  registerPvEnergyBill,
  setPvProspectStatus,
  upsertPvConsumptionProfile,
  upsertPvProspect,
  upsertPvSite,
  validatePvStudy,
  verifyPvEconomics,
  validatePvSiteSurvey,
  verifyPvEnergyBill,
} from "@/services/hermes/pv";
import { PV_QUOTE_BLOCKER_LABELS } from "@/lib/pv/quoteLabels";
import { PV_SURVEY_FINDING_LABELS } from "@/lib/pv/surveyLabels";
import { PV_PURCHASE_BLOCKER_LABELS } from "@/lib/pv/materialLabels";
import type {
  PvMaterialOutcome,
  PvQuoteOutcome,
  PvSurveyOutcome,
  PvWriteOutcome,
} from "@/types/pv";

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
  // — PV-4 —
  NOT_ADMIN:
    "Seul un administrateur du tenant peut purger définitivement des documents. Demandez à un administrateur.",
  GRACE_PERIOD:
    "Ce document est encore dans son délai de grâce de 7 jours : il n’est pas purgeable.",
  CONFIRMATION_REQUIRED:
    "Confirmation requise : cochez la case avant de purger définitivement.",
  PDF_FINAL_NOT_READY:
    "Synthèse définitive impossible : l’étude doit être validée et le chiffrage vérifié.",
  NO_STUDY: "Aucune étude n’est rattachée à ce dossier.",
  BAD_REQUEST_ID: "Demande de génération invalide.",
  BAD_STAGE: "Stade de document invalide.",
  BAD_HASH: "Empreinte du document invalide.",
  ECONOMICS_NOT_FOUND: "Le chiffrage indiqué n’appartient pas à cette étude.",
  QUOTE_NOT_READY:
    "Ce dossier n’est pas prêt pour un devis. Les éléments manquants sont listés ci-dessous.",
  QUOTE_LOCKED:
    "Ce devis a été transmis : son contenu est figé. Créez une nouvelle version pour le modifier.",
  QUOTE_ACCEPTED_IMMUTABLE:
    "Ce devis a été accepté. Il ne peut plus être révisé.",
  ALREADY_SUPERSEDED: "Ce devis a déjà été remplacé par une version plus récente.",
  QUOTE_PDF_NOT_READY:
    "Le PDF définitif est refusé : le devis n’est pas complet ou n’est pas encore préparé.",
  BAD_QUANTITY: "La quantité doit être strictement positive.",
  BAD_PRICE: "Le prix unitaire ne peut pas être négatif.",
  BAD_DISCOUNT: "La remise doit être comprise entre 0 et 100 %.",
  BAD_STATUS: "Cette action n’est pas possible dans l’état actuel du devis.",
  INVALID_LINE: "Ligne refusée : une valeur est hors des bornes autorisées.",
  LINE_NOT_FOUND: "Cette ligne n’existe plus.",
  // — PV-6 —
  SITE_SURVEY_REQUIRED:
    "Aucune visite technique validée : un devis contractuel ne peut pas reposer sur des données de toiture jamais vérifiées sur site.",
  SITE_SURVEY_BLOCKING:
    "La visite technique a constaté un blocage sur site. La pose est impossible en l’état.",
  SITE_SURVEY_NOT_VALIDATED:
    "Une visite technique existe mais n’est pas validée : validez-la avant d’émettre un devis.",
  SURVEY_LOCKED:
    "Cette visite est validée ou annulée : son relevé est figé. Planifiez une nouvelle visite.",
  SURVEY_NOT_READY: "Cette visite n’est pas assez avancée pour cette action.",
  BLOCKING_FINDINGS_UNRESOLVED:
    "Des écarts bloquants ne sont pas résolus : une visite ne peut pas être validée en les ignorant.",
  NO_MEASUREMENT: "Aucune mesure n’a été relevée pour ce champ.",
  UNKNOWN_FIELD: "Ce champ ne peut pas être appliqué au site.",
  INVALID_MEASUREMENT: "Mesure refusée : une valeur est hors des bornes autorisées.",
  BAD_RESOLUTION: "Cette résolution n’existe pas.",
  // — PV-7 —
  INVALID_MATERIAL: "Article invalide : catégorie, référence interne et désignation sont obligatoires.",
  DUPLICATE_SKU: "Cette référence interne existe déjà dans votre catalogue.",
  INVALID_SUPPLIER: "Fournisseur invalide : la raison sociale est obligatoire.",
  DUPLICATE_SUPPLIER: "Un fournisseur porte déjà ce nom.",
  SUPPLIER_NOT_FOUND: "Ce fournisseur n’existe pas.",
  INVALID_PRICE: "Prix invalide : un tarif fournisseur ne peut pas être négatif.",
  INVALID_REQUIREMENT:
    "Besoin invalide : indiquez SOIT un article du catalogue, SOIT une désignation libre — pas les deux.",
  REASON_REQUIRED: "Un motif est obligatoire.",
  ORDER_LOCKED:
    "Cette commande a été passée : son contenu commercial est figé. Créez une nouvelle commande.",
  ORDER_NOT_READY:
    "Cette commande ne peut pas être engagée. Les raisons sont listées ci-dessous.",
  ORDER_NOT_ORDERED:
    "On ne réceptionne que ce qui a été commandé : marquez d’abord la commande comme passée.",
  OVER_RECEIPT:
    "Réception refusée : le cumul dépasserait la quantité commandée. Corrigez la commande avant de réceptionner davantage.",
  INVALID_RECEIPT: "Réception refusée : une valeur est hors des bornes autorisées.",
  NO_SITE: "Aucun site n’est rattaché à cette affaire.",
  // `LINE_NOT_FOUND` existe déjà (PV-5) et dit la même chose ici : on ne le
  // redouble pas — deux messages pour un code finiraient par diverger.
  // `VALIDATION_REFUSED` et `USE_VALIDATION_FACADE` existent déjà plus haut
  // (PV-2/PV-3) et disent exactement la même chose pour la visite : on ne les
  // redouble pas — deux messages pour un code finiraient par diverger.
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

// --- PV-4 : purge confirmée ---------------------------------------------------

/**
 * Purge DÉFINITIVE — le seul geste irréversible du Pack PV.
 *
 * Deux verrous indépendants, et c'est délibéré :
 *   1. l'écran EXIGE une confirmation explicite (case à cocher) — protection
 *      contre l'erreur humaine ;
 *   2. la BASE exige la permission `tenant.admin` — protection contre le
 *      contournement. Sauter l'écran ne permet à personne de purger.
 *
 * Le premier sans le second serait décoratif ; le second sans le premier
 * laisserait un administrateur détruire des fichiers d'un clic.
 */
export async function purgePvDocumentsConfirmedAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const siteId = text(formData, "site_id");
  if (formData.get("confirm") !== "PURGER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: ERROR_MESSAGES.CONFIRMATION_REQUIRED,
    };
  }

  const report = await purgePvDocuments();
  if (siteId) revalidatePath(`/etudes/sites/${siteId}`);

  if (report.code !== "OK") {
    return {
      phase: "error",
      code: report.code,
      message: ERROR_MESSAGES[report.code] ?? "Purge refusée.",
    };
  }
  return {
    phase: report.failed > 0 ? "error" : "ok",
    code: "PURGE",
    message:
      report.failed > 0
        ? `${report.purged} purgé(s), ${report.failed} en échec sur ${report.examined} examiné(s).`
        : `${report.purged} document(s) purgé(s) définitivement sur ${report.examined} examiné(s).`,
  };
}

// --- PV-4 : synthèse d'étude PDF ----------------------------------------------

/**
 * Génère la synthèse d'étude. Le stade est décidé par le SERVEUR à partir de
 * l'état réel du dossier : un FINAL demandé sur un dossier qui ne l'est pas est
 * refusé, avec le motif précis.
 *
 * `request_id` porte l'idempotence. Le formulaire en fournit un ; s'il est
 * absent, on en fabrique un — mais alors chaque envoi produit un document, ce
 * qui est le comportement attendu d'une génération explicitement répétée.
 */
export async function generatePvStudySummaryAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }

  const result = await generatePvStudySummary({
    prospectId,
    requestId: text(formData, "request_id") ?? randomUUID(),
    wantFinal: formData.get("stage") === "FINAL",
    company: text(formData, "company") ?? "Hermès OS",
    generatedOn: new Date().toISOString().slice(0, 10),
  });

  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  if (!result.ok) {
    const base = ERROR_MESSAGES[result.code] ?? "Génération refusée.";
    return {
      phase: "error",
      code: result.code,
      message: result.reason ? `${base} (${result.reason})` : base,
    };
  }
  return {
    phase: "ok",
    code: result.code,
    id: result.documentId ?? undefined,
    message:
      result.code === "ALREADY_GENERATED"
        ? "Cette synthèse avait déjà été générée : le document existant est réutilisé."
        : `Synthèse ${result.stage === "FINAL" ? "définitive" : "brouillon"} générée.`,
  };
}

// --- PV-5 : le devis ----------------------------------------------------------


/** Traduit un refus de devis en message + liste de raisons lisibles. */
function quoteState(result: PvQuoteOutcome, successMessage: string): PvActionState {
  if (result.ok) {
    return {
      phase: "ok",
      code: result.code,
      id: result.quoteId ?? undefined,
      message: successMessage,
    };
  }
  const base = ERROR_MESSAGES[result.code] ?? "Action refusée.";
  const reasons = result.missingRequirements
    .map((r) => PV_QUOTE_BLOCKER_LABELS[r] ?? r)
    .join(" · ");
  return {
    phase: "error",
    code: result.code,
    message: reasons.length > 0 ? `${base} ${reasons}.` : base,
  };
}

export async function createPvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await createPvQuote(prospectId);
  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  return quoteState(
    result,
    result.quoteNumber === null
      ? "Devis créé."
      : `Devis ${result.quoteNumber} créé en brouillon.`,
  );
}

export async function upsertPvQuoteLineAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const designation = text(formData, "designation");
  if (designation === null) {
    return { phase: "error", code: "INVALID_LINE", message: "La désignation est obligatoire." };
  }
  // Le TOTAL n'est pas lu : il est calculé en base. Aucun champ ne le porte.
  const result = await upsertPvQuoteLine({
    lineId: text(formData, "line_id"),
    quoteId,
    category: text(formData, "category") ?? "AUTRE",
    designation,
    quantity: decimal(formData, "quantity") ?? 0,
    unit: text(formData, "unit") ?? "U",
    unitPriceHtEur: decimal(formData, "unit_price_ht_eur") ?? 0,
    vatRatePct: decimal(formData, "vat_rate_pct") ?? 20,
    discountPct: decimal(formData, "discount_pct") ?? 0,
    description: text(formData, "description"),
  });
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return result.ok
    ? { phase: "ok", code: result.code, id: result.id ?? undefined, message: "Ligne enregistrée." }
    : { phase: "error", code: result.code, message: ERROR_MESSAGES[result.code] ?? "Ligne refusée." };
}

export async function deletePvQuoteLineAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const lineId = text(formData, "line_id");
  const quoteId = text(formData, "quote_id");
  if (lineId === null) {
    return { phase: "error", code: "LINE_NOT_FOUND", message: ERROR_MESSAGES.LINE_NOT_FOUND };
  }
  const result = await deletePvQuoteLine(lineId);
  if (result.ok && quoteId !== null) revalidatePath(`/etudes/devis/${quoteId}`);
  return result.ok
    ? { phase: "ok", code: result.code, message: "Ligne retirée du devis." }
    : { phase: "error", code: result.code, message: ERROR_MESSAGES[result.code] ?? "Suppression refusée." };
}

export async function updatePvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await updatePvQuote({
    quoteId,
    discountPct: decimal(formData, "discount_pct"),
    validUntil: text(formData, "valid_until"),
    observations: text(formData, "observations"),
    terms: text(formData, "terms"),
  });
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return result.ok
    ? { phase: "ok", code: result.code, message: "Devis enregistré." }
    : { phase: "error", code: result.code, message: ERROR_MESSAGES[result.code] ?? "Enregistrement refusé." };
}

export async function setPvQuoteReadyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvQuoteReady(quoteId);
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return quoteState(result, "Devis prêt à être transmis.");
}

/**
 * « Marquer comme envoyé ». Le message le dit explicitement : PV-5 n'expédie
 * aucun courriel. Laisser croire le contraire serait la pire des approximations
 * sur un document contractuel.
 */
export async function sendPvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await sendPvQuote(quoteId, text(formData, "issued_on"));
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return quoteState(
    result,
    "Devis marqué comme transmis. Hermès n’a envoyé aucun message : l’envoi reste à votre charge.",
  );
}

export async function acceptPvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  // Confirmation explicite : enregistrer une acceptation engage l'entreprise.
  if (formData.get("confirm") !== "ACCEPTER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise : cochez la case avant d’enregistrer l’acceptation.",
    };
  }
  const result = await acceptPvQuote({
    quoteId,
    acceptedOn: text(formData, "accepted_on"),
    reference: text(formData, "reference"),
  });
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return quoteState(result, "Acceptation enregistrée. Le prospect passe en « offre acceptée ».");
}

export async function refusePvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await refusePvQuote(quoteId, text(formData, "reason"));
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return quoteState(result, "Refus enregistré.");
}

export async function cancelPvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await cancelPvQuote(quoteId);
  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  return quoteState(result, "Devis annulé.");
}

export async function revisePvQuoteAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await revisePvQuote(quoteId);
  if (result.ok) {
    revalidatePath(`/etudes/devis/${quoteId}`);
    if (result.quoteId !== null) revalidatePath(`/etudes/devis/${result.quoteId}`);
  }
  return quoteState(
    result,
    result.version === null
      ? "Nouvelle version créée."
      : `Version ${result.version} créée en brouillon. La version précédente reste intacte.`,
  );
}

/**
 * Applique la péremption. AUCUN cron, AUCUN scheduler : n8n est hors périmètre.
 * Confirmation explicite exigée — faire basculer des offres transmises en
 * « périmé » change leur état commercial, ce n'est pas une lecture.
 */
export async function expirePvQuotesAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  if (formData.get("confirm") !== "EXPIRER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise : cochez la case avant d’appliquer la péremption.",
    };
  }
  const result = await expirePvQuotes();
  if (!result.ok) {
    return {
      phase: "error",
      code: result.code,
      message: ERROR_MESSAGES[result.code] ?? "Traitement refusé.",
    };
  }
  return {
    phase: "ok",
    code: result.code,
    message:
      result.expired === 0
        ? "Aucun devis n’était périmé."
        : `${result.expired} devis passé(s) en « périmé ».`,
  };
}

export async function generatePvQuotePdfAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const quoteId = text(formData, "quote_id");
  if (quoteId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await generatePvQuotePdf({
    quoteId,
    requestId: text(formData, "request_id") ?? randomUUID(),
    wantFinal: formData.get("stage") === "FINAL",
    company: text(formData, "company") ?? "Hermès OS",
    generatedOn: new Date().toISOString().slice(0, 10),
  });

  if (result.ok) revalidatePath(`/etudes/devis/${quoteId}`);
  if (!result.ok) {
    const base = ERROR_MESSAGES[result.code] ?? "Génération refusée.";
    const reason =
      result.reason === null ? null : PV_QUOTE_BLOCKER_LABELS[result.reason] ?? result.reason;
    return { phase: "error", code: result.code, message: reason ? `${base} (${reason})` : base };
  }
  return {
    phase: "ok",
    code: result.code,
    id: result.documentId ?? undefined,
    message:
      result.code === "ALREADY_GENERATED"
        ? "Ce PDF avait déjà été généré : le document existant est réutilisé."
        : `PDF ${result.stage === "FINAL" ? "définitif" : "brouillon"} généré.`,
  };
}

// --- PV-6 : la visite technique -----------------------------------------------

/** Traduit un refus de visite en message + raisons lisibles. */
function surveyState(result: PvSurveyOutcome, successMessage: string): PvActionState {
  if (result.ok) {
    return {
      phase: "ok",
      code: result.code,
      id: result.surveyId ?? undefined,
      message: successMessage,
    };
  }
  const base = ERROR_MESSAGES[result.code] ?? "Action refusée.";
  const reasons = result.blockingFindings
    .map((c) => PV_SURVEY_FINDING_LABELS[c] ?? c)
    .join(" · ");
  return {
    phase: "error",
    code: result.code,
    message: reasons.length > 0 ? `${base} ${reasons}.` : base,
  };
}

export async function planPvSiteSurveyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await planPvSiteSurvey({
    prospectId,
    scheduledOn: text(formData, "scheduled_on"),
    technicianUserId: null, // jamais reçu du navigateur : la base prend l'appelant
  });
  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  return surveyState(result, "Visite technique planifiée.");
}

export async function upsertPvSurveyRoofAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  if (surveyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvSurveyRoof({
    surveyId,
    roofAreaTotalM2: decimal(formData, "roof_area_total_m2"),
    roofAreaUsableM2: decimal(formData, "roof_area_usable_m2"),
    azimuthDeg: decimal(formData, "azimuth_deg"),
    tiltDeg: decimal(formData, "tilt_deg"),
    roofType: text(formData, "roof_type"),
    roofCondition: text(formData, "roof_condition"),
    shading: text(formData, "shading"),
    accessDifficulty: text(formData, "access_difficulty"),
    heightM: decimal(formData, "height_m"),
    ridgeLengthM: decimal(formData, "ridge_length_m"),
    eaveLengthM: decimal(formData, "eave_length_m"),
    slopeLengthM: decimal(formData, "slope_length_m"),
    obstacles: text(formData, "obstacles"),
    // Une case décochée doit pouvoir LEVER la suspicion : sans marqueur, un
    // `null` signifierait « inchangé » et la coche serait irréversible. Le
    // marqueur dit « ce formulaire s'est prononcé sur l'amiante » ; les autres
    // appelants, qui ne l'envoient pas, ne touchent pas au champ.
    asbestosSuspicion: formData.has("asbestos_declared")
      ? formData.get("asbestos_suspicion") === "on"
      : null,
    asbestosNote: text(formData, "asbestos_note"),
  });
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  return surveyState(
    result,
    result.findings === null
      ? "Relevé de toiture enregistré."
      : `Relevé enregistré. ${result.findings} écart(s) constaté(s).`,
  );
}

export async function upsertPvSurveyElectricalAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  if (surveyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvSurveyElectrical({
    surveyId,
    panelLocation: text(formData, "panel_location"),
    inverterLocation: text(formData, "inverter_location"),
    batteryLocation: text(formData, "battery_location"),
    cableRoute: text(formData, "cable_route"),
    cableDistanceM: decimal(formData, "cable_distance_m"),
    panelBoardLocation: text(formData, "panel_board_location"),
    panelBoardCondition: text(formData, "panel_board_condition"),
    panelBoardFreeSlots: decimal(formData, "panel_board_free_slots"),
    mainBreakerRatingA: decimal(formData, "main_breaker_rating_a"),
    earthingObserved: text(formData, "earthing_observed"),
    earthingNote: text(formData, "earthing_note"),
  });
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  return surveyState(result, "Relevé électrique enregistré.");
}

export async function upsertPvSurveyContextAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  if (surveyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await upsertPvSurveyContext({
    surveyId,
    weatherConditions: text(formData, "weather_conditions"),
    roofAccess: text(formData, "roof_access"),
    accessMeans: text(formData, "access_means"),
    siteCondition: text(formData, "site_condition"),
    safetyConstraints: text(formData, "safety_constraints"),
    observations: text(formData, "observations"),
    remarks: text(formData, "remarks"),
  });
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  return surveyState(result, "Conditions de visite enregistrées.");
}

export async function setPvSurveyStatusAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  const status = text(formData, "status");
  if (surveyId === null || status === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvSurveyStatus(surveyId, status);
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  return surveyState(result, `Visite passée à « ${status} ».`);
}

/**
 * VALIDER une visite. Geste HUMAIN : la base refuse quand `auth.uid()` est NULL,
 * et refuse aussi tant qu'un écart bloquant n'est pas résolu — valider en les
 * ignorant ferait dire à la preuve terrain le contraire de ce qu'elle a constaté.
 */
export async function validatePvSiteSurveyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  if (surveyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  if (formData.get("confirm") !== "VALIDER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise : cochez la case avant de valider la visite.",
    };
  }
  const result = await validatePvSiteSurvey(surveyId);
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  return surveyState(
    result,
    "Visite validée. La preuve terrain est disponible pour l’émission d’un devis.",
  );
}

export async function resolvePvSurveyFindingAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const findingId = text(formData, "finding_id");
  const surveyId = text(formData, "survey_id");
  const resolution = text(formData, "resolution");
  if (findingId === null || resolution === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await resolvePvSurveyFinding({
    findingId,
    resolution,
    comment: text(formData, "comment"),
  });
  if (result.ok && surveyId !== null) revalidatePath(`/etudes/visites/${surveyId}`);
  return result.ok
    ? { phase: "ok", code: result.code, message: "Écart résolu." }
    : { phase: "error", code: result.code, message: ERROR_MESSAGES[result.code] ?? "Résolution refusée." };
}

/**
 * APPLIQUER une mesure au site. Geste EXPLICITE et audité — le seul chemin par
 * lequel une valeur de terrain remplace une valeur déclarée. Confirmation exigée :
 * la déclaration d'origine disparaît du site (elle survit dans l'audit et dans
 * la visite, mais l'écran du site, lui, ne la montrera plus).
 */
export async function applyPvSurveyMeasurementAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  const field = text(formData, "field");
  if (surveyId === null || field === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  if (formData.get("confirm") !== "APPLIQUER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise : cochez la case avant de remplacer la donnée déclarée.",
    };
  }
  const result = await applyPvSurveyMeasurement({ surveyId, field });
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  if (!result.ok) {
    return {
      phase: "error",
      code: result.code,
      message: ERROR_MESSAGES[result.code] ?? "Application refusée.",
    };
  }
  return {
    phase: "ok",
    code: result.code,
    message: `Mesure appliquée au site : ${result.previousValue ?? "non renseigné"} → ${result.newValue ?? "non renseigné"}.`,
  };
}

/**
 * GÉNÉRER le rapport de visite technique.
 *
 * La clé d'idempotence vient de l'écran mais reste STABLE (visite + statut) :
 * deux clics ne produisent pas deux fichiers, alors qu'une visite passée de
 * « Terminée » à « Validée » produit bien un nouveau constat — ce qui est
 * exactement ce que l'on veut archiver.
 */
export async function generatePvSurveyReportAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const surveyId = text(formData, "survey_id");
  if (surveyId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await generatePvSurveyReport({
    surveyId,
    requestId: text(formData, "request_id") ?? randomUUID(),
    company: text(formData, "company") ?? "Hermès OS",
    generatedOn: new Date().toISOString().slice(0, 10),
  });
  if (result.ok) revalidatePath(`/etudes/visites/${surveyId}`);
  if (!result.ok) {
    return {
      phase: "error",
      code: result.code,
      message: ERROR_MESSAGES[result.code] ?? "Génération refusée.",
    };
  }
  return {
    phase: "ok",
    code: result.code,
    id: result.documentId ?? undefined,
    message:
      result.code === "ALREADY_GENERATED"
        ? "Ce rapport avait déjà été généré : le document existant est réutilisé."
        : "Rapport de visite technique généré.",
  };
}

// --- PV-7 : approvisionnement matériel ---------------------------------------

/**
 * Traduit un refus PV-7. Les blocages de commande remontent en toutes lettres :
 * « refusé » sans raison n'aide personne à débloquer une affaire.
 */
function materialState(result: PvMaterialOutcome, successMessage: string): PvActionState {
  if (result.ok) {
    return { phase: "ok", code: result.code, id: result.id ?? undefined, message: successMessage };
  }
  const base = ERROR_MESSAGES[result.code] ?? "Action refusée.";
  const reasons = result.blockers
    .map((b) => PV_PURCHASE_BLOCKER_LABELS[b] ?? b)
    .join(" ");
  return {
    phase: "error",
    code: result.code,
    message: reasons.length > 0 ? `${base} ${reasons}` : base,
  };
}

export async function upsertPvMaterialAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const result = await upsertPvMaterial({
    id: text(formData, "material_id"),
    category: text(formData, "category"),
    sku: text(formData, "sku"),
    designation: text(formData, "designation"),
    subcategory: text(formData, "subcategory"),
    brand: text(formData, "brand"),
    manufacturerRef: text(formData, "manufacturer_ref"),
    description: text(formData, "description"),
    unit: text(formData, "unit") ?? "U",
    unitCostHtEur: decimal(formData, "unit_cost_ht_eur"),
    preferredSupplierId: text(formData, "preferred_supplier_id"),
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath("/etudes");
  return materialState(result, "Article enregistré.");
}

export async function setPvMaterialActiveAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const materialId = text(formData, "material_id");
  if (materialId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const active = formData.get("active") === "1";
  const result = await setPvMaterialActive(materialId, active);
  if (result.ok) revalidatePath("/etudes");
  return materialState(
    result,
    active
      ? "Article réactivé : il est de nouveau proposé."
      : "Article désactivé : il n’est plus proposé, mais reste dans l’historique.",
  );
}

export async function upsertPvSupplierAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const result = await upsertPvSupplier({
    id: text(formData, "supplier_id"),
    name: text(formData, "name"),
    contactName: text(formData, "contact_name"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    addressLine1: text(formData, "address_line1"),
    postalCode: text(formData, "postal_code"),
    city: text(formData, "city"),
    leadTimeDays: decimal(formData, "lead_time_days"),
    paymentTerms: text(formData, "payment_terms"),
    freeShippingHtEur: decimal(formData, "free_shipping_ht_eur"),
    isActive: formData.has("is_active_declared") ? formData.get("is_active") === "on" : null,
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath("/etudes");
  return materialState(result, "Fournisseur enregistré.");
}

/**
 * Enregistrer un tarif OUVRE une période datée. La façade clôt la précédente la
 * veille : l'historique reste lisible, et une commande passée en mars garde son
 * prix de mars.
 */
export async function upsertPvSupplierPriceAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const materialId = text(formData, "material_id");
  const supplierId = text(formData, "supplier_id");
  const price = decimal(formData, "price_ht_eur");
  if (materialId === null || supplierId === null || price === null) {
    return { phase: "error", code: "INVALID_PRICE", message: ERROR_MESSAGES.INVALID_PRICE };
  }
  const result = await upsertPvSupplierPrice({
    materialId,
    supplierId,
    priceHtEur: price,
    validFrom: text(formData, "valid_from"),
    supplierRef: text(formData, "supplier_ref"),
    minQuantity: decimal(formData, "min_quantity"),
    packSize: decimal(formData, "pack_size"),
    leadTimeDays: decimal(formData, "lead_time_days"),
    availability: text(formData, "availability"),
    source: text(formData, "source") ?? "MANUAL",
    notes: text(formData, "notes"),
  });
  if (result.ok) revalidatePath("/etudes");
  return materialState(result, "Tarif enregistré : une nouvelle période de validité est ouverte.");
}

export async function addPvMaterialRequirementAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  const quantity = decimal(formData, "quantity");
  if (prospectId === null || quantity === null) {
    return { phase: "error", code: "INVALID_REQUIREMENT", message: ERROR_MESSAGES.INVALID_REQUIREMENT };
  }
  const result = await addPvMaterialRequirement({
    prospectId,
    quantity,
    materialId: text(formData, "material_id"),
    freeDesignation: text(formData, "free_designation"),
    unit: text(formData, "unit") ?? "U",
    isMandatory: formData.get("is_mandatory") !== "off",
    comment: text(formData, "comment"),
  });
  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  return materialState(result, "Besoin ajouté.");
}

/**
 * Dérive les besoins depuis les artefacts RETENUS. Idempotent : relancer ne
 * redouble rien. Le message dit ce qui a été TROUVÉ, pas ce qui a été deviné.
 */
export async function derivePvMaterialRequirementsAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  if (prospectId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await derivePvMaterialRequirements(prospectId);
  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  if (!result.ok) {
    return {
      phase: "error",
      code: result.code,
      message: ERROR_MESSAGES[result.code] ?? "Dérivation refusée.",
    };
  }
  const total = result.fromQuote + result.fromSurvey;
  return {
    phase: "ok",
    code: result.code,
    message:
      total === 0
        ? "Aucun besoin nouveau : tout ce qui était dérivable l’est déjà."
        : `${total} besoin(s) ajouté(s) — ${result.fromQuote} depuis le devis, ${result.fromSurvey} depuis la visite. Les besoins issus de texte libre attendent votre confirmation.`,
  };
}

/** Geste HUMAIN : c'est lui qui autorise un besoin à compter dans la readiness. */
export async function confirmPvMaterialRequirementAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const requirementId = text(formData, "requirement_id");
  const prospectId = text(formData, "prospect_id");
  if (requirementId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await confirmPvMaterialRequirement({
    requirementId,
    materialId: text(formData, "material_id"),
    quantity: decimal(formData, "quantity"),
  });
  if (result.ok && prospectId !== null) revalidatePath(`/etudes/affaires/${prospectId}`);
  return materialState(result, "Besoin confirmé.");
}

export async function dismissPvMaterialRequirementAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const requirementId = text(formData, "requirement_id");
  const prospectId = text(formData, "prospect_id");
  const reason = text(formData, "reason");
  if (requirementId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  if (reason === null) {
    return { phase: "error", code: "REASON_REQUIRED", message: ERROR_MESSAGES.REASON_REQUIRED };
  }
  const result = await dismissPvMaterialRequirement(requirementId, reason);
  if (result.ok && prospectId !== null) revalidatePath(`/etudes/affaires/${prospectId}`);
  return materialState(result, "Besoin écarté, avec son motif.");
}

export async function createPvPurchaseOrderAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const prospectId = text(formData, "prospect_id");
  const supplierId = text(formData, "supplier_id");
  if (prospectId === null || supplierId === null) {
    return { phase: "error", code: "SUPPLIER_NOT_FOUND", message: ERROR_MESSAGES.SUPPLIER_NOT_FOUND };
  }
  const result = await createPvPurchaseOrder({
    prospectId,
    supplierId,
    expectedDeliveryOn: text(formData, "expected_delivery_on"),
  });
  if (result.ok) revalidatePath(`/etudes/affaires/${prospectId}`);
  return materialState(result, "Commande créée en brouillon.");
}

export async function upsertPvPurchaseOrderLineAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const orderId = text(formData, "order_id");
  const designation = text(formData, "designation");
  const quantity = decimal(formData, "quantity");
  if (orderId === null || designation === null || quantity === null) {
    return { phase: "error", code: "INVALID_LINE", message: ERROR_MESSAGES.INVALID_LINE };
  }
  const result = await upsertPvPurchaseOrderLine({
    lineId: text(formData, "line_id"),
    orderId,
    designation,
    quantity,
    unit: text(formData, "unit") ?? "U",
    unitPriceHtEur: decimal(formData, "unit_price_ht_eur"),
    vatRatePct: decimal(formData, "vat_rate_pct"),
    materialId: text(formData, "material_id"),
    supplierRef: text(formData, "supplier_ref"),
    expectedDeliveryOn: text(formData, "expected_delivery_on"),
    requirementId: text(formData, "requirement_id"),
  });
  if (result.ok) revalidatePath(`/etudes/commandes/${orderId}`);
  return materialState(result, "Ligne enregistrée.");
}

export async function deletePvPurchaseOrderLineAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const lineId = text(formData, "line_id");
  const orderId = text(formData, "order_id");
  if (lineId === null) {
    return { phase: "error", code: "LINE_NOT_FOUND", message: ERROR_MESSAGES.LINE_NOT_FOUND };
  }
  const result = await deletePvPurchaseOrderLine(lineId);
  if (result.ok && orderId !== null) revalidatePath(`/etudes/commandes/${orderId}`);
  return materialState(result, "Ligne supprimée.");
}

export async function setPvPurchaseOrderReadyAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const orderId = text(formData, "order_id");
  if (orderId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  const result = await setPvPurchaseOrderReady(orderId);
  if (result.ok) revalidatePath(`/etudes/commandes/${orderId}`);
  return materialState(result, "Commande prête à être passée.");
}

/**
 * ⚠️ N'ENVOIE RIEN chez le fournisseur.
 *
 * Ce bouton enregistre qu'un humain déclare avoir passé la commande — par
 * téléphone, par courriel, sur un portail. Exactement le contrat de
 * « Marquer comme envoyé » en PV-5. Confirmation exigée : le geste engage
 * l'argent de l'entreprise.
 */
export async function markPvPurchaseOrderOrderedAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const orderId = text(formData, "order_id");
  if (orderId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  if (formData.get("confirm") !== "COMMANDER") {
    return {
      phase: "error",
      code: "CONFIRMATION_REQUIRED",
      message: "Confirmation requise : cochez la case avant de déclarer la commande passée.",
    };
  }
  const result = await markPvPurchaseOrderOrdered({
    orderId,
    orderedOn: text(formData, "ordered_on"),
  });
  if (result.ok) revalidatePath(`/etudes/commandes/${orderId}`);
  return materialState(
    result,
    "Commande enregistrée comme passée. Hermès n’a rien envoyé : c’est votre déclaration qui fait foi.",
  );
}

export async function cancelPvPurchaseOrderAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const orderId = text(formData, "order_id");
  const reason = text(formData, "reason");
  if (orderId === null) {
    return { phase: "error", code: "NOT_FOUND", message: ERROR_MESSAGES.NOT_FOUND };
  }
  if (reason === null) {
    return { phase: "error", code: "REASON_REQUIRED", message: ERROR_MESSAGES.REASON_REQUIRED };
  }
  const result = await cancelPvPurchaseOrder(orderId, reason);
  if (result.ok) revalidatePath(`/etudes/commandes/${orderId}`);
  return materialState(result, "Commande annulée, avec son motif.");
}

/** Réception PARTIELLE native : on saisit ce qui est arrivé, pas ce qui manque. */
export async function recordPvPurchaseReceiptAction(
  _prev: PvActionState,
  formData: FormData,
): Promise<PvActionState> {
  const lineId = text(formData, "line_id");
  const orderId = text(formData, "order_id");
  const quantity = decimal(formData, "quantity");
  if (lineId === null || quantity === null) {
    return { phase: "error", code: "INVALID_RECEIPT", message: ERROR_MESSAGES.INVALID_RECEIPT };
  }
  const result = await recordPvPurchaseReceipt({
    lineId,
    quantity,
    receivedOn: text(formData, "received_on"),
    deliveryNoteRef: text(formData, "delivery_note_ref"),
    condition: text(formData, "condition") ?? "CONFORME",
    comment: text(formData, "comment"),
  });
  if (result.ok && orderId !== null) revalidatePath(`/etudes/commandes/${orderId}`);
  if (!result.ok) {
    return {
      phase: "error",
      code: result.code,
      message: ERROR_MESSAGES[result.code] ?? "Réception refusée.",
    };
  }
  return {
    phase: "ok",
    code: result.code,
    message:
      result.lineMissing > 0
        ? `Réception enregistrée : ${result.lineReceived} reçu sur ${result.lineOrdered} commandé — il manque ${result.lineMissing}.`
        : `Réception enregistrée : la ligne est complète (${result.lineReceived}).`,
  };
}
