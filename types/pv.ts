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
