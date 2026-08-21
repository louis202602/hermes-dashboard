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
  /**
   * PV-6 — état de la preuve terrain pour le site de l'affaire, tel que la base
   * le calcule (`hermes_os.pv_survey_gate`). `NONE` par défaut : une affaire
   * sans site n'a pas de visite possible, et l'absence se dit plutôt qu'elle ne
   * se devine.
   */
  surveyGate: "NONE" | "NOT_VALIDATED" | "BLOCKING" | "OK";
  /**
   * PV-7 — état de l'approvisionnement du site, tel que la base le calcule
   * (`hermes_os.pv_material_readiness`). Volontairement HORS de
   * `resolvePvReadiness` : celle-ci répond « peut-on proposer ? », celle-ci
   * répond « peut-on poser ? ». Deux questions, deux moments, deux indicateurs.
   */
  materialReadiness: "NOT_READY" | "PARTIAL" | "READY";
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

// --- PV-6 : la visite technique ---------------------------------------------

/** Codes d'écart. Liste CLOSE côté base (contrainte CHECK). */
export const PV_SURVEY_FINDING_CODES = [
  "ROOF_AREA_MISMATCH",
  "USABLE_AREA_MISMATCH",
  "AZIMUTH_MISMATCH",
  "TILT_MISMATCH",
  "ROOF_TYPE_MISMATCH",
  "ROOF_CONDITION_ISSUE",
  "SHADING_MISMATCH",
  "ACCESS_BLOCKED",
  "ELECTRICAL_PANEL_ISSUE",
  "CABLE_ROUTE_ISSUE",
  "STRUCTURAL_CONCERN",
  "ASBESTOS_SUSPICION",
  "EARTHING_ISSUE",
  "HEIGHT_ACCESS_NOTICE",
] as const;
export type PvSurveyFindingCode = (typeof PV_SURVEY_FINDING_CODES)[number];

export const PV_SURVEY_RESOLUTIONS = [
  "ACCEPTED_AS_IS",
  "SITE_UPDATED",
  "STUDY_TO_REVISE",
  "QUOTE_TO_REVISE",
  "NOT_AN_ISSUE",
] as const;
export type PvSurveyResolution = (typeof PV_SURVEY_RESOLUTIONS)[number];

/**
 * UN ÉCART entre le déclaré et le mesuré.
 *
 * Il porte les DEUX valeurs, jamais une seule : c'est ce qui permet à l'écran de
 * montrer « 90 m² déclarés / 72 m² mesurés / −18 m² » plutôt qu'un drapeau rouge
 * sans explication.
 */
