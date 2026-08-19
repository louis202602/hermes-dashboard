import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  classifyMigrationDrift,
  declaredMigrationName,
  declaredMigrationNames,
} from "../lib/db/migrationDrift.ts";

/**
 * GARDE-FOU DE DÉRIVE + VERROU DE MIGRATION — contrat vérifié au niveau du diff.
 *
 * Deux familles d'assertions :
 *   * le classement legacy / dérive nouvelle, en logique pure ;
 *   * le SQL du verrou lu comme un contrat (singleton, TTL, aucune exposition).
 *
 * Les chemins d'exécution réels du verrou (concurrence, expiration, reprise) sont
 * vérifiés sur PostgreSQL, pas ici : un test de chaîne ne prouve pas qu'un CHECK
 * mord.
 */

const ROOT = new URL("..", import.meta.url);
const MIG = fileURLToPath(new URL("db/migrations/", ROOT));
const sql = (f: string) => readFileSync(MIG + f, "utf8");

const LOCK = sql("20260820_hermes_migration_governance_1_lock.sql");
const FUNCS = sql("20260820_hermes_migration_governance_2_functions.sql");
const BASELINE = sql("20260820_hermes_migration_governance_3_baseline.sql");
const ROLLBACK = sql("20260820_hermes_migration_governance_9_rollback.sql");

// --- Déclaration de migration par nom de fichier -------------------------------

test("un fichier aller déclare exactement son nom de migration", () => {
  assert.equal(declaredMigrationName("20260819_pv1_1_schema.sql"), "pv1_1_schema");
  assert.equal(
    declaredMigrationName("20260818_photo_studio_1_schema.sql"),
    "photo_studio_1_schema",
  );
});

test("un fichier de rollback ne déclare aucune migration", () => {
  assert.equal(declaredMigrationName("20260819_pv1_9_rollback.sql"), null);
  assert.equal(declaredMigrationName("20260820_photo_studio_9_rollback_p2.sql"), null);
});

test("ce qui n'est pas une migration datée ne déclare rien", () => {
  assert.equal(declaredMigrationName("README.md"), null);
  assert.equal(declaredMigrationName("notes.sql"), null);
  assert.equal(declaredMigrationName("2026_trop_court.sql"), null);
});

test("le rapprochement est STRICT : PV-1 lot 2 aurait été signalé", () => {
  // Le fichier déclare `pv1_2_functions`, la base a enregistré
  // `pv1_2_functions_guards`. Aucun rapprochement approximatif ne doit sauver ça.
  const declared = declaredMigrationNames(["20260819_pv1_2_functions.sql"]);
  assert.ok(declared.has("pv1_2_functions"));
  assert.ok(!declared.has("pv1_2_functions_guards"));
});

// --- Classement ----------------------------------------------------------------

const baselineOk = { baselineEstablished: true, cutoffVersion: "20260819161441" };

test("aucune migration depuis la ligne de base ⇒ OK", () => {
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [],
    repoFiles: ["20260819_pv1_1_schema.sql"],
  });
  assert.equal(r.verdict, "OK");
  assert.deepEqual(r.newUnversioned, []);
});

test("une migration récente DÉCLARÉE ⇒ OK", () => {
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [{ version: "20260820090000", name: "photo_studio_6_acquisition" }],
    repoFiles: ["20260819_photo_studio_6_acquisition.sql"],
  });
  assert.equal(r.verdict, "OK");
  assert.equal(r.newVersioned.length, 1);
});

test("une migration récente NON déclarée ⇒ STOP_UNVERSIONED_DB_DRIFT", () => {
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [{ version: "20260820091500", name: "un_truc_applique_a_la_main" }],
    repoFiles: ["20260819_photo_studio_6_acquisition.sql"],
  });
  assert.equal(r.verdict, "STOP_UNVERSIONED_DB_DRIFT");
  assert.equal(r.newUnversioned.length, 1);
  assert.match(r.detail, /un_truc_applique_a_la_main/);
});

