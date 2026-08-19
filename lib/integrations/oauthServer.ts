import "server-only";

/**
 * HERMÈS — échange OAuth `code → token`, CÔTÉ SERVEUR UNIQUEMENT.
 *
 * `import "server-only"` en première ligne : toute tentative d'importer ce
 * module depuis un composant client fait échouer la COMPILATION. Ce n'est pas
 * une convention de nommage, c'est une barrière vérifiée par le build.
 *
 * L'invariant tenu ici, reformulé précisément — c'était le point de la décision :
 *
 *   AVANT  « l'application ne détient aucun secret »
 *   APRÈS  « AUCUN SECRET N'ATTEINT LE NAVIGATEUR »
 *
 * Le second est celui qui protège réellement, et Next.js le garantit : une
 * variable d'environnement sans préfixe `NEXT_PUBLIC_` n'est jamais intégrée au
 * bundle client (docs Next.js 16, « Bundling Environment Variables for the
 * Browser »). Le premier énoncé, lui, imposait de faire boucler le flux par n8n
 * — donc de rendre la connexion d'un agenda impossible dès que n8n tombe.
 *
 * CE QUI RESTE INTERDIT, et vérifié par test :
 *   * `NEXT_PUBLIC_*` pour un secret ;
 *   * la clé `service_role` de Supabase dans l'application — elle contournerait
 *     tout le RLS, et serait bien pire qu'un `client_secret` de fournisseur.
 *     C'est pourquoi le callback appelle une façade `authenticated`
 *     (`complete_integration_connection_self`) et non une RPC `service_role`.
 */

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
 * Nom de la variable serveur portant le secret, par fournisseur.
 * Aucun préfixe `NEXT_PUBLIC_` — c'est ce qui garantit qu'elle reste serveur.
 */
const SECRET_ENV: Record<OAuthServerProvider, string> = {
  google_calendar: "GOOGLE_CLIENT_SECRET",
};

/** Point d'échange du fournisseur. Public, mais figé ici plutôt que reçu. */
const TOKEN_URL: Record<OAuthServerProvider, string> = {
  google_calendar: "https://oauth2.googleapis.com/token",
};

/**
 * Échange le `code` contre des jetons.
 *
 * Le secret est lu à CHAQUE appel plutôt que capturé au chargement du module :
 * une valeur absente produit un refus explicite (`PROVIDER_SECRET_MISSING`) au
 * lieu d'un module à moitié initialisé, et rien n'est mis en cache.
 *
 * Aucune donnée sensible ne remonte dans le résultat d'erreur : ni le `code`,
 * ni le corps de la réponse du fournisseur — un message d'erreur finit toujours
 * par atterrir dans un journal.
 */
export async function exchangeAuthorizationCode(
  provider: OAuthServerProvider,
  input: { code: string; clientId: string; redirectUri: string },
): Promise<TokenExchangeResult> {
  const secret = process.env[SECRET_ENV[provider]];
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, code: "PROVIDER_SECRET_MISSING" };
  }
  if (!input.code || !input.clientId || !input.redirectUri) {
    return { ok: false, code: "BAD_ARGUMENTS" };
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_URL[provider], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: input.clientId,
        client_secret: secret,
        redirect_uri: input.redirectUri,
      }),
      // Un échange OAuth ne se met JAMAIS en cache.
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "PROVIDER_UNREACHABLE" };
  }

  if (!response.ok) {
    // Le corps peut contenir le `code` renvoyé en écho : on ne le propage pas.
    return { ok: false, code: `PROVIDER_HTTP_${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "PROVIDER_BAD_RESPONSE" };
  }
  return parseTokenPayload(payload);
}

