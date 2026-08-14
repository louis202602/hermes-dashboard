"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server Actions for the resolver operator control plane. Each maps to a REAL
 * permission-gated, audited backend RPC (`public.resolver_operator_*`). No action
 * is faked client-side; authorization + all safety guards are enforced server-side
 * inside the RPCs (fail-closed). Enabling runs the DB preflight and returns
 * `ACTIVATION_DENIED` when any safety condition fails.
 */

export type OperatorResult = {
  ok: boolean;
  status?: string;
  message?: string;
  detail?: unknown;
};

async function callOperatorRpc(
  fn:
    | "resolver_operator_enable"
    | "resolver_operator_disable"
    | "resolver_operator_reset_circuit"
    | "resolver_operator_reap",
  args?: Record<string, unknown>,
): Promise<OperatorResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      return { ok: false, status: "RPC_ERROR", message: error.message };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(d.ok),
      status: (d.status as string) ?? undefined,
      detail: d,
    };
  } catch (err) {
    return { ok: false, status: "RPC_ERROR", message: (err as Error).message };
  }
}

export async function resolverEnableAction(): Promise<OperatorResult> {
  return callOperatorRpc("resolver_operator_enable");
}

export async function resolverDisableAction(): Promise<OperatorResult> {
  return callOperatorRpc("resolver_operator_disable");
}

export async function resolverResetCircuitAction(): Promise<OperatorResult> {
  return callOperatorRpc("resolver_operator_reset_circuit");
}

export async function resolverReapAction(): Promise<OperatorResult> {
  return callOperatorRpc("resolver_operator_reap", { p_limit: 50 });
}

/** Re-read the control state after an action so the panel reflects backend truth. */
export async function resolverRefreshControlAction(): Promise<Record<
  string,
  unknown
> | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc("resolver_operator_get_control");
    return (data as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}
