import { NextResponse, type NextRequest } from "next/server";

import { getAuthedUser } from "@/lib/dashboard/requestScope";
import { isOAuthServerProvider, callbackUrl } from "@/lib/integrations/oauthServer";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  const home = new URL("/integrations", request.nextUrl.origin);

  const user = await getAuthedUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  if (!isOAuthServerProvider(provider)) {
    home.searchParams.set("integration_error", "PROVIDER_NOT_IMPLEMENTED");
    return NextResponse.redirect(home);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("begin_integration_connection", {
    p_provider: provider,
    p_redirect_after: "/integrations",
  });
  if (error || !data || !(data as Record<string, unknown>).ok) {
    const code = String((data as Record<string, unknown>)?.code ?? error?.code ?? "UNAVAILABLE");
    logEvent("warn", "oauth.start_refused", { provider, code });
    home.searchParams.set("integration_error", code);
    return NextResponse.redirect(home);
  }

  const p = data as Record<string, unknown>;
  const authorize = new URL(String(p.authorize_url));
  authorize.searchParams.set("client_id", String(p.client_id));
  authorize.searchParams.set("redirect_uri", callbackUrl(request.nextUrl.origin, provider));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", String(p.state));
  authorize.searchParams.set(
    "scope",
    (Array.isArray(p.scopes) ? (p.scopes as string[]) : []).join(" "),
  );

  if (provider === "google_calendar") {
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
    authorize.searchParams.set("include_granted_scopes", "true");
  }

  return NextResponse.redirect(authorize);
}
