import "server-only";

import {
  parseAgenda,
  parseAlerts,
  type DashboardAgenda,
  type UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";

/**
 * Today's agenda (BTP phases, project start/end, approval expiries) bucketed in
 * the tenant timezone. Tenant scoping + fail-soft aggregation live in the RPC.
 */
export async function getDashboardAgenda(): Promise<
  ServiceResult<DashboardAgenda>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_dashboard_agenda");
    if (error) {
      logEvent("error", "agenda.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseAgenda(data) };
  } catch (e) {
    logEvent("error", "agenda.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "agenda" };
  }
}

/**
 * Unified actionable alerts (pending approvals, open incidents, resolver circuit,
 * budget threshold, quota blocks, late chantiers, dead-letters) normalised to
 * INFO/WARNING/HIGH/CRITICAL. Deterministic — no LLM.
 */
export async function getUnifiedAlerts(): Promise<
  ServiceResult<UnifiedAlerts>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_unified_alerts");
    if (error) {
      logEvent("error", "alerts.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseAlerts(data) };
  } catch (e) {
    logEvent("error", "alerts.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "alerts" };
  }
}
