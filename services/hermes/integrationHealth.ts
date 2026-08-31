import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OperationalIntegrationHealth = {
  ok: boolean;
  checkedAt: string | null;
  supabase: { status: string; proof: string };
  hermesBusiness: { status: string; lastSeenAt: string | null; eventsLast24h: number; proof: string };
  googleCalendar: {
    enabled: boolean;
    provisioned: boolean;
    status: string;
    accountLabel: string | null;
    connectedAt: string | null;
    expiresAt: string | null;
    lastErrorCode: string | null;
  };
  n8n: { status: string; lastSeenAt: string | null; proof: string; dbRole: string | null };
};

const empty: OperationalIntegrationHealth = {
  ok: false,
  checkedAt: null,
  supabase: { status: "UNAVAILABLE", proof: "" },
  hermesBusiness: { status: "UNAVAILABLE", lastSeenAt: null, eventsLast24h: 0, proof: "" },
  googleCalendar: { enabled: false, provisioned: false, status: "NOT_CONNECTED", accountLabel: null, connectedAt: null, expiresAt: null, lastErrorCode: null },
  n8n: { status: "UNAVAILABLE", lastSeenAt: null, proof: "", dbRole: null },
};

const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown): string | null => typeof v === "string" && v.length > 0 ? v : null;

export async function getOperationalIntegrationHealth(): Promise<OperationalIntegrationHealth> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_operational_integration_health");
    if (error) {
      logEvent("error", "integration_health.rpc_error", { code: error.code });
      return empty;
    }
    const p = rec(data);
    if (!p.ok) return empty;
    const db = rec(p.supabase);
    const hb = rec(p.hermes_business);
    const google = rec(p.google_calendar);
    const n8n = rec(p.n8n);
    const n8nMeta = rec(n8n.metadata);
    return {
      ok: true,
      checkedAt: str(p.checked_at),
      supabase: { status: String(db.status ?? "UNAVAILABLE"), proof: String(db.proof ?? "") },
      hermesBusiness: {
        status: String(hb.status ?? "UNAVAILABLE"),
        lastSeenAt: str(hb.last_seen_at),
        eventsLast24h: Number(hb.events_last_24h ?? 0) || 0,
        proof: String(hb.proof ?? ""),
      },
      googleCalendar: {
        enabled: Boolean(google.enabled),
        provisioned: Boolean(google.provisioned),
        status: String(google.status ?? "NOT_CONNECTED"),
        accountLabel: str(google.account_label),
        connectedAt: str(google.connected_at),
        expiresAt: str(google.expires_at),
        lastErrorCode: str(google.last_error_code),
      },
      n8n: {
        status: String(n8n.status ?? "UNAVAILABLE"),
        lastSeenAt: str(n8n.last_seen_at),
        proof: String(n8n.proof ?? ""),
        dbRole: str(n8nMeta.db_role),
      },
    };
  } catch (e) {
    logEvent("error", "integration_health.exception", { message: e instanceof Error ? e.message : "unknown" });
    return empty;
  }
}
