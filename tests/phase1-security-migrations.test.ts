import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * PHASE 1 — garde-fous sur les migrations de sécurisation du socle.
 *
 * Ces tests lisent le SQL comme un CONTRAT et vérifient mécaniquement, au niveau du
 * diff, les promesses de la phase :
 *   * la passerelle SW15 est FAIL-CLOSED sur les actions sensibles (BLOCKER B2) ;
 *   * `agent_action_catalog.is_sensitive` intervient réellement dans la décision ;
 *   * aucune capacité n'est rendue autonome (aucun PERMIT n'est activé) ;
 *   * rien n'est détruit, et le rollback annule EXACTEMENT les quatre lots ;
 *   * le périmètre est tenu : aucune table `pv_*`, aucune sortie de dormance photo.
 *
 * Ils ne remplacent pas les assertions SQL (`db/tests/phase1_gateway_fail_closed.test.sql`),
 * qui exigent une base : ils empêchent une régression du contrat dans le dépôt.
 */

const DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const read = (name: string): string => readFileSync(`${DIR}${name}`, "utf8");

/** Retire les commentaires SQL : les assertions « ne doit pas contenir » portent sur
 *  le CODE exécuté, pas sur la prose qui explique justement l'interdit. */
const code = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const GATE = read("20260819_phase1_security_1_gateway_fail_closed.sql");
const POLICIES = read("20260819_phase1_security_2_btp_policies.sql");
const RLS = read("20260819_phase1_security_3_context_settings_rls.sql");
const SEARCHPATH = read("20260819_phase1_security_4_photo_rank_search_path.sql");
const ROLLBACK = read("20260819_phase1_security_9_rollback.sql");
const UP_FILES = [GATE, POLICIES, RLS, SEARCHPATH];
const ALL_UP = UP_FILES.join("\n");

// --- B2 : la passerelle est FAIL-CLOSED --------------------------------------
test("B2: la gate lit is_sensitive depuis le catalogue canonique", () => {
  const body = code(GATE);
  assert.match(body, /select\s+c\.is_sensitive\s+into\s+v_sensitive/i);
  assert.match(body, /from\s+hermes_os\.agent_action_catalog\s+c/i);
});

test("B2: action inconnue du catalogue => traitée comme SENSIBLE (fail-closed)", () => {
  assert.match(code(GATE), /v_sensitive\s*:=\s*coalesce\(v_sensitive,\s*true\)/i);
});

test("B2: aucune politique + action sensible => REQUIRE_APPROVAL, jamais PERMIT", () => {
  const body = code(GATE);
  // La branche « pas de politique » doit tester la sensibilité AVANT tout défaut.
  const fallback = body.slice(body.indexOf("if v_effect is null then"));
  assert.ok(fallback.length > 0, "la branche de défaut doit exister");
  const sensitiveBranch = fallback.slice(0, fallback.indexOf("else"));
  assert.match(sensitiveBranch, /if\s+v_sensitive\s+then/i);
  assert.match(sensitiveBranch, /v_effect\s*:=\s*'REQUIRE_APPROVAL'/i);
  assert.doesNotMatch(
    sensitiveBranch,
    /v_effect\s*:=\s*'PERMIT'/i,
    "une action sensible sans politique ne doit JAMAIS retomber sur PERMIT",
  );
});

test("B2: le défaut fail-open historique a bien disparu de la migration forward", () => {
  // L'ancienne ligne exacte : `if v_effect is null then v_effect := 'PERMIT'; end if;`
  assert.doesNotMatch(
    code(GATE),
    /if\s+v_effect\s+is\s+null\s+then\s+v_effect\s*:=\s*'PERMIT'\s*;\s*end\s+if\s*;/i,
  );
});

test("B2: un PERMIT explicite sur action sensible reste possible mais tracé", () => {
  const body = code(GATE);
  assert.match(body, /elsif\s+v_effect\s*=\s*'PERMIT'\s+and\s+v_sensitive\s+then/i);
  assert.match(body, /PERMIT EXPLICITE/);
});

test("NON-RÉGRESSION: la gate conserve son contrat de retour et ses branches", () => {
  const body = code(GATE);
  for (const token of ["'NOT_FOUND'", "'DENY'", "'REQUIRE_APPROVAL'", "'PERMIT'"]) {
    assert.ok(body.includes(token), `valeur de retour ${token} manquante`);
  }
  // Court-circuit d'approbation humaine préservé.
  assert.match(body, /if\s+v_req\.approved_by\s+is\s+not\s+null\s+then/i);
  assert.match(body, /'Human-approved'/);
  // Création de la demande SW15 préservée.
  assert.match(body, /insert\s+into\s+hermes_os\.sw15_approval_requests/i);
  // search_path toujours verrouillé, SECURITY DEFINER conservé.
  assert.match(body, /security\s+definer/i);
  assert.match(body, /set\s+search_path\s+to\s+'hermes_os',\s*'pg_catalog',\s*'pg_temp'/i);
});

// --- Lot 2 : politiques BTP ---------------------------------------------------
test("POLITIQUES: les 3 capacités BTP sensibles reçoivent REQUIRE_APPROVAL", () => {
  const body = code(POLICIES);
  for (const key of [
    "btp.qualification.create",
    "btp.planning.phase.add",
    "btp.suivi.progress.report",
  ]) {
    assert.ok(body.includes(`'${key}'`), `capacité ${key} absente`);
  }
  assert.match(body, /'REQUIRE_APPROVAL'/);
});

test("POLITIQUES: AUCUNE action n'est rendue autonome (aucun effet PERMIT inséré)", () => {
  assert.doesNotMatch(
    code(POLICIES),
    /'PERMIT'/,
    "le lot 2 ne doit jamais créer d'effet PERMIT",
  );
});

