import "server-only";

import { logEvent } from "@/lib/observability/log";
import { buildPvDealPdfModel } from "@/lib/pv/dealPdfModel";
import { resolvePvReadiness } from "@/lib/pv/readiness";
import { buildPvStudyPdf } from "@/lib/pv/studyPdf";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  PvBillExtraction,
  PvDeal,
  PvDealDocument,
  PvPdfOutcome,
  PvPurgeJournalEntry,
  PvPilotSnapshot,
  PvPurgeCandidate,
  PvPurgeReport,
  PvConsumptionProfile,
  PvDocument,
  PvEconomics,
  PvEnergyBill,
  PvProspectDetail,
  PvProspectList,
  PvProspectStatus,
  PvSiteDetail,
  PvStudy,
  PvStudyAssumptions,
  PvWriteOutcome,
} from "@/types/pv";

/**
 * PACK PHOTOVOLTAÏQUE — accès serveur (LOT PV-2).
 *
 * Chaque fonction n'est qu'un appel à une façade `SECURITY DEFINER`. Tenant,
 * authentification, bornage et garde-fous sont décidés EN BASE. Ce fichier ne
 * contient AUCUNE règle métier et — point non négociable — n'accepte et
 * n'envoie JAMAIS de `tenant_id` : aucune façade PV n'a de paramètre pour cela,
 * donc aucun chemin client ne peut en proposer un.
 *
 * `server-only` : une importation depuis un composant client casserait le build.
 */

/** Bucket PRIVÉ des documents PV. Lecture par URL signée à TTL court, jamais publique. */
export const PV_DOCUMENT_BUCKET = "hermes-pv-documents";
/** TTL des URLs signées (secondes). Court : le temps d'ouvrir un document. */
const SIGNED_URL_TTL_SECONDS = 300;
/** Plafond du bucket, redit ici pour refuser AVANT d'envoyer le moindre octet. */
export const PV_DOCUMENT_MAX_BYTES = 26_214_400;
/** Allowlist MIME du bucket, même raison. La base reste l'arbitre final. */
export const PV_DOCUMENT_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

function rows(payload: Record<string, unknown> | null): Record<string, unknown>[] {
  const items = payload?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

async function callRpc(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logEvent("error", "pv.rpc_error", { fn, code: error.code });
    return null;
  }
  return asRecord(data);
}

/** Enveloppe d'écriture : le code de refus métier est RENDU, jamais avalé. */
function outcome(payload: Record<string, unknown> | null, idKey: string): PvWriteOutcome {
  if (!payload) return { ok: false, code: "RPC_ERROR", id: null };
  return {
    ok: Boolean(payload.ok),
    code: String(payload.code ?? "UNKNOWN"),
    id: str(payload[idKey]),
  };
}

// --- Lectures ---------------------------------------------------------------

export async function getPvProspects(params: {
  search?: string | null;
  status?: string | null;
  type?: string | null;
  limit?: number;
} = {}): Promise<PvProspectList> {
  const payload = await callRpc("get_pv_prospects", {
    p_search: params.search ?? null,
    p_status: params.status ?? null,
    p_type: params.type ?? null,
    p_limit: params.limit ?? 50,
  });
  if (!payload || !payload.ok) return { items: [], total: 0 };

  return {
    total: num(payload.total),
    items: rows(payload).map((r) => ({
      id: String(r.id ?? ""),
      prospectType: (r.prospect_type ?? "PARTICULIER") as PvProspectList["items"][number]["prospectType"],
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      companyName: str(r.company_name),
      phone: str(r.phone),
      email: str(r.email),
      source: String(r.source ?? "UNKNOWN"),
      status: (r.status ?? "NEW") as PvProspectStatus,
      qualificationScore: numOrNull(r.qualification_score),
      contactConsent: Boolean(r.contact_consent),
      optedOut: Boolean(r.opted_out),
      siteCount: num(r.site_count),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    })),
  };
}

export async function getPvProspect(prospectId: string): Promise<PvProspectDetail | null> {
  const payload = await callRpc("get_pv_prospect", { p_prospect_id: prospectId });
  if (!payload || !payload.ok) return null;
  const p = asRecord(payload.prospect);
  const sites = Array.isArray(payload.sites) ? (payload.sites as Record<string, unknown>[]) : [];
  const history = Array.isArray(payload.history)
    ? (payload.history as Record<string, unknown>[])
    : [];
  const next = Array.isArray(payload.next_statuses) ? (payload.next_statuses as string[]) : [];

  return {
    id: String(p.id ?? ""),
    prospectType: (p.prospect_type ?? "PARTICULIER") as PvProspectDetail["prospectType"],
    firstName: str(p.first_name),
    lastName: str(p.last_name),
    companyName: str(p.company_name),
    phone: str(p.phone),
    email: str(p.email),
    source: String(p.source ?? "UNKNOWN"),
    sourceDetail: str(p.source_detail),
    campaignRef: str(p.campaign_ref),
    contactConsent: Boolean(p.contact_consent),
    contactConsentAt: str(p.contact_consent_at),
    optedOut: Boolean(p.opted_out),
    status: (p.status ?? "NEW") as PvProspectStatus,
    qualificationScore: numOrNull(p.qualification_score),
    notes: str(p.notes),
    createdAt: str(p.created_at),
    updatedAt: str(p.updated_at),
    sites: sites.map((s) => ({
      id: String(s.id ?? ""),
      label: str(s.label),
      addressLine1: str(s.address_line1),
      postalCode: str(s.postal_code),
      city: str(s.city),
      buildingType: str(s.building_type),
      roofType: str(s.roof_type),
      roofAreaUsableM2: numOrNull(s.roof_area_usable_m2),
      azimuthDeg: numOrNull(s.azimuth_deg),
      tiltDeg: numOrNull(s.tilt_deg),
      shadingLevel: str(s.shading_level),
    })),
    history: history.map((h) => ({
      at: str(h.at),
      summary: str(h.summary),
      by: str(h.by),
    })),
    nextStatuses: next as PvProspectStatus[],
  };
}

export async function getPvSite(siteId: string): Promise<PvSiteDetail | null> {
  const payload = await callRpc("get_pv_site", { p_site_id: siteId });
  if (!payload || !payload.ok) return null;
  const site = asRecord(payload.site);
  if (!site.id) return null;
  return site as PvSiteDetail;
}

