/**
 * Classification des échecs de `supabase.auth.getUser()`.
 *
 * Trois situations très différentes remontent par le MÊME canal d'erreur, et
 * les confondre produit soit du bruit, soit un angle mort :
 *
 *   NO_SESSION                 — aucun cookie, aucune session. C'est l'état
 *                                NORMAL d'un visiteur non connecté ou de
 *                                /login. Supabase lève `AuthSessionMissingError`
 *                                (name: "AuthSessionMissingError", status 400,
 *                                code undefined). Ce n'est pas une panne.
 *   SESSION_EXPIRED_OR_INVALID — un refresh token existait mais n'a pas pu être
 *                                échangé (`refresh_token_not_found`). Attendu
 *                                lors d'une rotation, mais mérite un suivi.
 *   AUTH_CHECK_ERROR           — tout le reste : indisponibilité réseau,
 *                                réponse GoTrue inattendue… une vraie anomalie
 *                                technique, qui doit rester bruyante.
 *
 * Le test de `NO_SESSION` reproduit exactement celui du helper officiel
 * `isAuthSessionMissingError` (`isAuthError(e) && e.name === "AuthSessionMissingError"`)
 * SANS importer `@supabase/auth-js`, qui n'est qu'une dépendance transitive de
 * ce dépôt — importer directement d'un paquet non déclaré serait fragile.
 */

export type SessionFailureReason =
  | "NO_SESSION"
  | "SESSION_EXPIRED_OR_INVALID"
  | "AUTH_CHECK_ERROR";

/** Forme structurelle minimale d'une `AuthError` — évite d'épingler un type de paquet. */
export type AuthErrorLike = {
  name?: string;
  code?: string | undefined;
  status?: number | undefined;
};

/** Niveau de journalisation associé à chaque cause. */
const LEVEL: Record<SessionFailureReason, "info" | "warn" | "error"> = {
  NO_SESSION: "info",
  SESSION_EXPIRED_OR_INVALID: "warn",
  AUTH_CHECK_ERROR: "error",
};

export function classifyAuthError(error: AuthErrorLike): {
  reason: SessionFailureReason;
  level: "info" | "warn" | "error";
} {
  const reason: SessionFailureReason =
    error.name === "AuthSessionMissingError"
      ? "NO_SESSION"
      : error.code === "refresh_token_not_found"
        ? "SESSION_EXPIRED_OR_INVALID"
        : "AUTH_CHECK_ERROR";
  return { reason, level: LEVEL[reason] };
}
