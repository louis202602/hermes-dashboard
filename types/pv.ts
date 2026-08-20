/**
 * PACK PHOTOVOLTAÏQUE — types du LOT PV-2.
 *
 * Ces types décrivent la SORTIE DES FAÇADES, pas les tables. Les colonnes
 * protégées (`tenant_id` en tête) n'y figurent donc pas : elles ne franchissent
 * jamais la frontière serveur, et aucun formulaire ne peut en proposer une.
 *
 * Les statuts sont des unions littérales, alignées sur les `CHECK` de PV-1 : un
 * statut inventé côté client ne compile pas.
 */

import type { TenantResolutionStatus } from "@/types/hermes";

export type PvProspectType = "PARTICULIER" | "PROFESSIONNEL" | "INDUSTRIEL" | "AGRICOLE";

export type PvProspectStatus =
  | "NEW"
  | "CONTACTED"
  | "QUALIFYING"
  | "QUALIFIED"
  | "UNQUALIFIED"
  | "STUDY_REQUESTED"
  | "STUDY_DELIVERED"
  | "WON"
  | "LOST"
  | "ON_HOLD"
  | "ARCHIVED";

export type PvBillStatus = "RECEIVED" | "EXTRACTED" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";
export type PvStudyStatus =
  | "DRAFT"
  | "CALCULATED"
  | "NEEDS_REVIEW"
  | "VALIDATED"
  | "REJECTED"
  | "SUPERSEDED";
export type PvEconomicsStatus = "DRAFT" | "CALCULATED" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";
export type PvVerificationStatus = "UNVERIFIED" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";

/** Codes rendus par les façades. `OK` n'y figure pas : il devient `ok: true`. */
export type PvFacadeCode =
  | TenantResolutionStatus
  | "NOT_FOUND"
  | "MISSING_TYPE"
  | "MISSING_SITE"
  | "MISSING_PROSPECT"
  | "INVALID_PROSPECT"
  | "INVALID_SITE"
  | "INVALID_PROFILE"
  | "INVALID_BILL"
  | "INVALID_DOCUMENT"
  | "INVALID_REFERENCE"
  | "TRANSITION_REFUSED"
  | "VALIDATION_REFUSED"
  | "DOCUMENT_NOT_FOUND"
  | "PATH_OUT_OF_SCOPE"
  | "BAD_MIME"
  | "BAD_SIZE"
  | "BAD_DOC_TYPE"
  | "DUPLICATE_OBJECT"
  | "RPC_ERROR";

