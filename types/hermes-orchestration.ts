/**
 * Contract for the Hermès natural-language orchestrator
 * (`public.orchestrate_hermes_message`). The backend is the single source of
 * truth: it resolves intent against the capability registry, then DELEGATES any
 * execution to the existing Agent Action gateway (`request_agent_action`),
 * which enforces auth / tenant / permission / idempotency. SW15 approval is
 * decided by the poller's policy gate. The AI/orchestrator is never the final
 * authorization authority, and the frontend never sees a secret.
 */

/** Synchronous outcome returned by the orchestrator for one user turn. */
export type OrchestrationOutcome =
  | "ANSWER_ONLY" // informational reply grounded in the capability registry
  | "ACTION" // a real allowlisted action was enqueued via the gateway
  | "NEEDS_CLARIFICATION" // ambiguous / unknown / missing info — no execution
  | "ERROR"; // fail-closed (auth, tenant, validation, gateway refusal)

export type OrchestrationResult = {
  ok: boolean;
  outcome: OrchestrationOutcome | string;
  conversationId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  /** Hermès' textual response (deterministic, honest — never a faked answer). */
  reply: string;
  actionKey?: string | null;
  /** Present when outcome === "ACTION": poll the gateway result with this id. */
  requestId?: string | null;
  correlationId?: string | null;
  confidence?: string | null;
  /** Missing required slots when NEEDS_CLARIFICATION on a matched capability. */
  missing?: string[] | null;
  /** Candidate action keys when the request was ambiguous. */
  candidates?: string[] | null;
  /** Gateway/enqueue status when ACTION, else mirrors the outcome. */
  status: string;
  error?: { code?: string; message?: string } | null;
};
