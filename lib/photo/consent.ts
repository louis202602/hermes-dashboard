/**
 * PHOTO-P0 — Vocabulaire et validation de FORMULAIRE du consentement média.
 *
 * NON AUTORITAIRE, par conception. L'autorité est double et côté serveur :
 *   * la contrainte de table `photo_consent_minors_need_guardian` ;
 *   * la façade `record_photo_consent` + le gate `verifier_consentement_photo`.
 * Ce module empêche seulement l'utilisateur de soumettre un formulaire qui
 * serait de toute façon refusé — il ne peut RIEN autoriser.
 *
 * Doctrine mineurs (rapport §13) : par défaut `identity_scope = NONE`. Toute
 * portée d'identité plus large sur un consentement couvrant des mineurs exige le
 * consentement explicite du représentant légal.
 */

export const CONSENT_USE_CASES = [
  "PORTFOLIO",
  "INSTAGRAM",
  "FACEBOOK",
  "BLOG",
  "CONCOURS",
  "PUBLICITE",
] as const;
export type ConsentUseCase = (typeof CONSENT_USE_CASES)[number];

export const CONSENT_MEDIA_TYPES = ["PHOTO", "VIDEO"] as const;
export type ConsentMediaType = (typeof CONSENT_MEDIA_TYPES)[number];

export const IDENTITY_SCOPES = ["NONE", "SILHOUETTE", "FACE"] as const;
export type IdentityScope = (typeof IDENTITY_SCOPES)[number];

export const LOCATION_SCOPES = ["NONE", "CITY", "EXACT"] as const;
export type LocationScope = (typeof LOCATION_SCOPES)[number];

/** Portée d'identité par défaut : la plus restrictive. Jamais autre chose. */
export const DEFAULT_IDENTITY_SCOPE: IdentityScope = "NONE";
export const DEFAULT_LOCATION_SCOPE: LocationScope = "NONE";

export const CONSENT_USE_CASE_LABEL: Record<ConsentUseCase, string> = {
  PORTFOLIO: "Portfolio",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  BLOG: "Blog",
  CONCOURS: "Concours",
  PUBLICITE: "Publicité",
};

export const IDENTITY_SCOPE_LABEL: Record<IdentityScope, string> = {
  NONE: "Aucune identification",
  SILHOUETTE: "Silhouette / de dos",
  FACE: "Visage reconnaissable",
};

export const LOCATION_SCOPE_LABEL: Record<LocationScope, string> = {
  NONE: "Aucun lieu",
  CITY: "Ville uniquement",
  EXACT: "Lieu précis",
};

export type ConsentFormInput = {
  useCases: string[];
  mediaTypes: string[];
  identityScope: string;
  locationScope: string;
  includesMinors: boolean;
  guardianConsent: boolean;
  consentTextVersion: string;
};

export type ConsentFormValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

const ORDERED_IDENTITY: readonly string[] = IDENTITY_SCOPES;

/** La portée `a` est-elle au moins aussi large que `b` ? (ordre NONE < SILHOUETTE < FACE) */
export function identityScopeAtLeast(a: string, b: string): boolean {
  const ia = ORDERED_IDENTITY.indexOf(a);
  const ib = ORDERED_IDENTITY.indexOf(b);
  if (ia < 0 || ib < 0) return false;
  return ia >= ib;
}

/**
 * Validation de saisie. Fail-closed : tout ce qui n'est pas explicitement
 * reconnu est refusé, et le refus est expliqué.
 */
export function validateConsentForm(input: ConsentFormInput): ConsentFormValidation {
  const useCases = input.useCases.filter((u) =>
    (CONSENT_USE_CASES as readonly string[]).includes(u),
  );
  if (useCases.length !== input.useCases.length) {
    return { ok: false, code: "BAD_USE_CASE", message: "Usage non reconnu." };
  }
  if (useCases.length === 0) {
    return { ok: false, code: "NO_USE_CASE", message: "Sélectionnez au moins un usage." };
  }

  const mediaTypes = input.mediaTypes.filter((m) =>
    (CONSENT_MEDIA_TYPES as readonly string[]).includes(m),
  );
  if (mediaTypes.length !== input.mediaTypes.length) {
    return { ok: false, code: "BAD_MEDIA_TYPE", message: "Type de média non reconnu." };
  }
  if (mediaTypes.length === 0) {
    return { ok: false, code: "NO_MEDIA_TYPE", message: "Sélectionnez au moins un type de média." };
  }

  if (!(IDENTITY_SCOPES as readonly string[]).includes(input.identityScope)) {
    return { ok: false, code: "BAD_IDENTITY_SCOPE", message: "Portée d’identité invalide." };
  }
  if (!(LOCATION_SCOPES as readonly string[]).includes(input.locationScope)) {
    return { ok: false, code: "BAD_LOCATION_SCOPE", message: "Portée de lieu invalide." };
  }

  // Verrou mineurs — miroir de la contrainte de table.
  if (input.includesMinors && !input.guardianConsent) {
    return {
      ok: false,
      code: "MINOR_WITHOUT_GUARDIAN",
      message:
        "Un consentement couvrant des mineurs exige le consentement du représentant légal.",
    };
  }

  const version = input.consentTextVersion.trim();
  if (version.length === 0 || version.length > 40) {
    return {
      ok: false,
      code: "BAD_CONSENT_VERSION",
      message: "Indiquez la version du texte de consentement signé.",
    };
  }

  return { ok: true };
}