export type PvProspectListItem = {
  id: string;
  prospectType: PvProspectType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  status: PvProspectStatus;
  qualificationScore: number | null;
  contactConsent: boolean;
  optedOut: boolean;
  siteCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PvProspectList = {
  items: PvProspectListItem[];
  /** Total du tenant, AVANT filtres — distingue « aucun résultat » de « aucune donnée ». */
  total: number;
};

export type PvSiteSummary = {
  id: string;
  label: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  buildingType: string | null;
  roofType: string | null;
  roofAreaUsableM2: number | null;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  shadingLevel: string | null;
};

export type PvAuditEntry = {
  at: string | null;
  summary: string | null;
  by: string | null;
};

export type PvProspectDetail = {
  id: string;
  prospectType: PvProspectType;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  sourceDetail: string | null;
  campaignRef: string | null;
  contactConsent: boolean;
  contactConsentAt: string | null;
  optedOut: boolean;
  status: PvProspectStatus;
  qualificationScore: number | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  sites: PvSiteSummary[];
  history: PvAuditEntry[];
  /** Transitions RÉELLEMENT possibles, lues dans `pv_prospect_transitions`. */
  nextStatuses: PvProspectStatus[];
};

/** Détail d'un site : projection large et volontairement permissive côté clés. */
export type PvSiteDetail = Record<string, unknown> & { id: string };

export type PvConsumptionProfile = {
  id: string;
  energySupplier: string | null;
  subscribedPowerKva: number | null;
  annualConsumptionKwh: number | null;
  annualCostEur: number | null;
  unitPriceEurKwh: number | null;
  tariffOption: string | null;
  deliveryPointRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dataSource: string;
  verificationStatus: PvVerificationStatus;
};

export type PvEnergyBill = {
  id: string;
  supplier: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  issuedOn: string | null;
  amountHtEur: number | null;
  amountTtcEur: number | null;
  consumptionKwh: number | null;
  subscribedPowerKva: number | null;
  tariffOption: string | null;
  deliveryPointRef: string | null;
  status: PvBillStatus;
  verifiedAt: string | null;
  rejectionReason: string | null;
  documentBucket: string | null;
  documentPath: string | null;
  originalFilename: string | null;
  /** Nombre de LECTURES IA rattachées. Jamais fusionné aux valeurs retenues. */
  extractionCount: number;
  createdAt: string | null;
};

export type PvBillExtraction = {
  id: string;
  billId: string;
  extractedBy: string;
  modelUsed: string | null;
  supplier: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountTtcEur: number | null;
  consumptionKwh: number | null;
  subscribedPowerKva: number | null;
  tariffOption: string | null;
  deliveryPointRef: string | null;
  confidence: number;
  promotedToBill: boolean;
  promotedAt: string | null;
  createdAt: string | null;
};

export type PvStudy = {
  id: string;
  version: number;
  status: PvStudyStatus;
  targetPowerKwc: number | null;
  panelCount: number | null;
  panelUnitPowerW: number | null;
  panelBrand: string | null;
  inverterType: string | null;
  inverterBrand: string | null;
  hasBattery: boolean;
  batteryCapacityKwh: number | null;
  annualProductionKwh: number | null;
  specificYieldKwhKwc: number | null;
  selfConsumptionRatePct: number | null;
  selfProductionRatePct: number | null;
  surplusKwh: number | null;
  systemLossesPct: number | null;
  source: string;
  preparedBy: string;
  validatedAt: string | null;
  calculatedAt: string | null;
  createdAt: string | null;
};

export type PvStudyAssumptions = {
  studyId: string;
  energyPriceEurKwh: number | null;
  energyPriceInflationPct: number | null;
  analysisHorizonYears: number | null;
  discountRatePct: number | null;
  panelDegradationPctYear: number | null;
  systemLossesPct: number | null;
  surplusSalePriceEurKwh: number | null;
  subsidyTotalEur: number | null;
  subsidyScheme: string | null;
  vatRatePct: number | null;
};

export type PvEconomics = {
  id: string;
  studyId: string;
  investmentHtEur: number | null;
  investmentTtcEur: number | null;
  subsidyTotalEur: number | null;
  netCostEur: number | null;
  year1SavingsEur: number | null;
  surplusRevenueEur: number | null;
  annualGainEur: number | null;
  simpleRoiPct: number | null;
  paybackYears: number | null;
  npvEur: number | null;
  irrPct: number | null;
  status: PvEconomicsStatus;
  computedBy: string;
  verifiedAt: string | null;
  createdAt: string | null;
};

export type PvDocument = {
  id: string;
  siteId: string;
  billId: string | null;
  docType: string;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  status: string;
  uploadedAt: string | null;
  /**
   * URL SIGNÉE à TTL court, produite à la demande côté serveur. Elle n'est
   * jamais persistée : la source de vérité reste (bucket, chemin).
   */
  signedUrl: string | null;
};

/** Résultat d'une écriture humaine. `code` porte le refus métier éventuel. */
export type PvWriteOutcome = {
  ok: boolean;
  code: string;
  id: string | null;
};

// --- PV-3 ---------------------------------------------------------------------

/** Document candidat à la purge physique de ses octets. */
export type PvPurgeCandidate = {
  documentId: string;
  bucket: string;
  path: string;
  deletedAt: string | null;
};

/**
 * Résultat d'une passe de purge. Les quatre compteurs sont distincts à dessein :
 * « ignoré » (hors périmètre) et « échoué » (l'API Storage a refusé) ne disent
 * pas la même chose, et les confondre masquerait une vraie panne.
 */
export type PvPurgeReport = {
  examined: number;
  purged: number;
  skipped: number;
  failed: number;
  /**
   * PV-4 — code de la façade de listage. `NOT_ADMIN` doit être distingué d'un
   * `OK` sans candidat : un refus de droits n'est pas « rien à purger ».
   */
  code: string;
};

export type PvPilotStudy = {
  id: string;
  siteId: string;
  version: number;
  status: string;
  preparedBy: string;
  targetPowerKwc: number | null;
};

export type PvPilotBill = {
  id: string;
  siteId: string;
  supplier: string | null;
  status: string;
  consumptionKwh: number | null;
};

export type PvPilotProspect = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  status: string;
};

/**
 * Instantané PARTAGÉ des trois widgets de pilotage. Un seul appel : trois
 * widgets ne font jamais trois lectures (contrat COST-FIRST du registre).
 */
export type PvPilotSnapshot = {
  ok: boolean;
  studiesToValidate: number;
  billsToVerify: number;
  prospectsWithoutSite: number;
  studies: PvPilotStudy[];
  bills: PvPilotBill[];
  prospects: PvPilotProspect[];
};

// --- PV-4 ---------------------------------------------------------------------

/** Entrée du journal de purge — jointure `pv_documents` × `entity_audit_log`. */
export type PvPurgeJournalEntry = {
  documentId: string;
  siteId: string;
  docType: string;
  originalFilename: string | null;
  sizeBytes: number;
  deletedAt: string | null;
  deletedBy: string | null;
  purgedAt: string | null;
  purgedPath: string | null;
  purgedBy: string | null;
  outcome: string;
};

export type PvDealProspect = {
  id: string;
  prospectType: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  ownerUserId: string | null;
  contactConsent: boolean;
  contactConsentAt: string | null;
  optedOut: boolean;
  status: string;
};

