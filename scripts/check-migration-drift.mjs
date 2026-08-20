#!/usr/bin/env node
/**
 * GARDE-FOU DE DÉRIVE — étape 1 de la procédure BEFORE_PRODUCTION_DB_WRITE.
 *
 * Ce script ne se connecte PAS à la base : dans l'environnement Hermès, l'accès
 * production passe par l'outil Supabase de l'agent, pas par une chaîne de
 * connexion dans le dépôt. L'agent lit donc l'état, le passe ici, et ce script
 * rend le verdict. Séparer les deux a un avantage : le classement est testable
 * hors ligne (`tests/migration-drift-guard.test.ts`).
 *
 * Usage :
 *   1. exécuter en base :
 *        select hermes_os.migration_baseline_summary();
 *        select * from hermes_os.migrations_since_baseline();
 *   2. passer le résultat sur l'entrée standard :
 *        echo '{"baseline":{...},"appliedSinceBaseline":[...]}' \
 *          | node scripts/check-migration-drift.mjs
 *
 * Sortie : code 0 si OK, code 1 sinon. FAIL-CLOSED — une entrée absente,
 * illisible ou mal formée est un ARRÊT, jamais un laissez-passer. Ne pas pouvoir
 * mesurer la dérive et ne pas en avoir sont deux choses différentes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function stop(message) {
  console.error(`STOP_UNVERSIONED_DB_DRIFT\n${message}`);
  process.exit(1);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Le module de classement est en TypeScript ; on le relit ici en dupliquant la
// SEULE règle de nommage, volontairement, pour que ce script n'ait besoin
// d'aucun chargeur. La duplication est gardée honnête par un test qui compare
// les deux implémentations sur les mêmes cas.
function declaredMigrationName(fileName) {
  if (!fileName.endsWith(".sql")) return null;
  const stem = fileName.slice(0, -4);
  if (/_9(_|$)|_rollback(_|$)/.test(stem)) return null;
  const m = /^(\d{8})_(.+)$/.exec(stem);
  if (m === null) return null;
  return m[2].length > 0 ? m[2] : null;
}

const raw = readStdin().trim();
if (raw === "") {
  stop(
    "Aucun etat de base fourni sur l'entree standard.\n" +
      "Executer d'abord hermes_os.migration_baseline_summary() et " +
      "hermes_os.migrations_since_baseline(), puis les passer ici.",
  );
}

let input;
try {
  input = JSON.parse(raw);
} catch (e) {
  stop(`Entree illisible (JSON invalide) : ${e.message}`);
}

const baseline = input?.baseline ?? null;
const since = input?.appliedSinceBaseline ?? null;

if (baseline === null || !Array.isArray(since)) {
  stop("Entree incomplete : `baseline` et `appliedSinceBaseline` sont requis.");
}
const established = baseline.baseline_established ?? baseline.baselineEstablished;
const cutoff = baseline.cutoff_version ?? baseline.cutoffVersion;
if (established !== true || typeof cutoff !== "string" || cutoff === "") {
  stop(
    "Aucune ligne de base etablie : impossible de distinguer la dette historique " +
      "d'une derive nouvelle.\n" +
      "Appliquer db/migrations/20260820_hermes_migration_governance_3_baseline.sql.",
  );
}

const declared = new Set(
  readdirSync(MIGRATIONS_DIR)
    .map(declaredMigrationName)
    .filter((n) => n !== null),
);

const unversioned = since.filter((m) => !declared.has(m.name));
const versioned = since.filter((m) => declared.has(m.name));

if (unversioned.length > 0) {
  stop(
    `${unversioned.length} migration(s) appliquee(s) apres la ligne de base ${cutoff} ` +
      "sans fichier declarant :\n" +
      unversioned.map((m) => `  - ${m.version} ${m.name}`).join("\n") +
      "\n\nRappel : la dette ANTERIEURE a la ligne de base ne bloque pas. " +
      "Celles-ci sont posterieures.\nVersionner ces migrations avant toute nouvelle ecriture.",
  );
}

console.log(
  `OK — aucune derive depuis la ligne de base ${cutoff} ` +
    `(${versioned.length} migration(s) appliquee(s), toutes versionnees).`,
);