test("le classement refuse un nom APPROCHANT : le cas réel PV-1 lot 2", () => {
  // C'est le scénario qui s'est produit le 2026-08-19 : le fichier
  // `20260819_pv1_2_functions.sql` déclare `pv1_2_functions`, mais la base a
  // enregistré la migration sous `pv1_2_functions_guards`. Un rapprochement par
  // préfixe, suffixe ou inclusion ferait passer l'écart pour une correspondance.
  // Le classement doit le signaler comme une dérive, pas comme un détail.
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [{ version: "20260820093000", name: "pv1_2_functions_guards" }],
    repoFiles: ["20260819_pv1_2_functions.sql"],
  });
  assert.equal(r.verdict, "STOP_UNVERSIONED_DB_DRIFT");
  assert.deepEqual(
    r.newUnversioned.map((m) => m.name),
    ["pv1_2_functions_guards"],
  );
  assert.deepEqual(r.newVersioned, []);
});

test("le classement refuse aussi l'inclusion inverse", () => {
  // Symétrique : le fichier déclare un nom PLUS LONG que celui enregistré.
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [{ version: "20260820093100", name: "photo_studio_8" }],
    repoFiles: ["20260820_photo_studio_8_commerce.sql"],
  });
  assert.equal(r.verdict, "STOP_UNVERSIONED_DB_DRIFT");
});

test("la dette historique ne bloque JAMAIS", () => {
  // 165 migrations sans fichier existent avant la frontière : elles ne sont pas
  // dans `appliedSinceBaseline`, donc elles ne peuvent pas produire de verdict.
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [],
    repoFiles: [],
  });
  assert.equal(r.verdict, "OK");
});

test("un lot préparé mais non appliqué n'est pas une dérive", () => {
  const r = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: [],
    repoFiles: ["20260820_photo_studio_8_commerce.sql"],
  });
  assert.equal(r.verdict, "OK");
  assert.deepEqual(r.declaredNotApplied, ["photo_studio_8_commerce"]);
});

test("FAIL-CLOSED : base illisible ⇒ arrêt, pas « OK faute de mieux »", () => {
  const a = classifyMigrationDrift({
    baseline: null,
    appliedSinceBaseline: [],
    repoFiles: [],
  });
  assert.equal(a.verdict, "STOP_UNREADABLE");

  const b = classifyMigrationDrift({
    baseline: baselineOk,
    appliedSinceBaseline: null,
    repoFiles: [],
  });
  assert.equal(b.verdict, "STOP_UNREADABLE");
});

test("FAIL-CLOSED : pas de ligne de base ⇒ arrêt", () => {
  const r = classifyMigrationDrift({
    baseline: { baselineEstablished: false, cutoffVersion: null },
    appliedSinceBaseline: [],
    repoFiles: [],
  });
  assert.equal(r.verdict, "STOP_NO_BASELINE");
});

// --- Le script d'exécution ne doit pas diverger du module ----------------------

test("scripts/check-migration-drift.mjs applique la MÊME règle de nommage", () => {
  // Le script est autonome (aucun chargeur TypeScript) et redéclare donc la règle.
  // Une duplication non surveillée finit toujours par diverger : on compare les
  // deux implémentations sur les cas qui comptent, y compris les pièges réels.
  const script = readFileSync(fileURLToPath(new URL("scripts/check-migration-drift.mjs", ROOT)), "utf8");
  const body = /function declaredMigrationName\(fileName\) \{([\s\S]*?)\n\}/.exec(script);
  assert.ok(body, "le script doit definir declaredMigrationName");
  const scriptImpl = new Function("fileName", body[1]) as (f: string) => string | null;

  const cases = [
    "20260819_pv1_1_schema.sql",
    "20260819_pv1_2_functions.sql",
    "20260819_pv1_9_rollback.sql",
    // Discriminant : un fichier `_9_` qui ne s'appelle PAS rollback. Sans ce cas,
    // retirer la moitie `_9_` de la regle passerait inapercu.
    "20260819_pv1_9_teardown.sql",
    "20260820_photo_studio_9_rollback_p2.sql",
    "20260820_hermes_migration_governance_1_lock.sql",
    "20260820_hermes_migration_governance_9_rollback.sql",
    "README.md",
    "notes.sql",
    "2026_trop_court.sql",
    "20260819_.sql",
  ];
  for (const c of cases) {
    assert.equal(scriptImpl(c), declaredMigrationName(c), `divergence sur ${c}`);
  }
});

