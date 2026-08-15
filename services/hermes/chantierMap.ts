import "server-only";

import {
  parseChantiersMap,
  type ChantierMapData,
} from "@/lib/dashboard/chantierMap";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";

/**
 * The active tenant's geocoded worksites for the map. Tenant scoping + own-tenant
 * filtering are enforced in the RPC. Never fabricated; anything unresolved collapses
 * to an empty list.
 */
export async function getChantiersMap(): Promise<ServiceResult<ChantierMapData>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_chantiers_map");
    if (error) {
      logEvent("error", "chantier_map.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parseChantiersMap(data) };
  } catch (e) {
    logEvent("error", "chantier_map.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "chantier_map" };
  }
}
