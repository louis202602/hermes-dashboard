import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * PHOTO-P0 — garde-fous sur les migrations elles-mêmes.
 *
 * Ces tests lisent le SQL comme un contrat et vérifient, de façon mécanique, les
 * promesses faites au commanditaire :
 *   * GO_LIVE = NO — rien n'est activé par les seeds ;
 *   * isolation stricte : RLS deny-all, aucun `tenant_id` venant du client ;
 *   * aucune suppression automatique de photo ;
 *   * aucun bucket public ;
 *   * le rollback annule EXACTEMENT ce que les lots créent.
 *
 * Ils ne remplacent pas les assertions SQL d'isolation (`db/tests/`), qui
 * demandent une base ; ils empêchent une régression du contrat au niveau du diff.
 */

const DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const read = (name: string): string => readFileSync(`${DIR}${name}`, "utf8");

/** Retire les commentaires SQL : les assertions « ne doit pas contenir » portent
 *  sur le CODE exécuté, pas sur la prose qui explique justement l'interdit. */
const code = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const SCHEMA = read("20260818_photo_studio_1_schema.sql");
const SERVICES = read("20260818_photo_studio_2_services.sql");
const FACADES = read("20260818_photo_studio_3_facades.sql");
const STORAGE = read("20260818_photo_studio_4_storage_proxies.sql");
const SEEDS = read("20260818_photo_studio_5_dormant_registry.sql");
const ROLLBACK = read("20260818_photo_studio_9_rollback.sql");
const UP_FILES = [SCHEMA, SERVICES, FACADES, STORAGE, SEEDS];
const ALL_UP = UP_FILES.join("\n");

// --- GO_LIVE = NO ------------------------------------------------------------
test("DORMANCE: toutes les capacités photo sont insérées désactivées", () => {
  const rows = [...SEEDS.matchAll(/\('photo\.[a-z.]+',[\s\S]*?\n\s+(true|false), (true|false), (true|false),/g)];
  assert.ok(rows.length >= 10, `attendu ≥10 actions, trouvé ${rows.length}`);
  for (const row of rows) {
    // Colonnes : enabled, is_sensitive, nl_enabled.
    assert.equal(row[1], "false", "enabled DOIT être false pour chaque action photo");
    assert.equal(row[3], "false", "nl_enabled DOIT être false (aucune route NL dormante)");
  }
});

test("DORMANCE: aucun runner n'est câblé (target_workflow_id reste NULL)", () => {
  const catalogBlock = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.agent_action_catalog"),
    SEEDS.indexOf("on conflict (action_key) do nothing"),
  );
  assert.ok(catalogBlock.length > 0);
  assert.ok(
    !/'[A-Za-z0-9]{12,}'/.test(catalogBlock.replace(/'photo\.[a-z.]+'/g, "")),
    "aucun identifiant de workflow n8n ne doit être posé",
  );
  assert.ok(catalogBlock.includes("'N8N_WORKFLOW', null,"), "target_workflow_id doit rester NULL");
});

test("DORMANCE: la sûreté d'exécution est seedée à enabled=false, circuit CLOSED", () => {
  const block = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.resolver_runtime_config"),
    SEEDS.indexOf("-- 3. Doctrine d'approbation"),
  );
  const rows = [...block.matchAll(/\('photo\.[a-z.]+',\s+(true|false),/g)];
  assert.ok(rows.length >= 5, `attendu ≥5 configs, trouvé ${rows.length}`);
  for (const row of rows) assert.equal(row[1], "false");
  assert.ok(!block.includes("'OPEN'"));
  assert.equal((block.match(/'CLOSED'/g) ?? []).length, rows.length);
});

test("DORMANCE: politiques SW15 et abonnés SW20 sont insérés DISABLED", () => {
  const policies = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.sw15_policies"),
    SEEDS.indexOf("-- 4. Bus d'événements"),
  );
  assert.ok(policies.includes("'DISABLED'"));
  assert.ok(!policies.includes("'ACTIVE'"), "aucune politique photo ne doit être ACTIVE");

  const subscribers = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.sw20_subscribers"),
    SEEDS.indexOf("-- 5. Métriques SW19"),
  );
  assert.ok(subscribers.includes("'DISABLED'"));
  assert.ok(!subscribers.includes("'ACTIVE'"));
});

