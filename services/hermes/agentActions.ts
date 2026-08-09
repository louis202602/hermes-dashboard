import "server-only";

import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BtpQualificationInput,
  EnqueueOutcome,
  ResultOutcome,
} from "@/types/agent-actions";

function asError(value: unknown): { code?: string; message?: string } | null {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return { code: v.code as string, message: v.message as string };
  }
  return null;
}

/**
 * Enqueue a `btp.qualification.create` agent action. The `request_id` is
 * generated server-side (UUID) and returned so the caller can poll the result.
 * Tenant/authorization/policy are all enforced by the backend RPC.
 */
export async function requestBtpQualification(
  input: BtpQualificationInput,
  requestId: string = randomUUID(),
): Promise<EnqueueOutcome> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_agent_action", {
      p_action_key: "btp.qualification.create",
      p_payload: {
        chantier_name: input.chantier_name,
        client: input.client ?? null,
        adresse: input.adresse ?? null,
        type: input.type ?? null,
      },
      p_request_id: requestId,
    });

    if (error) {
      logEvent("error", "agent_action.request_rpc_error", { code: error.code });
      return {
        ok: false,
        status: "RPC_ERROR",
        requestId,
        error: { code: error.code, message: "Le service est indisponible." },
      };
    }

    const d = (data ?? {}) as Record<string, unknown>;
    logEvent("info", "agent_action.requested", { status: d.status });
    return {
      ok: Boolean(d.ok),
      status: (d.status as string) ?? "RPC_ERROR",
      requestId: (d.request_id as string) ?? requestId,
      correlationId: (d.correlation_id as string) ?? undefined,
      replay: Boolean(d.replay),
      error: asError(d.error),
    };
  } catch (err) {
    logEvent("error", "agent_action.request_exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      status: "RPC_ERROR",
      requestId,
      error: { code: "EXCEPTION", message: "Le service est indisponible." },
    };
  }
}

/** Fetch the current status/result of a previously enqueued request. */
export async function getAgentActionResult(
  requestId: string,
): Promise<ResultOutcome> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_agent_action_result", {
      p_request_id: requestId,
    });

    if (error) {
      logEvent("error", "agent_action.result_rpc_error", { code: error.code });
      return {
        ok: false,
        status: "RPC_ERROR",
        requestId,
        error: { code: error.code, message: "Le service est indisponible." },
      };
    }

    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(d.ok),
      status: (d.status as string) ?? "RPC_ERROR",
      requestId: (d.request_id as string) ?? requestId,
      actionKey: (d.action_key as string) ?? undefined,
      result: d.result ?? null,
      error: asError(d.error),
      policyDecision: (d.policy_decision as string) ?? null,
      policyReason: (d.policy_reason as string) ?? null,
      finishedAt: (d.finished_at as string) ?? null,
    };
  } catch (err) {
    logEvent("error", "agent_action.result_exception", {
      message: (err as Error).message,
    });
    return {
      ok: false,
      status: "RPC_ERROR",
      requestId,
      error: { code: "EXCEPTION", message: "Le service est indisponible." },
    };
  }
}
