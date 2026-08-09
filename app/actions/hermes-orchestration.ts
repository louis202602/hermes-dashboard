"use server";

import {
  applyHermesResolution,
  orchestrateHermesMessage,
} from "@/services/hermes/orchestration";
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

/**
 * Server Action: apply a completed semantic resolution. The client calls this
 * once the resolve request reaches a terminal state. Re-validation and
 * execution happen server-side; the model is never the authority.
 */
export async function applyHermesResolutionAction(
  conversationId: string,
  resolveRequestId: string,
  requestId: string | null,
): Promise<OrchestrationResult> {
  if (!conversationId || !resolveRequestId) {
    return {
      ok: false,
      outcome: "ERROR",
      reply: "Résolution invalide.",
      status: "VALIDATION_FAILED",
      error: { code: "INVALID_ARGS", message: "Arguments requis." },
    };
  }
  return applyHermesResolution(conversationId, resolveRequestId, requestId ?? null);
}