export type PvSurveyFinding = {
  id: string;
  surveyId: string;
  code: string;
  category: string;
  severity: "INFO" | "REVIEW" | "BLOCKING";
  isBlocking: boolean;
  declaredValue: string | null;
  measuredValue: string | null;
  unit: string | null;
  comment: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

/** Le relevé de terrain. Colonnes TYPÉES — jamais un blob JSON. */
export type PvSiteSurvey = {
  id: string;
  prospectId: string;
  siteId: string;
  technicianUserId: string | null;
  scheduledOn: string | null;
  startedAt: string | null;
  completedAt: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  status: string;

  weatherConditions: string | null;
  roofAccess: string | null;
  accessMeans: string | null;
  siteCondition: string | null;
  safetyConstraints: string | null;
  observations: string | null;
  remarks: string | null;

  roofAreaTotalMeasuredM2: number | null;
  roofAreaUsableMeasuredM2: number | null;
  azimuthMeasuredDeg: number | null;
  tiltMeasuredDeg: number | null;
  roofTypeMeasured: string | null;
  roofConditionMeasured: string | null;
  shadingMeasured: string | null;
  accessDifficultyMeasured: string | null;
  heightMeasuredM: number | null;
  ridgeLengthM: number | null;
  eaveLengthM: number | null;
  slopeLengthM: number | null;
  obstacles: string | null;
  /** CONSTAT de terrain, jamais un diagnostic — celui-ci relève d'un opérateur certifié. */
  asbestosSuspicion: boolean;
  asbestosNote: string | null;

  panelLocation: string | null;
  inverterLocation: string | null;
  batteryLocation: string | null;
  cableRoute: string | null;
  cableDistanceM: number | null;
  panelBoardLocation: string | null;
  panelBoardCondition: string | null;
  panelBoardFreeSlots: number | null;
  mainBreakerRatingA: number | null;
  /** OBSERVATION visuelle, pas un contrôle réglementaire. */
  earthingObserved: string | null;
  earthingNote: string | null;

  createdAt: string;
  updatedAt: string;
};

/** Une ligne de la vue comparative : déclaré, mesuré, écart, statut. */
export type PvSurveyComparisonRow = {
  field: string;
  label: string;
  declared: string | null;
  measured: string | null;
  delta: string | null;
  unit: string | null;
  /** `OK` quand la mesure confirme la déclaration ou qu'aucun écart n'est retenu. */
  status: "OK" | "INFO" | "REVIEW" | "BLOCKING" | "NON_MESURE";
  findingCode: string | null;
  /** `true` quand une mesure existe et peut être appliquée au site. */
  applicable: boolean;
};

export type PvSiteSurveyDetail = {
  survey: PvSiteSurvey;
  site: PvDealSite | null;
  prospect: PvDealProspect | null;
  findings: PvSurveyFinding[];
  documents: PvDealDocument[];
  /** Miroir de `hermes_os.pv_survey_gate` pour le SITE de cette visite. */
  gate: "NONE" | "NOT_VALIDATED" | "BLOCKING" | "OK";
  /**
   * Statuts atteignables depuis le statut courant, LUS dans
   * `hermes_os.pv_survey_transitions`. L'écran ne redéclare pas la machine :
   * il affiche ce que la base autorise. `VALIDATED` n'y figure jamais — il
   * s'obtient par la façade de validation humaine, pas par une transition.
   */
  nextStatuses: string[];
};

export type PvSiteSurveySummary = {
  id: string;
  siteId: string;
  status: string;
  scheduledOn: string | null;
  completedAt: string | null;
  validatedAt: string | null;
  technicianUserId: string | null;
  createdAt: string;
  findingsTotal: number;
  findingsBlocking: number;
};

/** Résultat d'une écriture sur une visite : le refus porte ses raisons. */
export type PvSurveyOutcome = {
  ok: boolean;
  code: string;
  surveyId: string | null;
  /** Écarts bloquants non résolus qui ont fait échouer une validation. */
  blockingFindings: string[];
  findings: number | null;
};

/**
 * VOCABULAIRES DE LA VISITE — listes CLOSES, identiques aux contraintes `CHECK`
 * de `hermes_os.pv_site_surveys`. Elles servent à peupler les listes déroulantes ;
 * la base reste l'arbitre : une valeur forgée hors de ces listes est refusée.
 *
 * Les quatre premières sont ALIGNÉES sur `pv_sites` — c'est ce qui rend la
 * comparaison déclaré/mesuré exacte plutôt qu'approximative.
 */
export const PV_SURVEY_ROOF_TYPES = [
  "PENTE", "TERRASSE", "MULTIPENTE", "SHED", "COURBE", "SOL", "OMBRIERE", "AUTRE",
] as const;
export const PV_SURVEY_ROOF_CONDITIONS = ["BON", "MOYEN", "MAUVAIS", "INCONNU"] as const;
export const PV_SURVEY_SHADING_LEVELS = ["AUCUN", "FAIBLE", "MODERE", "FORT"] as const;
export const PV_SURVEY_ACCESS_DIFFICULTIES = [
  "FACILE", "MOYEN", "DIFFICILE", "TRES_DIFFICILE",
] as const;

export const PV_SURVEY_WEATHER = ["SEC", "PLUIE", "NEIGE", "VENT_FORT", "AUTRE"] as const;
export const PV_SURVEY_ROOF_ACCESS = ["FACILE", "MOYEN", "DIFFICILE", "IMPOSSIBLE"] as const;
export const PV_SURVEY_ACCESS_MEANS = [
  "ECHELLE", "ECHAFAUDAGE", "NACELLE", "TRAPPE", "AUCUN", "AUTRE",
] as const;
export const PV_SURVEY_SITE_CONDITIONS = ["BON", "MOYEN", "DEGRADE", "CRITIQUE"] as const;
export const PV_SURVEY_BOARD_CONDITIONS = [
  "BON", "MOYEN", "DEGRADE", "NON_CONFORME_APPARENT",
] as const;
export const PV_SURVEY_EARTHING_STATES = ["PRESENTE", "ABSENTE", "NON_VERIFIABLE"] as const;

/** Statuts pouvant être posés à la main. `VALIDATED` en est ABSENT : il passe
 *  par la façade de validation humaine, jamais par un changement de statut. */
export const PV_SURVEY_MANUAL_STATUSES = [
  "IN_PROGRESS", "DONE", "NEEDS_REVIEW", "BLOCKING", "PLANNED", "CANCELLED",
] as const;

// --- PV-7 : approvisionnement matériel ---------------------------------------

/** Catégories du catalogue. Liste CLOSE, identique au `CHECK` de la base. */
export const PV_MATERIAL_CATEGORIES = [
  "PANNEAU", "ONDULEUR", "MICRO_ONDULEUR", "BATTERIE",
  "STRUCTURE", "RAIL", "CROCHET", "BAC_LESTE",
  "PROTECTION_DC", "PROTECTION_AC", "CABLE_DC", "CABLE_AC",
  "CONNECTIQUE", "COFFRET", "MONITORING", "MISE_A_LA_TERRE",
  "CONSOMMABLE", "ACCES_SECURITE", "AUTRE",
] as const;
export type PvMaterialCategory = (typeof PV_MATERIAL_CATEGORIES)[number];

export const PV_MATERIAL_UNITS = ["U", "M", "ML", "M2", "KG", "L", "LOT", "H", "FORFAIT"] as const;

/** D'où vient un besoin. Conservé tel quel : c'est ce qui rend l'écart lisible. */
export const PV_REQUIREMENT_ORIGINS = ["QUOTE", "STUDY", "SURVEY", "MANUAL"] as const;
export type PvRequirementOrigin = (typeof PV_REQUIREMENT_ORIGINS)[number];

/** Écart matériel — le vocabulaire du moteur `pv_material_balance`. */
export const PV_MATERIAL_GAP_STATUSES = [
  "NOT_ORDERED", "PARTIALLY_ORDERED", "ORDERED",
  "PARTIALLY_RECEIVED", "RECEIVED", "OVER_ORDERED", "SHORTAGE",
] as const;
export type PvMaterialGapStatus = (typeof PV_MATERIAL_GAP_STATUSES)[number];

export const PV_PURCHASE_ORDER_STATUSES = [
  "DRAFT", "READY", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED",
] as const;
export type PvPurchaseOrderStatus = (typeof PV_PURCHASE_ORDER_STATUSES)[number];

export const PV_RECEIPT_CONDITIONS = ["CONFORME", "ENDOMMAGE", "NON_CONFORME", "INCOMPLET"] as const;

export const PV_SUPPLIER_AVAILABILITY = ["EN_STOCK", "SUR_COMMANDE", "RUPTURE", "INCONNU"] as const;
export const PV_SUPPLIER_PRICE_SOURCES = ["MANUAL", "SUPPLIER_QUOTE", "CATALOG", "INVOICE"] as const;

/** Readiness MATÉRIEL — miroir de `hermes_os.pv_material_readiness`. */
export type PvMaterialReadiness = "NOT_READY" | "PARTIAL" | "READY";

export type PvMaterial = {
  id: string;
  category: string;
  subcategory: string | null;
  sku: string;
  brand: string | null;
  manufacturerRef: string | null;
  designation: string;
  description: string | null;
  unit: string;
  isActive: boolean;
  /** Coût INDICATIF. Le prix qui engage est celui du tarif fournisseur daté. */
  unitCostHtEur: number | null;
  preferredSupplierId: string | null;
  notes: string | null;
};

export type PvSupplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  isActive: boolean;
  /** INDICATIF, saisi à la main — jamais un engagement du fournisseur. */
  leadTimeDays: number | null;
  paymentTerms: string | null;
  freeShippingHtEur: number | null;
  notes: string | null;
};

