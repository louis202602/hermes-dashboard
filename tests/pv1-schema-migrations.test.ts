import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * LOT PV-1 — garde-fous de CONTRAT sur les migrations du Pack Photovoltaïque.
 *
 * Ces tests lisent le SQL comme un contrat et vérifient mécaniquement, au niveau
 * du diff, les promesses du lot :
 *   * multi-tenant dès la première table, avec FK COMPOSITES (pas de lien inter-tenant) ;
 *   * RLS deny-all, aucun accès direct accordé ;
 *   * `timestamptz` partout, jamais de `timestamp` naïf ;
 *   * statuts sous CHECK, jamais du texte libre ;
 *   * l'IA ne peut pas s'auto-valider ;
 *   * aucune donnée métier critique uniquement en JSON ;
 *   * périmètre tenu : aucun devis/facture/SAV/Consuel, aucune activation n8n.
 *
 * Ils ne remplacent pas `db/tests/pv1_schema.test.sql`, qui exige une base.
 */

const DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const read = (n: string): string => readFileSync(`${DIR}${n}`, "utf8");
const code = (sql: string): string =>
  sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const SCHEMA = read("20260819_pv1_1_schema.sql");
const FUNCTIONS = read("20260819_pv1_2_functions.sql");
const ROLLBACK = read("20260819_pv1_9_rollback.sql");
const ALL_UP = code(SCHEMA) + "\n" + code(FUNCTIONS);

const TABLES = [
  "pv_prospects", "pv_sites", "pv_consumption_profiles", "pv_energy_bills",
  "pv_energy_bill_extractions", "pv_studies", "pv_study_assumptions", "pv_economics",
];

// --- multi-tenant -------------------------------------------------------------
test("TENANT: chaque table métier porte tenant_id NOT NULL + FK vers tenants", () => {
  const s = code(SCHEMA);
  for (const t of TABLES) {
    const start = s.indexOf(`create table if not exists hermes_os.${t} (`);
    assert.ok(start >= 0, `table ${t} absente`);
    const body = s.slice(start, s.indexOf("\n);", start));
    assert.match(body, /tenant_id\s+text not null references hermes_os\.tenants\(tenant_id\)/,
      `${t}: tenant_id doit être NOT NULL et référencer tenants`);
  }
});

test("TENANT: les liens parent/enfant sont COMPOSITES (aucun lien inter-tenant possible)", () => {
  const s = code(SCHEMA);
  // 7 FK composites attendues : sites, consumption, bills, extractions, studies,
  // assumptions, economics.
  const composites = [...s.matchAll(/foreign key \(tenant_id, \w+\)\s*\n?\s*references hermes_os\.pv_\w+ \(tenant_id, id\)/g)];
  assert.ok(composites.length >= 7, `attendu ≥7 FK composites, trouvé ${composites.length}`);
  // Et AUCUNE FK simple vers une table pv_ (qui rouvrirait le trou).
  assert.doesNotMatch(s, /references hermes_os\.pv_\w+\(id\)/,
    "une FK vers une table pv_ sur `id` seul autoriserait un lien inter-tenant");
});

test("TENANT: chaque parent expose la clé candidate composite", () => {
  const s = code(SCHEMA);
  for (const t of ["pv_prospects", "pv_sites", "pv_energy_bills", "pv_studies"]) {
    assert.ok(s.includes(`constraint ${t}_tenant_id_key unique (tenant_id, id)`),
      `${t}: clé candidate (tenant_id, id) manquante`);
  }
});

test("TENANT: tenant_id est rendu immuable par déclencheur", () => {
  assert.match(code(FUNCTIONS), /create or replace function hermes_os\.pv_tenant_immutable\(\)/);
  for (const t of TABLES) {
    assert.ok(code(FUNCTIONS).includes("trg_%1$s_tenant_immutable") || code(FUNCTIONS).includes(t),
      `${t}: déclencheur d'immuabilité non câblé`);
  }
});

// --- RLS ----------------------------------------------------------------------
test("RLS: les 9 tables activent la RLS et AUCUNE policy n'est créée", () => {
  const s = code(SCHEMA);
  const enabled = [...s.matchAll(/alter table hermes_os\.(pv_\w+)\s+enable row level security/g)].map((m) => m[1]);
  assert.equal(new Set(enabled).size, 9, `attendu 9 tables en RLS, trouvé ${new Set(enabled).size}`);
  assert.doesNotMatch(s, /create policy/i, "aucune policy ne doit être créée (deny-all)");
});

test("RLS: aucun accès direct n'est accordé à anon/authenticated", () => {
  const s = ALL_UP;
  assert.match(s, /revoke all on hermes_os\.pv_prospects/);
  assert.doesNotMatch(s, /grant\s+(select|insert|update|delete|all)[\s\S]{0,120}\bto\s+(anon|authenticated)\b/i,
    "aucun GRANT direct ne doit être accordé sur une table PV");
});

