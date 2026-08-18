import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  IntegrationConnectStart,
  IntegrationProvider,
  IntegrationStatus,
  PhoneCosts,
  PhoneStatus,
  TenantIntegration,
  TenantIntegrations,
} from "@/types/integrations";

/**
 * HERMÈS — Lecture des connexions d'outils du tenant.
 *
 * Ce service ne manipule JAMAIS de jeton : la façade SQL n'en renvoie pas, et
 * les types n'en portent pas. Il n'y a donc rien à filtrer ici — l'absence est
 * structurelle, pas défensive.
 */

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Repli fermé, utilisé partout : sans donnée, rien n'est connecté. */
const EMPTY: TenantIntegrations = {
  resolutionStatus: "UNAVAILABLE",
  tenantId: null,
  integrations: [],
};

export async function getTenantIntegrations(): Promise<TenantIntegrations> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_tenant_integrations");
    if (error) {
      logEvent("error", "integrations.rpc_error", { code: error.code });
      return EMPTY;
    }
    const payload = asRecord(data);
    const rows = Array.isArray(payload.integrations)
      ? (payload.integrations as Record<string, unknown>[])
      : [];
    return {
      resolutionStatus: String(payload.resolution_status ?? "UNAVAILABLE"),
      tenantId: str(payload.tenant_id),
      integrations: rows.map(
        (r): TenantIntegration => ({
          provider: String(r.provider) as IntegrationProvider,
          label: String(r.label ?? r.provider),
          status: String(r.status ?? "NOT_CONNECTED") as IntegrationStatus,
          accountLabel: str(r.account_label),
          connectedAt: str(r.connected_at),
          expiresAt: str(r.expires_at),
          lastErrorCode: str(r.last_error_code),
        }),
      ),
    };
  } catch (e) {
    logEvent("error", "integrations.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return EMPTY;
  }
}

/**
 * Démarre une connexion. Renvoie l'URL d'autorisation, le `client_id` (public)
 * et un `state` à usage unique — jamais un `client_secret`, qui n'existe pas
 * dans cette application.
 */
export async function beginIntegrationConnection(
  provider: IntegrationProvider,
): Promise<IntegrationConnectStart> {
  const closed: IntegrationConnectStart = {
    ok: false,
    code: "UNAVAILABLE",
    provider: null,
    authorizeUrl: null,
    clientId: null,
    scopes: [],
    state: null,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("begin_integration_connection", {
      p_provider: provider,
    });
    if (error) {
      logEvent("error", "integrations.begin_error", { code: error.code });
      return closed;
    }
    const p = asRecord(data);
    if (!p.ok) return { ...closed, code: String(p.code ?? "UNAVAILABLE") };
    return {
      ok: true,
      code: String(p.code ?? "OK"),
      provider,
      authorizeUrl: str(p.authorize_url),
      clientId: str(p.client_id),
      scopes: Array.isArray(p.scopes) ? (p.scopes as string[]) : [],
      state: str(p.state),
    };
  } catch (e) {
    logEvent("error", "integrations.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return closed;
  }
}

export async function revokeIntegrationConnection(
  provider: IntegrationProvider,
): Promise<{ ok: boolean; code: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("revoke_integration_connection", {
      p_provider: provider,
    });
    if (error) {
      logEvent("error", "integrations.revoke_error", { code: error.code });
      return { ok: false, code: "UNAVAILABLE" };
    }
    const p = asRecord(data);
    return { ok: Boolean(p.ok), code: String(p.code ?? "UNAVAILABLE") };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Statut du standard téléphonique. Ne renvoie ni l'agent fournisseur, ni la
 * clé, ni le pointeur Vault : ce sont des détails d'infrastructure Hermès que
 * le tenant n'a pas à connaître.
 */
export async function getPhoneStatus(): Promise<PhoneStatus> {
  const closed: PhoneStatus = {
    resolutionStatus: "UNAVAILABLE",
    operational: false,
    tenantConfigured: false,
    hermesProvisioned: false,
    code: "UNAVAILABLE",
    incomingNumber: null,
    calendarUsable: false,
    costs: null,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_phone_status");
    if (error) {
      logEvent("error", "phone_status.rpc_error", { code: error.code });
      return closed;
    }
    const p = asRecord(data);
    const c = asRecord(p.costs);
    const costs: PhoneCosts | null = c.ok
      ? {
          callCount: num(c.call_count) ?? 0,
          callMinutes: num(c.call_minutes) ?? 0,
          callsWithoutReportedCost: num(c.calls_without_reported_cost) ?? 0,
          // `null` est conservé tel quel : un coût non rapporté n'est pas 0.
          retellCostUsd: num(c.retell_cost_usd),
          telephonyCostUsd: num(c.telephony_cost_usd),
          llmCostUsd: num(c.llm_cost_usd),
          totalCallCostUsd: num(c.total_call_cost_usd),
          provenance: (String(c.provenance ?? "UNAVAILABLE") as PhoneCosts["provenance"]),
        }
      : null;
    return {
      resolutionStatus: String(p.resolution_status ?? "UNAVAILABLE"),
      operational: Boolean(p.operational),
      tenantConfigured: Boolean(p.tenant_configured),
      hermesProvisioned: Boolean(p.hermes_provisioned),
      code: String(p.code ?? "UNAVAILABLE"),
      incomingNumber: str(p.incoming_number),
      calendarUsable: Boolean(p.calendar_usable),
      costs,
    };
  } catch (e) {
    logEvent("error", "phone_status.exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return closed;
  }
}
