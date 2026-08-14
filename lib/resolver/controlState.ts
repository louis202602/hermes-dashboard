/**
 * Pure, DOM-free derivation of the resolver operator control state from the
 * `public.resolver_operator_get_control` RPC payload. Kept side-effect free so it
 * is unit-testable without a browser. The panel renders from this; every action
 * it enables maps to a real backend RPC (no purely-visual buttons).
 */

export type ResolverControlStatus =
  | "DISABLED"
  | "READY"
  | "CIRCUIT_OPEN"
  | "BLOCKED_BUDGET"
  | "RUNNING"
  | "UNAVAILABLE";

export type ResolverControl = {
  authorized: boolean;
  enabled: boolean;
  circuitState: "CLOSED" | "OPEN";
  circuitReason: string | null;
  maxBatch: number | null;
  maxConcurrency: number | null;
  cadenceSeconds: number | null;
  queueDepth: number;
  runningCount: number;
  protectedExclusionsCount: number;
  preflightReady: boolean;
  preflightDeniedReasons: string[];
};

export type ResolverControlView = {
  status: ResolverControlStatus;
  /** Enable is only offered when authorized, currently disabled, and preflight passes. */
  canEnable: boolean;
  canDisable: boolean;
  canResetCircuit: boolean;
  canReap: boolean;
  blockers: string[];
};

/** Map the raw RPC object to a typed control model. Missing/unauth → safe defaults. */
export function parseResolverControl(
  raw: Record<string, unknown> | null | undefined,
): ResolverControl {
  const p = (raw ?? {}) as Record<string, unknown>;
  const pre = (p.preflight ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(pre.denied_reasons)
    ? (pre.denied_reasons as unknown[]).map((r) => String(r))
    : [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    authorized: Boolean(p.authorized),
    enabled: Boolean(p.enabled),
    circuitState: p.circuit_state === "OPEN" ? "OPEN" : "CLOSED",
    circuitReason: (p.circuit_reason as string) ?? null,
    maxBatch: num(p.max_batch),
    maxConcurrency: num(p.max_concurrency),
    cadenceSeconds: num(p.cadence_seconds),
    queueDepth: num(p.queue_depth) ?? 0,
    runningCount: num(p.running_count) ?? 0,
    protectedExclusionsCount:
      num(p.protected_exclusions_count) ?? num(pre.protected_exclusions_count) ?? 0,
    preflightReady: Boolean(pre.ready),
    preflightDeniedReasons: reasons,
  };
}

/** Derive the display status + which operator actions are permitted right now. */
export function deriveResolverControl(c: ResolverControl): ResolverControlView {
  let status: ResolverControlStatus;
  if (c.circuitState === "OPEN") status = "CIRCUIT_OPEN";
  else if (c.runningCount > 0) status = "RUNNING";
  else if (c.enabled) status = "READY";
  else if (c.preflightDeniedReasons.includes("BUDGET_NOT_READY")) status = "BLOCKED_BUDGET";
  else status = "DISABLED";

  return {
    status,
    // Enable is fail-closed at the UI too: only when authorized, currently OFF, preflight green.
    canEnable: c.authorized && !c.enabled && c.preflightReady,
    canDisable: c.authorized && c.enabled,
    canResetCircuit: c.authorized && c.circuitState === "OPEN",
    canReap: c.authorized,
    blockers: c.preflightDeniedReasons,
  };
}

export const RESOLVER_STATUS_LABELS: Record<ResolverControlStatus, string> = {
  DISABLED: "Désactivé",
  READY: "Actif",
  CIRCUIT_OPEN: "Circuit ouvert",
  BLOCKED_BUDGET: "Bloqué (budget)",
  RUNNING: "En traitement",
  UNAVAILABLE: "Indisponible",
};

export const RESOLVER_BLOCKER_LABELS: Record<string, string> = {
  NO_RUNTIME_CONFIG: "Config runtime absente",
  CIRCUIT_NOT_CLOSED: "Circuit non fermé",
  MAX_BATCH_INVALID: "max_batch invalide",
  MAX_CONCURRENCY_INVALID: "max_concurrency invalide",
  CADENCE_INVALID: "cadence invalide",
  RUNNING_PRESENT: "Traitement en cours",
  PROTECTED_EXCLUSIONS_MISSING: "Exclusions protégées manquantes",
  BUDGET_NOT_READY: "Budget non prêt (config/hard-stop/dépassement)",
};
