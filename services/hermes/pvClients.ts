import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PvClient = {
  prospectId: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  prospectStatus: string | null;
  qualificationScore: number | null;
  projectId: string | null;
  projectStatus: string | null;
  executionMode: string | null;
  puissanceKwc: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getPvClients(limit = 200): Promise<{ items: PvClient[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_pv_clients", {
    p_search: null,
    p_status: null,
    p_limit: Math.min(Math.max(limit, 1), 200),
  });

  if (error) {
    logEvent("error", "pv.clients_rpc_error", { code: error.code });
    return { items: [], total: 0 };
  }

  const envelope = record(data);
  const source = Array.isArray(envelope.items) ? envelope.items : [];
  const items = (source as unknown[]).map((value) => {
    const row = record(value);
    return {
      prospectId: String(row.prospect_id ?? ""),
      companyName: text(row.company_name),
      firstName: text(row.first_name),
      lastName: text(row.last_name),
      email: text(row.email),
      phone: text(row.phone),
      prospectStatus: text(row.prospect_status),
      qualificationScore: numberOrNull(row.qualification_score),
      projectId: text(row.active_project_id),
      projectStatus: text(row.project_status),
      executionMode: text(row.mode_execution),
      puissanceKwc: numberOrNull(row.puissance_kwc),
    } satisfies PvClient;
  }).filter((item) => item.prospectId);

  const total = Number(envelope.total);
  return { items, total: Number.isFinite(total) ? total : items.length };
}