export type PvDealSite = {
  id: string;
  label: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  buildingType: string | null;
  buildingUse: string | null;
  occupancy: string | null;
  roofType: string | null;
  roofMaterial: string | null;
  roofCondition: string | null;
  roofAreaTotalM2: number | null;
  roofAreaUsableM2: number | null;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  shadingLevel: string | null;
  accessDifficulty: string | null;
};

export type PvDealDocument = {
  id: string;
  docType: string;
  documentStage: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  status: string;
  storagePath: string | null;
  uploadedAt: string | null;
  signedUrl: string | null;
};

/**
 * L'AFFAIRE — agrégat de lecture, jamais une source de vérité.
 *
 * `retainedStudy` et `retainedEconomics` suivent la règle déterministe de la
 * façade : étude VALIDATED de plus haut numéro de version, puis chiffrage
 * VERIFIED le plus récent de CETTE étude. Un brouillon n'est jamais retenu, même
 * s'il est le plus récent.
 */
export type PvDeal = {
  prospect: PvDealProspect;
  site: PvDealSite | null;
  consumption: PvConsumptionProfile | null;
  verifiedBill: PvEnergyBill | null;
  retainedStudy: PvStudy | null;
  latestStudy: PvStudy | null;
  retainedAssumptions: PvStudyAssumptions | null;
  retainedEconomics: PvEconomics | null;
  studies: { id: string; version: number; status: string; preparedBy: string; targetPowerKwc: number | null }[];
  documents: PvDealDocument[];
};

/** Résultat d'une génération de synthèse PDF. */
export type PvPdfOutcome = {
  ok: boolean;
  code: string;
  documentId: string | null;
  stage: "DRAFT" | "FINAL" | null;
  /** Motif précis du refus d'un FINAL, quand il y en a un. */
  reason: string | null;
};

// --- PV-5 : le devis --------------------------------------------------------

/** Catégories de ligne proposées. La liste est CLOSE côté base (contrainte CHECK). */
export const PV_QUOTE_LINE_CATEGORIES = [
  "PANNEAUX",
  "ONDULEUR",
  "BATTERIE",
  "STRUCTURE",
  "PROTECTIONS",
  "CABLAGE",
  "POSE",
  "MISE_EN_SERVICE",
  "ETUDES_ADMINISTRATIF",
  "OPTION",
  "AUTRE",
] as const;

export type PvQuoteLineCategory = (typeof PV_QUOTE_LINE_CATEGORIES)[number];

export type PvQuoteLine = {
  id: string;
  quoteId: string;
  position: number;
  category: string;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceHtEur: number;
  vatRatePct: number;
  discountPct: number;
  /** Colonne GÉNÉRÉE en base. Jamais envoyée par le navigateur. */
  lineTotalHtEur: number;
};

/**
 * LE DEVIS. `quoteNumber` est la référence COMMERCIALE — stable à travers les
 * versions ; `version` distingue les révisions successives de cette même offre.
 *
 * Tous les totaux sont RECALCULÉS en base. Les champs ci-dessous sont des
 * lectures, jamais des entrées : aucune façade n'accepte de total.
 */
export type PvQuote = {
  id: string;
  prospectId: string;
  siteId: string;
  studyId: string;
  economicsId: string | null;
  quoteNumber: string;
  version: number;
  supersedesQuoteId: string | null;
  status: string;
  currency: string;
  discountPct: number;
  subtotalHtEur: number;
  discountAmountEur: number;
  totalHtEur: number;
  totalVatEur: number;
  totalTtcEur: number;
  issuedOn: string | null;
  validUntil: string | null;
  observations: string | null;
  terms: string | null;
  sentBy: string | null;
  sentAt: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptedOn: string | null;
  acceptanceReference: string | null;
  refusedAt: string | null;
  refusalReason: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Le devis, ses lignes, et CE QUI LUI MANQUE — des raisons, pas un booléen. */
export type PvQuoteDetail = {
  quote: PvQuote;
  lines: PvQuoteLine[];
  prospect: PvDealProspect | null;
  site: PvDealSite | null;
  study: PvStudy | null;
  blockers: string[];
  /** Péremption CALCULÉE à la lecture : visible sans passage de `expire_pv_quotes()`. */
  isExpired: boolean;
};

/** Ligne de liste — assez pour un tableau, pas plus. */
export type PvQuoteSummary = {
  id: string;
  quoteNumber: string;
  version: number;
  status: string;
  totalHtEur: number;
  totalVatEur: number;
  totalTtcEur: number;
  currency: string;
  issuedOn: string | null;
  validUntil: string | null;
  acceptedOn: string | null;
  createdAt: string;
  isExpired: boolean;
};

/** Résultat d'une écriture sur un devis : le refus porte ses raisons. */
export type PvQuoteOutcome = {
  ok: boolean;
  code: string;
  quoteId: string | null;
  quoteNumber: string | null;
  version: number | null;
  missingRequirements: string[];
};