test("DORMANCE: la verticale est désactivée par défaut pour tout tenant", () => {
  assert.ok(
    SCHEMA.includes("enabled      boolean not null default false"),
    "photo_studio_activation doit être false par défaut",
  );
  assert.ok(
    !ALL_UP.includes("insert into hermes_os.photo_studio_activation"),
    "aucune migration ne doit activer un tenant",
  );
});

test("DORMANCE: aucun composant n'est déclaré au registre (pas d'inflation des KPI)", () => {
  assert.ok(
    !ALL_UP.includes("insert into hermes_os.component_registry"),
    "component_registry ne doit pas être alimenté en Phase 1",
  );
});

test("NON-RÉGRESSION: un budget SW23 existant n'est jamais écrasé", () => {
  const block = SEEDS.slice(SEEDS.indexOf("sw23_tenant_budget_config"));
  assert.ok(block.includes("on conflict (tenant_id) do nothing"));
  assert.ok(block.includes("where t.tenant_id = 'photo-pilote'"), "insertion conditionnelle");
  assert.ok(!block.includes("do update"), "aucun écrasement de budget opérateur");
});

// --- ISOLATION / SÉCURITÉ ----------------------------------------------------
test("RLS: chaque table photo active RLS et n'a AUCUNE policy (deny-all)", () => {
  const tables = [...SCHEMA.matchAll(/create table if not exists hermes_os\.(photo_\w+)/g)].map(
    (m) => m[1],
  );
  assert.ok(tables.length >= 13, `attendu ≥13 tables, trouvé ${tables.length}`);
  for (const table of tables) {
    assert.ok(
      SCHEMA.includes(`alter table hermes_os.${table} enable row level security;`),
      `RLS non activée sur ${table}`,
    );
  }
  assert.ok(
    !/create policy[\s\S]*?on hermes_os\.photo_/.test(SCHEMA),
    "aucune policy ne doit ouvrir une table photo — accès par façade uniquement",
  );
});

test("TENANT: aucune façade publique n'accepte de tenant_id du client", () => {
  const signatures = [...FACADES.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\nreturns/g)];
  assert.ok(signatures.length >= 12, `attendu ≥12 façades, trouvé ${signatures.length}`);
  for (const [, name, args] of signatures) {
    assert.ok(
      !/p_tenant/i.test(args),
      `${name} ne doit pas accepter de tenant en paramètre (résolution server-side)`,
    );
  }
  // Le tenant vient TOUJOURS de la garde partagée.
  assert.ok(FACADES.includes("hermes_os.resolve_active_tenant(null)"));
});

