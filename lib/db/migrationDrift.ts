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

export type DriftInput = {
  /** `hermes_os.migration_baseline_summary()`. `null` = illisible ⇒ STOP. */
  baseline: { baselineEstablished: boolean; cutoffVersion: string | null } | null;
  /** `hermes_os.migrations_since_baseline()`. `null` = illisible ⇒ STOP. */
  appliedSinceBaseline: readonly AppliedMigration[] | null;
  /** Noms de fichiers de `db/migrations/` (basename, avec `.sql`). */
  repoFiles: readonly string[];
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
      detail:
        "Aucune ligne de base etablie : impossible de distinguer la dette historique " +
        "d'une derive nouvelle. Appliquer 20260820_hermes_migration_governance_3_baseline.sql.",
    };
  }

  const newUnversioned: AppliedMigration[] = [];
  const newVersioned: AppliedMigration[] = [];
  const appliedNames = new Set<string>();

  for (const m of input.appliedSinceBaseline) {
    appliedNames.add(m.name);
    if (declared.has(m.name)) newVersioned.push(m);
    else newUnversioned.push(m);
  }

  const declaredNotApplied = [...declared].filter((n) => !appliedNames.has(n)).sort();

  if (newUnversioned.length > 0) {
    return {
      verdict: "STOP_UNVERSIONED_DB_DRIFT",
      cutoffVersion: input.baseline.cutoffVersion,
      newUnversioned,
      newVersioned,
      declaredNotApplied,
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
    detail:
      `Aucune derive depuis la ligne de base ${input.baseline.cutoffVersion} ` +
      `(${newVersioned.length} migration(s) appliquee(s), toutes versionnees).`,
  };
}
