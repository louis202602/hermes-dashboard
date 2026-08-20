/**
 * GARDE-FOU DE DÉRIVE — dépôt vs production.
 *
 * L'audit du 2026-08-19 a montré que la très grande majorité des migrations de
 * cette base a été appliquée sans fichier dans le dépôt. Une règle qui refuserait
 * toute migration non versionnée bloquerait Hermès sur cette dette et serait
 * désactivée dès le lendemain — un garde-fou qu'on contourne ne protège rien.
 *
 * D'où la séparation, exacte et non négociable :
 *
 *   LEGACY_BASELINE        version <= cutoff. Dette d'avant la règle. N'ARRÊTE RIEN.
 *   NEW_UNVERSIONED_DRIFT  version >  cutoff sans fichier. STOP.
 *
 * La frontière est une comparaison de chaînes horodatées, pas une appréciation :
 * aucune migration ne peut « passer pour » de l'héritage.
 *
 * RÈGLE DE DÉCLARATION, volontairement exacte. Un fichier `YYYYMMDD_<nom>.sql`
 * déclare la migration nommée `<nom>`. Rien d'approchant, rien de similaire.
 * C'est ce qui fait que PV-1 aurait été attrapé : le fichier
 * `20260819_pv1_2_functions.sql` déclare `pv1_2_functions`, alors que la base a
 * enregistré `pv1_2_functions_guards`. Un rapprochement « intelligent » aurait
 * laissé passer l'écart ; l'égalité stricte le montre.
 *
 * Pur, sans I/O : la lecture du disque et l'accès à la base sont chez l'appelant.
 */

export type AppliedMigration = { version: string; name: string };

/**
 * Une migration appliquée dont le contenu vit dans un AUTRE fichier.
 *
 * Une session applique souvent par petits pas — un lot, un correctif, un second
 * correctif — puis consolide le tout dans un fichier unique décrivant l'état
 * FINAL au moment de committer. C'est la bonne pratique : un fichier de migration
 * doit être rejouable et lisible d'un bloc. Mais le registre de production, lui,
 * garde la trace de chaque pas. Les deux ont raison et ne disent pas la même chose.
 *
 * Sans ce mécanisme, le garde-fou n'aurait que deux lectures, toutes deux
 * mauvaises : refuser la consolidation, ou rapprocher les noms de façon
 * approximative — ce qui laisserait passer les vraies dérives.
 */
export type ConsolidationEntry = {
  /** Nom enregistré par la production. */
  applied: string;
  /** Nom de fichier (basename) qui porte réellement ce contenu. */
  carriedBy: string;
  reason: string;
  /** La MESURE qui a établi que le contenu est bien là. Pas une intention. */
  verifiedBy: string;
};

export type DriftInput = {
  /** `hermes_os.migration_baseline_summary()`. `null` = illisible ⇒ STOP. */
  baseline: { baselineEstablished: boolean; cutoffVersion: string | null } | null;
  /** `hermes_os.migrations_since_baseline()`. `null` = illisible ⇒ STOP. */
  appliedSinceBaseline: readonly AppliedMigration[] | null;
  /** Noms de fichiers de `db/migrations/` (basename, avec `.sql`). */
  repoFiles: readonly string[];
  /** Registre de consolidation. Absent ⇒ aucune consolidation admise. */
  consolidated?: readonly ConsolidationEntry[] | null;
};

export const DRIFT_VERDICTS = [
  "OK",
  "STOP_UNVERSIONED_DB_DRIFT",
  "STOP_NO_BASELINE",
  "STOP_UNREADABLE",
] as const;
export type DriftVerdict = (typeof DRIFT_VERDICTS)[number];

export type DriftReport = {
  verdict: DriftVerdict;
  cutoffVersion: string | null;
  /** Migrations appliquées après la frontière SANS fichier déclarant. Bloquantes. */
  newUnversioned: AppliedMigration[];
  /** Migrations appliquées après la frontière et correctement déclarées. */
  newVersioned: AppliedMigration[];
  /** Fichiers du dépôt jamais appliqués. Informatif : un lot préparé n'est pas une dérive. */
  declaredNotApplied: string[];
  /** Migrations acceptées via le registre de consolidation, et par quel fichier. */
  consolidatedAccepted: { applied: string; carriedBy: string }[];
  /** Entrées de consolidation refusées, avec le motif. Chacune vaut dérive. */
  consolidatedRejected: { applied: string; carriedBy: string; why: string }[];
  /** Phrase à afficher telle quelle par l'appelant. */
  detail: string;
};

/** `20260819_pv1_1_schema.sql` → `pv1_1_schema`. `null` si le fichier ne déclare rien. */
export function declaredMigrationName(fileName: string): string | null {
  if (!fileName.endsWith(".sql")) return null;
  const stem = fileName.slice(0, -4);
  // Les fichiers de rollback ne déclarent aucune migration : ils défont.
  if (/_9(_|$)|_rollback(_|$)/.test(stem)) return null;
  const m = /^(\d{8})_(.+)$/.exec(stem);
  if (m === null) return null;
  const name = m[2];
  return name.length > 0 ? name : null;
}

export function declaredMigrationNames(repoFiles: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of repoFiles) {
    const n = declaredMigrationName(f);
    if (n !== null) out.add(n);
  }
  return out;
}