test("le script est FAIL-CLOSED : vérifié en l'exécutant, pas en le lisant", () => {
  // Un test qui compte les `process.exit(1)` ne prouve rien : on peut neutraliser
  // le contrôle sans en supprimer un seul. On lance donc le script pour de vrai.
  const bin = fileURLToPath(new URL("scripts/check-migration-drift.mjs", ROOT));
  const run = (stdin: string) =>
    spawnSync(process.execPath, [bin], { input: stdin, encoding: "utf8" }).status;

  assert.equal(run(""), 1, "entrée vide doit arrêter");
  assert.equal(run("pas du json"), 1, "JSON invalide doit arrêter");
  assert.equal(run("{}"), 1, "entrée incomplète doit arrêter");
  assert.equal(run('{"baseline":{},"appliedSinceBaseline":[]}'), 1, "baseline absente doit arrêter");
  assert.equal(
    run('{"baseline":{"baseline_established":true},"appliedSinceBaseline":[]}'),
    1,
    "cutoff manquant doit arrêter",
  );
  assert.equal(
    run('{"baseline":{"baseline_established":true,"cutoff_version":"20260819161441"},"appliedSinceBaseline":null}'),
    1,
    "liste non fournie doit arrêter",
  );
  assert.equal(
    run(
      '{"baseline":{"baseline_established":true,"cutoff_version":"20260819161441"},' +
        '"appliedSinceBaseline":[{"version":"20260820091500","name":"applique_a_la_main"}]}',
    ),
    1,
    "dérive nouvelle doit arrêter",
  );
  assert.equal(
    run(
      '{"baseline":{"baseline_established":true,"cutoff_version":"20260819161441"},' +
        '"appliedSinceBaseline":[{"version":"20260820090000","name":"hermes_migration_governance_1_lock"}]}',
    ),
    0,
    "migration déclarée doit passer",
  );
});

// --- Le SQL du verrou lu comme un contrat --------------------------------------

test("ONE_ACTIVE_LOCK_MAX est structurel, pas conventionnel", () => {
  // Clé primaire + CHECK sur la seule valeur autorisée : la table ne peut pas
  // contenir deux lignes, quoi que fasse le code.
  assert.match(LOCK, /primary key \(lock_id\)/);
  assert.match(LOCK, /check \(lock_id = 'PRODUCTION'\)/);
});

test("TTL_REQUIRED est borné des deux côtés", () => {
  assert.match(LOCK, /check \(expires_at > acquired_at\)/);
  assert.match(LOCK, /expires_at <= acquired_at \+ interval '2 hours'/);
  assert.match(FUNCS, /p_ttl_minutes < 1 or p_ttl_minutes > 120/);
});

