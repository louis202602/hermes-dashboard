import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { availableWidgetIds, resolveWidgetLayout } from "@/lib/dashboard/widgets";
import { grantedModules, moduleDef } from "@/lib/verticals/modules";
import { resolveTenantComposition } from "@/lib/verticals/composition";

/**
 * LOT PV-4 — garde-fous de CONTRAT sur le dossier commercial.
 *
 * Complète `db/tests/pv4_deal_and_pdf.test.sql`, qui prouve le COMPORTEMENT en
 * base. Ici on prouve que ce comportement ne peut pas être perdu par une
 * réécriture distraite : une grille de widgets qu'on débranche, un bouton
 * « Supprimer » ambigu qui revient, une URL publique persistée, un `tenant_id`
 * glissé dans une signature, un devis introduit hors périmètre.
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
const M1 = read("../db/migrations/20260821_pv4_1_purge_admin_guard.sql");
const M2 = read("../db/migrations/20260821_pv4_2_document_stage.sql");
const M3 = read("../db/migrations/20260821_pv4_3_deal_and_generation.sql");
const ROLLBACK = read("../db/migrations/20260821_pv4_9_rollback.sql");
const ALL_PV4 = [M1, M2, M3].map(sqlCode).join("\n");

const SERVICE = tsCode(read("../services/hermes/pv.ts"));
const ACTIONS = tsCode(read("../app/actions/pv.ts"));
const DOCS_PANEL = read("../components/dashboard/PvDocumentsPanel.tsx");
const BOARD = tsCode(read("../components/dashboard/DashboardWidgetBoard.tsx"));
const HOME = tsCode(read("../app/(dashboard)/page.tsx"));

const PV_WIDGETS = [
  "pv-studies-to-validate",
  "pv-bills-to-verify",
  "pv-prospects-without-site",
];
const SOLAIRE = ["quotes", "worksites", "leads"];
const PHOTO = ["photo_studio", "leads", "appointments", "quotes"];
const IMMO = ["properties", "leads", "appointments"];

// --- 9-14. LA GRILLE DE WIDGETS EST RÉELLEMENT RENDUE ------------------------

test("9 — la page d'accueil rend RÉELLEMENT la grille de widgets", () => {
  // Le point du lot : `EditableWidgetGrid` existait mais n'était montée nulle
  // part. Une déclaration de widgets sans rendu est une déclaration sans effet.
  assert.match(HOME, /<DashboardWidgetBoard/);
  assert.match(HOME, /available=\{composedWidgets\}/);
  assert.match(BOARD, /EditableWidgetGrid/);
});

test("9b — la grille est alimentée par la COMPOSITION, pas par une liste en dur", () => {
  assert.match(HOME, /resolvePageContext\(\)/);
  assert.match(HOME, /pageContext\.composition\.widgets/);
  // Aucun identifiant de widget PV codé en dur comme source de la grille.
  assert.equal(
    /available=\{\s*\[/.test(HOME),
    false,
    "la grille ne doit pas recevoir un tableau littéral",
  );
});

test("10 — un tenant solaire compose EXACTEMENT les 3 widgets PV", () => {
  const composition = resolveTenantComposition({ capabilityKeys: SOLAIRE });
  for (const id of PV_WIDGETS) {
    assert.ok(composition.widgets.includes(id), `${id} doit être composé pour le solaire`);
  }
  assert.equal(
    composition.widgets.filter((w) => w.startsWith("pv-")).length,
    3,
    "exactement 3 widgets PV",
  );
});

test("11 — un tenant photo et un tenant immobilier composent 0 widget PV", () => {
  for (const [name, keys] of [["photo", PHOTO], ["immobilier", IMMO]] as const) {
    const composition = resolveTenantComposition({ capabilityKeys: keys });
    assert.equal(
      composition.widgets.filter((w) => w.startsWith("pv-")).length,
      0,
      `${name} ne doit composer aucun widget PV`,
    );
  }
});

test("12 — la grille NE PEUT PAS afficher un widget absent de la composition", () => {
  // Même si la mise en page persistée en réclame un : `resolveWidgetLayout`
  // intersecte avec l'ensemble autorisé. C'est la garde qui compte, parce que
  // la mise en page vient des préférences de l'utilisateur.
  const layout = { order: [...PV_WIDGETS, "photo-sessions"], hidden: [], sizes: {} };
  const photoAllowed = new Set(
    resolveTenantComposition({ capabilityKeys: PHOTO }).widgets,
  );
  const resolved = resolveWidgetLayout(layout as never, photoAllowed);
  for (const id of PV_WIDGETS) {
    assert.ok(
      !resolved.visible.some((i) => i.id === id),
      `${id} ne doit pas être rendu à un tenant photo`,
    );
  }
});

test("13 — AUCUNE grille spécifique PV : un seul composant de grille", () => {
  const components = readdirSync(url("../components/dashboard/"));
  const grids = components.filter((f) => /WidgetGrid|WidgetBoard/.test(f));
  assert.deepEqual(
    grids.sort(),
    ["DashboardWidgetBoard.tsx", "EditableWidgetGrid.tsx"],
    "aucune grille dédiée à une verticale ne doit exister",
  );
  // Et le composant PV des widgets ne réimplémente pas de grille.
  const pvWidgets = tsCode(read("../components/dashboard/PvWidgets.tsx"));
  assert.equal(/dashboard-widgets|DndContext|SortableContext/.test(pvWidgets), false);
});

test("14 — l'instantané PV n'est lu QUE si un widget PV est réellement composé", () => {
  // Un tenant photo ne doit déclencher aucune lecture PV : le coût suit l'usage.
  assert.match(HOME, /composedWidgets\.some\(\(id\) => id\.startsWith\("pv-"\)\)/);
  assert.match(HOME, /needsPvSnapshot \? await getPvPilotSnapshot\(\) : null/);
});

test("14b — les widgets PV sont gardés par un MODULE, pas par une capacité PV", () => {
  // Les capacités `pv.*` sont désactivées : une garde par préfixe de capacité
  // ne pourrait JAMAIS s'ouvrir. La garde utile est le module métier.
  const def = moduleDef("solar.studies");
  assert.deepEqual(def?.widgets, PV_WIDGETS);
  for (const id of PV_WIDGETS) {
    assert.ok(
      !availableWidgetIds(new Set(["pv.study.generate"]), new Set()).has(id),
      `${id} ne doit pas s'ouvrir sur une capacité pv.*`,
    );
    assert.ok(availableWidgetIds(new Set(), grantedModules(SOLAIRE)).has(id));
  }
});

// --- PURGE : VOCABULAIRE ET CONFIRMATION -------------------------------------

test("1 — la zone de purge porte la phrase d'avertissement EXACTE exigée", () => {
  assert.match(
    DOCS_PANEL.replace(/\s+/g, " "),
    /Cette action supprimera définitivement le fichier après le délai de grâce\.\s*<strong> Cette opération est irréversible\.<\/strong>/,
  );
});

test("2 — vocabulaire non ambigu : « Retirer » et « Purger définitivement »", () => {
  assert.match(DOCS_PANEL, /Retirer/);
  assert.match(DOCS_PANEL, /Purger définitivement/);
  // AUCUN bouton simplement « Supprimer » : le mot ne dit pas lequel des deux
  // gestes il déclenche, et l'un des deux est irréversible.
  const buttons = [...DOCS_PANEL.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.ok(buttons.length >= 2, `trop peu de boutons analysés: ${buttons.length}`);
  for (const b of buttons) {
    assert.equal(
      /Supprimer/.test(b),
      false,
      `un bouton porte le libellé ambigu « Supprimer » : ${b.slice(0, 80)}`,
    );
  }
});

test("3 — la confirmation explicite est OBLIGATOIRE dans l'écran", () => {
  assert.match(DOCS_PANEL, /type="checkbox"\s+name="confirm"\s+value="PURGER"\s+required/);
});

test("4 — le SERVEUR reste l'autorité : contourner l'écran ne purge pas", () => {
  // 1. L'action refuse sans la confirmation…
  assert.match(ACTIONS, /formData\.get\("confirm"\)\s*!==\s*"PURGER"/);
  assert.match(ACTIONS, /CONFIRMATION_REQUIRED/);
  // 2. …et surtout la BASE refuse sans `tenant.admin`, indépendamment de l'UI.
  assert.match(sqlCode(M1), /pv_guard_admin\(\)/);
  assert.match(sqlCode(M1), /NOT_ADMIN/);
  const purgeFns = sqlCode(M1).match(
    /create or replace function public\.(list_pv_documents_to_purge|mark_pv_document_purged)[\s\S]*?\$function\$;/g,
  );
  assert.equal(purgeFns?.length, 2, "les deux façades de purge doivent être redéfinies");
  for (const fn of purgeFns ?? []) {
    assert.match(fn, /hermes_os\.pv_guard_admin\(\)/);
  }
});

test("5 — AUCUN nouveau système de rôles : la permission existante est réutilisée", () => {
  assert.match(sqlCode(M1), /user_tenant_permissions/);
  assert.match(sqlCode(M1), /'tenant\.admin'/);
  assert.equal(
    /create table[\s\S]{0,80}(role|permission)/i.test(ALL_PV4),
    false,
    "PV-4 ne doit créer aucune table de rôles",
  );
});

test("6 — AUCUNE nouvelle table d'audit : le journal est une jointure", () => {
  assert.equal(
    /create table[\s\S]{0,120}audit/i.test(ALL_PV4),
    false,
    "PV-4 ne doit créer aucune table d'audit",
  );
  assert.match(sqlCode(M1), /entity_audit_log/);
  assert.match(sqlCode(M1), /purged_path/);
  assert.match(sqlCode(M1), /purged_at/);
});

test("7 — le journal expose bien les 9 informations exigées", () => {
  const journal = sqlCode(M1).match(
    /create or replace function public\.get_pv_purge_journal[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(journal, "get_pv_purge_journal introuvable");
  for (const field of [
    "'document_id'",
    "'doc_type'",
    "'site_id'",
    "'original_filename'",
    "'deleted_at'",
    "'purged_at'",
    "'purged_by'",
    "'purged_path'",
    "'outcome'",
  ]) {
    assert.ok(journal.includes(field), `le journal doit porter ${field}`);
  }
});

test("8 — le délai de grâce de 7 jours reste le défaut, des DEUX côtés", () => {
  assert.match(sqlCode(M1), /p_older_than\s+interval\s+default\s+'7 days'/);
  assert.match(sqlCode(M1), /GRACE_PERIOD/);
  // Le comparateur `<=` du correctif PV-3/3b est conservé : `<` serait faux à
  // l'égalité, `now()` étant constant dans une transaction.
  assert.match(sqlCode(M1), /deleted_at <= now\(\) - v_age/);
});

// --- 31-33. STOCKAGE ET PDF --------------------------------------------------

test("31 — le bucket PV reste PRIVÉ et PV-4 n'y touche pas", () => {
  assert.equal(
    /storage\.buckets/.test(sqlCode(ALL_PV4)),
    false,
    "PV-4 ne doit pas modifier les buckets",
  );
  assert.equal(/public\s*=\s*true/.test(sqlCode(ALL_PV4)), false);
});

test("32 — AUCUNE URL publique, AUCUNE URL persistée : signature courte uniquement", () => {
  assert.equal(
    /getPublicUrl/.test(SERVICE),
    false,
    "getPublicUrl ne doit jamais être appelé",
  );
  assert.match(SERVICE, /createSignedUrls?\(/);
  assert.match(SERVICE, /SIGNED_URL_TTL_SECONDS = 300/);
  // Et rien ne stocke une URL en base : la façade d'enregistrement ne prend que
  // le CHEMIN, jamais une URL.
  assert.equal(
    /p_url|signed_url|public_url/i.test(sqlCode(M3)),
    false,
    "aucune URL ne doit être persistée",
  );
});

test("33 — le chemin du PDF est demandé À LA BASE, jamais reconstruit côté client", () => {
  const gen = SERVICE.match(
    /export async function generatePvStudySummary[\s\S]*?\n}\n/,
  )?.[0];
  assert.ok(gen, "generatePvStudySummary introuvable");
  assert.match(gen, /await preparePvDocument\(/);
  assert.match(gen, /\.upload\(slot\.path/);
  // Le tenant n'apparaît nulle part dans la construction du chemin.
  assert.equal(
    /`\$\{tenant/.test(gen) || /tenantId/.test(gen),
    false,
    "le chemin ne doit pas être composé à partir d'un tenant côté application",
  );
  // Et la base revalide le préfixe, indépendamment de l'application.
  assert.match(sqlCode(M3), /PATH_OUT_OF_SCOPE/);
  assert.match(sqlCode(M3), /v_prefix := v_t \|\| '\/' \|\| v_site::text \|\| '\/'/);
});

test("33b — le tenant A ne peut pas rattacher le PDF d'un tenant B (FK composite)", () => {
  assert.match(sqlCode(M2), /foreign key \(tenant_id, study_id\)/);
  assert.match(sqlCode(M2), /foreign key \(tenant_id, economics_id\)/);
  assert.match(sqlCode(M2), /references hermes_os\.pv_studies \(tenant_id, id\)/);
  assert.match(sqlCode(M2), /references hermes_os\.pv_economics \(tenant_id, id\)/);
});

test("34 — le stade FINAL est reverifié EN BASE, pas seulement dans l'écran", () => {
  assert.match(sqlCode(M3), /PDF_FINAL_NOT_READY/);
  assert.match(sqlCode(M3), /STUDY_NOT_VALIDATED/);
  assert.match(sqlCode(M3), /ECONOMICS_NOT_VERIFIED/);
  // Deux gardes indépendantes : application ET base.
  assert.match(SERVICE, /canGenerateFinalPdf/);
  assert.match(SERVICE, /PDF_FINAL_NOT_READY/);
});

// --- CONTRAT GÉNÉRAL ---------------------------------------------------------

test("35 — aucune façade PV-4 n'accepte de tenant_id", () => {
  const signatures = [...sqlCode(ALL_PV4).matchAll(/create or replace function ([\s\S]*?)\)\s*\nreturns/g)];
  assert.ok(signatures.length >= 6, `trop peu de signatures trouvées: ${signatures.length}`);
  for (const [, sig] of signatures) {
    assert.equal(
      /p_tenant|tenant_id\s+text/.test(sig),
      false,
      `une signature PV-4 expose un tenant : ${sig.slice(0, 120)}`,
    );
  }
});

test("36 — aucune façade PV-4 n'accepte de paramètre d'acteur", () => {
  assert.equal(
    /p_actor|p_user_id|p_purged_by|p_generated_by/.test(sqlCode(ALL_PV4)),
    false,
    "l'acteur vient toujours de auth.uid()",
  );
  assert.match(sqlCode(M1), /uid/);
});

test("37 — aucun GRANT anon, aucun service_role dans PV-4", () => {
  assert.equal(/to anon/.test(sqlCode(ALL_PV4)), false);
  assert.equal(/service_role/.test(sqlCode(ALL_PV4)), false);
  assert.equal(/service_role|SERVICE_ROLE/.test(SERVICE), false);
  assert.equal(/service_role|SERVICE_ROLE/.test(ACTIONS), false);
});

test("38 — toute façade PV-4 est SECURITY DEFINER à search_path verrouillé", () => {
  const fns = [...sqlCode(ALL_PV4).matchAll(
    /create or replace function [\s\S]*?\$function\$;/g,
  )].map((m) => m[0]);
  assert.ok(fns.length >= 5, `trop peu de fonctions trouvées: ${fns.length}`);
  for (const fn of fns) {
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'/);
  }
});

test("39 — le rollback PV-4 ne supprime AUCUN objet storage en SQL direct", () => {
  const body = sqlCode(ROLLBACK);
  assert.equal(/delete\s+from\s+storage\.(buckets|objects)/i.test(body), false);
  // Et il restaure les façades PV-3 AVANT de retirer la garde d'administration,
  // sinon il laisserait des fonctions appelant une fonction absente.
  const restore = body.indexOf("create or replace function public.mark_pv_document_purged");
  const dropGuard = body.indexOf("drop function if exists hermes_os.pv_guard_admin");
  assert.ok(restore > 0 && dropGuard > restore, "l'ordre du rollback est incorrect");
});

test("39b — le rollback DIT qu'il diminue une protection, plutôt que de le taire", () => {
  assert.match(ROLLBACK, /TOUT membre du tenant/);
  assert.match(ROLLBACK, /PERTE DE RATTACHEMENT/);
});

test("40 — AUCUN devis, signature, acompte ou paiement introduit par PV-4", () => {
  for (const forbidden of [
    "pv_quotes",
    "quote_lines",
    "pv_quote_lines",
    "signature",
    "acompte",
    "deposit",
    "payment",
    "facture_client",
  ]) {
    assert.equal(
      new RegExp(forbidden, "i").test(sqlCode(ALL_PV4)),
      false,
      `PV-4 introduit « ${forbidden} », hors périmètre`,
    );
  }
});

test("41 — AUCUN appel n8n, AUCUNE activation de capacité PV dans PV-4", () => {
  for (const src of [ALL_PV4, SERVICE, ACTIONS]) {
    assert.equal(/n8n|webhook/i.test(src), false, "aucune référence n8n");
  }
  assert.equal(
    /agent_action_catalog|resolver_runtime_config|sw15_policies/.test(sqlCode(ALL_PV4)),
    false,
    "PV-4 ne touche à aucun registre de capacités",
  );
  assert.equal(/enabled\s*=\s*true/.test(sqlCode(ALL_PV4)), false);
});

test("42 — le PDF est produit SANS nouvelle dépendance", () => {
  const pkg = JSON.parse(read("../package.json")) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});
  for (const heavy of ["pdfkit", "jspdf", "pdf-lib", "puppeteer", "playwright"]) {
    assert.ok(!deps.includes(heavy), `dépendance PDF lourde ajoutée : ${heavy}`);
  }
  // Les modules PDF n'importent que des modules internes (`@/`) ou Node : jamais
  // un paquet tiers. C'est la propriété qui compte, pas « zéro import ».
  for (const f of ["../lib/pv/pdfEngine.ts", "../lib/pv/studyPdf.ts"]) {
    const mod = tsCode(read(f));
    const imports = [...mod.matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("node:"),
        `${f} importe le paquet tiers « ${spec} »`,
      );
    }
  }
});

test("43 — aucun rollback du dépôt ne supprime storage.objects ou storage.buckets", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && f.includes("rollback"),
  );
  assert.ok(files.length >= 6, `trop peu de rollbacks trouvés: ${files.length}`);
  for (const f of files) {
    const body = sqlCode(readFileSync(`${MIGRATIONS_DIR}${f}`, "utf8"));
    assert.equal(
      /delete\s+from\s+storage\.(buckets|objects)/i.test(body),
      false,
      `${f} contient une suppression SQL directe dans storage`,
    );
  }
});

test("44 — les styles PV-4 sont tous préfixés pv-, sans fuite globale", () => {
  const css = read("../app/globals.css");
  const block = css.slice(css.indexOf("PV-4 : zone dangereuse"));
  assert.ok(block.length > 0, "bloc CSS PV-4 introuvable");
  const selectors = [...block.matchAll(/^\.([a-z][\w-]*)/gm)].map((m) => m[1]);
  assert.ok(selectors.length >= 3, `trop peu de sélecteurs: ${selectors.length}`);
  for (const s of selectors) {
    assert.ok(s.startsWith("pv-"), `le sélecteur .${s} n'est pas préfixé pv-`);
  }
});
