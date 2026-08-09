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

export type CommandState = {
  phase: "idle" | "queued" | "error";
  status?: string;
  requestId?: string;
  actionKey?: string;
  message?: string;
};

/**
 * Interpret a free-text Hermès command into an allowlisted action. This is
 * explicit UI-level routing (not business logic): the real work is done by the
 * backend agent. Only backed, non-destructive actions are recognized; anything
 * else is honestly reported as unrecognized (never faked).
 */
function interpretHermesCommand(
  text: string,
):
  | { kind: "qualification"; chantierName: string }
  | { kind: "error"; code: "NAME_REQUIRED" | "NOT_RECOGNIZED" } {
  const low = text.toLowerCase();
  if (/(qualif|chantier)/.test(low)) {
    let name = "";
    const colon = text.indexOf(":");
    if (colon >= 0) name = text.slice(colon + 1).trim();
    if (!name) {
      const m = text.match(/chantier\s+(.+)$/i);
      if (m) name = m[1].trim();
    }
    if (!name) return { kind: "error", code: "NAME_REQUIRED" };
    return { kind: "qualification", chantierName: name };
  }
  return { kind: "error", code: "NOT_RECOGNIZED" };
}

/**
 * Server Action: submit a Hermès command from the Command Center. Routes to a
 * real allowlisted action via the gateway; the request_id is generated
 * server-side. Backend errors are surfaced, never hidden.
 */
export async function submitHermesCommandAction(
  _prev: CommandState,
  formData: FormData,
): Promise<CommandState> {
  const command = String(formData.get("command") ?? "").trim();
  if (command.length === 0) {
    return { phase: "error", status: "VALIDATION_FAILED", message: "Saisissez une commande." };
  }

  const interp = interpretHermesCommand(command);
  if (interp.kind === "error") {
    if (interp.code === "NAME_REQUIRED") {
      return {
        phase: "error",
        status: "VALIDATION_FAILED",
        message: "Précisez le nom du chantier. Ex : « qualifier chantier: Toiture Nord ».",
      };
    }
    return {
      phase: "error",
      status: "COMMAND_NOT_RECOGNIZED",
      message:
        "Commande non reconnue. Action disponible : qualifier un chantier — ex : « qualifier chantier: Toiture Nord ».",
    };
  }

  const outcome = await requestBtpQualification({
    chantier_name: interp.chantierName,
    type: "installation",
  });

  if (!outcome.ok || outcome.status !== "QUEUED") {
    return {
      phase: "error",
      status: outcome.status,
      requestId: outcome.requestId,
      message:
        outcome.error?.message ??
        ENQUEUE_MESSAGES[outcome.status] ??
        "Échec de la commande.",
    };
  }

  return {
    phase: "queued",
    status: "QUEUED",
    requestId: outcome.requestId,
    actionKey: "btp.qualification.create",
  };
}
