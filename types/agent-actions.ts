/**
 * Contracts for the Agent Action gateway (backend RPCs
 * `request_agent_action` / `get_agent_action_result`). The frontend never talks
 * to n8n directly and never sees any secret — it only consumes these RPCs.
 */

/** Terminal + rejection statuses returned when enqueuing an action. */
export type AgentActionEnqueueStatus =
  | "QUEUED"
  | "UNKNOWN_ACTION"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "IDEMPOTENCY_CONFLICT"
  | "NO_TENANT"
  | "AMBIGUOUS_TENANT_REQUIRE_SELECTION"
  | "UNAUTHENTICATED"
  | "RPC_ERROR";

/** Lifecycle statuses returned when polling a request's result. */
export type AgentActionResultStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "POLICY_DENIED"
  | "PENDING_APPROVAL"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "NO_TENANT"
  | "RPC_ERROR";

export type AgentActionError = { code?: string; message?: string };

export type EnqueueOutcome = {
  ok: boolean;
  status: AgentActionEnqueueStatus | string;
  requestId?: string;
  correlationId?: string;
  replay?: boolean;
  error?: AgentActionError | null;
};

export type ResultOutcome = {
  ok: boolean;
  status: AgentActionResultStatus | string;
  requestId?: string;
  actionKey?: string;
  result?: unknown;
  error?: AgentActionError | null;
  policyDecision?: string | null;
  policyReason?: string | null;
  finishedAt?: string | null;
};

/** Input for the `btp.qualification.create` action. */
export type BtpQualificationInput = {
  chantier_name: string;
  client?: string;
  adresse?: string;
  type?: string;
};

/** Statuses that mean the request has reached a terminal state (stop polling). */
export const TERMINAL_RESULT_STATUSES: ReadonlySet<string> = new Set([
  "SUCCEEDED",
  "FAILED",
  "POLICY_DENIED",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "NO_TENANT",
  "RPC_ERROR",
]);