test("POLITIQUES: les 13 politiques préexistantes ne sont pas réactivées", () => {
  const body = code(POLICIES);
  // Tout UPDATE/DELETE doit être borné par le marqueur updated_by du lot.
  for (const stmt of body.split(";")) {
    if (/^\s*(update|delete)\s/i.test(stmt)) {
      assert.match(
        stmt,
        /updated_by\s*=\s*'phase1_security_2'/i,
        `écriture non bornée au lot: ${stmt.trim().slice(0, 80)}`,
      );
    }
  }
  assert.doesNotMatch(body, /\bphoto\./, "le lot 2 ne doit pas toucher aux politiques photo");
});

// --- Lot 3 : RLS ---------------------------------------------------------------
test("RLS: dashboard_context_settings passe en row level security", () => {
  const body = code(RLS);
  assert.match(
    body,
    /alter\s+table\s+hermes_os\.dashboard_context_settings\s+enable\s+row\s+level\s+security/i,
  );
  // Deny-all assumé : aucune politique n'est créée.
  assert.doesNotMatch(body, /create\s+policy/i);
  // Aucun accès direct n'est ouvert.
  assert.doesNotMatch(body, /\bgrant\b/i);
  assert.match(body, /revoke\s+all\s+on\s+table\s+hermes_os\.dashboard_context_settings\s+from\s+anon/i);
  assert.match(
    body,
    /revoke\s+all\s+on\s+table\s+hermes_os\.dashboard_context_settings\s+from\s+authenticated/i,
  );
});

// --- Lot 4 : search_path -------------------------------------------------------
test("SEARCH_PATH: photo_session_status_rank est épinglée", () => {
  assert.match(
    code(SEARCHPATH),
    /alter\s+function\s+hermes_os\.photo_session_status_rank\(text\)\s+set\s+search_path\s*=/i,
  );
});

// --- Sûreté globale ------------------------------------------------------------
test("SÛRETÉ: aucune destruction de données ni de structure", () => {
  const body = code(ALL_UP);
  for (const forbidden of [
    /\bdrop\s+table\b/i,
    /\bdrop\s+schema\b/i,
    /\btruncate\b/i,
    /\bdrop\s+column\b/i,
    /\bdelete\s+from\s+hermes_os\.agent_action_requests\b/i,
    /\bdelete\s+from\s+hermes_os\.agent_action_catalog\b/i,
    /\bdrop\s+function\b/i,
  ]) {
    assert.doesNotMatch(body, forbidden, `instruction destructive interdite: ${forbidden}`);
  }
});

test("PÉRIMÈTRE: aucune table pv_*, aucun réveil du pack photo", () => {
  const body = code(ALL_UP);
  assert.doesNotMatch(body, /create\s+table[\s\S]{0,80}\bpv_/i, "hors périmètre: tables pv_*");
  assert.doesNotMatch(
    body,
    /update\s+hermes_os\.agent_action_catalog\s+set[\s\S]{0,120}enabled\s*=\s*true/i,
    "hors périmètre: activation d'une capacité",
  );
  assert.doesNotMatch(
    body,
    /update\s+hermes_os\.resolver_runtime_config[\s\S]{0,120}enabled\s*=\s*true/i,
    "hors périmètre: réveil d'un runner",
  );
});

test("PÉRIMÈTRE: aucune capacité photo n'est activée par le lot 2", () => {
  assert.doesNotMatch(code(POLICIES), /status\s*=\s*'ACTIVE'[\s\S]{0,200}photo\./i);
});

// --- Rollback ------------------------------------------------------------------
test("ROLLBACK: les quatre lots sont annulés", () => {
  const body = code(ROLLBACK);
  assert.match(body, /alter\s+function\s+hermes_os\.photo_session_status_rank\(text\)\s+reset\s+search_path/i);
  assert.match(
    body,
    /alter\s+table\s+hermes_os\.dashboard_context_settings\s+disable\s+row\s+level\s+security/i,
  );
  assert.match(body, /delete\s+from\s+hermes_os\.sw15_policies/i);
  assert.match(body, /create\s+or\s+replace\s+function\s+hermes_os\.gateway_policy_gate/i);
});

test("ROLLBACK: la suppression de politiques est bornée au marqueur du lot 2", () => {
  const body = code(ROLLBACK);
  const del = body.slice(body.indexOf("delete from hermes_os.sw15_policies"));
  const stmt = del.slice(0, del.indexOf(";"));
  assert.match(stmt, /updated_by\s*=\s*'phase1_security_2'/i);
  assert.match(stmt, /tenant_id\s*=\s*'heliosolar'/i);
});

test("ROLLBACK: restaure bien la version fail-open historique (et le dit)", () => {
  const body = code(ROLLBACK);
  assert.match(body, /if\s+v_effect\s+is\s+null\s+then\s+v_effect\s*:=\s*'PERMIT'\s*;\s*end\s+if\s*;/i);
  // L'avertissement doit rester visible en tête de fichier (commentaire, donc hors `code`).
  assert.match(ROLLBACK, /RÉ-OUVRE le BLOCKER B2/);
});

// --- Discipline de dépôt -------------------------------------------------------
test("DISCIPLINE: chaque lot forward a son fichier, et un unique rollback", () => {
  const files = readdirSync(DIR).filter((f) => f.startsWith("20260819_phase1_security_"));
  assert.deepEqual(
    files.sort(),
    [
      "20260819_phase1_security_1_gateway_fail_closed.sql",
      "20260819_phase1_security_2_btp_policies.sql",
      "20260819_phase1_security_3_context_settings_rls.sql",
      "20260819_phase1_security_4_photo_rank_search_path.sql",
      "20260819_phase1_security_9_rollback.sql",
    ],
    "jeu de migrations Phase 1 inattendu",
  );
});
