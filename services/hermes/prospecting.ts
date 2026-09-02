import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PvOutreachSnapshot = {
  ok: boolean;
  code: string;
  timezone: string;
  found: number;
  qualified: number;
  emailReady: number;
  sent: number;
  replies: number;
  interested: number;
  minimumTarget: number;
  technicalCap: number;
};

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

export async function getPvOutreachSnapshot(): Promise<PvOutreachSnapshot> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_hb_pv_outreach_snapshot");
  const p = (data ?? {}) as Record<string, unknown>;

  if (error || !p.ok) {
    return {
      ok: false,
      code: error?.code ?? String(p.code ?? "UNAVAILABLE"),
      timezone: "Europe/Paris",
      found: 0,
      qualified: 0,
      emailReady: 0,
      sent: 0,
      replies: 0,
      interested: 0,
      minimumTarget: 20,
      technicalCap: 300,
    };
  }

  return {
    ok: true,
    code: String(p.code ?? "OK"),
    timezone: String(p.timezone ?? "Europe/Paris"),
    found: num(p.found),
    qualified: num(p.qualified),
    emailReady: num(p.email_ready),
    sent: num(p.sent),
    replies: num(p.replies),
    interested: num(p.interested),
    minimumTarget: num(p.minimum_target) || 20,
    technicalCap: num(p.technical_cap) || 300,
  };
}
