import { NextResponse, type NextRequest } from "next/server";

import { getAuthedUser } from "@/lib/dashboard/requestScope";
import {
  callbackUrl,
  exchangeAuthorizationCode,
  isOAuthServerProvider,
  safeRedirectPath,
} from "@/lib/integrations/oauthServer";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  const origin = request.nextUrl.origin;
  const fail = (code: string, path = "/integrations") => {
    const url = new URL(safeRedirectPath(path), origin);
    url.searchParams.set("integration_error", code);
    return NextResponse.redirect(url);
  };

  const user = await getAuthedUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (!isOAuthServerProvider(provider)) return fail("PROVIDER_NOT_IMPLEMENTED");

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const providerError = request.nextUrl.searchParams.get("error");
  const supabase = await createSupabaseServerClient();

  if (providerError) {
    const { data } = await supabase.rpc("fail_integration_connection", {
      p_state: state,
      p_error_code: providerError,
    });
    return fail(
      "PROVIDER_DENIED",
      safeRedirectPath((data as Record<string, unknown>)?.redirect_after),
    );
  }
  if (!state || !code) return fail("MISSING_CALLBACK_PARAMS");

  const { data: listing } = await supabase.rpc("get_tenant_integrations");
  const rows = Array.isArray((listing as Record<string, unknown>)?.integrations)
    ? ((listing as Record<string, unknown>).integrations as Record<string, unknown>[])
    : [];
  if (!rows.some((r) => r.provider === provider)) {
    await supabase.rpc("fail_integration_connection", {
      p_state: state,
      p_error_code: "PROVIDER_NOT_ALLOWED",
    });
    return fail("PROVIDER_NOT_ALLOWED");
  }

  if (provider === "qonto") {
    const { data, error } = await supabase.rpc("complete_qonto_integration_connection_self", {
      p_state: state,
      p_code: code,
      p_redirect_uri: callbackUrl(origin, provider),
    });
    const payload = (data ?? {}) as Record<string, unknown>;
    if (error || !payload.ok) {
      const failureCode = String(payload.code ?? error?.code ?? "UNAVAILABLE");
      logEvent("error", "oauth.qonto_complete_failed", { provider, code: failureCode });
      return fail(failureCode, safeRedirectPath(payload.redirect_after));
    }
    const done = new URL(safeRedirectPath(payload.redirect_after), origin);
    done.searchParams.set("integration_connected", provider);
    return NextResponse.redirect(done);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const exchanged = await exchangeAuthorizationCode(provider, {
    code,
    clientId,
    redirectUri: callbackUrl(origin, provider),
  });
  if (!exchanged.ok) {
    logEvent("error", "oauth.exchange_failed", { provider, code: exchanged.code });
    await supabase.rpc("fail_integration_connection", {
      p_state: state,
      p_error_code: exchanged.code,
    });
    return fail(exchanged.code);
  }

  const { data, error } = await supabase.rpc("complete_integration_connection_self", {
    p_state: state,
    p_access_token: exchanged.accessToken,
    p_refresh_token: exchanged.refreshToken,
    p_expires_at: exchanged.expiresAt,
    p_account_label: null,
    p_scopes: exchanged.scopes,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  if (error || !payload.ok) {
    const failureCode = String(payload.code ?? error?.code ?? "UNAVAILABLE");
    logEvent("error", "oauth.complete_failed", { provider, code: failureCode });
    return fail(failureCode);
  }

  const done = new URL(safeRedirectPath(payload.redirect_after), origin);
  done.searchParams.set("integration_connected", provider);
  return NextResponse.redirect(done);
}
