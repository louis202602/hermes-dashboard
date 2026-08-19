/**
 * HERMÈS — OAuth : la partie PURE, sans secret.
 *
 * Séparée de `oauthServer.ts` volontairement. Ce dernier porte
 * `import "server-only"`, qui fait échouer la compilation dès qu'un composant
 * client l'importe — barrière réelle, mais qui empêche AUSSI un test de le
 * charger. Or ce sont précisément ces fonctions-ci qu'il faut éprouver : la
 * lecture défensive de la réponse d'un fournisseur et la protection contre une
 * redirection ouverte.
 *
 * Rien ici ne touche à un secret ni au réseau. La frontière `server-only` reste
 * serrée autour du seul code qui en manipule un.
 */

/** Fournisseurs dont l'échange de jeton est IMPLÉMENTÉ. Déclaré ≠ prêt. */
export const OAUTH_SERVER_PROVIDERS = ["google_calendar"] as const;
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

/**
 * Lecture défensive de la réponse du fournisseur. Pur, donc testable sans
 * réseau — c'est là que se cachent les surprises (`expires_in` absent, `scope`
 * en chaîne séparée par des espaces, `refresh_token` seulement au premier
 * consentement).
 */
export function parseTokenPayload(payload: unknown): TokenExchangeResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  const accessToken = typeof p.access_token === "string" ? p.access_token : "";
  if (accessToken.length === 0) return { ok: false, code: "NO_ACCESS_TOKEN" };

  const refreshToken = typeof p.refresh_token === "string" && p.refresh_token.length > 0
    ? p.refresh_token
    : null;

  // `expires_in` en secondes. Absent ou illisible ⇒ `null` : une expiration
  // inventée ferait croire à une connexion utilisable après sa péremption, et
  // `isIntegrationUsable` refuse déjà tout jeton dont la date est illisible.
  let expiresAt: string | null = null;
  const expiresIn = p.expires_in;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const scopes =
    typeof p.scope === "string" && p.scope.length > 0 ? p.scope.split(/\s+/).filter(Boolean) : [];

  return { ok: true, accessToken, refreshToken, expiresAt, scopes };
}

/**
 * URI de retour, construite depuis l'origine de la requête reçue.
 *
 * Elle DOIT être identique à celle envoyée au démarrage, sinon le fournisseur
 * refuse l'échange — d'où une seule fonction, utilisée des deux côtés.
 */
export function callbackUrl(origin: string, provider: string): string {
  return `${origin.replace(/\/+$/, "")}/api/integrations/${provider}/callback`;
}

/**
 * Destination de retour sûre. Un `redirect_after` venant de la base est déjà
 * contraint à commencer par `/`, mais on revérifie : une redirection ouverte se
 * glisse toujours par le chemin qu'on n'a pas revérifié. `//evil.com` est une
 * URL absolue pour un navigateur — d'où le second test.
 */
export function safeRedirectPath(candidate: unknown): string {
  const v = typeof candidate === "string" ? candidate : "";
  if (!v.startsWith("/") || v.startsWith("//")) return "/integrations";
  return v;
}
