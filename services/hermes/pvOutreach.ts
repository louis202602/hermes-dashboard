import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PvOutreachKpi } from "@/types/pvOutreachKpi";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export async function getPvOutreachKpi(): Promise<PvOutreachKpi | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_pv_outreach_kpi");

  if (error) {
    logEvent("error", "pv.outreach_kpi_rpc_error", { code: error.code });
    return null;
  }

  const raw = asRecord(data);
  if (raw.ok === false) return null;

  return {
    date: str(raw.date),
    zone: str(raw.zone),
    sentToday: num(raw.sent_today),
    sendingToday: num(raw.sending_today),
    queuedToday: num(raw.queued_today),
    failedToday: num(raw.failed_today),
    engagedToday: num(raw.engaged_today),
    target: num(raw.target) || 20,
    remainingToTarget: num(raw.remaining_to_target),
    repliesToday: num(raw.replies_today),
    actionableRepliesToday: num(raw.actionable_replies_today),
    bouncesToday: num(raw.bounces_today),
    unsubscribesToday: num(raw.unsubscribes_today),
    globalStopActive: bool(raw.global_stop_active),
    qualifiedTotal: num(raw.qualified_total),
    qualifiedWithEmail: num(raw.qualified_with_email),
  };
}
