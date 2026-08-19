import "server-only";

import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrchestrationResult } from "@/types/hermes-orchestration";

function asError(value: unknown): { code?: string; message?: string } | null {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return { code: v.code as string, message: v.message as string };
  }
  return null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((v) => String(v)) : null;
}

/**
 * Send one free-text message to the Hermès orchestrator. Intent resolution,
 * capability selection, policy delegation, persistence and audit all happen
 * server-side in `hermes_os`. The frontend only renders the canonical outcome.
 */
export async function orchestrateHermesMessage(
  message: string,
  conversationId: string | null,
  // PHASE 2 — la clé d'idempotence n'est plus fournie EXCLUSIVEMENT par le client :
  // faute de clé, le serveur en génère une. Même patron que
  // `services/hermes/agentActions.ts`, qui le faisait déjà (`= randomUUID()`).
  requestId: string | null = null,
): Promise<OrchestrationResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("orchestrate_hermes_message", {
      p_message: message,
      p_conversation_id: conversationId,
      p_request_id: requestId ?? randomUUID(),
    });

    if (error) {
      logEvent("error", "hermes.orchestrate_rpc_error", { code: error.code });
      return {
        ok: false,
        outcome: "ERROR",
        reply: "Le service est indisponible. Réessayez plus tard.",
        status: "RPC_ERROR",
        error: { code: error.code, message: "Le service est indisponible." },
      };
    }

    const d = (data ?? {}) as Record<string, unknown>;
    logEvent("info", "hermes.orchestrated", { outcome: d.outcome, status: d.status });
    return mapOrchestration(d);
  } catch (err) {
    logEvent("error", "hermes.orchestrate_exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      outcome: "ERROR",
      reply: "Le service est indisponible. Réessayez plus tard.",
      status: "RPC_ERROR",
      error: { code: "EXCEPTION", message: "Le service est indisponible." },
    };
  }
}

function mapOrchestration(d: Record<string, unknown>): OrchestrationResult {
  return {
    ok: Boolean(d.ok),
    outcome: (d.outcome as string) ?? "ERROR",
    conversationId: (d.conversation_id as string) ?? null,
    userMessageId: (d.user_message_id as string) ?? null,
    assistantMessageId: (d.assistant_message_id as string) ?? null,
    reply: (d.reply as string) ?? "",
    actionKey: (d.action_key as string) ?? null,
    requestId: (d.request_id as string) ?? null,
    resolveRequestId: (d.resolve_request_id as string) ?? null,
    correlationId: (d.correlation_id as string) ?? null,
    confidence: (d.confidence as string) ?? null,
    missing: asStringArray(d.missing),
    candidates: asStringArray(d.candidates),
    status: (d.status as string) ?? (d.outcome as string) ?? "ERROR",
    error: asError(d.error),
  };
}

/**
 * Apply a completed semantic resolution: the backend RE-VALIDATES the model's
 * proposal against the registry and executes via the gateway (or fails closed).
 * Runs as the authenticated user, so permissions / tenant / SW15 all apply.
 */
export async function applyHermesResolution(
  conversationId: string,
  resolveRequestId: string,
  // PHASE 2 — la clé d'idempotence n'est plus fournie EXCLUSIVEMENT par le client :
  // faute de clé, le serveur en génère une. Même patron que
  // `services/hermes/agentActions.ts`, qui le faisait déjà (`= randomUUID()`).
  requestId: string | null = null,
): Promise<OrchestrationResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("apply_hermes_resolution", {
      p_conversation_id: conversationId,
      p_resolve_request_id: resolveRequestId,
      p_request_id: requestId ?? randomUUID(),
    });
    if (error) {
      logEvent("error", "hermes.apply_rpc_error", { code: error.code });
      return {
        ok: false,
        outcome: "ERROR",
        reply: "Le service est indisponible. Réessayez plus tard.",
        status: "RPC_ERROR",
        error: { code: error.code, message: "Le service est indisponible." },
      };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    logEvent("info", "hermes.applied", { outcome: d.outcome, status: d.status });
    return mapOrchestration(d);
  } catch (err) {
    logEvent("error", "hermes.apply_exception", { message: (err as Error).message });
    return {
      ok: false,
      outcome: "ERROR",
      reply: "Le service est indisponible. Réessayez plus tard.",
      status: "RPC_ERROR",
      error: { code: "EXCEPTION", message: "Le service est indisponible." },
    };
  }
}
