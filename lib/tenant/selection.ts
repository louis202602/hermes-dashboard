/**
 * HERMÈS — sélection du tenant actif (ACTIVE_TENANT_SELECTION).
 *
 * Le problème, constaté en base : `resolve_active_tenant(null)` renvoie
 * `AMBIGUOUS_TENANT_REQUIRE_SELECTION` dès qu'un utilisateur est membre de
 * plusieurs tenants — et aucun sélecteur n'existe. Un compte rattaché à deux
 * tenants casserait donc ses propres lectures.
 *
 * Ce module prépare la sélection SANS l'imposer : un utilisateur mono-tenant
 * (le cas de Vanessa, et le seul cas réel aujourd'hui) n'en voit jamais rien.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LA RÈGLE : la sélection est une PRÉFÉRENCE, jamais une AUTORISATION.      │
 * │ Elle indique lequel des tenants autorisés on regarde. Elle n'en autorise  │
 * │ aucun. La vérification d'appartenance est refaite EN BASE à chaque appel. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * C'est pour cela qu'il est sûr de la transporter dans un cookie, donc dans une
 * valeur que le client contrôle : `resolve_active_tenant(p_requested_tenant_id)`
 * — qui existe déjà et n'a pas à changer — répond `ACCESS_DENIED` pour tout
 * tenant dont l'appelant n'est pas `tenant.member`. Un cookie forgé ne donne
 * accès à rien ; il produit un refus.
 *
 * Pur, sans I/O.
 */

/**
 * Nom du cookie. Préfixe `__Host-` : il impose HTTPS, interdit l'attribut
 * `Domain` et force `Path=/`. Un sous-domaine compromis ne peut donc pas
 * l'écrire — la sélection ne franchit pas les frontières d'origine.
 */
export const ACTIVE_TENANT_COOKIE = "__Host-hermes-tenant";

/** Un `tenant_id` est un slug. Tout le reste est refusé avant même la base. */
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function isWellFormedTenantId(v: unknown): v is string {
  return typeof v === "string" && TENANT_ID_PATTERN.test(v);
}

/**
 * Valeur de cookie → tenant demandé, ou `null`.
 *
 * Le filtrage de forme n'est PAS une mesure de sécurité — la sécurité est en
 * base. Il évite seulement d'envoyer n'importe quelle chaîne à Postgres et de
 * transformer un cookie bricolé en trafic inutile.
 */
export function parseSelection(cookieValue: string | null | undefined): string | null {
  const raw = typeof cookieValue === "string" ? cookieValue.trim() : "";
  return isWellFormedTenantId(raw) ? raw : null;
}

export type TenantMembership = {
  tenantId: string;
  label: string;
};

export const SELECTION_OUTCOMES = [
  "SINGLE_TENANT",
  "SELECTION_APPLIED",
  "SELECTION_INVALID",
  "SELECTION_REQUIRED",
  "NO_TENANT",
] as const;
export type SelectionOutcome = (typeof SELECTION_OUTCOMES)[number];

export type SelectionResult = {
  outcome: SelectionOutcome;
  /** Tenant à demander à `resolve_active_tenant`. `null` ⇒ ne rien demander. */
  requestedTenantId: string | null;
  /** L'interface doit-elle afficher un sélecteur ? */
  mustChoose: boolean;
};

/**
 * Que faire, compte tenu des appartenances RÉELLES et de la sélection stockée.
 *
 * Les appartenances viennent de la base (`tenant.member` uniquement), jamais du
 * client. Une sélection qui n'y figure pas est ignorée — pas honorée, pas
 * transformée en erreur bruyante : on redemande simplement de choisir.
 *
 * Cas important et volontaire : UN SEUL tenant ⇒ `SINGLE_TENANT` et
 * `requestedTenantId: null`. On continue d'appeler `resolve_active_tenant(null)`
 * exactement comme aujourd'hui. Aucun comportement ne change pour un
 * utilisateur mono-tenant — ce qui est le cas de Vanessa.
 */
export function resolveSelection(
  memberships: readonly TenantMembership[],
  storedSelection: string | null,
): SelectionResult {
  if (memberships.length === 0) {
    return { outcome: "NO_TENANT", requestedTenantId: null, mustChoose: false };
  }
  if (memberships.length === 1) {
    return { outcome: "SINGLE_TENANT", requestedTenantId: null, mustChoose: false };
  }

  const selection = parseSelection(storedSelection);
  if (selection === null) {
    return { outcome: "SELECTION_REQUIRED", requestedTenantId: null, mustChoose: true };
  }
  const belongs = memberships.some((m) => m.tenantId === selection);
  if (!belongs) {
    // L'utilisateur a pu perdre son accès depuis. On ne devine pas un
    // remplaçant : on redemande.
    return { outcome: "SELECTION_INVALID", requestedTenantId: null, mustChoose: true };
  }
  return { outcome: "SELECTION_APPLIED", requestedTenantId: selection, mustChoose: false };
}

/**
 * Une sélection peut-elle être ENREGISTRÉE ?
 *
 * Contrôle applicatif, doublé en base : la façade d'écriture ne persiste que
 * des tenants dont l'appelant est membre. Refuser ici évite un aller-retour,
 * mais ce n'est pas ce qui protège.
 */
export function canPersistSelection(
  memberships: readonly TenantMembership[],
  candidate: string,
): boolean {
  return isWellFormedTenantId(candidate) && memberships.some((m) => m.tenantId === candidate);
}

/**
 * Attributs du cookie de sélection. `httpOnly` : le navigateur n'a aucune raison
 * de lire cette valeur en JavaScript. `sameSite: "lax"` : la sélection ne suit
 * pas une requête déclenchée par un site tiers.
 */
export const ACTIVE_TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 180,
} as const;

/**
 * FOUNDER ET OPERATOR — la règle explicite, pour qu'elle soit testable.
 *
 * Un niveau élevé n'ÉLARGIT PAS la liste des tenants. `get_my_tenants()` ne
 * remonte que des lignes `tenant.member` : un founder qui n'est pas membre d'un
 * tenant ne le voit pas, ne le sélectionne pas, n'en lit rien.
 *
 * Accéder à un tenant supplémentaire est donc un acte d'ADMINISTRATION —
 * s'ajouter comme membre, tracé dans `user_tenant_permissions` — jamais un
 * effet de bord d'un rôle.
 */
export function selectableTenants(
  memberships: readonly TenantMembership[],
): TenantMembership[] {
  // Aucun ajout selon le niveau. La fonction existe pour que ce « aucun » soit
  // vérifié par un test plutôt qu'affirmé par un commentaire.
  return [...memberships].sort((a, b) => a.tenantId.localeCompare(b.tenantId));
}