/** Un tarif fournisseur est une donnée DATÉE : la période fait partie du prix. */
export type PvSupplierPrice = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierRef: string | null;
  priceHtEur: number;
  minQuantity: number;
  packSize: number | null;
  validFrom: string;
  validUntil: string | null;
  leadTimeDays: number | null;
  availability: string | null;
  source: string;
  lastCheckedAt: string | null;
  isCurrent: boolean;
};

export type PvMaterialRequirement = {
  id: string;
  materialId: string | null;
  designation: string | null;
  sku: string | null;
  quantityRequired: number;
  unit: string;
  origin: string;
  sourceEntityId: string | null;
  isMandatory: boolean;
  /** Vrai tant qu'un besoin issu de TEXTE LIBRE n'a pas été confirmé. */
  needsConfirmation: boolean;
  confirmedAt: string | null;
  status: string;
  dismissalReason: string | null;
  comment: string | null;
};

/** Une ligne de l'écart matériel : besoin, commandé, reçu — jamais confondus. */
export type PvMaterialBalanceRow = {
  materialId: string | null;
  designation: string | null;
  unit: string;
  qtyRequired: number;
  qtyOrdered: number;
  qtyReceived: number;
  /** Quantité encore attendue sur des commandes ouvertes. */
  qtyOpen: number;
  gap: number;
  status: PvMaterialGapStatus;
  isMandatory: boolean;
  needsConfirmation: boolean;
  origins: string[];
};

