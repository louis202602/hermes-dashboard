import { NextResponse, type NextRequest } from "next/server";

import { getAuthedUser } from "@/lib/dashboard/requestScope";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * RÉVOCATION — `POST /api/integrations/<provider>/disconnect`.
 *
 * POST et non GET : une déconnexion change l'état. En GET, un simple `<img>`
 * pointant vers cette URL, ou un préchargement de navigateur, la déclencherait.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  const origin = request.nextUrl.origin;

  const user = await getAuthedUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("revoke_integration_connection", {
    p_provider: provider,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  const url = new URL("/integrations", origin);
  if (error || !payload.ok) {
    logEvent("warn", "oauth.revoke_failed", {
      provider,
      code: String(payload.code ?? error?.code ?? "UNAVAILABLE"),
    });
    url.searchParams.set("integration_error", "REVOKE_FAILED");
  } else {
    url.searchParams.set("integration_revoked", provider);
  }
  return NextResponse.redirect(url, { status: 303 });
}
