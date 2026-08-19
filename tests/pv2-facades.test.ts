import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * LOT PV-2 — garde-fous de CONTRAT sur les migrations, le service et l'UI.
 *
 * Ces tests lisent le code comme un contrat et vérifient MÉCANIQUEMENT, au
 * niveau du diff, les promesses du lot. Ils ne remplacent pas
 * `db/tests/pv2_facades.test.sql`, qui exige une base et prouve le COMPORTEMENT ;
 * ils prouvent que le comportement ne peut pas être perdu par une réécriture
 * distraite (une façade qui deviendrait `SECURITY INVOKER`, un `GRANT anon`
 * glissé, un `tenant_id` ajouté à une signature).
 */

const url = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(url(p), "utf8");
/** Retire les commentaires : une promesse tenue dans un commentaire ne compte pas. */
const code = (sql: string): string =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const DOCS = read("../db/migrations/20260819_pv2_1_documents.sql");
const READS = read("../db/migrations/20260819_pv2_2_facades_read.sql");
const WRITES = read("../db/migrations/20260819_pv2_3_facades_write.sql");
const STORAGE = read("../db/migrations/20260819_pv2_4_storage.sql");
const REGISTRY = read("../db/migrations/20260819_pv2_5_dormant_registry.sql");
const ROLLBACK = read("../db/migrations/20260819_pv2_9_rollback.sql");
const ALL_MIGRATIONS = [DOCS, READS, WRITES, STORAGE, REGISTRY].map(code).join("\n");

const SERVICE = read("../services/hermes/pv.ts");
const ACTIONS = read("../app/actions/pv.ts");

/**
 * Retire les commentaires TypeScript. Une interdiction doit porter sur le CODE :
 * un commentaire qui explique « ce fichier n'envoie jamais de tenant_id » ne doit
 * évidemment pas faire échouer l'assertion qui vérifie cette même promesse.
 */
const ts = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
const SERVICE_CODE = ts(SERVICE);
const ACTIONS_CODE = ts(ACTIONS);

// --- Façades : le contrat Hermès, sans exception -----------------------------

test("PV-2 — 23 façades : 11 lectures, 9 écritures humaines, 3 documentaires", () => {
  const declared = (sql: string) =>
    [...code(sql).matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);

  const reads = declared(READS);
  const writes = declared(WRITES);
  const storage = declared(STORAGE);

  assert.equal(reads.length, 11, `lectures: ${reads.join(", ")}`);
  assert.equal(writes.length, 9, `écritures: ${writes.join(", ")}`);
  assert.equal(storage.length, 3, `stockage: ${storage.join(", ")}`);

  // Les dix lectures EXIGÉES par la mission, nommément.
  for (const fn of [
    "get_pv_prospects",
    "get_pv_prospect",
    "get_pv_sites",
    "get_pv_site",
    "get_pv_consumption_profiles",
    "get_pv_energy_bills",
    "get_pv_bill_extractions",
    "get_pv_studies",
    "get_pv_study_assumptions",
    "get_pv_economics",
  ]) {
    assert.ok(reads.includes(fn), `lecture manquante: ${fn}`);
  }
  // Les neuf écritures humaines EXIGÉES, nommément.
  for (const fn of [
    "upsert_pv_prospect",
    "upsert_pv_site",
    "upsert_pv_consumption_profile",
    "set_pv_prospect_status",
    "register_pv_energy_bill",
    "promote_pv_bill_extraction",
    "verify_pv_energy_bill",
    "validate_pv_study",
    "verify_pv_economics",
  ]) {
    assert.ok(writes.includes(fn), `écriture manquante: ${fn}`);
  }
});