test("FAÇADES: SECURITY DEFINER, search_path verrouillé, REVOKE PUBLIC / GRANT authenticated", () => {
  const names = [...FACADES.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  for (const name of new Set(names)) {
    assert.ok(
      new RegExp(`revoke all on function public\\.${name}\\(`).test(FACADES),
      `${name}: REVOKE ALL … FROM public manquant`,
    );
    assert.ok(
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`).test(FACADES),
      `${name}: GRANT à authenticated manquant`,
    );
  }
  const definers = (FACADES.match(/security definer/g) ?? []).length;
  const paths = (FACADES.match(/set search_path to /g) ?? []).length;
  assert.equal(definers, paths, "chaque SECURITY DEFINER doit verrouiller son search_path");
  assert.ok(!/grant .* to anon/i.test(code(FACADES) + code(STORAGE)), "jamais de grant à anon");
  assert.ok(
    !/grant .* to service_role/i.test(code(FACADES)),
    "aucune façade publique en service_role",
  );
});

test("STOCKAGE: bucket privé, aucun accès public, aucune suppression depuis le navigateur", () => {
  assert.ok(STORAGE.includes("'hermes-photo-proxies',\n  false,"), "le bucket doit être privé");
  assert.ok(!code(STORAGE).includes("getPublicUrl"));
  assert.ok(
    !/create policy[^;]*for delete/i.test(code(STORAGE)),
    "aucune policy DELETE : un client ne peut pas détruire un proxy",
  );
  assert.ok(
    STORAGE.includes("is_active_tenant_member((storage.foldername(name))[1])"),
    "le tenant doit être re-dérivé de la clé d'objet",
  );
  assert.ok(
    !code(STORAGE).includes("create or replace function hermes_os.is_active_tenant_member"),
    "la fonction existante doit être RÉUTILISÉE, pas redéfinie",
  );
});

test("PHOTOS: aucune migration ne supprime jamais un asset ou un verdict", () => {
  for (const [index, sql] of UP_FILES.entries()) {
    const deletes = [...sql.matchAll(/delete from hermes_os\.(\w+)/g)].map((m) => m[1]);
    for (const table of deletes) {
      assert.ok(
        !table.startsWith("photo_session_assets") && !table.startsWith("photo_culling"),
        `lot ${index + 1} : DELETE interdit sur ${table}`,
      );
    }
  }
  // La purge « oublie » le dérivé sans supprimer la ligne d'inventaire.
  assert.ok(STORAGE.includes("set proxy_status = 'PURGED', proxy_path = null"));
  assert.ok(!/delete from hermes_os\.photo_session_assets/.test(STORAGE));
});

test("TRI: une photo protégée ne peut jamais être suggérée au rejet", () => {
  const derive = SERVICES.slice(SERVICES.indexOf("derive_photo_culling_verdicts"));
  const decided = derive.slice(derive.indexOf("decided as ("), derive.indexOf("ins as ("));
  // La branche « protégée » est évaluée en PREMIER et donne KEEP_SUGGESTION.
  const protectedIndex = decided.indexOf("select asset_id from protect) then 'KEEP_SUGGESTION'");
  const rejectIndex = decided.indexOf("'REJECTED_SUGGESTION'");
  assert.ok(protectedIndex > -1, "la branche de protection doit exister");
  assert.ok(protectedIndex < rejectIndex, "la protection doit primer sur tout rejet");
  // Une décision humaine déjà prise n'est jamais écrasée par une ré-exécution.
  assert.ok(derive.includes("human_decision is null"));
});

// --- RÉVERSIBILITÉ -----------------------------------------------------------
test("ROLLBACK: chaque table créée est supprimée", () => {
  const tables = [...SCHEMA.matchAll(/create table if not exists hermes_os\.(photo_\w+)/g)].map(
    (m) => m[1],
  );
  for (const table of tables) {
    assert.ok(
      ROLLBACK.includes(`drop table if exists hermes_os.${table};`),
      `rollback manquant pour la table ${table}`,
    );
  }
});

test("ROLLBACK: chaque fonction créée est supprimée avec sa signature", () => {
  const created = [
    ...ALL_UP.matchAll(/create or replace function (public|hermes_os)\.(\w+)\(/g),
  ].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(created.length >= 18, `attendu ≥18 fonctions, trouvé ${created.length}`);
  for (const fn of new Set(created)) {
    assert.ok(
      ROLLBACK.includes(`drop function if exists ${fn}(`),
      `rollback manquant pour la fonction ${fn}`,
    );
  }
});

test("ROLLBACK: policies de stockage, bucket et seeds sont annulés", () => {
  for (const policy of [
    "hermes_photo_proxy_insert_tenant",
    "hermes_photo_proxy_select_tenant",
    "hermes_photo_proxy_update_tenant",
  ]) {
    assert.ok(ROLLBACK.includes(`drop policy if exists "${policy}" on storage.objects;`));
  }
  assert.ok(ROLLBACK.includes("delete from storage.buckets where id = 'hermes-photo-proxies';"));
  assert.ok(ROLLBACK.includes("delete from hermes_os.resolver_runtime_config where action_key like 'photo.%'"));
  assert.ok(ROLLBACK.includes("delete from hermes_os.sw15_policies where action_pattern like 'photo.%'"));
  assert.ok(ROLLBACK.includes("agent_action_catalog"));
});

test("ROLLBACK: ne touche PAS aux briques partagées d'une autre ardoise", () => {
  const rollbackCode = code(ROLLBACK);
  assert.ok(
    !rollbackCode.includes("drop function if exists hermes_os.is_active_tenant_member"),
    "la fonction appartient à l'ardoise des pièces jointes du chat",
  );
  assert.ok(!rollbackCode.includes("hermes-chat-attachments"));
  assert.ok(!/drop .*(btp_|sw1[0-9]|sw2[0-9]|resolve_active_tenant)/.test(rollbackCode));
});

// --- IDEMPOTENCE (régressions constatées à l'exécution réelle) ----------------
test("IDEMPOTENCE: les policies de stockage sont retirées avant d'être recréées", () => {
  // `create policy` n'accepte pas `if not exists` : sans le drop préalable, une
  // seconde application du lot échoue. Constaté en exécutant réellement le SQL.
  for (const policy of [
    "hermes_photo_proxy_insert_tenant",
    "hermes_photo_proxy_select_tenant",
    "hermes_photo_proxy_update_tenant",
  ]) {
    const drop = STORAGE.indexOf(`drop policy if exists "${policy}" on storage.objects;`);
    const create = STORAGE.indexOf(`create policy "${policy}"`);
    assert.ok(drop > -1, `${policy}: drop préalable manquant`);
    assert.ok(drop < create, `${policy}: le drop doit précéder le create`);
  }
});

test("IDEMPOTENCE: les seeds sans contrainte d'unicité utilisent une anti-jointure", () => {
  // `sw15_policies` et `sw20_subscribers` n'ont AUCUNE contrainte d'unicité :
  // `on conflict do nothing` n'y empêche rien et les lignes se dupliquaient à
  // chaque ré-application. Constaté en exécutant réellement le SQL.
  const sw15 = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.sw15_policies"),
    SEEDS.indexOf("-- 4. Bus d'événements"),
  );
  assert.ok(sw15.includes("where not exists ("), "SW15 : anti-jointure manquante");
  assert.ok(!sw15.includes("on conflict do nothing"), "SW15 : on conflict inopérant ici");

  const sw20 = SEEDS.slice(
    SEEDS.indexOf("insert into hermes_os.sw20_subscribers"),
    SEEDS.indexOf("-- 5. Métriques SW19"),
  );
  assert.ok(sw20.includes("where not exists ("), "SW20 : anti-jointure manquante");
  assert.ok(!sw20.includes("on conflict do nothing"), "SW20 : on conflict inopérant ici");

  // Les tables qui ONT une clé/unicité gardent le `on conflict`, plus lisible.
  assert.ok(SEEDS.includes("on conflict (action_key) do nothing"));
  assert.ok(SEEDS.includes("on conflict (metric_key) do nothing"));
  assert.ok(SEEDS.includes("on conflict (tenant_id) do nothing"));
});

test("SQL: aucune fonction de fenêtre imbriquée dans la dérivation du tri", () => {
  // Postgres l'interdit ; la version initiale le faisait et échouait à l'exécution.
  const derive = SERVICES.slice(SERVICES.indexOf("derive_photo_culling_verdicts"));
  assert.ok(!/sum\([^)]*lag\([^)]*\) over/s.test(derive), "fenêtre imbriquée détectée");
  assert.ok(derive.includes("prev_captured_at"), "le lag doit être matérialisé dans un CTE");
});

// --- HYGIÈNE ------------------------------------------------------------------
test("chaque lot est transactionnel (begin/commit) et le rollback aussi", () => {
  for (const sql of [...UP_FILES, ROLLBACK]) {
    assert.ok(sql.includes("begin;"), "begin; manquant");
    assert.ok(sql.trimEnd().endsWith("commit;"), "commit; final manquant");
  }
});

test("les fichiers de migration photo suivent la convention de nommage du dépôt", () => {
  const files = readdirSync(DIR).filter((f) => f.includes("photo_studio"));
  assert.equal(files.length, 6, "5 lots + 1 rollback");
  assert.ok(files.every((f) => /^20260818_photo_studio_[1-59]/.test(f)));
  assert.ok(files.includes("20260818_photo_studio_9_rollback.sql"));
});