export async function getPvConsumptionProfiles(siteId: string): Promise<PvConsumptionProfile[]> {
  const payload = await callRpc("get_pv_consumption_profiles", { p_site_id: siteId });
  return rows(payload).map((c) => ({
    id: String(c.id ?? ""),
    energySupplier: str(c.energy_supplier),
    subscribedPowerKva: numOrNull(c.subscribed_power_kva),
    annualConsumptionKwh: numOrNull(c.annual_consumption_kwh),
    annualCostEur: numOrNull(c.annual_cost_eur),
    unitPriceEurKwh: numOrNull(c.unit_price_eur_kwh),
    tariffOption: str(c.tariff_option),
    deliveryPointRef: str(c.delivery_point_ref),
    periodStart: str(c.period_start),
    periodEnd: str(c.period_end),
    dataSource: String(c.data_source ?? "DECLARATIVE"),
    verificationStatus: (c.verification_status ??
      "UNVERIFIED") as PvConsumptionProfile["verificationStatus"],
  }));
}

export async function getPvEnergyBills(siteId: string): Promise<PvEnergyBill[]> {
  const payload = await callRpc("get_pv_energy_bills", { p_site_id: siteId });
  return rows(payload).map((b) => ({
    id: String(b.id ?? ""),
    supplier: str(b.supplier),
    periodStart: str(b.period_start),
    periodEnd: str(b.period_end),
    issuedOn: str(b.issued_on),
    amountHtEur: numOrNull(b.amount_ht_eur),
    amountTtcEur: numOrNull(b.amount_ttc_eur),
    consumptionKwh: numOrNull(b.consumption_kwh),
    subscribedPowerKva: numOrNull(b.subscribed_power_kva),
    tariffOption: str(b.tariff_option),
    deliveryPointRef: str(b.delivery_point_ref),
    status: (b.status ?? "RECEIVED") as PvEnergyBill["status"],
    verifiedAt: str(b.verified_at),
    rejectionReason: str(b.rejection_reason),
    documentBucket: str(b.document_bucket),
    documentPath: str(b.document_path),
    originalFilename: str(b.original_filename),
    extractionCount: num(b.extraction_count),
    createdAt: str(b.created_at),
  }));
}

export async function getPvBillExtractions(billId: string): Promise<PvBillExtraction[]> {
  const payload = await callRpc("get_pv_bill_extractions", { p_bill_id: billId });
  return rows(payload).map((e) => ({
    id: String(e.id ?? ""),
    billId: String(e.bill_id ?? ""),
    extractedBy: String(e.extracted_by ?? "AGENT_4"),
    modelUsed: str(e.model_used),
    supplier: str(e.supplier),
    periodStart: str(e.period_start),
    periodEnd: str(e.period_end),
    amountTtcEur: numOrNull(e.amount_ttc_eur),
    consumptionKwh: numOrNull(e.consumption_kwh),
    subscribedPowerKva: numOrNull(e.subscribed_power_kva),
    tariffOption: str(e.tariff_option),
    deliveryPointRef: str(e.delivery_point_ref),
    confidence: num(e.confidence),
    promotedToBill: Boolean(e.promoted_to_bill),
    promotedAt: str(e.promoted_at),
    createdAt: str(e.created_at),
  }));
}

export async function getPvStudies(siteId: string): Promise<PvStudy[]> {
  const payload = await callRpc("get_pv_studies", { p_site_id: siteId });
  return rows(payload).map((s) => ({
    id: String(s.id ?? ""),
    version: num(s.version, 1),
    status: (s.status ?? "DRAFT") as PvStudy["status"],
    targetPowerKwc: numOrNull(s.target_power_kwc),
    panelCount: numOrNull(s.panel_count),
    panelUnitPowerW: numOrNull(s.panel_unit_power_w),
    panelBrand: str(s.panel_brand),
    inverterType: str(s.inverter_type),
    inverterBrand: str(s.inverter_brand),
    hasBattery: Boolean(s.has_battery),
    batteryCapacityKwh: numOrNull(s.battery_capacity_kwh),
    annualProductionKwh: numOrNull(s.annual_production_kwh),
    specificYieldKwhKwc: numOrNull(s.specific_yield_kwh_kwc),
    selfConsumptionRatePct: numOrNull(s.self_consumption_rate_pct),
    selfProductionRatePct: numOrNull(s.self_production_rate_pct),
    surplusKwh: numOrNull(s.surplus_kwh),
    systemLossesPct: numOrNull(s.system_losses_pct),
    source: String(s.source ?? "MANUAL"),
    preparedBy: String(s.prepared_by ?? "MANUAL"),
    validatedAt: str(s.validated_at),
    calculatedAt: str(s.calculated_at),
    createdAt: str(s.created_at),
  }));
}

export async function getPvStudyAssumptions(studyId: string): Promise<PvStudyAssumptions | null> {
  const payload = await callRpc("get_pv_study_assumptions", { p_study_id: studyId });
  if (!payload || !payload.ok) return null;
  const a = asRecord(payload.assumptions);
  return {
    studyId: String(a.study_id ?? studyId),
    energyPriceEurKwh: numOrNull(a.energy_price_eur_kwh),
    energyPriceInflationPct: numOrNull(a.energy_price_inflation_pct),
    analysisHorizonYears: numOrNull(a.analysis_horizon_years),
    discountRatePct: numOrNull(a.discount_rate_pct),
    panelDegradationPctYear: numOrNull(a.panel_degradation_pct_year),
    systemLossesPct: numOrNull(a.system_losses_pct),
    surplusSalePriceEurKwh: numOrNull(a.surplus_sale_price_eur_kwh),
    subsidyTotalEur: numOrNull(a.subsidy_total_eur),
    subsidyScheme: str(a.subsidy_scheme),
    vatRatePct: numOrNull(a.vat_rate_pct),
  };
}

export async function getPvEconomics(studyId: string): Promise<PvEconomics[]> {
  const payload = await callRpc("get_pv_economics", { p_study_id: studyId });
  return rows(payload).map((e) => ({
    id: String(e.id ?? ""),
    studyId: String(e.study_id ?? studyId),
    investmentHtEur: numOrNull(e.investment_ht_eur),
    investmentTtcEur: numOrNull(e.investment_ttc_eur),
    subsidyTotalEur: numOrNull(e.subsidy_total_eur),
    netCostEur: numOrNull(e.net_cost_eur),
    year1SavingsEur: numOrNull(e.year1_savings_eur),
    surplusRevenueEur: numOrNull(e.surplus_revenue_eur),
    annualGainEur: numOrNull(e.annual_gain_eur),
    simpleRoiPct: numOrNull(e.simple_roi_pct),
    paybackYears: numOrNull(e.payback_years),
    npvEur: numOrNull(e.npv_eur),
    irrPct: numOrNull(e.irr_pct),
    status: (e.status ?? "DRAFT") as PvEconomics["status"],
    computedBy: String(e.computed_by ?? "MANUAL"),
    verifiedAt: str(e.verified_at),
    createdAt: str(e.created_at),
  }));
}

