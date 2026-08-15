import "server-only";

import {
  parseAgentActionStats,
  parseCommercial,
  type AgentActionStats,
  type DashboardCommercial,
} from "@/lib/dashboard/systemActivity";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";

/**
 * Caller-tenant agent_action_requests counts by status (queue health). Bounded
 * aggregate — no row dump, no PII. Tenant scoping enforced in the RPC.
 */
export async function getAgentActionStats(): Promise<
  ServiceResult<AgentActionStats>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_agent_action_stats");
    if (error) {
      logEvent("error", "action_stats.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseAgentActionStats(data) };
  } catch (e) {
    logEvent("error", "action_stats.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "action_stats" };
  }
}

/**
 * Real btp_devis commercial aggregates (EUR): sent / to-follow-up / accepted +
 * TTC amounts. Invoices / prospects / contracts are absent and never fabricated.
 */
export async function getDashboardCommercial(): Promise<
  ServiceResult<DashboardCommercial>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_dashboard_commercial");
    if (error) {
      logEvent("error", "commercial.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseCommercial(data) };
  } catch (e) {
    logEvent("error", "commercial.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "commercial" };
  }
}