/**
 * Valide le registre de consolidation contre les fichiers réellement présents.
 *
 * FAIL-CLOSED, et c'est le point important : une entrée qui désigne un fichier
 * absent est REFUSÉE, pas ignorée. Sans cela, ce registre deviendrait un moyen
 * de déclarer la dérive inexistante en écrivant deux lignes de JSON — l'exact
 * contraire de ce qu'on cherche.
 */
export function resolveConsolidation(
  entries: readonly ConsolidationEntry[] | null | undefined,
  repoFiles: readonly string[],
): {
  accepted: Map<string, string>;
  rejected: { applied: string; carriedBy: string; why: string }[];
} {
  const present = new Set(repoFiles);
  const accepted = new Map<string, string>();
  const rejected: { applied: string; carriedBy: string; why: string }[] = [];

  for (const e of entries ?? []) {
    const applied = typeof e?.applied === "string" ? e.applied.trim() : "";
    const carriedBy = typeof e?.carriedBy === "string" ? e.carriedBy.trim() : "";
    const verifiedBy = typeof e?.verifiedBy === "string" ? e.verifiedBy.trim() : "";

    if (applied === "" || carriedBy === "") {
      rejected.push({ applied, carriedBy, why: "entree incomplete" });
      continue;
    }
    if (!present.has(carriedBy)) {
      rejected.push({ applied, carriedBy, why: "le fichier porteur n'existe pas" });
      continue;
    }
    // Un rollback ne porte aucun contenu : il défait. Le désigner comme porteur
    // serait une façon polie de ne rien versionner du tout.
    if (declaredMigrationName(carriedBy) === null) {
      rejected.push({ applied, carriedBy, why: "le fichier porteur ne declare aucune migration" });
      continue;
    }
    if (verifiedBy === "") {
      rejected.push({ applied, carriedBy, why: "aucune mesure citee dans verifiedBy" });
      continue;
    }
    accepted.set(applied, carriedBy);
  }
  return { accepted, rejected };
}

/**
 * FAIL-CLOSED. Une entrée manquante, une ligne de base absente ou un `cutoff`
 * illisible rendent un verdict d'ARRÊT — jamais « OK faute de mieux ». Ne pas
 * pouvoir mesurer la dérive et ne pas en avoir sont deux choses différentes.
 */
export function classifyMigrationDrift(input: DriftInput): DriftReport {
  const declared = declaredMigrationNames(input.repoFiles ?? []);

  if (input.baseline === null || input.appliedSinceBaseline === null) {
    return {
      verdict: "STOP_UNREADABLE",
      cutoffVersion: null,
      newUnversioned: [],
      newVersioned: [],
      declaredNotApplied: [],
      consolidatedAccepted: [],
      consolidatedRejected: [],
      detail:
        "Etat de la base illisible (baseline ou migrations appliquees non fournies). " +
        "Absence de mesure n'est pas absence de derive : ne pas ecrire.",
    };
  }

  if (!input.baseline.baselineEstablished || !input.baseline.cutoffVersion) {
    return {
      verdict: "STOP_NO_BASELINE",
      cutoffVersion: null,
      newUnversioned: [],
      newVersioned: [],
      declaredNotApplied: [],
      consolidatedAccepted: [],
      consolidatedRejected: [],
      detail:
        "Aucune ligne de base etablie : impossible de distinguer la dette historique " +
        "d'une derive nouvelle. Appliquer 20260820_hermes_migration_governance_3_baseline.sql.",
    };
  }

  const consolidation = resolveConsolidation(input.consolidated, input.repoFiles ?? []);

  const newUnversioned: AppliedMigration[] = [];
  const newVersioned: AppliedMigration[] = [];
  const consolidatedAccepted: { applied: string; carriedBy: string }[] = [];
  const appliedNames = new Set<string>();

  for (const m of input.appliedSinceBaseline) {
    appliedNames.add(m.name);
    if (declared.has(m.name)) {
      newVersioned.push(m);
      continue;
    }
    const carriedBy = consolidation.accepted.get(m.name);
    if (carriedBy !== undefined) {
      newVersioned.push(m);
      consolidatedAccepted.push({ applied: m.name, carriedBy });
      continue;
    }
    newUnversioned.push(m);
  }

  const declaredNotApplied = [...declared].filter((n) => !appliedNames.has(n)).sort();

  if (newUnversioned.length > 0) {
    return {
      verdict: "STOP_UNVERSIONED_DB_DRIFT",
      cutoffVersion: input.baseline.cutoffVersion,
      newUnversioned,
      newVersioned,
      declaredNotApplied,
      consolidatedAccepted,
      consolidatedRejected: consolidation.rejected,
      detail:
        `${newUnversioned.length} migration(s) appliquee(s) apres la ligne de base ` +
        `sans fichier declarant : ${newUnversioned.map((m) => `${m.version} ${m.name}`).join(", ")}. ` +
        "Versionner ces migrations avant toute nouvelle ecriture.",
    };
  }

  return {
    verdict: "OK",
    cutoffVersion: input.baseline.cutoffVersion,
    newUnversioned,
    newVersioned,
    declaredNotApplied,
    consolidatedAccepted,
    consolidatedRejected: consolidation.rejected,
    detail:
      `Aucune derive depuis la ligne de base ${input.baseline.cutoffVersion} ` +
      `(${newVersioned.length} migration(s) appliquee(s), toutes versionnees` +
      (consolidatedAccepted.length > 0
        ? `, dont ${consolidatedAccepted.length} via le registre de consolidation`
        : "") +
      ").",
  };
}
