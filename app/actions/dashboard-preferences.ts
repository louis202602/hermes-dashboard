"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server Action for DASH-4A: persist the caller's dashboard preferences through the
 * REAL optimistic-concurrency RPC `upsert_dashboard_user_preferences`. Tenant + user
 * scoping and the version check are enforced server-side (fail-closed). A stale
 * `expectedVersion` returns `VERSION_CONFLICT` — never a silent overwrite. No LLM,
 * no external call. The caller writes only on an explicit user change (debounced).
 */

export type SavePreferencesResult = {
  ok: boolean;
  status: string;
  version?: number;
};

export async function saveDashboardPreferencesAction(
  patch: Record<string, unknown>,
  expectedVersion: number,
): Promise<SavePreferencesResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      "upsert_dashboard_user_preferences",
      { p_patch: patch, p_expected_version: expectedVersion },
    );
    if (error) {
      return { ok: false, status: "RPC_ERROR" };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(d.ok),
      status: String(d.status ?? "UNKNOWN"),
      version:
        typeof d.version === "number" ? (d.version as number) : undefined,
    };
  } catch {
    return { ok: false, status: "EXCEPTION" };
  }
}