// --- typage et statuts ---------------------------------------------------------
test("TEMPS: timestamptz partout, aucun timestamp naïf", () => {
  const s = code(SCHEMA);
  assert.doesNotMatch(s, /\btimestamp\b(?!tz)(?!\s+with)/, "un timestamp naïf s'est glissé dans le schéma");
  assert.ok((s.match(/timestamptz/g) ?? []).length >= 14, "trop peu de colonnes temporelles typées");
});

test("STATUTS: chaque statut métier est sous contrainte CHECK", () => {
  const s = code(SCHEMA);
  for (const [table, col] of [
    ["pv_prospects", "status"], ["pv_energy_bills", "status"], ["pv_studies", "status"],
    ["pv_economics", "status"], ["pv_consumption_profiles", "verification_status"],
  ] as const) {
    const start = s.indexOf(`create table if not exists hermes_os.${table} (`);
    const body = s.slice(start, s.indexOf("\n);", start));
    const re = new RegExp(`${col}\\s+text not null default '[A-Z_]+'[\\s\\S]{0,200}?check \\(${col} in \\(`);
    assert.match(body, re, `${table}.${col} doit être contraint par un CHECK`);
  }
});

test("ORIENTATION: azimut et inclinaison sont NUMÉRIQUES, pas du texte libre", () => {
  const s = code(SCHEMA);
  assert.match(s, /azimuth_deg\s+numeric\(5,2\)/, "l'azimut doit être numérique (exploitable par un moteur de calcul)");
  assert.match(s, /tilt_deg\s+numeric\(4,2\)/, "l'inclinaison doit être numérique");
});

// --- l'IA ne s'auto-valide pas --------------------------------------------------
test("VALIDATION: un état validé exige acteur + horodatage (CHECK)", () => {
  const s = code(SCHEMA);
  for (const c of [
    "pv_bills_verifie_par_humain", "pv_studies_validee_par_humain",
    "pv_economics_verifie_par_humain", "pv_consumption_verifie_par_humain",
  ]) {
    assert.ok(s.includes(c), `contrainte ${c} manquante`);
  }
});

test("VALIDATION: le déclencheur refuse un validateur non authentifié", () => {
  const f = code(FUNCTIONS);
  assert.match(f, /if v_uid is null then/);
  assert.match(f, /PV_VALIDATION_NON_HUMAINE/);
  assert.match(f, /PV_VALIDATION_USURPEE/);
  assert.match(f, /v_actor <> v_uid/, "le validateur doit être l'appelant authentifié lui-même");
});

test("VALIDATION: l'acteur de validation référence un compte réel", () => {
  const s = code(SCHEMA);
  for (const col of ["verified_by", "validated_by", "promoted_by"]) {
    assert.match(
      s,
      new RegExp(`${col}\\s+uuid references auth\\.users\\(id\\)`),
      `${col} doit référencer auth.users(id) — un validateur est un compte réel`,
    );
  }
  assert.ok((s.match(/references auth\.users\(id\)/g) ?? []).length >= 6,
    "les acteurs de validation doivent référencer auth.users");
});

test("PROMOTION: promouvoir une extraction ne certifie JAMAIS la facture", () => {
  const f = code(FUNCTIONS);
  const fn = f.slice(f.indexOf("function hermes_os.pv_promote_bill_extraction"));
  assert.match(fn, /status\s+=\s+'NEEDS_REVIEW'/, "la promotion doit aboutir à NEEDS_REVIEW");
  assert.doesNotMatch(fn, /status\s*=\s*'VERIFIED'/, "la promotion ne doit jamais poser VERIFIED");
  assert.match(fn, /if v_uid is null then/, "la promotion exige un utilisateur authentifié");
});

// --- hypothèses en colonnes ------------------------------------------------------
test("HYPOTHÈSES: les hypothèses structurantes sont des COLONNES, pas un blob", () => {
  const s = code(SCHEMA);
  const start = s.indexOf("create table if not exists hermes_os.pv_study_assumptions (");
  const body = s.slice(start, s.indexOf("\n);", start));
  for (const col of [
    "energy_price_eur_kwh", "energy_price_inflation_pct", "analysis_horizon_years",
    "discount_rate_pct", "panel_degradation_pct_year", "system_losses_pct",
    "surplus_sale_price_eur_kwh", "subsidy_total_eur",
  ]) {
    assert.ok(body.includes(col), `hypothèse ${col} absente des colonnes typées`);
  }
  assert.ok(body.includes("extra_assumptions"), "le JSON complémentaire doit exister…");
  assert.ok(body.indexOf("extra_assumptions") > body.indexOf("subsidy_total_eur"),
    "…mais après les colonnes typées, comme complément");
});