test("PV-2 — chaque façade est SECURITY DEFINER avec search_path VERROUILLÉ", () => {
  for (const [name, sql] of [
    ["lectures", READS],
    ["écritures", WRITES],
    ["stockage", STORAGE],
  ] as const) {
    const body = code(sql);
    const created = [...body.matchAll(/create or replace function (public|hermes_os)\.\w+/g)].length;
    const definer = [...body.matchAll(/security definer/g)].length;
    const pinned = [...body.matchAll(/set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'/g)].length;
    assert.equal(definer, created, `${name}: ${created} fonctions, ${definer} SECURITY DEFINER`);
    assert.equal(pinned, created, `${name}: ${created} fonctions, ${pinned} search_path verrouillés`);
  }
});

test("PV-2 — GRANT à `authenticated` seulement, jamais à `anon` ni à `public`", () => {
  assert.equal(/grant\s+execute[^;]*to\s+anon/i.test(ALL_MIGRATIONS), false, "GRANT anon interdit");
  assert.equal(/grant\s+execute[^;]*to\s+public/i.test(ALL_MIGRATIONS), false, "GRANT public interdit");

  // Toute façade `public.*` exposée est précédée de son REVOKE et suivie de son GRANT.
  for (const sql of [READS, WRITES, STORAGE]) {
    const body = code(sql);
    const created = [...body.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    for (const fn of created) {
      assert.ok(
        new RegExp(`revoke all on function public\\.${fn}\\(`).test(body),
        `REVOKE manquant sur ${fn}`,
      );
      assert.ok(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`).test(body),
        `GRANT authenticated manquant sur ${fn}`,
      );
    }
  }
});

test("PV-2 — AUCUNE façade n'accepte de tenant_id : le navigateur n'a pas de chemin", () => {
  const signatures = [...ALL_MIGRATIONS.matchAll(/create or replace function (?:public|hermes_os)\.\w+\(([^)]*)\)/g)]
    .map((m) => m[1]);
  for (const sig of signatures) {
    assert.equal(/tenant/i.test(sig), false, `signature exposant un tenant: (${sig})`);
  }
  // Le tenant est résolu SERVER-SIDE, avec `null` en argument, à chaque appel.
  assert.match(code(READS), /resolve_active_tenant\(null\)/);
  assert.equal(/resolve_active_tenant\(\s*p_/.test(ALL_MIGRATIONS), false);
});

test("PV-2 — aucune façade n'expose de paramètre d'ACTEUR (pas de validation par procuration)", () => {
  const signatures = [...ALL_MIGRATIONS.matchAll(/create or replace function (?:public|hermes_os)\.\w+\(([^)]*)\)/g)]
    .map((m) => m[1]);
  for (const sig of signatures) {
    assert.equal(
      /(verified_by|validated_by|promoted_by|p_actor|p_user_id|p_uid)/i.test(sig),
      false,
      `signature exposant un acteur: (${sig})`,
    );
  }
  // L'acteur vient d'`auth.uid()`, via la garde, pour les trois validations.
  for (const fn of ["verify_pv_energy_bill", "validate_pv_study", "verify_pv_economics"]) {
    const body = code(WRITES).slice(code(WRITES).indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, 2200), /v_uid := \(v_g->>'uid'\)::uuid/, `${fn} doit dériver l'acteur du garde`);
  }
});

test("PV-2 — les écritures ne peuvent pas contourner les garde-fous PV-1", () => {
  const body = code(WRITES);
  // Aucune façade ne désactive un déclencheur, ne change de rôle, ne touche au tenant.
  assert.equal(/alter table[^;]*disable trigger/i.test(body), false);
  assert.equal(/set (local )?role/i.test(body), false);
  assert.equal(/security invoker/i.test(body), false);
  // Une AFFECTATION apparaît en début de ligne (`tenant_id = ...`) ; une
  // COMPARAISON est toujours qualifiée (`p.tenant_id = v_t`). On ne cherche donc
  // que la première forme — sinon la clause WHERE ferait un faux positif.
  assert.equal(/^\s*tenant_id\s*=/m.test(body), false, "aucune écriture ne réaffecte un tenant");
  assert.equal(/set\s+tenant_id\s*=/i.test(body), false, "aucun SET tenant_id");
  // La promotion réutilise la fonction PV-1 au lieu de la réimplémenter.
  assert.match(body, /hermes_os\.pv_promote_bill_extraction\(p_extraction_id\)/);
  assert.equal(/status\s*=\s*'VERIFIED'[^;]*promote/i.test(body), false);
});

// --- Table documentaire ------------------------------------------------------

test("PV-2 — pv_documents : FK COMPOSITES, RLS deny-all, aucun accès direct", () => {
  const body = code(DOCS);
  assert.match(body, /foreign key \(tenant_id, site_id\)\s*\n?\s*references hermes_os\.pv_sites \(tenant_id, id\)/);
  assert.match(body, /foreign key \(tenant_id, bill_id\)\s*\n?\s*references hermes_os\.pv_energy_bills \(tenant_id, id\)/);
  assert.match(body, /alter table hermes_os\.pv_documents enable row level security/);
  assert.match(body, /revoke all on table hermes_os\.pv_documents from anon, authenticated/);
  assert.equal(/create policy/i.test(body), false, "deny-all : aucune policy sur la table");
  assert.match(body, /unique \(tenant_id, id\)/);
});

test("PV-2 — pv_documents : aucune URL publique stockable, suppression LOGIQUE", () => {
  const body = code(DOCS);
  assert.match(body, /storage_path !~\* '\^https\?:\/\/'/);
  assert.match(body, /deleted_at\s+timestamptz/);
  assert.match(body, /deleted_by\s+uuid references auth\.users\(id\)/);
  assert.equal(/delete from hermes_os\.pv_documents/i.test(code(WRITES) + code(STORAGE)), false,
    "aucune suppression physique depuis une façade");
  // `timestamptz` partout, jamais de `timestamp` naïf.
  assert.equal(/\btimestamp\b(?! with)(?!tz)/.test(body), false);
});

test("PV-2 — tous les index de pv_documents sont préfixés par tenant_id", () => {
  const indexes = [...code(DOCS).matchAll(/create index[^(]*\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(indexes.length >= 3);
  for (const cols of indexes) {
    assert.match(cols.trim(), /^tenant_id/, `index non préfixé tenant_id: (${cols})`);
  }
});

// --- Stockage ----------------------------------------------------------------

test("PV-2 — bucket PRIVÉ, plafond et allowlist MIME explicites", () => {
  const body = code(STORAGE);
  assert.match(body, /'hermes-pv-documents',\s*\n?\s*false,/);
  assert.match(body, /set public = false/);
  assert.match(body, /26214400/);
  assert.match(body, /array\['application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp'\]/);
  // Trois policies, bornées AU BUCKET ET AU TENANT. Aucune policy DELETE.
  const policies = [...body.matchAll(/create policy "hermes_pv_documents_(\w+)_tenant"/g)].map((m) => m[1]);
  assert.deepEqual(policies.sort(), ["insert", "select", "update"]);
  assert.equal(/for delete/i.test(body), false, "aucune suppression d'objet depuis le navigateur");
  assert.equal(
    [...body.matchAll(/hermes_os\.is_active_tenant_member\(\(storage\.foldername\(name\)\)\[1\]\)/g)].length,
    4,
    "chaque policy dérive le tenant du 1er segment du chemin (update en compte 2)",
  );
});

test("PV-2 — le chemin de stockage est décidé par la base, revalidé à la finalisation", () => {
  const body = code(STORAGE);
  // `prepare_pv_document` fabrique l'identifiant ET le chemin.
  assert.match(body, /v_id uuid := gen_random_uuid\(\)/);
  assert.match(body, /v_t \|\| '\/' \|\| v_site::text \|\| '\/' \|\| v_id::text/);
  // Nom de fichier assaini : pas de traversée de répertoire.
  assert.match(body, /regexp_replace\(coalesce\(p_filename, ''\), '\[\^A-Za-z0-9\._-\]', '_', 'g'\)/);
  // `finalize` recontrôle le préfixe, le MIME et la taille.
  assert.match(body, /PATH_OUT_OF_SCOPE/);
  assert.match(body, /BAD_MIME/);
  assert.match(body, /BAD_SIZE/);
});

test("PV-2 — aucune URL publique n'est jamais construite ni persistée", () => {
  for (const [name, src] of [
    ["migrations", ALL_MIGRATIONS],
    ["service", SERVICE],
    ["actions", ACTIONS],
  ] as const) {
    assert.equal(/getPublicUrl/i.test(src), false, `${name} : getPublicUrl interdit`);
    assert.equal(/public_url|publicUrl/i.test(src), false, `${name} : URL publique interdite`);
  }
});

test("PV-2 — les URL signées sont produites à la demande, avec un TTL COURT (test 12)", () => {
  assert.match(SERVICE, /const SIGNED_URL_TTL_SECONDS = 300;/);
  assert.match(SERVICE, /createSignedUrls\(paths, SIGNED_URL_TTL_SECONDS\)/);
  // Le TTL doit rester borné : une valeur longue viderait la garantie.
  const ttl = Number(/SIGNED_URL_TTL_SECONDS = (\d+)/.exec(SERVICE)?.[1]);
  assert.ok(ttl > 0 && ttl <= 900, `TTL hors bornes: ${ttl}s`);
  // L'URL signée n'est jamais écrite en base : elle ne vit que dans la réponse.
  assert.equal(/signedUrl/.test(ALL_MIGRATIONS), false);
});

// --- Capacités dormantes et SW15 ---------------------------------------------

test("PV-2 — 3 capacités PV, toutes dormantes, sensibles, sans cible n8n", () => {
  const body = code(REGISTRY);
  for (const key of ["pv.bill.extract", "pv.study.prepare", "pv.economics.compute"]) {
    assert.ok(body.includes(`'${key}'`), `capacité manquante: ${key}`);
  }
  // Trois tuples `false, true` : enabled = false, is_sensitive = true.
  assert.equal([...body.matchAll(/\n\s*false, true, false, array\[\]::text\[\], null,/g)].length, 3);
  // `target_workflow_id` et `target_agent` restent NULL : aucun runner désigné.
  assert.equal([...body.matchAll(/'N8N_WORKFLOW', null, null, 'tenant\.member', array\[/g)].length, 3);
  assert.equal(/enabled\s*=\s*true/i.test(body), false, "aucune activation dans ce lot");
});

test("PV-2 — politiques SW15 ACTIVE / REQUIRE_APPROVAL, aucun PERMIT", () => {
  const body = code(REGISTRY);
  assert.equal([...body.matchAll(/'REQUIRE_APPROVAL', 10, 'ACTIVE', false/g)].length, 3);
  assert.equal(/'PERMIT'/.test(body), false, "aucun PERMIT dans le lot PV");
  // Scopées au tenant réel : la gate filtre `p.tenant_id = v_req.tenant_id`,
  // une politique globale serait décorative.
  assert.equal([...body.matchAll(/'heliosolar'/g)].length, 3);
  assert.match(body, /where exists \(select 1 from hermes_os\.tenants t where t\.tenant_id = v\.tenant_id\)/);
});

test("PV-2 — aucun consumer activé, aucun workflow n8n touché", () => {
  const body = code(REGISTRY);
  assert.equal([...body.matchAll(/false, 2, 1, \d+, 'CLOSED'/g)].length, 3);
  // Aucune migration du lot ne touche à n8n ni à `component_registry`.
  assert.equal(/component_registry/i.test(ALL_MIGRATIONS), false);
  assert.equal(/n8n_workflows|workflow_id\s*=\s*'/i.test(ALL_MIGRATIONS), false);
});

test("PV-2 — le lot ne touche AUCUNE autre verticale", () => {
  for (const table of ["photo_", "immo_", "peinture_", "btp_", "youtube_"]) {
    assert.equal(
      new RegExp(`(create|alter|drop) table[^;]*hermes_os\\.${table}`, "i").test(ALL_MIGRATIONS),
      false,
      `le lot modifie une table ${table}*`,
    );
  }
  // Une seule table créée par tout le lot.
  assert.equal([...ALL_MIGRATIONS.matchAll(/create table if not exists hermes_os\.(\w+)/g)].map((m) => m[1]).join(","),
    "pv_documents");
});

test("PV-2 — périmètre tenu : ni devis, ni facture client, ni Consuel, ni Enedis", () => {
  const surface = ALL_MIGRATIONS + SERVICE + ACTIONS;
  for (const forbidden of [
    "consuel",
    "enedis",
    "pv_quotes",
    "pv_invoices",
    "pv_payments",
    "pv_contracts",
    "pv_orders",
    "pv_stock",
    "pv_worksite",
    "pvgis",
    "opensolar",
    "retell",
  ]) {
    assert.equal(
      new RegExp(forbidden, "i").test(surface),
      false,
      `hors périmètre PV-2 détecté: ${forbidden}`,
    );
  }
});

// --- Rollback ----------------------------------------------------------------

test("PV-2 — le rollback retire TOUT le lot, et rien d'autre", () => {
  const body = code(ROLLBACK);
  const created = [...ALL_MIGRATIONS.matchAll(/create or replace function (public|hermes_os)\.(\w+)/g)]
    .map((m) => `${m[1]}.${m[2]}`);
  for (const fn of new Set(created)) {
    assert.ok(body.includes(`drop function if exists ${fn}(`), `rollback incomplet: ${fn}`);
  }
  assert.match(body, /drop table if exists hermes_os\.pv_documents/);
  // Les briques ANTÉRIEURES sont explicitement préservées.
  for (const keep of [
    "hermes_os.is_active_tenant_member",
    "hermes_os._pv_audit",
    "hermes_os.pv_tenant_immutable",
    "hermes_os.pv_promote_bill_extraction",
    "hermes_os.set_updated_at",
  ]) {
    assert.equal(body.includes(`drop function if exists ${keep}`), false, `le rollback détruit ${keep}`);
  }
  // Aucune table de PV-1 n'est retirée.
  for (const t of ["pv_prospects", "pv_sites", "pv_studies", "pv_energy_bills", "pv_economics"]) {
    assert.equal(body.includes(`drop table if exists hermes_os.${t}`), false, `le rollback détruit ${t}`);
  }
});

test("PV-2 — le rollback ne supprime PAS le bucket en SQL (Supabase l'interdit)", () => {
  // MESURÉ : `delete from storage.buckets` échoue avec
  // « Direct deletion from storage tables is not allowed » (storage.protect_delete()).
  // L'inclure ferait échouer TOUT le rollback.
  assert.equal(/delete from storage\.buckets/i.test(code(ROLLBACK)), false);
  // Les policies, elles, sont bien retirées : le bucket subsiste mais inerte.
  assert.equal([...code(ROLLBACK).matchAll(/drop policy if exists "hermes_pv_documents_/g)].length, 3);
});

test("PV-2 — l'ordre du rollback est correct : déclencheurs, puis fonction, puis table", () => {
  const body = code(ROLLBACK);
  const trigger = body.indexOf("drop trigger if exists trg_pv_documents_audit");
  const fn = body.indexOf("drop function if exists hermes_os.pv_document_audit()");
  const table = body.indexOf("drop table if exists hermes_os.pv_documents");
  const guard = body.indexOf("drop function if exists hermes_os.pv_guard()");
  const facade = body.indexOf("drop function if exists public.get_pv_prospects");
  assert.ok(trigger < fn, "un déclencheur doit tomber avant sa fonction");
  assert.ok(fn < table, "la fonction doit tomber avant la table");
  assert.ok(facade < guard, "les façades doivent tomber avant la garde qu'elles appellent");
});

// --- Service et Server Actions ------------------------------------------------

test("PV-2 — le service est `server-only` et n'envoie jamais de tenant_id", () => {
  assert.match(SERVICE, /^import "server-only";/m);
  assert.equal(/tenant_id|tenantId/.test(SERVICE_CODE), false, "le service ne manipule aucun tenant");
  assert.equal(/tenant_id|tenantId/.test(ACTIONS_CODE), false, "aucune action ne manipule de tenant");
  // Aucune clé de service : le client serveur passe par la session de l'utilisateur.
  for (const [name, src] of [["service", SERVICE_CODE], ["actions", ACTIONS_CODE]] as const) {
    assert.equal(/service_role|SERVICE_ROLE|serviceRole/.test(src), false, `${name} : service_role interdit`);
  }
});

test("PV-2 — un refus métier n'est JAMAIS présenté comme un succès", () => {
  // Les codes de refus des garde-fous remontent jusqu'à l'écran.
  for (const codeName of ["TRANSITION_REFUSED", "VALIDATION_REFUSED", "NOT_FOUND"]) {
    assert.ok(ACTIONS.includes(codeName), `code de refus non traduit: ${codeName}`);
  }
  assert.match(ACTIONS, /phase: "error"/);
  // `toState` ne peut pas rendre "ok" sur un résultat non ok.
  assert.match(ACTIONS, /if \(result\.ok\) return \{ phase: "ok"/);
});

test("PV-2 — les pages PV passent TOUTES par la garde de route unique", () => {
  for (const page of [
    "../app/(dashboard)/etudes/page.tsx",
    "../app/(dashboard)/etudes/[prospectId]/page.tsx",
    "../app/(dashboard)/etudes/sites/[siteId]/page.tsx",
  ]) {
    const src = read(page);
    assert.match(src, /requireRoute\("\/etudes"\)/, `${page} doit appeler la garde`);
    assert.equal(/redirect\(/.test(src), false, `${page} : notFound(), jamais redirect()`);
  }
});

test("PV-2 — l'état vide est HONNÊTE : aucun mock présenté comme réel", () => {
  const panels = [
    read("../components/dashboard/PvProspectsPanel.tsx"),
    read("../components/dashboard/PvEnergyPanel.tsx"),
    read("../components/dashboard/PvStudyPanel.tsx"),
  ].join("\n");
  for (const forbidden of ["MOCK", "FAKE", "Lorem", "exemple de données", "Dupont", "demo"]) {
    assert.equal(new RegExp(forbidden, "i").test(panels), false, `donnée fictive détectée: ${forbidden}`);
  }
  // Chaque panneau dit explicitement qu'il n'y a rien, plutôt que d'afficher un vide muet.
  assert.match(read("../components/dashboard/PvProspectsPanel.tsx"), /Aucun prospect/);
  assert.match(read("../components/dashboard/PvEnergyPanel.tsx"), /Aucune facture/);
  assert.match(read("../components/dashboard/PvStudyPanel.tsx"), /Aucune étude/);
});

test("PV-2 — CSS : le bloc PV est intégralement préfixé `pv-`", () => {
  const css = read("../app/globals.css");
  const start = css.indexOf("PACK PHOTOVOLTAÏQUE — LOT PV-2.");
  assert.ok(start > 0, "le bloc CSS PV doit exister");
  const selectors = [...css.slice(start).matchAll(/^\.([a-z0-9-]+)/gm)].map((m) => m[1]);
  assert.ok(selectors.length > 5, `trop peu de sélecteurs: ${selectors.length}`);
  for (const selector of selectors) {
    assert.ok(selector.startsWith("pv-"), `sélecteur non préfixé: .${selector}`);
  }
});
