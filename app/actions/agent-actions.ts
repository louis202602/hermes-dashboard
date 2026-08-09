"use server";

import {
  approveAgentAction,
  getAgentActionResult,
  listPendingApprovals,
  rejectAgentAction,
  requestBtpQualification,
} from "@/services/hermes/agentActions";
import type {
  DecisionOutcome,
  ListApprovalsOutcome,
  ResultOutcome,
} from "@/types/agent-actions";

export type SubmitState = {
  phase: "idle" | "queued" | "error";
  status?: string;
  requestId?: string;
  message?: string;
};

const ENQUEUE_MESSAGES: Record<string, string> = {
  UNKNOWN_ACTION: "Action inconnue ou désactivée.",
  VALIDATION_FAILED: "Données invalides. Vérifiez le formulaire.",
  UNAUTHORIZED: "Vous n’êtes pas autorisé à exécuter cette action.",
  IDEMPOTENCY_CONFLICT:
    "Une demande différente utilise déjà cet identifiant. Réessayez.",
  NO_TENANT: "Aucun tenant n’est associé à votre compte.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION:
    "Plusieurs tenants disponibles : sélection requise.",
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  RPC_ERROR: "Le service est indisponible. Réessayez plus tard.",
};

/**
 * Server Action: submit the "qualifier un chantier" form. Validates input,
 * generates the request_id server-side (inside the service), and enqueues the
 * action. Backend errors are surfaced, never hidden.
 */
export async function submitBtpQualificationAction(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const chantier_name = String(formData.get("chantier_name") ?? "").trim();
  const client = String(formData.get("client") ?? "").trim();
  const adresse = String(formData.get("adresse") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();

  if (chantier_name.length === 0) {
    return {
      phase: "error",
      status: "VALIDATION_FAILED",
      message: "Le nom du chantier est requis.",
    };
  }

  const outcome = await requestBtpQualification({
    chantier_name,
    client: client || undefined,
    adresse: adresse || undefined,
    type: type || undefined,
  });

  if (!outcome.ok || outcome.status !== "QUEUED") {
    return {
      phase: "error",
      status: outcome.status,
      requestId: outcome.requestId,
      message:
        outcome.error?.message ??
        ENQUEUE_MESSAGES[outcome.status] ??
        "Échec de la mise en file de l’action.",
    };
  }

  return { phase: "queued", status: "QUEUED", requestId: outcome.requestId };
}

/** Server Action: poll a request's status/result (called from the client). */
export async function pollAgentActionResultAction(
  requestId: string,
): Promise<ResultOutcome> {
  if (!requestId) {
    return { ok: false, status: "NOT_FOUND", requestId };
  }
  return getAgentActionResult(requestId);
}

/** Server Action: list pending approvals for the caller's tenant. */
export async function listPendingApprovalsAction(): Promise<ListApprovalsOutcome> {
  return listPendingApprovals();
}

/** Server Action: approve a pending action (backend enforces tenant.admin). */
export async function approveAgentActionAction(
  requestId: string,
): Promise<DecisionOutcome> {
  if (!requestId) return { ok: false, status: "NOT_FOUND" };
  return approveAgentAction(requestId);
}

/** Server Action: reject a pending action with a reason. */
export async function rejectAgentActionAction(
  requestId: string,
  reason: string,
): Promise<DecisionOutcome> {
  if (!requestId) return { ok: false, status: "NOT_FOUND" };
  if (!reason || reason.trim().length === 0) {
    return {
      ok: false,
      status: "VALIDATION_FAILED",
      error: { code: "REASON_REQUIRED", message: "Un motif de refus est requis." },
    };
  }
  return rejectAgentAction(requestId, reason.trim());
}