// --- documents -------------------------------------------------------------------
test("DOCUMENTS: aucun stockage d'URL publique", () => {
  const s = code(SCHEMA);
  assert.match(s, /document_bucket/, "le document doit être (bucket, chemin)");
  assert.match(s, /document_path !~\* '\^https\?:\/\/'/, "une URL http(s) doit être refusée par CHECK");
  assert.doesNotMatch(s, /\w*url\w*\s+text/i, "aucune colonne d'URL ne doit exister");
});

// --- périmètre ---------------------------------------------------------------------
test("PÉRIMÈTRE: aucune table hors du lot PV-1", () => {
  const created = [...code(SCHEMA).matchAll(/create table if not exists hermes_os\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    created.sort(),
    [...TABLES, "pv_prospect_transitions"].sort(),
    "le lot ne doit créer QUE les tables PV-1",
  );
});

test("PÉRIMÈTRE: rien de ce qui appartient aux lots suivants", () => {
  const s = ALL_UP.toLowerCase();
  for (const forbidden of [
    "pv_quotes", "pv_devis", "pv_invoices", "pv_factures", "pv_payments", "pv_paiements",
    "pv_consuel", "pv_raccordement", "pv_orders", "pv_commandes", "pv_planning",
    "pv_reception", "pv_sav", "pv_reviews",
  ]) {
    assert.ok(!s.includes(forbidden), `hors périmètre PV-1 : ${forbidden}`);
  }
});

test("PÉRIMÈTRE: aucune verticale existante n'est touchée", () => {
  const s = ALL_UP;
  for (const other of [/hermes_os\.photo_/, /hermes_os\.immo_/, /hermes_os\.peinture_/, /hermes_os\.btp_/]) {
    assert.doesNotMatch(s, other, `le lot ne doit toucher aucune autre verticale : ${other}`);
  }
});

test("PÉRIMÈTRE: aucune activation n8n, aucune capacité ajoutée", () => {
  const s = ALL_UP;
  assert.doesNotMatch(s, /insert into hermes_os\.agent_action_catalog/i, "aucune capacité ne doit être créée");
  assert.doesNotMatch(s, /resolver_runtime_config/i, "aucun runner ne doit être touché");
  assert.doesNotMatch(s, /enabled\s*=\s*true/i, "rien ne doit être activé");
});

test("AUDIT: la brique existante est réutilisée, aucun second système", () => {
  const f = code(FUNCTIONS);
  assert.match(f, /insert into hermes_os\.entity_audit_log/, "l'audit doit réutiliser entity_audit_log");
  assert.doesNotMatch(code(SCHEMA), /create table if not exists hermes_os\.pv_\w*audit/i,
    "aucune table d'audit PV ne doit être créée");
});

// --- rollback -----------------------------------------------------------------------
test("ROLLBACK: les 9 tables, les 5 fonctions et les déclencheurs sont retirés", () => {
  const s = code(ROLLBACK);
  for (const t of [...TABLES, "pv_prospect_transitions"]) {
    assert.ok(s.includes(`drop table if exists hermes_os.${t};`), `rollback: ${t} non supprimée`);
  }
  for (const f of [
    "pv_promote_bill_extraction", "pv_human_validation_guard",
    "pv_prospect_status_guard", "pv_tenant_immutable", "_pv_audit",
  ]) {
    assert.ok(s.includes(`drop function if exists hermes_os.${f}`), `rollback: fonction ${f} non supprimée`);
  }
  // Les déclencheurs doivent tomber AVANT les fonctions dont ils dépendent.
  assert.ok(
    s.indexOf("trg_%1$s_tenant_immutable") < s.indexOf("drop function if exists hermes_os.pv_tenant_immutable"),
    "les déclencheurs doivent être supprimés avant leurs fonctions",
  );
});

test("ROLLBACK: ne touche à aucune autre verticale ni au socle", () => {
  const s = code(ROLLBACK);
  for (const other of [/photo_/, /immo_/, /peinture_/, /btp_/, /gateway_policy_gate/, /sw15_/]) {
    assert.doesNotMatch(s, other, `le rollback PV ne doit pas toucher : ${other}`);
  }
});

test("DISCIPLINE: le lot est exactement 3 fichiers", () => {
  const files = readdirSync(DIR).filter((f) => f.startsWith("20260819_pv1_"));
  assert.deepEqual(files.sort(), [
    "20260819_pv1_1_schema.sql",
    "20260819_pv1_2_functions.sql",
    "20260819_pv1_9_rollback.sql",
  ]);
});