test("base_sha doit être un vrai SHA de commit", () => {
  assert.match(LOCK, /base_sha ~ '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(FUNCS, /INVALID_BASE_SHA/);
});

test("un verrou occupé rend STOP_CONCURRENT_MIGRATION", () => {
  assert.match(FUNCS, /STOP_CONCURRENT_MIGRATION/);
});

test("EXPIRED_LOCK_CAN_BE_RECLAIMED, mais la reprise laisse une trace", () => {
  assert.match(FUNCS, /ACQUIRED_AFTER_EXPIRY/);
  assert.match(FUNCS, /RECLAIMED_AFTER_EXPIRY/);
  // L'archivage précède la suppression : sinon la trace disparaîtrait avec la ligne.
  const iInsert = FUNCS.indexOf("RECLAIMED_AFTER_EXPIRY");
  const iDelete = FUNCS.indexOf("delete from hermes_os.production_migration_lock");
  assert.ok(iInsert < iDelete, "l'historique doit être écrit avant la suppression");
});

test("on ne relâche pas le verrou vivant d'un autre", () => {
  assert.match(FUNCS, /NOT_OWNER/);
});

test("les acquisitions sont sérialisées", () => {
  assert.match(FUNCS, /pg_advisory_xact_lock/);
});

test("aucune exposition applicative : ni anon, ni authenticated, ni façade public", () => {
  for (const [label, text] of [
    ["lock", LOCK],
    ["functions", FUNCS],
    ["baseline", BASELINE],
  ] as const) {
    assert.match(text, /revoke all/i, `${label} doit révoquer`);
    assert.ok(
      !/^\s*(create|create or replace)\s+function\s+public\./im.test(text),
      `${label} ne doit créer aucune façade public`,
    );
    assert.ok(
      !/\bgrant\s+(execute|select|insert|update|delete|all)\b[^;]*\bto\b[^;]*\b(anon|authenticated)\b/i.test(
        text,
      ),
      `${label} ne doit accorder aucun privilège à anon/authenticated`,
    );
  }
});

test("RLS deny-all sur les quatre tables", () => {
  for (const t of [
    "production_migration_lock",
    "production_migration_lock_history",
    "migration_baseline",
    "migration_baseline_meta",
  ]) {
    const src = t.startsWith("migration_baseline") ? BASELINE : LOCK;
    assert.ok(
      new RegExp(`alter table hermes_os\\.${t}\\s+enable row level security`).test(src),
      `${t} doit avoir RLS activée`,
    );
    assert.ok(!new RegExp(`create policy[^;]*on hermes_os\\.${t}`, "i").test(src),
      `${t} ne doit avoir aucune policy`);
  }
});

test("la ligne de base ne se reprend pas toute seule", () => {
  assert.match(BASELINE, /if exists \(select 1 from hermes_os\.migration_baseline_meta\)/);
  assert.match(BASELINE, /check \(baseline_id = 'BASELINE'\)/);
});

test("le rollback annule exactement ce que les trois lots créent", () => {
  const created = [
    ...LOCK.matchAll(/create table if not exists hermes_os\.(\w+)/g),
    ...BASELINE.matchAll(/create table if not exists hermes_os\.(\w+)/g),
  ].map((m) => m[1]);
  const fns = [
    ...FUNCS.matchAll(/create or replace function hermes_os\.(\w+)/g),
    ...BASELINE.matchAll(/create or replace function hermes_os\.(\w+)/g),
  ].map((m) => m[1]);

  assert.equal(created.length, 4);
  assert.equal(fns.length, 5);
  for (const t of created) {
    assert.ok(
      ROLLBACK.includes(`drop table if exists hermes_os.${t};`),
      `le rollback doit supprimer ${t}`,
    );
  }
  for (const f of fns) {
    assert.ok(ROLLBACK.includes(`drop function if exists hermes_os.${f}`), `le rollback doit supprimer ${f}`);
  }
});

test("le rollback ne touche à rien d'autre que la gouvernance", () => {
  const dropped = [...ROLLBACK.matchAll(/drop (?:table|function) if exists hermes_os\.(\w+)/g)].map(
    (m) => m[1],
  );
  const allowed = new Set([
    "production_migration_lock",
    "production_migration_lock_history",
    "migration_baseline",
    "migration_baseline_meta",
    "acquire_production_migration_lock",
    "release_production_migration_lock",
    "production_migration_lock_status",
    "migrations_since_baseline",
    "migration_baseline_summary",
  ]);
  for (const d of dropped) assert.ok(allowed.has(d), `le rollback ne doit pas supprimer ${d}`);
});

test("les fichiers de gouvernance respectent la règle de nommage qu'ils imposent", () => {
  // Un garde-fou qui ne s'applique pas à lui-même n'est pas un garde-fou.
  const own = readdirSync(MIG).filter((f) => f.includes("hermes_migration_governance"));
  assert.equal(own.length, 4);
  for (const f of own) {
    const name = declaredMigrationName(f);
    if (f.includes("_9_rollback")) assert.equal(name, null);
    else assert.ok(name !== null && name.startsWith("hermes_migration_governance_"), f);
  }
});
