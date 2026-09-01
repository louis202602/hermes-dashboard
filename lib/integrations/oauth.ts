/**
 * HERMÈS — OAuth : partie pure, sans secret.
 */

/** Fournisseurs dont le démarrage/callback OAuth est implémenté. */
export const OAUTH_SERVER_PROVIDERS = ["google_calendar", "qonto"] as const;
export type OAuthServerProvider = (typeof OAUTH_SERVER_PROVIDERS)[number];

export function isOAuthServerProvider(v: string): v is OAuthServerProvider {
  return (OAUTH_SERVER_PROVIDERS as readonly string[]).includes(v);
}

export type TokenExchangeResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: string | null;
      scopes: string[];
    }
  | { ok: false; code: string };

export function parseTokenPayload(payload: unknown): TokenExchangeResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const accessToken = typeof p.access_token === "string" ? p.access_token : "";
  if (accessToken.length === 0) return { ok: false, code: "NO_ACCESS_TOKEN" };

  const refreshToken = typeof p.refresh_token === "string" && p.refresh_token.length > 0
    ? p.refresh_token
    : null;

  let expiresAt: string | null = null;
  const expiresIn = p.expires_in;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const scopes =
    typeof p.scope === "string" && p.scope.length > 0 ? p.scope.split(/\s+/).filter(Boolean) : [];

  return { ok: true, accessToken, refreshToken, expiresAt, scopes };
}

export function callbackUrl(origin: string, provider: string): string {
  return `${origin.replace(/\/+$/, "")}/api/integrations/${provider}/callback`;
}

export function safeRedirectPath(candidate: unknown): string {
  const v = typeof candidate === "string" ? candidate : "";
  if (!v.startsWith("/") || v.startsWith("//")) return "/integrations";
  return v;
}
