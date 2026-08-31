import "server-only";

import {
  type OAuthServerProvider,
  type TokenExchangeResult,
  parseTokenPayload,
} from "@/lib/integrations/oauth";

export {
  OAUTH_SERVER_PROVIDERS,
  callbackUrl,
  isOAuthServerProvider,
  parseTokenPayload,
  safeRedirectPath,
} from "@/lib/integrations/oauth";
export type { OAuthServerProvider, TokenExchangeResult } from "@/lib/integrations/oauth";

/**
 * Seul Google utilise encore un secret d'application côté Vercel.
 * Qonto est volontairement géré par Supabase Vault et ne passe jamais ici.
 */
const SECRET_ENV: Partial<Record<OAuthServerProvider, string>> = {
  google_calendar: "GOOGLE_CLIENT_SECRET",
};

const TOKEN_URL: Partial<Record<OAuthServerProvider, string>> = {
  google_calendar: "https://oauth2.googleapis.com/token",
};

export async function exchangeAuthorizationCode(
  provider: OAuthServerProvider,
  input: { code: string; clientId: string; redirectUri: string },
): Promise<TokenExchangeResult> {
  const envName = SECRET_ENV[provider];
  const tokenUrl = TOKEN_URL[provider];
  if (!envName || !tokenUrl) return { ok: false, code: "PROVIDER_DB_MANAGED" };

  const secret = process.env[envName];
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, code: "PROVIDER_SECRET_MISSING" };
  }
  if (!input.code || !input.clientId || !input.redirectUri) {
    return { ok: false, code: "BAD_ARGUMENTS" };
  }

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: input.clientId,
        client_secret: secret,
        redirect_uri: input.redirectUri,
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "PROVIDER_UNREACHABLE" };
  }

  if (!response.ok) return { ok: false, code: `PROVIDER_HTTP_${response.status}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "PROVIDER_BAD_RESPONSE" };
  }
  return parseTokenPayload(payload);
}
