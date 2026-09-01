import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PvDailyKpi } from "@/types/pvDailyKpi";
import type { PvLeadInbox, PvLeadInboxItem, PvLeadTemperature } from "@/types/pvLead";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstStr(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = str(value);
    if (parsed) return parsed;
  }
  return null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function temperature(value: unknown): PvLeadTemperature | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const v = String(value).toUpperCase();
  if (v === "FROID" || v === "TIEDE" || v === "CHAUD" || v === "TRES_PRIORITAIRE") return v;
  return null;
}

function mapLead(raw: Record<string, unknown>): PvLeadInboxItem {
  return {
    prospectId: String(raw.prospect_id ?? ""),
    companyName: str(raw.company_name),
    siren: firstStr(raw.siren, raw.company_siren),
    siret: firstStr(raw.siret, raw.company_siret),
    city: str(raw.city),
    sector: firstStr(raw.sector, raw.secteur),
    activity: firstStr(raw.activity, raw.activite, raw.naf_label),
    contactName: str(raw.contact_name),
    contactRole: firstStr(raw.contact_role, raw.contact_function, raw.fonction),
    email: str(raw.email),
    phone: str(raw.phone),
    domain: firstStr(raw.domain, raw.website_domain),
    sourceMethod: firstStr(raw.source_method, raw.source),
    sourceProvider: firstStr(raw.source_provider, raw.provider),
    sourceUrl: firstStr(raw.source_url, raw.contact_source_url),
    identityConfidence: str(raw.identity_confidence),
    contactScope: str(raw.contact_scope),
    verificationSources: strings(raw.verification_sources),
    qualificationStatus: firstStr(raw.qualification_status, raw.status),
    qualificationReason: firstStr(raw.qualification_reason, raw.priority_reason),
    qualificationScore: numOrNull(raw.qualification_score),
    pvCommercialQualified: boolOrNull(raw.pv_commercial_qualified),
    pvSiteVerified: boolOrNull(raw.pv_site_verified),
    leadTemperature: temperature(raw.lead_temperature),
    priorityReason: str(raw.priority_reason),
    agentId: firstStr(raw.agent_id, raw.producer_agent_id),
    workflowId: firstStr(raw.workflow_id, raw.producer_workflow_id),
    createdAt: firstStr(raw.created_at, raw.prospect_created_at),
    verifiedAt: firstStr(raw.verified_at, raw.identity_verified_at),
    emailStatus: firstStr(raw.email_status, raw.outreach_status),
    sentAt: firstStr(raw.sent_at, raw.email_sent_at),
    deliveredAt: firstStr(raw.delivered_at, raw.email_delivered_at),
    bounce: boolOrNull(raw.bounce),
    bounceReason: firstStr(raw.bounce_reason, raw.last_bounce_reason),
    replyStatus: str(raw.reply_status),
    replyClass: firstStr(raw.reply_class, raw.reply_category),
    replySummary: str(raw.reply_summary),
    lastContactAt: str(raw.last_contact_at),
    followupsSent: numOrNull(raw.followups_sent),
    needsCallback: bool(raw.needs_callback),
    nextAction: str(raw.next_action),
    nextActionAt: str(raw.next_action_at),
    callPending: boolOrNull(raw.call_pending),
    callStatus: str(raw.call_status),
    callOutcome: str(raw.call_outcome),
    meetingStatus: str(raw.meeting_status),
    meetingAt: firstStr(raw.meeting_at, raw.meeting_start_at),
    alertPriority: str(raw.alert_priority),
    alertChannelsRequired: strings(raw.alert_channels_required),
    lastNotifiedAt: str(raw.last_notified_at),
    projectId: str(raw.project_id),
    projectStatus: str(raw.project_status),
    puissanceKwc: numOrNull(raw.puissance_kwc),
  };
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
}

function matchesSearch(lead: PvLeadInboxItem, query: string): boolean {
  const needle = normalized(query);
  return [
    lead.companyName,
    lead.siren,
    lead.siret,
    lead.city,
    lead.sector,
    lead.activity,
    lead.contactName,
    lead.contactRole,
    lead.email,
    lead.phone,
    lead.domain,
    lead.sourceMethod,
    lead.sourceProvider,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalized(value).includes(needle));
}

export async function getPvLeadInbox(params: {
  temperature?: PvLeadTemperature | null;
  needsCallback?: boolean | null;
  search?: string | null;
  limit?: number;
} = {}): Promise<PvLeadInbox> {
  const supabase = await createSupabaseServerClient();
  const requestedLimit = Math.min(Math.max(params.limit ?? 200, 1), 200);
  const hasSearch = Boolean(params.search?.trim());

  // La RPC historique ne recherche que société/e-mail. Pour garantir ce que l'UI promet
  // (identité, ville, contact, téléphone, domaine inclus), on récupère le lot complet actuel
  // (max RPC 200) puis on applique ici le filtre canonique côté serveur.
  const { data, error } = await supabase.rpc("get_pv_lead_inbox", {
    p_temperature: params.temperature ?? null,
    p_needs_callback: params.needsCallback ?? null,
    p_search: hasSearch ? null : params.search ?? null,
    p_limit: hasSearch ? 200 : requestedLimit,
  });

  if (error) {
    logEvent("error", "pv.lead_inbox_rpc_error", { code: error.code });
    return { items: [], total: 0 };
  }

  const envelope = asRecord(data);
  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(envelope.items)
      ? envelope.items
      : Array.isArray(envelope.leads)
        ? envelope.leads
        : [];

  const mapped = (rawItems as Record<string, unknown>[])
    .map(mapLead)
    .filter((lead) => lead.prospectId);
  const filtered = hasSearch
    ? mapped.filter((lead) => matchesSearch(lead, params.search!.trim()))
    : mapped;

  const rawTotal = envelope.total;
  const parsedTotal = typeof rawTotal === "string" ? Number(rawTotal) : (rawTotal as number);

  return {
    items: filtered.slice(0, requestedLimit),
    total: hasSearch
      ? filtered.length
      : Number.isFinite(parsedTotal)
        ? parsedTotal
        : filtered.length,
  };
}

export async function getPvDailyKpi(): Promise<PvDailyKpi | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_pv_daily_kpi");

  if (error) {
    logEvent("error", "pv.daily_kpi_rpc_error", { code: error.code });
    return null;
  }

  const raw = asRecord(data);
  if (raw.ok === false) return null;

  return {
    date: str(raw.date),
    zone: str(raw.zone),
    qualifiedCallableCount: numOrNull(raw.qualified_callable_count) ?? 0,
    target: numOrNull(raw.target) ?? 20,
    remaining: numOrNull(raw.remaining) ?? 0,
    weeklyCount: numOrNull(raw.weekly_count) ?? 0,
    weeklyTarget: numOrNull(raw.weekly_target) ?? 100,
    readyProspectIds: strings(raw.ready_prospect_ids),
  };
}
