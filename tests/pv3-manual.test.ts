import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { availableWidgetIds, WIDGET_REGISTRY } from "@/lib/dashboard/widgets";
import { grantedModules, moduleDef, moduleWidgets } from "@/lib/verticals/modules";
import { resolveTenantComposition } from "@/lib/verticals/composition";

/**
 * LOT PV-3 — garde-fous de CONTRAT sur l'exploitation manuelle.
 *
 * Ils complètent `db/tests/pv3_manual.test.sql`, qui prouve le COMPORTEMENT en
 * base. Ici on prouve que ce comportement ne peut pas être perdu par une
 * réécriture distraite : une suppression directe de bucket qui reviendrait, un
 * `tenant_id` glissé dans une signature, un widget PV qui fuiterait vers une
 * autre verticale.
 */

const url = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(url(p), "utf8");
const sqlCode = (sql: string): string =>
  sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const tsCode = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

const MIGRATIONS_DIR = url("../db/migrations/");
const STATUS = read("../db/migrations/20260820_pv3_1_status_machines.sql");
const MANUAL = read("../db/migrations/20260820_pv3_2_facades_manual.sql");
const PURGE = read("../db/migrations/20260820_pv3_3_documents_purge.sql");
const ROLLBACK = read("../db/migrations/20260820_pv3_9_rollback.sql");
const ALL_PV3 = [STATUS, MANUAL, PURGE].map(sqlCode).join("\n");

const SERVICE = tsCode(read("../services/hermes/pv.ts"));
const ACTIONS = tsCode(read("../app/actions/pv.ts"));

// --- 11-12. Rollbacks : le pattern interdit, dépôt-wide -----------------------

test("11 — le rollback photo ne contient plus de suppression directe de storage.buckets", () => {
  const photo = sqlCode(read("../db/migrations/20260818_photo_studio_9_rollback.sql"));
  assert.equal(/delete\s+from\s+storage\.buckets/i.test(photo), false);
  // Et la procédure correcte est documentée, plutôt que le problème simplement effacé.
  const raw = read("../db/migrations/20260818_photo_studio_9_rollback.sql");
  assert.match(raw, /API Storage/);
  assert.match(raw, /storage\.protect_delete/);
});

test("12 — AUCUN fichier *_rollback.sql du dépôt ne contient le pattern interdit", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f.includes("rollback"));
  assert.ok(files.length >= 5, `trop peu de rollbacks trouvés: ${files.length}`);
  for (const f of files) {
    const body = sqlCode(readFileSync(`${MIGRATIONS_DIR}${f}`, "utf8"));
    assert.equal(
      /delete\s+from\s+storage\.buckets/i.test(body),
      false,
      `${f} contient une suppression directe de storage.buckets`,
    );
    assert.equal(
      /delete\s+from\s+storage\.objects/i.test(body),
      false,
      `${f} contient une suppression directe de storage.objects`,
    );
  }
});

test("12b — aucune migration du dépôt ne supprime directement dans storage.*", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = sqlCode(readFileSync(`${MIGRATIONS_DIR}${f}`, "utf8"));
    assert.equal(
      /delete\s+from\s+storage\.(buckets|objects)/i.test(body),
      false,
      `${f} supprime directement dans storage.*`,
    );
  }
});

// --- 3-7. Documents : le contrat d'upload et de téléchargement ----------------

