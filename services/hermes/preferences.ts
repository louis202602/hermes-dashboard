import "server-only";

import { cache } from "react";

import {
  parsePreferences,
  type DashboardPreferences,
} from "@/lib/dashboard/preferences";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceResult } from "@/types/hermes";

/**
 * The caller's own dashboard preferences (user-scoped). Tenant scoping + own-row
 * filtering are enforced in the RPC. Anything unresolved collapses to the Hermès
 * defaults (parsePreferences), never a fabricated or cross-user value.
 *
 * Wrapped in React `cache()` so the layout (SSR anti-FOUC) and the page/settings
 * route share ONE actual DB read per request (COST-FIRST: NEW_DB_READS = 1).
 */
export const getDashboardUserPreferences = cache(async function getDashboardUserPreferences(): Promise<
  ServiceResult<DashboardPreferences>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      "get_dashboard_user_preferences",
    );
    if (error) {
      logEvent("error", "user_prefs.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }
    return { ok: true, provenance: "REAL", data: parsePreferences(data) };
  } catch (e) {
    logEvent("error", "user_prefs.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, provenance: "UNAVAILABLE", error: "user_prefs" };
  }
});
