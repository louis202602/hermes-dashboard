"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function setActiveTenantAction(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dashboard_set_active_tenant", {
    p_tenant_id: tenantId,
  });

  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) {
    return { ok: false, error: String(payload.reason ?? "TENANT_SWITCH_FAILED") };
  }

  revalidatePath("/", "layout");
  return { ok: true, tenantId: String(payload.tenant_id ?? tenantId) };
}