/**
 * Documents d'un site. Les URLs signées sont produites ICI, à la demande, avec
 * un TTL de 300 s — et ne sont jamais écrites en base. La source de vérité reste
 * le couple (bucket, chemin) que PV-1 impose par CHECK.
 */
export async function getPvDocuments(siteId: string): Promise<PvDocument[]> {
  const payload = await callRpc("get_pv_documents", { p_site_id: siteId });
  const items = rows(payload);
  const paths = items
    .map((d) => str(d.storage_path))
    .filter((p): p is string => p !== null);

  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const supabase = await createSupabaseServerClient();
    const { data: signed } = await supabase.storage
      .from(PV_DOCUMENT_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  return items.map((d) => ({
    id: String(d.id ?? ""),
    siteId: String(d.site_id ?? siteId),
    billId: str(d.bill_id),
    docType: String(d.doc_type ?? "AUTRE"),
    storageBucket: String(d.storage_bucket ?? PV_DOCUMENT_BUCKET),
    storagePath: String(d.storage_path ?? ""),
    mimeType: String(d.mime_type ?? ""),
    sizeBytes: num(d.size_bytes),
    originalFilename: str(d.original_filename),
    status: String(d.status ?? "UPLOADED"),
    uploadedAt: str(d.uploaded_at),
    signedUrl: signedByPath.get(str(d.storage_path) ?? "") ?? null,
  }));
}

// --- Écritures humaines -----------------------------------------------------

export async function upsertPvProspect(input: {
  prospectId?: string | null;
  prospectType?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  campaignRef?: string | null;
  contactConsent?: boolean | null;
  qualificationScore?: number | null;
  ownerUserId?: string | null;
  crmExternalId?: string | null;
  notes?: string | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_prospect", {
    p_prospect_id: input.prospectId ?? null,
    p_prospect_type: input.prospectType ?? null,
    p_first_name: input.firstName ?? null,
    p_last_name: input.lastName ?? null,
    p_company_name: input.companyName ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_source: input.source ?? null,
    p_source_detail: input.sourceDetail ?? null,
    p_campaign_ref: input.campaignRef ?? null,
    p_contact_consent: input.contactConsent ?? null,
    p_qualification_score: input.qualificationScore ?? null,
    p_owner_user_id: input.ownerUserId ?? null,
    p_crm_external_id: input.crmExternalId ?? null,
    p_notes: input.notes ?? null,
  });
  return outcome(payload, "prospect_id");
}

export async function setPvProspectStatus(
  prospectId: string,
  status: string,
): Promise<PvWriteOutcome> {
  const payload = await callRpc("set_pv_prospect_status", {
    p_prospect_id: prospectId,
    p_status: status,
  });
  return { ...outcome(payload, "prospect_id"), id: prospectId };
}

export async function upsertPvSite(input: {
  siteId?: string | null;
  prospectId?: string | null;
  label?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  buildingType?: string | null;
  buildingUse?: string | null;
  occupancy?: string | null;
  roofType?: string | null;
  roofMaterial?: string | null;
  roofCondition?: string | null;
  roofAreaTotalM2?: number | null;
  roofAreaUsableM2?: number | null;
  azimuthDeg?: number | null;
  tiltDeg?: number | null;
  shadingLevel?: string | null;
  shadingLossPct?: number | null;
  heightM?: number | null;
  accessDifficulty?: string | null;
  accessNotes?: string | null;
  knownConstraints?: string | null;
  technicalNotes?: string | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_site", {
    p_site_id: input.siteId ?? null,
    p_prospect_id: input.prospectId ?? null,
    p_label: input.label ?? null,
    p_address_line1: input.addressLine1 ?? null,
    p_address_line2: input.addressLine2 ?? null,
    p_postal_code: input.postalCode ?? null,
    p_city: input.city ?? null,
    p_country_code: input.countryCode ?? null,
    p_building_type: input.buildingType ?? null,
    p_building_use: input.buildingUse ?? null,
    p_occupancy: input.occupancy ?? null,
    p_roof_type: input.roofType ?? null,
    p_roof_material: input.roofMaterial ?? null,
    p_roof_condition: input.roofCondition ?? null,
    p_roof_area_total_m2: input.roofAreaTotalM2 ?? null,
    p_roof_area_usable_m2: input.roofAreaUsableM2 ?? null,
    p_azimuth_deg: input.azimuthDeg ?? null,
    p_tilt_deg: input.tiltDeg ?? null,
    p_shading_level: input.shadingLevel ?? null,
    p_shading_loss_pct: input.shadingLossPct ?? null,
    p_height_m: input.heightM ?? null,
    p_access_difficulty: input.accessDifficulty ?? null,
    p_access_notes: input.accessNotes ?? null,
    p_known_constraints: input.knownConstraints ?? null,
    p_technical_notes: input.technicalNotes ?? null,
  });
  return outcome(payload, "site_id");
}

export async function upsertPvConsumptionProfile(input: {
  profileId?: string | null;
  siteId?: string | null;
  energySupplier?: string | null;
  subscribedPowerKva?: number | null;
  annualConsumptionKwh?: number | null;
  annualCostEur?: number | null;
  unitPriceEurKwh?: number | null;
  tariffOption?: string | null;
  deliveryPointRef?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  dataSource?: string | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_consumption_profile", {
    p_profile_id: input.profileId ?? null,
    p_site_id: input.siteId ?? null,
    p_energy_supplier: input.energySupplier ?? null,
    p_subscribed_power_kva: input.subscribedPowerKva ?? null,
    p_annual_consumption_kwh: input.annualConsumptionKwh ?? null,
    p_annual_cost_eur: input.annualCostEur ?? null,
    p_unit_price_eur_kwh: input.unitPriceEurKwh ?? null,
    p_tariff_option: input.tariffOption ?? null,
    p_delivery_point_ref: input.deliveryPointRef ?? null,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
    p_data_source: input.dataSource ?? null,
  });
  return outcome(payload, "profile_id");
}