/**
 * Coûts matériels. `marginReliable` faux ⇒ l'écran n'a PAS le droit d'afficher
 * la marge : elle serait calculée sur des coûts inconnus ou des besoins non
 * confirmés. Et c'est une marge MATÉRIELLE, pas une marge d'affaire — la
 * main-d'œuvre n'est pas séparée dans les lignes de devis.
 */
export type PvMaterialCosts = {
  plannedCostHtEur: number;
  orderedCostHtEur: number;
  receivedCostHtEur: number;
  quoteTotalHtEur: number | null;
  materialsWithoutCost: number;
  requirementsPendingConfirmation: number;
  marginReliable: boolean;
  indicativeMaterialMarginHtEur: number | null;
};

export type PvPurchaseOrderSummary = {
  id: string;
  orderNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  subtotalHtEur: number;
  totalTtcEur: number;
  orderedOn: string | null;
  expectedDeliveryOn: string | null;
  receivedOn: string | null;
  lineCount: number;
};

export type PvPurchaseOrderLine = {
  id: string;
  position: number;
  materialId: string | null;
  sku: string | null;
  designation: string;
  supplierRef: string | null;
  quantity: number;
  unit: string;
  unitPriceHtEur: number;
  vatRatePct: number;
  lineTotalHtEur: number;
  quantityReceived: number;
  quantityMissing: number;
  expectedDeliveryOn: string | null;
  requirementId: string | null;
};

export type PvPurchaseReceipt = {
  id: string;
  lineId: string;
  quantityReceived: number;
  receivedOn: string;
  deliveryNoteRef: string | null;
  condition: string;
  comment: string | null;
  createdAt: string;
};

export type PvPurchaseOrderDetail = {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    supplierId: string;
    prospectId: string;
    siteId: string;
    currency: string;
    subtotalHtEur: number;
    totalVatEur: number;
    totalTtcEur: number;
    expectedDeliveryOn: string | null;
    orderedOn: string | null;
    receivedOn: string | null;
    approvedAt: string | null;
    orderedAt: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
    notes: string | null;
  };
  supplier: PvSupplier | null;
  prospect: { firstName: string | null; lastName: string | null; companyName: string | null } | null;
  lines: PvPurchaseOrderLine[];
  receipts: PvPurchaseReceipt[];
  documents: PvDealDocument[];
  /** Lues dans `pv_purchase_order_transitions` : l'écran ne redéclare rien. */
  nextStatuses: string[];
  /** Ce qui empêche READY/ORDERED, tel que la base le calcule. */
  blockers: string[];
};

export type PvMaterialPlan = {
  siteId: string | null;
  requirements: PvMaterialRequirement[];
  balance: PvMaterialBalanceRow[];
  orders: PvPurchaseOrderSummary[];
  readiness: PvMaterialReadiness;
  costs: PvMaterialCosts;
};

/** Résultat générique des façades PV-7 (écriture). */
export type PvMaterialOutcome = {
  ok: boolean;
  code: string;
  id: string | null;
  /** Ce qui bloque, quand la base refuse un READY / ORDERED. */
  blockers: string[];
};