test("3-5 — l'upload refuse MIME et taille AVANT d'écrire le moindre octet", () => {
  // Les deux refus précèdent `preparePvDocument` dans le corps de la fonction :
  // un fichier hors règles ne réserve même pas d'emplacement.
  const fn = SERVICE.slice(SERVICE.indexOf("export async function uploadPvDocument("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  const mimeAt = body.indexOf("BAD_MIME");
  const sizeAt = body.indexOf("BAD_SIZE");
  const prepareAt = body.indexOf("preparePvDocument(");
  const uploadAt = body.indexOf(".upload(");
  assert.ok(mimeAt > 0 && sizeAt > 0, "les deux refus doivent exister");
  assert.ok(mimeAt < prepareAt, "le MIME est refusé avant la réservation");
  assert.ok(sizeAt < prepareAt, "la taille est refusée avant la réservation");
  assert.ok(prepareAt < uploadAt, "la réservation précède l'écriture");
  // Le plafond et l'allowlist sont ceux du bucket, redits côté serveur.
  assert.match(SERVICE, /PV_DOCUMENT_MAX_BYTES = 26_214_400/);
  assert.match(SERVICE, /"application\/pdf",\s*\n\s*"image\/jpeg",\s*\n\s*"image\/png",\s*\n\s*"image\/webp",/);
});

test("3b — le navigateur ne choisit ni le tenant, ni le bucket, ni le chemin", () => {
  // Le chemin vient de la base (`prepare_pv_document`), jamais du formulaire.
  // On compare les OCCURRENCES plutôt qu'un lookahead : `\s*(?!…)` se satisfait
  // en revenant sur zéro caractère, donc il ne prouverait rien.
  const pathArgs = [...SERVICE.matchAll(/p_path:\s*([^,\n]+)/g)].map((m) => m[1].trim());
  assert.ok(pathArgs.length > 0, "la finalisation doit passer un chemin");
  for (const arg of pathArgs) {
    assert.equal(arg, "slot.path", `chemin non issu de la base: ${arg}`);
  }
  // Aucune action ne lit un champ de chemin ou de bucket depuis le formulaire.
  for (const field of ["path", "bucket", "storage_path", "storage_bucket", "tenant"]) {
    assert.equal(
      new RegExp(`formData\\.get\\("${field}"\\)|text\\(formData, "${field}"\\)`).test(ACTIONS),
      false,
      `le formulaire ne doit pas porter « ${field} »`,
    );
  }
  // Et la façade re-valide le préfixe server-side.
  assert.match(sqlCode(read("../db/migrations/20260819_pv2_4_storage.sql")), /PATH_OUT_OF_SCOPE/);
});

test("6-7 — téléchargement par URL signée bornée, jamais publique", () => {
  assert.match(SERVICE, /const SIGNED_URL_TTL_SECONDS = 300;/);
  const ttl = Number(/SIGNED_URL_TTL_SECONDS = (\d+)/.exec(SERVICE)?.[1]);
  assert.ok(ttl > 0 && ttl <= 900, `TTL hors bornes: ${ttl}s`);
  for (const [name, src] of [["service", SERVICE], ["actions", ACTIONS], ["migrations", ALL_PV3]] as const) {
    assert.equal(/getPublicUrl/i.test(src), false, `${name} : getPublicUrl interdit`);
  }
  // L'URL signée n'est jamais persistée : aucune colonne ne la porte.
  assert.equal(/signed_url|signedUrl/.test(ALL_PV3), false);
});

test("9-10 — la purge ne peut pas sortir du tenant, et se rejoue sans effet", () => {
  // Le service ne supprime QUE dans le bucket du lot, et re-vérifie le préfixe.
  const fn = SERVICE.slice(SERVICE.indexOf("export async function purgePvDocuments("));
  assert.match(fn, /c\.bucket !== PV_DOCUMENT_BUCKET/);
  assert.match(fn, /c\.path\.startsWith\(`\$\{options\.tenantPrefix\}\/`\)/);
  // ORDRE : lister → supprimer les octets → enregistrer. L'inverse orphelinerait.
  const listAt = fn.indexOf("listPvDocumentsToPurge(");
  const removeAt = fn.indexOf(".remove(");
  const markAt = fn.indexOf("mark_pv_document_purged");
  assert.ok(listAt < removeAt && removeAt < markAt, "ordre lister → effacer → enregistrer");
  // Idempotence : la façade répond ALREADY_PURGED, elle ne lève pas.
  assert.match(sqlCode(PURGE), /ALREADY_PURGED/);
  assert.match(sqlCode(PURGE), /NOT_DELETED/);
  // Aucune suppression SQL directe dans storage.*, nulle part dans le lot.
  assert.equal(/delete\s+from\s+storage\./i.test(ALL_PV3), false);
});

// --- Machines à états ---------------------------------------------------------

test("18 — les transitions étude/chiffrage sont des DONNÉES, pas du code", () => {
  const body = sqlCode(STATUS);
  assert.match(body, /create table if not exists hermes_os\.pv_status_transitions/);
  // Le déclencheur LIT la table ; il ne code aucun chemin en dur.
  assert.match(body, /from hermes_os\.pv_status_transitions t/);
  assert.equal(/if old\.status = '\w+' and new\.status = '\w+'/.test(body), false);
  // DRAFT -> VALIDATED n'est PAS déclaré : c'est le raccourci que le lot ferme.
  assert.equal(/\('pv_studies', 'DRAFT',\s*'VALIDATED'\)/.test(body), false);
  assert.equal(/\('pv_economics', 'DRAFT',\s*'VERIFIED'\)/.test(body), false);
  // Les chemins réellement empruntés par PV-2 restent déclarés.
  assert.match(body, /\('pv_studies', 'CALCULATED',\s*'VALIDATED'\)/);
  assert.match(body, /\('pv_economics', 'CALCULATED',\s*'VERIFIED'\)/);
});

test("PV-3 — les façades de statut refusent explicitement de valider", () => {
  const body = sqlCode(MANUAL);
  assert.match(body, /if p_status = 'VALIDATED' then\s*\n\s*return jsonb_build_object\('ok', false, 'code', 'USE_VALIDATION_FACADE'\)/);
  assert.match(body, /if p_status = 'VERIFIED' then\s*\n\s*return jsonb_build_object\('ok', false, 'code', 'USE_VALIDATION_FACADE'\)/);
  // Une étude créée à la main naît en DRAFT, préparée MANUAL — jamais autrement.
  assert.match(body, /'DRAFT', 'MANUAL',/);
  assert.equal(/values\s*\([^)]*'VALIDATED'/.test(body), false);
});

test("PV-3 — le contrat Hermès tient sur les 8 nouvelles façades", () => {
  const created = [...ALL_PV3.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(created.length >= 8, `façades trouvées: ${created.join(", ")}`);
  for (const fn of [
    "verify_pv_consumption_profile",
    "upsert_pv_study",
    "upsert_pv_study_assumptions",
    "set_pv_study_status",
    "upsert_pv_economics",
    "set_pv_economics_status",
    "list_pv_documents_to_purge",
    "mark_pv_document_purged",
  ]) {
    assert.ok(created.includes(fn), `façade manquante: ${fn}`);
    assert.ok(
      new RegExp(`revoke all on function public\\.${fn}\\(`).test(ALL_PV3),
      `REVOKE manquant sur ${fn}`,
    );
    assert.ok(
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`).test(ALL_PV3),
      `GRANT authenticated manquant sur ${fn}`,
    );
  }
  // Aucun GRANT anon, aucune signature portant un tenant ou un acteur.
  assert.equal(/grant\s+execute[^;]*to\s+anon/i.test(ALL_PV3), false);
  const signatures = [...ALL_PV3.matchAll(/create or replace function (?:public|hermes_os)\.\w+\(([^)]*)\)/g)]
    .map((m) => m[1]);
  for (const sig of signatures) {
    assert.equal(/tenant/i.test(sig), false, `signature exposant un tenant: (${sig})`);
    assert.equal(
      /(verified_by|validated_by|promoted_by|p_actor|p_user_id)/i.test(sig),
      false,
      `signature exposant un acteur: (${sig})`,
    );
  }
});

test("PV-3 — aucune façade ne contourne les garde-fous PV-1", () => {
  assert.equal(/alter table[^;]*disable trigger/i.test(ALL_PV3), false);
  assert.equal(/set (local )?role/i.test(ALL_PV3), false);
  assert.equal(/security invoker/i.test(ALL_PV3), false);
  assert.equal(/^\s*tenant_id\s*=/m.test(sqlCode(MANUAL)), false, "aucune écriture ne réaffecte un tenant");
  // L'audit réutilise la brique existante ; aucun second journal.
  assert.match(sqlCode(STATUS), /hermes_os\._pv_audit\(/);
  assert.equal(/create table[^;]*audit/i.test(ALL_PV3), false, "aucun second système d'audit");
});

// --- 25-28. Widgets et verticales ---------------------------------------------

const PHOTO = ["photo_studio", "leads", "appointments", "quotes"];
const IMMO = ["properties", "leads", "appointments"];
const SOLAIRE = ["quotes", "worksites", "leads"];
const PV_WIDGETS = ["pv-studies-to-validate", "pv-bills-to-verify", "pv-prospects-without-site"];

test("25 — un tenant solaire voit les TROIS widgets PV", () => {
  const modules = grantedModules(SOLAIRE);
  const widgets = moduleWidgets(modules);
  for (const id of PV_WIDGETS) {
    assert.ok(widgets.includes(id), `widget manquant pour le solaire: ${id}`);
    assert.ok(availableWidgetIds(new Set(), modules).has(id), `${id} doit être disponible`);
  }
  // Trois widgets, UN seul instantané partagé — contrat COST-FIRST.
  const defs = WIDGET_REGISTRY.filter((w) => PV_WIDGETS.includes(w.id));
  assert.equal(defs.length, 3);
  for (const d of defs) {
    assert.deepEqual(d.snapshotKeys, ["pvPilot"], `${d.id} doit lire l'instantané partagé`);
    assert.equal(d.requiredModule, "solar.studies");
  }
});

test("26-27 — ni photo ni immobilier ne voient un seul widget PV", () => {
  for (const [name, tokens] of [["photo", PHOTO], ["immobilier", IMMO]] as const) {
    const modules = grantedModules(tokens);
    const widgets = moduleWidgets(modules);
    for (const id of PV_WIDGETS) {
      assert.ok(!widgets.includes(id), `${name} ne doit pas posséder ${id}`);
      assert.ok(!availableWidgetIds(new Set(), modules).has(id), `${name} : ${id} doit être fermé`);
    }
    // Et la composition complète — la seule vérité affichée — n'en contient aucun.
    const composition = resolveTenantComposition({ capabilityKeys: tokens });
    for (const id of PV_WIDGETS) {
      assert.ok(!composition.widgets.includes(id), `${name} : ${id} fuite dans la composition`);
    }
  }
});

test("27b — aucun token générique ne fait fuiter un widget PV", () => {
  for (const token of ["quotes", "leads", "crm", "pipeline", "sales", "appointments", "documents", "worksites"]) {
    const modules = grantedModules([token]);
    for (const id of PV_WIDGETS) {
      assert.ok(
        !availableWidgetIds(new Set(), modules).has(id),
        `le token « ${token} » ne doit pas ouvrir ${id}`,
      );
    }
  }
  // Une capacité `pv.*` ne suffit pas non plus : elles sont désactivées, c'est
  // le MODULE qui décide.
  for (const id of PV_WIDGETS) {
    assert.ok(!availableWidgetIds(new Set(["pv.study.prepare"])).has(id));
  }
});

test("28 — la route PV reste fail-closed, et la composition solaire est cohérente", () => {
  const composition = resolveTenantComposition({ capabilityKeys: SOLAIRE });
  assert.ok(composition.modules.includes("solar.studies"));
  for (const id of PV_WIDGETS) {
    assert.ok(composition.widgets.includes(id), `${id} doit être composé pour le solaire`);
  }
  const def = moduleDef("solar.studies");
  assert.equal(def?.route, "/etudes");
  assert.deepEqual(def?.widgets, PV_WIDGETS);
});

// --- Rollback PV-3 -------------------------------------------------------------

test("PV-3 — le rollback retire tout le lot, et rien d'autre", () => {
  const body = sqlCode(ROLLBACK);
  const created = [...ALL_PV3.matchAll(/create or replace function (public|hermes_os)\.(\w+)/g)]
    .map((m) => `${m[1]}.${m[2]}`);
  for (const fn of new Set(created)) {
    assert.ok(body.includes(`drop function if exists ${fn}(`), `rollback incomplet: ${fn}`);
  }
  assert.match(body, /drop table if exists hermes_os\.pv_status_transitions/);
  assert.match(body, /drop column if exists purged_at/);
  // Les briques ANTÉRIEURES survivent.
  for (const keep of [
    "hermes_os._pv_audit",
    "hermes_os.pv_guard",
    "hermes_os.pv_human_validation_guard",
    "hermes_os.pv_tenant_immutable",
    "hermes_os.is_active_tenant_member",
  ]) {
    assert.equal(body.includes(`drop function if exists ${keep}`), false, `le rollback détruit ${keep}`);
  }
  for (const t of ["pv_documents", "pv_prospects", "pv_studies", "pv_economics"]) {
    assert.equal(body.includes(`drop table if exists hermes_os.${t}`), false, `le rollback détruit ${t}`);
  }
  // ORDRE : la contrainte tombe avant les colonnes qu'elle cite ; les
  // déclencheurs avant leurs fonctions.
  const constraintAt = body.indexOf("drop constraint if exists pv_documents_purge_coherente");
  const columnAt = body.indexOf("drop column if exists purged_path");
  const triggerAt = body.indexOf("drop trigger if exists trg_pv_studies_change_audit");
  const fnAt = body.indexOf("drop function if exists hermes_os.pv_change_audit()");
  assert.ok(constraintAt < columnAt, "la contrainte tombe avant ses colonnes");
  assert.ok(triggerAt < fnAt, "un déclencheur tombe avant sa fonction");
});

// --- Périmètre -----------------------------------------------------------------

test("PV-3 — périmètre tenu : rien de ce qui est reporté n'apparaît", () => {
  const surface = ALL_PV3 + SERVICE + ACTIONS;
  for (const forbidden of [
    "consuel", "enedis", "pv_quotes", "pv_invoices", "pv_payments", "pv_contracts",
    "pv_orders", "pv_stock", "pvgis", "opensolar", "retell", "sendEmail", "twilio",
  ]) {
    assert.equal(new RegExp(forbidden, "i").test(surface), false, `hors périmètre PV-3: ${forbidden}`);
  }
  // Aucune activation de capacité ni de consumer dans tout le lot.
  assert.equal(/enabled\s*=\s*true/i.test(ALL_PV3), false, "aucune activation dans le lot");
  assert.equal(/agent_action_catalog|resolver_runtime_config|sw15_policies/.test(ALL_PV3), false);
});

test("PV-3 — le service reste server-only et sans service_role", () => {
  assert.match(read("../services/hermes/pv.ts"), /^import "server-only";/m);
  for (const [name, src] of [["service", SERVICE], ["actions", ACTIONS]] as const) {
    assert.equal(/service_role|SERVICE_ROLE|serviceRole/.test(src), false, `${name} : service_role interdit`);
    assert.equal(/tenant_id|tenantId/.test(src), false, `${name} : aucun tenant manipulé`);
  }
});
