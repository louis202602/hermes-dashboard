/**
 * HERMÈS — niveaux d'accès. PAS un nouveau système de rôles.
 *
 * L'audit a établi que le modèle de droits d'Hermès est déjà entièrement porté
 * par `hermes_os.user_tenant_permissions` : des CHAÎNES de permission accordées
 * par (user, tenant), jointes à `agent_action_catalog.required_permission` pour
 * décider ce qui est exécutable. Deux chaînes existent réellement aujourd'hui :
 * `tenant.member` et `tenant.admin`.
 *
 * Ce module ne crée donc AUCUNE table, AUCUNE colonne, AUCUN rôle parallèle : il
 * ordonne des chaînes de la table existante et rend le classement testable.
 *
 * ⚠️ Honnêteté du modèle : sur les quatre niveaux demandés, DEUX sont provisionnés
 * (`tenant.member`, `tenant.admin`) et DEUX ne le sont pas encore
 * (`hermes.operator`, `hermes.founder`). Les seconds sont déclarés ici pour que
 * le classement soit total, mais `ACCESS_LEVEL_PROVISIONED` dit la vérité :
 * personne ne les détient. Les accorder plus tard = insérer deux lignes dans la
 * table existante, pas construire un système.
 */

export const ACCESS_LEVELS = [
  "NONE",
  "TENANT_MEMBER",
  "TENANT_ADMIN",
  "HERMES_OPERATOR",
  "FOUNDER",
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Chaîne de permission (table existante) → niveau. */
export const PERMISSION_TO_LEVEL: Record<string, AccessLevel> = {
  "tenant.member": "TENANT_MEMBER",
  "tenant.admin": "TENANT_ADMIN",
  "hermes.operator": "HERMES_OPERATOR",
  "hermes.founder": "FOUNDER",
};

/** Ordre croissant. Sert aux comparaisons, jamais à contourner une capacité. */
export const LEVEL_RANK: Record<AccessLevel, number> = {
  NONE: 0,
  TENANT_MEMBER: 1,
  TENANT_ADMIN: 2,
  HERMES_OPERATOR: 3,
  FOUNDER: 4,
};

/**
 * Ce qui est RÉELLEMENT accordable aujourd'hui, constaté en base. Un niveau non
 * provisionné n'est pas une promesse : aucun utilisateur ne peut l'atteindre.
 */
export const ACCESS_LEVEL_PROVISIONED: Record<AccessLevel, boolean> = {
  NONE: true,
  TENANT_MEMBER: true,
  TENANT_ADMIN: true,
  HERMES_OPERATOR: false,
  FOUNDER: false,
};

/**
 * Niveau le plus élevé porté par un jeu de permissions.
 * Une chaîne inconnue ne vaut rien : elle ne peut pas élever un utilisateur.
 */
export function resolveAccessLevel(permissions: Iterable<string>): AccessLevel {
  let best: AccessLevel = "NONE";
  for (const p of permissions) {
    const lvl = PERMISSION_TO_LEVEL[String(p)];
    if (lvl && LEVEL_RANK[lvl] > LEVEL_RANK[best]) best = lvl;
  }
  return best;
}

export function atLeast(level: AccessLevel, required: AccessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[required];
}

/**
 * LA RÈGLE QUI PROTÈGE LE MULTI-TENANT.
 *
 * Un niveau élevé donne accès à des ÉCRANS d'administration — jamais aux données
 * d'un autre tenant. Aucun niveau, founder compris, ne franchit la frontière du
 * tenant : celle-ci est tenue en base par `resolve_active_tenant`, qui ne rend
 * qu'un tenant dont l'appelant est `tenant.member`, et par RLS deny-all.
 *
 * Cette fonction existe pour que la règle soit TESTABLE, pas seulement écrite.
 *
 * L'allowlist ci-dessous est VIDE, et c'est le point : si quelqu'un y ajoute un
 * niveau un jour, le test d'isolation échoue immédiatement.
 */
const CROSS_TENANT_ALLOWLIST: readonly AccessLevel[] = [];

export function canCrossTenantBoundary(level: AccessLevel): boolean {
  return CROSS_TENANT_ALLOWLIST.includes(level);
}

/**
 * Un niveau peut-il ouvrir les écrans d'exploitation Hermès (santé plateforme,
 * provisioning téléphonie, catalogue de fournisseurs) ? Ce sont des écrans
 * d'INFRASTRUCTURE, sans données métier d'un tenant.
 */
export function canOperateHermes(level: AccessLevel): boolean {
  return atLeast(level, "HERMES_OPERATOR");
}

/** Un niveau peut-il administrer SON tenant (membres, activation de modules) ? */
export function canAdministerTenant(level: AccessLevel): boolean {
  return atLeast(level, "TENANT_ADMIN");
}
