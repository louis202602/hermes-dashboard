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

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
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
    city: str(raw.city),
    contactName: str(raw.contact_name),
    email: str(raw.email),
    phone: str(raw.phone),
    qualificationScore: numOrNull(raw.qualification_score),
    leadTemperature: temperature(raw.lead_temperature),
    priorityReason: str(raw.priority_reason),
    replyStatus: str(raw.reply_status),
    replySummary: str(raw.reply_summary),
    lastContactAt: str(raw.last_contact_at),
    needsCallback: bool(raw.needs_callback),
    nextAction: str(raw.next_action),
    nextActionAt: str(raw.next_action_at),
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
  return [lead.companyName, lead.city, lead.contactName, lead.email, lead.phone]
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
  // (ville, contact et téléphone inclus), on récupère le lot complet actuel (max RPC 200)
  // puis on applique ici le filtre canonique côté serveur. Aucun faux « aucun résultat ».
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
