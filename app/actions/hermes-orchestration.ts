"use server";

import { orchestrateHermesMessage } from "@/services/hermes/orchestration";
import type { OrchestrationResult } from "@/types/hermes-orchestration";

/**
 * Server Action: submit one Hermès conversational turn. The client generates a
 * `requestId` (idempotency key for any resulting action). All authorization,
 * policy (SW15) and execution remain server-side — this action only forwards
 * the free text and surfaces the canonical outcome. Errors are never hidden.
 */
export async function submitHermesMessageAction(
  message: string,
  conversationId: string | null,
  requestId: string | null,
): Promise<OrchestrationResult> {
  const text = (message ?? "").trim();
  if (text.length === 0) {
    return {
      ok: false,
      outcome: "ERROR",
      reply: "Saisissez un message.",
      status: "VALIDATION_FAILED",
      error: { code: "EMPTY_MESSAGE", message: "Message requis." },
    };
  }
  return orchestrateHermesMessage(text, conversationId ?? null, requestId ?? null);
}
