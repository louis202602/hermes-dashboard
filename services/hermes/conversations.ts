import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  RecentConversation,
  RecentConversations,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

function mapConversation(raw: Record<string, unknown>): RecentConversation {
  return {
    id: String(raw.id ?? ""),
    title: (raw.title as string) ?? "Conversation",
    preview: (raw.preview as string) ?? "",
    outcome: (raw.outcome as string) ?? null,
    lastMessageAt: (raw.last_message_at as string) ?? null,
  };
}

/**
 * The caller's own recent Hermès conversations, tenant/user-scoped. Authorization
 * (auth + tenant resolution + `user_id = auth.uid()`) is enforced entirely inside
 * the backend RPC `public.get_recent_hermes_conversations`; a non-OK
 * `resolutionStatus` returns no rows (fail-closed).
 */
export async function getRecentConversations(
  limit = 6,
): Promise<ServiceResult<RecentConversations>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(
      "get_recent_hermes_conversations",
      { p_limit: limit },
    );

    if (error) {
      logEvent("error", "conversations.rpc_error", { code: error.code });
      return { ok: false, provenance: "UNAVAILABLE", error: error.message };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const resolutionStatus = (payload.resolution_status ??
      "UNAUTHENTICATED") as TenantResolutionStatus;
    const rawConversations = Array.isArray(payload.conversations)
      ? (payload.conversations as Record<string, unknown>[])
      : [];

    logEvent("info", "conversations.resolved", {
      status: resolutionStatus,
      count: rawConversations.length,
    });

    return {
      ok: true,
      provenance: "REAL",
      data: {
        resolutionStatus,
        tenantId: (payload.tenant_id as string) ?? null,
        conversations: rawConversations.map(mapConversation),
      },
    };
  } catch (err) {
    logEvent("error", "conversations.exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      provenance: "UNAVAILABLE",
      error: "Conversations service unavailable.",
    };
  }
}
