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

/** Generic multi-vertical agenda retained for non-PV surfaces. */
export async function getDashboardAgenda(): Promise<ServiceResult<DashboardAgenda>> {
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
 * Agenda photovoltaïque réel: rendez-vous Hermès, dates chantier, échéances de
 * devis et d'acomptes. Aucune donnée BTP générique ni donnée de démonstration.
 */
export async function getPvAgenda(): Promise<ServiceResult<DashboardAgenda>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_pv_agenda", { p_limit: 100 });
    if (error) {
      logEvent("error", "pv_agenda.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseAgenda(data) };
  } catch (e) {
    logEvent("error", "pv_agenda.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "pv_agenda" };
  }
}

/** Unified actionable alerts. */
export async function getUnifiedAlerts(): Promise<ServiceResult<UnifiedAlerts>> {
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