export async function registerPvEnergyBill(input: {
  billId?: string | null;
  siteId?: string | null;
  supplier?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  issuedOn?: string | null;
  amountHtEur?: number | null;
  amountTtcEur?: number | null;
  consumptionKwh?: number | null;
  subscribedPowerKva?: number | null;
  tariffOption?: string | null;
  deliveryPointRef?: string | null;
  documentId?: string | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("register_pv_energy_bill", {
    p_bill_id: input.billId ?? null,
    p_site_id: input.siteId ?? null,
    p_supplier: input.supplier ?? null,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
    p_issued_on: input.issuedOn ?? null,
    p_amount_ht_eur: input.amountHtEur ?? null,
    p_amount_ttc_eur: input.amountTtcEur ?? null,
    p_consumption_kwh: input.consumptionKwh ?? null,
    p_subscribed_power_kva: input.subscribedPowerKva ?? null,
    p_tariff_option: input.tariffOption ?? null,
    p_delivery_point_ref: input.deliveryPointRef ?? null,
    p_document_id: input.documentId ?? null,
  });
  return outcome(payload, "bill_id");
}

/** Promeut une LECTURE IA vers la facture — qui passe NEEDS_REVIEW, jamais VERIFIED. */
export async function promotePvBillExtraction(extractionId: string): Promise<PvWriteOutcome> {
  const payload = await callRpc("promote_pv_bill_extraction", {
    p_extraction_id: extractionId,
  });
  if (!payload) return { ok: false, code: "RPC_ERROR", id: null };
  // La façade PV-1 sous-jacente rend `status`, les façades PV-2 rendent `code`.
  return {
    ok: Boolean(payload.ok),
    code: String(payload.code ?? payload.status ?? "UNKNOWN"),
    id: str(payload.bill_id),
  };
}

export async function verifyPvEnergyBill(
  billId: string,
  opts: { reject?: boolean; reason?: string | null } = {},
): Promise<PvWriteOutcome> {
  const payload = await callRpc("verify_pv_energy_bill", {
    p_bill_id: billId,
    p_reject: opts.reject ?? false,
    p_reason: opts.reason ?? null,
  });
  return outcome(payload, "bill_id");
}

export async function validatePvStudy(
  studyId: string,
  opts: { reject?: boolean; reason?: string | null } = {},
): Promise<PvWriteOutcome> {
  const payload = await callRpc("validate_pv_study", {
    p_study_id: studyId,
    p_reject: opts.reject ?? false,
    p_reason: opts.reason ?? null,
  });
  return outcome(payload, "study_id");
}

export async function verifyPvEconomics(
  economicsId: string,
  opts: { reject?: boolean; reason?: string | null } = {},
): Promise<PvWriteOutcome> {
  const payload = await callRpc("verify_pv_economics", {
    p_economics_id: economicsId,
    p_reject: opts.reject ?? false,
    p_reason: opts.reason ?? null,
  });
  return outcome(payload, "economics_id");
}

export async function softDeletePvDocument(documentId: string): Promise<PvWriteOutcome> {
  const payload = await callRpc("soft_delete_pv_document", { p_document_id: documentId });
  return outcome(payload, "document_id");
}

// --- PV-3 : documents réels ---------------------------------------------------

/**
 * Emplacement réservé PAR LA BASE avant téléversement.
 *
 * Le navigateur ne choisit ni le tenant, ni le bucket, ni le chemin : la façade
 * `prepare_pv_document` attribue l'identifiant du document ET construit le chemin
 * `<tenant>/<site>/<document>/<fichier assaini>`. C'est ce qui rend le contrôle
 * de périmètre à la finalisation non contournable.
 */
export async function preparePvDocument(input: {
  siteId: string;
  docType: string;
  filename?: string | null;
}): Promise<{
  ok: boolean;
  code: string;
  documentId: string | null;
  bucket: string;
  path: string | null;
  maxBytes: number;
  allowedMime: string[];
}> {
  const payload = await callRpc("prepare_pv_document", {
    p_site_id: input.siteId,
    p_doc_type: input.docType,
    p_filename: input.filename ?? null,
  });
  if (!payload || !payload.ok) {
    return {
      ok: false,
      code: String(payload?.code ?? "RPC_ERROR"),
      documentId: null,
      bucket: PV_DOCUMENT_BUCKET,
      path: null,
      maxBytes: PV_DOCUMENT_MAX_BYTES,
      allowedMime: [...PV_DOCUMENT_ALLOWED_MIME],
    };
  }
  return {
    ok: true,
    code: "OK",
    documentId: str(payload.document_id),
    bucket: String(payload.bucket ?? PV_DOCUMENT_BUCKET),
    path: str(payload.path),
    maxBytes: num(payload.max_bytes, PV_DOCUMENT_MAX_BYTES),
    allowedMime: Array.isArray(payload.allowed_mime)
      ? (payload.allowed_mime as string[])
      : [...PV_DOCUMENT_ALLOWED_MIME],
  };
}

/**
 * Téléversement COMPLET : prepare → upload serveur → finalize.
 *
 * Les octets transitent par le serveur — compromis assumé, hérité du patron des
 * proxies photo. Un envoi direct navigateur → Storage serait plus rapide mais
 * imposerait d'exposer le tenant au client, ce que toute la chaîne PV refuse.
 *
 * Trois refus AVANT le moindre octet écrit : MIME hors allowlist, taille
 * au-delà du plafond, site hors du tenant. Et si l'upload réussit mais que la
 * finalisation refuse le chemin, l'objet reste ORPHELIN et non référencé —
 * jamais rattaché à une donnée métier.
 */
export async function uploadPvDocument(input: {
  siteId: string;
  docType: string;
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<PvWriteOutcome> {
  if (!PV_DOCUMENT_ALLOWED_MIME.includes(input.mimeType as never)) {
    return { ok: false, code: "BAD_MIME", id: null };
  }
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > PV_DOCUMENT_MAX_BYTES) {
    return { ok: false, code: "BAD_SIZE", id: null };
  }

  const slot = await preparePvDocument({
    siteId: input.siteId,
    docType: input.docType,
    filename: input.filename,
  });
  if (!slot.ok || slot.documentId === null || slot.path === null) {
    return { ok: false, code: slot.code, id: null };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(PV_DOCUMENT_BUCKET)
    .upload(slot.path, input.bytes, { contentType: input.mimeType, upsert: false });
  if (error) {
    logEvent("error", "pv.document_upload_failed", { code: error.name });
    return { ok: false, code: "UPLOAD_FAILED", id: null };
  }

  // SHA-256 du contenu, calculé côté serveur sur les octets réellement reçus.
  // Empreinte d'INTÉGRITÉ, pas de sécurité : elle permet de constater qu'un
  // document a changé, elle n'authentifie personne.
  const digest = await crypto.subtle.digest("SHA-256", input.bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const finalized = await callRpc("finalize_pv_document", {
    p_document_id: slot.documentId,
    p_site_id: input.siteId,
    p_doc_type: input.docType,
    p_path: slot.path,
    p_mime: input.mimeType,
    p_bytes: input.bytes.byteLength,
    p_sha256: sha256,
    p_filename: input.filename,
  });
  return outcome(finalized, "document_id");
}

/** Documents purgeables : supprimés logiquement, hors délai de grâce, encore présents. */
export async function listPvDocumentsToPurge(
  olderThan = "7 days",
  limit = 100,
): Promise<PvPurgeCandidate[]> {
  const payload = await callRpc("list_pv_documents_to_purge", {
    p_older_than: olderThan,
    p_limit: limit,
  });
  return rows(payload).map((d) => ({
    documentId: String(d.document_id ?? ""),
    bucket: String(d.bucket ?? PV_DOCUMENT_BUCKET),
    path: String(d.path ?? ""),
    deletedAt: str(d.deleted_at),
  }));
}

/**
 * PURGE RÉELLE des octets. Ordre NON interchangeable :
 *   1. lister · 2. supprimer via l'API Storage · 3. enregistrer.
 *
 * Marquer avant d'effacer rendrait l'objet définitivement orphelin : plus aucune
 * ligne ne porterait son chemin, donc plus personne ne saurait qu'il existe.
 *
 * IDEMPOTENTE : rejouée, elle ne trouve plus rien à faire. Un document déjà
 * purgé répond `ALREADY_PURGED`, jamais une erreur. Et elle ne peut PAS sortir
 * du tenant : la liste vient d'une façade tenant-scopée, et chaque chemin est
 * re-vérifié contre le préfixe du tenant avant suppression.
 */
export async function purgePvDocuments(options: {
  olderThan?: string;
  limit?: number;
  tenantPrefix?: string;
} = {}): Promise<PvPurgeReport> {
  // PV-4 : la liste est réservée à un `tenant.admin`. Un membre standard obtient
  // `NOT_ADMIN` et donc une liste vide — le rapport doit dire « refusé », pas
  // « rien à purger », sinon un refus de droits passerait pour un succès.
  const listing = await callRpc("list_pv_documents_to_purge", {
    p_older_than: options.olderThan ?? "7 days",
    p_limit: options.limit ?? 100,
  });
  if (!listing || !listing.ok) {
    return { examined: 0, purged: 0, skipped: 0, failed: 0, code: String(listing?.code ?? "RPC_ERROR") };
  }
  const candidates: PvPurgeCandidate[] = rows(listing).map((d) => ({
    documentId: String(d.document_id ?? ""),
    bucket: String(d.bucket ?? PV_DOCUMENT_BUCKET),
    path: String(d.path ?? ""),
    deletedAt: str(d.deleted_at),
  }));
  const report: PvPurgeReport = {
    examined: candidates.length,
    purged: 0,
    skipped: 0,
    failed: 0,
    code: "OK",
  };
  if (candidates.length === 0) return report;

  const supabase = await createSupabaseServerClient();
  for (const c of candidates) {
    // Défense en profondeur : le bucket doit être CELUI du lot, et le chemin doit
    // rester dans l'arborescence du tenant. La façade borne déjà ; on ne délègue
    // pas une suppression irréversible à une seule couche.
    const prefixOk =
      options.tenantPrefix === undefined || c.path.startsWith(`${options.tenantPrefix}/`);
    if (c.bucket !== PV_DOCUMENT_BUCKET || c.path.length === 0 || !prefixOk) {
      report.skipped += 1;
      continue;
    }

    const { error } = await supabase.storage.from(PV_DOCUMENT_BUCKET).remove([c.path]);
    if (error) {
      logEvent("error", "pv.document_purge_failed", { code: error.name });
      report.failed += 1;
      continue;
    }

    const marked = await callRpc("mark_pv_document_purged", {
      p_document_id: c.documentId,
      p_older_than: options.olderThan ?? "7 days",
    });
    if (marked?.ok) report.purged += 1;
    else report.failed += 1;
  }
  return report;
}

// --- PV-3 : travail manuel ----------------------------------------------------

export async function verifyPvConsumptionProfile(
  profileId: string,
  opts: { reject?: boolean; reason?: string | null } = {},
): Promise<PvWriteOutcome> {
  const payload = await callRpc("verify_pv_consumption_profile", {
    p_profile_id: profileId,
    p_reject: opts.reject ?? false,
    p_reason: opts.reason ?? null,
  });
  return outcome(payload, "profile_id");
}

export async function upsertPvStudy(input: {
  studyId?: string | null;
  siteId?: string | null;
  targetPowerKwc?: number | null;
  panelCount?: number | null;
  panelUnitPowerW?: number | null;
  panelBrand?: string | null;
  panelReference?: string | null;
  inverterType?: string | null;
  inverterBrand?: string | null;
  inverterReference?: string | null;
  microinverterCount?: number | null;
  hasBattery?: boolean | null;
  batteryCapacityKwh?: number | null;
  batteryPowerKw?: number | null;
  annualProductionKwh?: number | null;
  specificYieldKwhKwc?: number | null;
  selfConsumptionRatePct?: number | null;
  selfProductionRatePct?: number | null;
  surplusKwh?: number | null;
  systemLossesPct?: number | null;
  calculationMethod?: string | null;
  source?: string | null;
  sourceReference?: string | null;
  notes?: string | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_study", {
    p_study_id: input.studyId ?? null,
    p_site_id: input.siteId ?? null,
    p_target_power_kwc: input.targetPowerKwc ?? null,
    p_panel_count: input.panelCount ?? null,
    p_panel_unit_power_w: input.panelUnitPowerW ?? null,
    p_panel_brand: input.panelBrand ?? null,
    p_panel_reference: input.panelReference ?? null,
    p_inverter_type: input.inverterType ?? null,
    p_inverter_brand: input.inverterBrand ?? null,
    p_inverter_reference: input.inverterReference ?? null,
    p_microinverter_count: input.microinverterCount ?? null,
    p_has_battery: input.hasBattery ?? null,
    p_battery_capacity_kwh: input.batteryCapacityKwh ?? null,
    p_battery_power_kw: input.batteryPowerKw ?? null,
    p_annual_production_kwh: input.annualProductionKwh ?? null,
    p_specific_yield_kwh_kwc: input.specificYieldKwhKwc ?? null,
    p_self_consumption_rate_pct: input.selfConsumptionRatePct ?? null,
    p_self_production_rate_pct: input.selfProductionRatePct ?? null,
    p_surplus_kwh: input.surplusKwh ?? null,
    p_system_losses_pct: input.systemLossesPct ?? null,
    p_calculation_method: input.calculationMethod ?? null,
    p_source: input.source ?? null,
    p_source_reference: input.sourceReference ?? null,
    p_notes: input.notes ?? null,
  });
  return outcome(payload, "study_id");
}

export async function upsertPvStudyAssumptions(input: {
  studyId: string;
  energyPriceEurKwh?: number | null;
  energyPriceInflationPct?: number | null;
  analysisHorizonYears?: number | null;
  discountRatePct?: number | null;
  panelDegradationPctYear?: number | null;
  systemLossesPct?: number | null;
  surplusSalePriceEurKwh?: number | null;
  subsidyTotalEur?: number | null;
  subsidyScheme?: string | null;
  vatRatePct?: number | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_study_assumptions", {
    p_study_id: input.studyId,
    p_energy_price_eur_kwh: input.energyPriceEurKwh ?? null,
    p_energy_price_inflation_pct: input.energyPriceInflationPct ?? null,
    p_analysis_horizon_years: input.analysisHorizonYears ?? null,
    p_discount_rate_pct: input.discountRatePct ?? null,
    p_panel_degradation_pct_year: input.panelDegradationPctYear ?? null,
    p_system_losses_pct: input.systemLossesPct ?? null,
    p_surplus_sale_price_eur_kwh: input.surplusSalePriceEurKwh ?? null,
    p_subsidy_total_eur: input.subsidyTotalEur ?? null,
    p_subsidy_scheme: input.subsidyScheme ?? null,
    p_vat_rate_pct: input.vatRatePct ?? null,
  });
  return outcome(payload, "study_id");
}

export async function setPvStudyStatus(studyId: string, status: string): Promise<PvWriteOutcome> {
  const payload = await callRpc("set_pv_study_status", {
    p_study_id: studyId,
    p_status: status,
  });
  return { ...outcome(payload, "study_id"), id: studyId };
}

export async function upsertPvEconomics(input: {
  economicsId?: string | null;
  studyId?: string | null;
  investmentHtEur?: number | null;
  investmentTtcEur?: number | null;
  subsidyTotalEur?: number | null;
  netCostEur?: number | null;
  year1SavingsEur?: number | null;
  surplusRevenueEur?: number | null;
  annualGainEur?: number | null;
  simpleRoiPct?: number | null;
  paybackYears?: number | null;
  npvEur?: number | null;
  irrPct?: number | null;
}): Promise<PvWriteOutcome> {
  const payload = await callRpc("upsert_pv_economics", {
    p_economics_id: input.economicsId ?? null,
    p_study_id: input.studyId ?? null,
    p_investment_ht_eur: input.investmentHtEur ?? null,
    p_investment_ttc_eur: input.investmentTtcEur ?? null,
    p_subsidy_total_eur: input.subsidyTotalEur ?? null,
    p_net_cost_eur: input.netCostEur ?? null,
    p_year1_savings_eur: input.year1SavingsEur ?? null,
    p_surplus_revenue_eur: input.surplusRevenueEur ?? null,
    p_annual_gain_eur: input.annualGainEur ?? null,
    p_simple_roi_pct: input.simpleRoiPct ?? null,
    p_payback_years: input.paybackYears ?? null,
    p_npv_eur: input.npvEur ?? null,
    p_irr_pct: input.irrPct ?? null,
  });
  return outcome(payload, "economics_id");
}

export async function setPvEconomicsStatus(
  economicsId: string,
  status: string,
): Promise<PvWriteOutcome> {
  const payload = await callRpc("set_pv_economics_status", {
    p_economics_id: economicsId,
    p_status: status,
  });
  return { ...outcome(payload, "economics_id"), id: economicsId };
}

/** Instantané de pilotage — UN appel pour les trois widgets PV. */
export async function getPvPilotSnapshot(limit = 5): Promise<PvPilotSnapshot> {
  const payload = await callRpc("get_pv_pilot_snapshot", { p_limit: limit });
  const empty: PvPilotSnapshot = {
    ok: false,
    studiesToValidate: 0,
    billsToVerify: 0,
    prospectsWithoutSite: 0,
    studies: [],
    bills: [],
    prospects: [],
  };
  if (!payload || !payload.ok) return empty;

  const list = (key: string): Record<string, unknown>[] =>
    Array.isArray(payload[key]) ? (payload[key] as Record<string, unknown>[]) : [];

  return {
    ok: true,
    studiesToValidate: num(payload.studies_to_validate),
    billsToVerify: num(payload.bills_to_verify),
    prospectsWithoutSite: num(payload.prospects_without_site),
    studies: list("studies").map((s) => ({
      id: String(s.id ?? ""),
      siteId: String(s.site_id ?? ""),
      version: num(s.version, 1),
      status: String(s.status ?? "DRAFT"),
      preparedBy: String(s.prepared_by ?? "MANUAL"),
      targetPowerKwc: numOrNull(s.target_power_kwc),
    })),
    bills: list("bills").map((b) => ({
      id: String(b.id ?? ""),
      siteId: String(b.site_id ?? ""),
      supplier: str(b.supplier),
      status: String(b.status ?? "RECEIVED"),
      consumptionKwh: numOrNull(b.consumption_kwh),
    })),
    prospects: list("prospects").map((p) => ({
      id: String(p.id ?? ""),
      firstName: str(p.first_name),
      lastName: str(p.last_name),
      companyName: str(p.company_name),
      status: String(p.status ?? "NEW"),
    })),
  };
}

// --- PV-4 : purge sécurisée, journal, affaire, synthèse PDF ------------------

/**
 * Journal des purges. Lecture ouverte à tout membre du tenant : savoir qu'un
 * document a été détruit, par qui et quand, n'est pas un privilège
 * d'administrateur — c'est ce qui rend l'irréversible acceptable.
 */
export async function getPvPurgeJournal(limit = 100): Promise<PvPurgeJournalEntry[]> {
  const payload = await callRpc("get_pv_purge_journal", { p_limit: limit });
  return rows(payload).map((e) => ({
    documentId: String(e.document_id ?? ""),
    siteId: String(e.site_id ?? ""),
    docType: String(e.doc_type ?? "AUTRE"),
    originalFilename: str(e.original_filename),
    sizeBytes: num(e.size_bytes),
    deletedAt: str(e.deleted_at),
    deletedBy: str(e.deleted_by),
    purgedAt: str(e.purged_at),
    purgedPath: str(e.purged_path),
    purgedBy: str(e.purged_by),
    outcome: String(e.outcome ?? "PURGED"),
  }));
}

/**
 * L'AFFAIRE — une lecture, tout le dossier. Les URL signées des documents sont
 * produites ici, à la demande, et ne sont jamais persistées.
 */
export async function getPvDeal(prospectId: string): Promise<PvDeal | null> {
  const payload = await callRpc("get_pv_deal", { p_prospect_id: prospectId });
  if (!payload || !payload.ok) return null;

  const obj = (key: string): Record<string, unknown> | null => {
    const v = payload[key];
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  };

  const p = obj("prospect");
  if (p === null) return null;
  const s = obj("site");
  const c = obj("consumption");
  const b = obj("verified_bill");
  const rs = obj("retained_study");
  const ls = obj("latest_study");
  const ra = obj("retained_assumptions");
  const re = obj("retained_economics");

  const mapStudy = (x: Record<string, unknown> | null): PvStudy | null =>
    x === null
      ? null
      : {
          id: String(x.id ?? ""),
          version: num(x.version, 1),
          status: (x.status ?? "DRAFT") as PvStudy["status"],
          targetPowerKwc: numOrNull(x.target_power_kwc),
          panelCount: numOrNull(x.panel_count),
          panelUnitPowerW: numOrNull(x.panel_unit_power_w),
          panelBrand: str(x.panel_brand),
          inverterType: str(x.inverter_type),
          inverterBrand: str(x.inverter_brand),
          hasBattery: Boolean(x.has_battery),
          batteryCapacityKwh: numOrNull(x.battery_capacity_kwh),
          annualProductionKwh: numOrNull(x.annual_production_kwh),
          specificYieldKwhKwc: numOrNull(x.specific_yield_kwh_kwc),
          selfConsumptionRatePct: numOrNull(x.self_consumption_rate_pct),
          selfProductionRatePct: numOrNull(x.self_production_rate_pct),
          surplusKwh: numOrNull(x.surplus_kwh),
          systemLossesPct: numOrNull(x.system_losses_pct),
          source: String(x.source ?? "MANUAL"),
          preparedBy: String(x.prepared_by ?? "MANUAL"),
          validatedAt: str(x.validated_at),
          calculatedAt: str(x.calculated_at),
          createdAt: str(x.created_at),
        };

  const docsRaw = Array.isArray(payload.documents)
    ? (payload.documents as Record<string, unknown>[])
    : [];
  const paths = docsRaw.map((d) => str(d.storage_path)).filter((x): x is string => x !== null);
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const supabase = await createSupabaseServerClient();
    const { data: signed } = await supabase.storage
      .from(PV_DOCUMENT_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  const documents: PvDealDocument[] = docsRaw.map((d) => ({
    id: String(d.id ?? ""),
    docType: String(d.doc_type ?? "AUTRE"),
    documentStage: String(d.document_stage ?? "SOURCE"),
    originalFilename: str(d.original_filename),
    mimeType: String(d.mime_type ?? ""),
    sizeBytes: num(d.size_bytes),
    status: String(d.status ?? "UPLOADED"),
    storagePath: str(d.storage_path),
    uploadedAt: str(d.uploaded_at),
    signedUrl: signedByPath.get(str(d.storage_path) ?? "") ?? null,
  }));

  return {
    prospect: {
      id: String(p.id ?? ""),
      prospectType: String(p.prospect_type ?? "PARTICULIER"),
      firstName: str(p.first_name),
      lastName: str(p.last_name),
      companyName: str(p.company_name),
      phone: str(p.phone),
      email: str(p.email),
      source: String(p.source ?? "UNKNOWN"),
      ownerUserId: str(p.owner_user_id),
      contactConsent: Boolean(p.contact_consent),
      contactConsentAt: str(p.contact_consent_at),
      optedOut: Boolean(p.opted_out),
      status: String(p.status ?? "NEW"),
    },
    site:
      s === null
        ? null
        : {
            id: String(s.id ?? ""),
            label: str(s.label),
            addressLine1: str(s.address_line1),
            postalCode: str(s.postal_code),
            city: str(s.city),
            buildingType: str(s.building_type),
            buildingUse: str(s.building_use),
            occupancy: str(s.occupancy),
            roofType: str(s.roof_type),
            roofMaterial: str(s.roof_material),
            roofCondition: str(s.roof_condition),
            roofAreaTotalM2: numOrNull(s.roof_area_total_m2),
            roofAreaUsableM2: numOrNull(s.roof_area_usable_m2),
            azimuthDeg: numOrNull(s.azimuth_deg),
            tiltDeg: numOrNull(s.tilt_deg),
            shadingLevel: str(s.shading_level),
            accessDifficulty: str(s.access_difficulty),
          },
    consumption:
      c === null
        ? null
        : {
            id: String(c.id ?? ""),
            energySupplier: str(c.energy_supplier),
            subscribedPowerKva: numOrNull(c.subscribed_power_kva),
            annualConsumptionKwh: numOrNull(c.annual_consumption_kwh),
            annualCostEur: numOrNull(c.annual_cost_eur),
            unitPriceEurKwh: numOrNull(c.unit_price_eur_kwh),
            tariffOption: str(c.tariff_option),
            deliveryPointRef: str(c.delivery_point_ref),
            periodStart: str(c.period_start),
            periodEnd: str(c.period_end),
            dataSource: String(c.data_source ?? "DECLARATIVE"),
            verificationStatus: (c.verification_status ??
              "UNVERIFIED") as PvConsumptionProfile["verificationStatus"],
          },
    verifiedBill:
      b === null
        ? null
        : {
            id: String(b.id ?? ""),
            supplier: str(b.supplier),
            periodStart: str(b.period_start),
            periodEnd: str(b.period_end),
            issuedOn: str(b.issued_on),
            amountHtEur: numOrNull(b.amount_ht_eur),
            amountTtcEur: numOrNull(b.amount_ttc_eur),
            consumptionKwh: numOrNull(b.consumption_kwh),
            subscribedPowerKva: numOrNull(b.subscribed_power_kva),
            tariffOption: str(b.tariff_option),
            deliveryPointRef: str(b.delivery_point_ref),
            status: (b.status ?? "RECEIVED") as PvEnergyBill["status"],
            verifiedAt: str(b.verified_at),
            rejectionReason: str(b.rejection_reason),
            documentBucket: str(b.document_bucket),
            documentPath: str(b.document_path),
            originalFilename: str(b.original_filename),
            extractionCount: 0,
            createdAt: str(b.created_at),
          },
    retainedStudy: mapStudy(rs),
    latestStudy: mapStudy(ls),
    retainedAssumptions:
      ra === null
        ? null
        : {
            studyId: String(ra.study_id ?? ""),
            energyPriceEurKwh: numOrNull(ra.energy_price_eur_kwh),
            energyPriceInflationPct: numOrNull(ra.energy_price_inflation_pct),
            analysisHorizonYears: numOrNull(ra.analysis_horizon_years),
            discountRatePct: numOrNull(ra.discount_rate_pct),
            panelDegradationPctYear: numOrNull(ra.panel_degradation_pct_year),
            systemLossesPct: numOrNull(ra.system_losses_pct),
            surplusSalePriceEurKwh: numOrNull(ra.surplus_sale_price_eur_kwh),
            subsidyTotalEur: numOrNull(ra.subsidy_total_eur),
            subsidyScheme: str(ra.subsidy_scheme),
            vatRatePct: numOrNull(ra.vat_rate_pct),
          },
    retainedEconomics:
      re === null
        ? null
        : {
            id: String(re.id ?? ""),
            studyId: String(re.study_id ?? ""),
            investmentHtEur: numOrNull(re.investment_ht_eur),
            investmentTtcEur: numOrNull(re.investment_ttc_eur),
            subsidyTotalEur: numOrNull(re.subsidy_total_eur),
            netCostEur: numOrNull(re.net_cost_eur),
            year1SavingsEur: numOrNull(re.year1_savings_eur),
            surplusRevenueEur: numOrNull(re.surplus_revenue_eur),
            annualGainEur: numOrNull(re.annual_gain_eur),
            simpleRoiPct: numOrNull(re.simple_roi_pct),
            paybackYears: numOrNull(re.payback_years),
            npvEur: numOrNull(re.npv_eur),
            irrPct: numOrNull(re.irr_pct),
            status: (re.status ?? "DRAFT") as PvEconomics["status"],
            computedBy: String(re.computed_by ?? "MANUAL"),
            verifiedAt: str(re.verified_at),
            createdAt: str(re.created_at),
          },
    studies: (Array.isArray(payload.studies) ? (payload.studies as Record<string, unknown>[]) : []).map(
      (x) => ({
        id: String(x.id ?? ""),
        version: num(x.version, 1),
        status: String(x.status ?? "DRAFT"),
        preparedBy: String(x.prepared_by ?? "MANUAL"),
        targetPowerKwc: numOrNull(x.target_power_kwc),
      }),
    ),
    documents,
  };
}

/**
 * GÉNÈRE la synthèse d'étude en PDF, la dépose dans le bucket privé et
 * l'enregistre dans `pv_documents`.
 *
 * Le stade est DÉCIDÉ ICI, à partir de l'état réel du dossier — jamais à partir
 * d'un paramètre client. Un FINAL demandé sur un dossier qui ne l'est pas est
 * refusé (`PDF_FINAL_NOT_READY`), et la base le revérifie de son côté : deux
 * gardes indépendantes sur la seule chose qu'on ne veut pas se tromper.
 *
 * IDEMPOTENCE : `requestId` porte la demande. Rejouée, elle renvoie le document
 * déjà produit — aucun second fichier, aucun second objet dans le bucket.
 */
export async function generatePvStudySummary(input: {
  prospectId: string;
  requestId: string;
  wantFinal: boolean;
  company: string;
  generatedOn: string;
}): Promise<PvPdfOutcome> {
  const deal = await getPvDeal(input.prospectId);
  if (deal === null) return { ok: false, code: "NOT_FOUND", documentId: null, stage: null, reason: null };

  const study = deal.retainedStudy ?? deal.latestStudy;
  if (study === null) {
    return { ok: false, code: "NO_STUDY", documentId: null, stage: null, reason: "NO_STUDY" };
  }

  const readiness = resolvePvReadiness({
    prospect: { status: deal.prospect.status, optedOut: deal.prospect.optedOut },
    site: deal.site,
    consumption: deal.consumption,
    verifiedBill: deal.verifiedBill,
    retainedStudy: deal.retainedStudy,
    latestStudy: deal.latestStudy,
    retainedEconomics: deal.retainedEconomics,
    hasAnyEconomics: deal.retainedEconomics !== null,
  });

  if (input.wantFinal && !readiness.canGenerateFinalPdf) {
    const reason =
      deal.retainedStudy === null
        ? "STUDY_NOT_VALIDATED"
        : deal.retainedEconomics === null
          ? "ECONOMICS_NOT_VERIFIED"
          : readiness.missingRequirements[0] ?? "NOT_READY";
    return { ok: false, code: "PDF_FINAL_NOT_READY", documentId: null, stage: null, reason };
  }

  const stage: "DRAFT" | "FINAL" = input.wantFinal ? "FINAL" : "DRAFT";
  const dbStage = stage === "FINAL" ? "STUDY_SUMMARY_FINAL" : "STUDY_SUMMARY_DRAFT";

  const pdf = buildPvStudyPdf(
    buildPvDealPdfModel({
      deal,
      readiness,
      stage,
      company: input.company,
      generatedOn: input.generatedOn,
    }),
  );

  const digest = await crypto.subtle.digest("SHA-256", pdf.slice().buffer as ArrayBuffer);
  const sha256 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Chemin déterministe, sous le préfixe du tenant et du site : la base le
  // revalide, et la même demande écrit toujours au même endroit.
  const siteId = deal.site?.id ?? "";
  if (siteId.length === 0) {
    return { ok: false, code: "NO_SITE", documentId: null, stage: null, reason: "NO_SITE" };
  }
  // Le tenant n'est jamais reconstruit côté client : on demande l'emplacement à
  // la base, exactement comme pour un dépôt. Le chemin en revient complet.
  const slot = await preparePvDocument({
    siteId,
    docType: "NOTE_TECHNIQUE",
    filename: `synthese-${input.requestId}.pdf`,
  });
  if (!slot.ok || slot.path === null) {
    return { ok: false, code: slot.code, documentId: null, stage: null, reason: null };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(PV_DOCUMENT_BUCKET)
    .upload(slot.path, pdf, { contentType: "application/pdf", upsert: true });
  if (error) {
    logEvent("error", "pv.study_summary_upload_failed", { code: error.name });
    return { ok: false, code: "UPLOAD_FAILED", documentId: null, stage: null, reason: null };
  }

  const registered = await callRpc("register_pv_study_summary", {
    p_request_id: input.requestId,
    p_study_id: study.id,
    p_economics_id: deal.retainedEconomics?.id ?? null,
    p_stage: dbStage,
    p_path: slot.path,
    p_bytes: pdf.byteLength,
    p_sha256: sha256,
  });

  if (!registered || !registered.ok) {
    return {
      ok: false,
      code: String(registered?.code ?? "RPC_ERROR"),
      documentId: null,
      stage: null,
      reason: str(registered?.reason),
    };
  }
  return {
    ok: true,
    code: String(registered.code ?? "GENERATED"),
    documentId: str(registered.document_id),
    stage,
    reason: null,
  };
}
