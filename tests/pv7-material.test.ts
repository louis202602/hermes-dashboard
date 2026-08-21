import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isRouteAllowed, routeModule } from "@/lib/verticals/navigation";
import { grantedModules } from "@/lib/verticals/modules";
import {
  pvGapTone,
  pvMarginSentence,
  pvMaterialReadinessTone,
  pvOrderTone,
  pvQty,
  PV_MATERIAL_CATEGORY_LABELS,
  PV_MATERIAL_GAP_LABELS,
  PV_MATERIAL_READINESS_LABELS,
  PV_PURCHASE_BLOCKER_LABELS,
  PV_PURCHASE_ORDER_STATUS_LABELS,
  PV_RECEIPT_CONDITION_LABELS,
  PV_REQUIREMENT_ORIGIN_LABELS,
} from "@/lib/pv/materialLabels";
import {
  PV_MATERIAL_CATEGORIES,
  PV_MATERIAL_GAP_STATUSES,
  PV_MATERIAL_UNITS,
  PV_PURCHASE_ORDER_STATUSES,
  PV_RECEIPT_CONDITIONS,
  PV_REQUIREMENT_ORIGINS,
  type PvMaterialCosts,
} from "@/types/pv";

/**
 * LOT PV-7 — garde-fous de CONTRAT sur l'approvisionnement matériel.
 *
 * Ils complètent `db/tests/pv7_material_procurement.test.sql`, qui prouve le
 * COMPORTEMENT en base. Ici on prouve que ce comportement ne peut pas être perdu
 * par une réécriture distraite : un total redevenu saisissable, un envoi réel de
 * commande introduit par mégarde, une marge affichée sur des coûts inconnus, un
 * `tenant_id` glissé dans un formulaire.
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

/**
 * SQL sans commentaires NI littéraux. Les commentaires BLOC sont retirés
 * d'abord : une apostrophe française isolée dans l'un d'eux désynchroniserait le
 * détecteur de littéraux, qui avalerait tout le reste du fichier — et le test
 * passerait en ne regardant plus rien. (Leçon de PV-6, appliquée d'emblée.)
 */
const sqlIdentifiers = (sql: string): string =>
  sqlCode(sql.replace(/\/\*[\s\S]*?\*\//g, " ")).replace(/'(?:''|[^'])*'/g, "''");

const MIGRATIONS_DIR = url("../db/migrations/");
const M1 = read("../db/migrations/20260824_pv7_1_catalog_suppliers.sql");
const M2 = read("../db/migrations/20260824_pv7_2_requirements.sql");
const M3 = read("../db/migrations/20260824_pv7_3_purchase_orders.sql");
const M3B = read("../db/migrations/20260824_pv7_3b_line_guard_generated_column.sql");
const M4 = read("../db/migrations/20260824_pv7_4_balance_and_facades.sql");
const M5 = read("../db/migrations/20260824_pv7_5_facades_orders.sql");
const ROLLBACK = read("../db/migrations/20260824_pv7_9_rollback.sql");
const ALL_PV7 = [M1, M2, M3, M3B, M4, M5].map(sqlCode).join("\n");

const SERVICE = read("../services/hermes/pv.ts");
const ACTIONS = read("../app/actions/pv.ts");
const PANEL = read("../components/dashboard/PvMaterialPanel.tsx");
const EDITOR = read("../components/dashboard/PvPurchaseOrderEditor.tsx");
const ROUTE = read("../app/(dashboard)/etudes/commandes/[orderId]/page.tsx");
const DEAL_PAGE = read("../app/(dashboard)/etudes/affaires/[prospectId]/page.tsx");
const CSS = read("../app/globals.css");

// --- 1. La propriété qui porte le lot : rien n'est envoyé nulle part ---------

test("PV-7 : ORDERED n'envoie RIEN — aucun appel externe nulle part", () => {
  // C'est le malentendu le plus coûteux que ce lot puisse produire. On le ferme
  // structurellement : ni le SQL, ni le service, ni les actions, ni l'écran ne
  // contiennent le moindre chemin d'envoi.
  const surfaces: [string, string][] = [
    ["migrations", sqlIdentifiers(ALL_PV7)],
    ["service", tsCode(SERVICE)],
    ["actions", tsCode(ACTIONS)],
    ["éditeur", tsCode(EDITOR)],
    ["bloc affaire", tsCode(PANEL)],
  ];
  for (const [name, code] of surfaces) {
    for (const forbidden of ["n8n", "webhook", "sendMail", "nodemailer", "smtp", "fetch("]) {
      assert.ok(!code.includes(forbidden), `${name} : chemin d'envoi (${forbidden})`);
    }
  }
  // Et l'écran le DIT à l'endroit du clic, pas dans une note de bas de page.
  assert.match(tsCode(EDITOR), /Hermès[\s\S]{0,40}n’envoie rien/);
  assert.match(tsCode(ACTIONS), /Hermès n’a rien envoyé/);
});

test("PV-7 : déclarer une commande passée exige une confirmation explicite", () => {
  assert.match(tsCode(ACTIONS), /formData\.get\("confirm"\) !== "COMMANDER"/);
  assert.match(tsCode(EDITOR), /value="COMMANDER"/);
});

// --- 2. Aucun total ne vient du navigateur ----------------------------------

test("PV-7 : le total de ligne est une COLONNE GÉNÉRÉE, sans point d'écriture", () => {
  assert.match(
    M3,
    /line_total_ht_eur\s+numeric\(14,2\) not null\s*\n\s*generated always as \(round\(quantity \* unit_price_ht_eur, 2\)\) stored/,
  );
  // Aucune façade n'accepte de total, et aucun formulaire n'en porte le champ.
  for (const [name, code] of [["actions", tsCode(ACTIONS)], ["éditeur", tsCode(EDITOR)]] as const) {
    assert.ok(!/name="(line_)?total/i.test(code), `${name} : champ de total`);
  }
  const sig = sqlIdentifiers(ALL_PV7).match(/create or replace function public\.[a-z_]+\([^)]*\)/g) ?? [];
  for (const s of sig) {
    assert.ok(!/p_(total|montant|amount)/i.test(s), `façade acceptant un total : ${s.slice(0, 70)}`);
  }
});

test("PV-7 : la TVA de commande est arrondie PAR TAUX, comme en PV-5", () => {
  assert.match(M3, /group by vat_rate_pct/);
  assert.match(M3, /round\(base \* rate \/ 100, 2\)/);
});

// --- 3. Le prix de vente n'est jamais écrasé par le prix d'achat ------------

test("PV-7 : aucune fonction du lot n'écrit dans pv_quote_lines ni pv_quotes", () => {
  const code = sqlIdentifiers(ALL_PV7);
  for (const t of ["pv_quote_lines", "pv_quotes"]) {
    assert.ok(!new RegExp(`(insert into|update)\\s+hermes_os\\.${t}`).test(code),
      `écriture sur ${t} : le prix de vente doit rester intact`);
  }
  // Elles sont bien LUES — c'est la porte de commande et le calcul de marge.
  assert.ok(code.includes("from hermes_os.pv_quotes"));
});

test("PV-7 : la marge n'est PAS affichée quand elle n'est pas fiable", () => {
  const base: PvMaterialCosts = {
    plannedCostHtEur: 3480,
    orderedCostHtEur: 3648,
    receivedCostHtEur: 3648,
    quoteTotalHtEur: 8000,
    materialsWithoutCost: 0,
    requirementsPendingConfirmation: 0,
    marginReliable: true,
    indicativeMaterialMarginHtEur: 4520,
  };
  assert.match(pvMarginSentence(base), /MARGE MATÉRIELLE INDICATIVE/);
  assert.match(pvMarginSentence(base), /main-d’œuvre non déduite/);

  assert.match(
    pvMarginSentence({ ...base, quoteTotalHtEur: null, marginReliable: false }),
    /^Marge non calculable : aucun devis accepté/,
  );
  assert.match(
    pvMarginSentence({ ...base, marginReliable: false, materialsWithoutCost: 2 }),
    /^Marge non calculable : 2 article\(s\) sans coût connu\.$/,
  );
  assert.match(
    pvMarginSentence({
      ...base,
      marginReliable: false,
      materialsWithoutCost: 1,
      requirementsPendingConfirmation: 3,
    }),
    /1 article\(s\) sans coût connu et 3 besoin\(s\) non confirmé\(s\)/,
  );

  // Et l'écran ne rend le MONTANT que si `marginReliable` est vrai.
  assert.match(tsCode(PANEL), /costs\.marginReliable && costs\.indicativeMaterialMarginHtEur !== null/);
});

// --- 4. Structuré vs texte libre --------------------------------------------

test("PV-7 : la dérivation depuis le devis n'utilise QUE des correspondances exactes", () => {
  const code = sqlIdentifiers(M2);
  // Aucune approximation : ni similarité, ni distance, ni recherche floue.
  for (const fuzzy of ["similarity", "levenshtein", "soundex", "metaphone", "ilike", "%%", "to_tsvector"]) {
    assert.ok(!code.includes(fuzzy), `correspondance approximative : ${fuzzy}`);
  }
  assert.match(M2, /lower\(btrim\(c\.designation\)\) = lower\(btrim\(l\.designation\)\)/);
  // Ce qui n'est pas reconnu devient un besoin à confirmer, pas une devinette.
  assert.match(M2, /v_material is null,\s*\n\s*case when v_material is null/);
});

test("PV-7 : seuls trois écarts de visite ont une traduction matérielle", () => {
  // Les autres (surface, azimut, amiante…) n'ont pas de conséquence univoque :
  // les traduire quand même serait exactement la devinette qu'on s'interdit.
  const codes = [...M2.matchAll(/'(CABLE_ROUTE_ISSUE|ELECTRICAL_PANEL_ISSUE|HEIGHT_ACCESS_NOTICE)'/g)];
  assert.ok(codes.length >= 3);
  for (const notTranslated of ["ROOF_AREA_MISMATCH", "AZIMUTH_MISMATCH", "ASBESTOS_SUSPICION"]) {
    assert.ok(!M2.includes(notTranslated), `écart traduit sans justification : ${notTranslated}`);
  }
});

test("PV-7 : un besoin issu de texte libre ne peut pas rendre une affaire prête", () => {
  assert.match(M4, /v_pending_confirmation > 0/);
  // Et la lecture de `needs_confirmation` ignore ceux qui ont été confirmés.
  assert.match(M4, /r\.needs_confirmation and r\.confirmed_at is null/);
});

// --- 5. Écart matériel : trois grandeurs, jamais confondues -----------------

test("PV-7 : un BROUILLON de commande ne compte pas comme commandé", () => {
  assert.match(
    M4,
    /case when o\.status in \('ORDERED','PARTIALLY_RECEIVED','RECEIVED'\)\s*\n\s*then l\.quantity else 0 end/,
  );
});

test("PV-7 : les 7 statuts d'écart ont un libellé, et la priorité est documentée", () => {
  for (const s of PV_MATERIAL_GAP_STATUSES) {
    assert.ok(PV_MATERIAL_GAP_LABELS[s], `statut d'écart sans libellé : ${s}`);
    assert.ok(M4.includes(`'${s}'`), `statut absent du moteur SQL : ${s}`);
    assert.ok(["ok", "warn", "muted", "neutral"].includes(pvGapTone(s)));
  }
  // L'ordre de priorité est écrit dans la migration : sans lui, deux lecteurs
  // liraient deux règles.
  assert.match(M4, /PRIORITÉ|ORDRE DE PRIORITÉ/);
});

// --- 6. Machine à états et gestes humains -----------------------------------

test("PV-7 : DRAFT → RECEIVED et READY → RECEIVED sont ABSENTS", () => {
  const rows = sqlCode(M3)
    .split("\n")
    .filter((l) => /^\s*\('[A-Z_]+',\s*'[A-Z_]+'\)/.test(l));
  assert.equal(rows.length, 10, "la table de transitions doit contenir 10 chemins");
  const has = (from: string, to: string) =>
    rows.some((l) => new RegExp(`\\('${from}',\\s*'${to}'\\)`).test(l));
  assert.ok(!has("DRAFT", "RECEIVED"), "on ne reçoit pas ce qu'on n'a pas commandé");
  assert.ok(!has("DRAFT", "PARTIALLY_RECEIVED"));
  assert.ok(!has("READY", "RECEIVED"), "« prête » n'est pas « passée »");
  assert.ok(!rows.some((l) => /\('RECEIVED',/.test(l)), "RECEIVED doit être terminal");
  assert.ok(has("READY", "ORDERED"));
  assert.ok(has("ORDERED", "PARTIALLY_RECEIVED"));
});

test("PV-7 : READY et ORDERED réutilisent la garde humaine de PV-1", () => {
  assert.match(M3, /pv_human_validation_guard\(\s*\n?\s*'status', 'READY', 'approved_by', 'approved_at'\)/);
  assert.match(M3, /pv_human_validation_guard\(\s*\n?\s*'status', 'ORDERED', 'ordered_by', 'ordered_at'\)/);
  // Aucun moteur d'autorisation nouveau, et pas de sur-restriction admin.
  assert.ok(!ALL_PV7.includes("create or replace function hermes_os.pv_human_validation_guard"));
  assert.ok(!ALL_PV7.includes("pv_guard_admin()"), "commander ne doit pas exiger tenant.admin");
  assert.ok(ALL_PV7.includes("hermes_os.pv_guard()"));
});

test("PV-7 : la réception est un geste humain, avec sa garde", () => {
  assert.match(M3, /PV_RECEPTION_NON_HUMAINE/);
  assert.match(M3, /PV_RECEPTION_USURPEE/);
  assert.match(M3, /new\.received_by is distinct from v_uid/);
});

test("PV-7 : le correctif du gel de ligne exclut la colonne GÉNÉRÉE", () => {
  // Sans cela, `line_total_ht_eur` vaut NULL dans NEW (BEFORE UPDATE) et la
  // comparaison est TOUJOURS différente : toute réception devient impossible.
  assert.match(M3B, /- 'line_total_ht_eur'/);
  assert.match(M3B, /GENERATED ALWAYS AS|colonne `GENERATED/);
  // Le gel commercial lui-même reste : quantité et prix sont toujours comparés.
  assert.ok(!M3B.includes("- 'quantity'"));
  assert.ok(!M3B.includes("- 'unit_price_ht_eur'"));
});

// --- 7. La porte de commande ------------------------------------------------

test("PV-7 : on ne commande pas avant que le client ait accepté", () => {
  for (const code of ["QUOTE_NOT_ACCEPTED", "SITE_SURVEY_NOT_VALIDATED",
                      "SITE_SURVEY_BLOCKING", "SURVEY_FINDINGS_UNRESOLVED"]) {
    assert.ok(M4.includes(code), `blocage absent de la porte : ${code}`);
    assert.ok(PV_PURCHASE_BLOCKER_LABELS[code], `blocage sans libellé : ${code}`);
  }
  // La porte réutilise celle de PV-6 plutôt que d'en refaire une.
  assert.match(M4, /hermes_os\.pv_survey_gate\(o\.tenant_id, o\.site_id\)/);
  // Un BROUILLON reste libre : la garde porte sur READY et ORDERED.
  assert.match(M5, /set_pv_purchase_order_ready[\s\S]{0,2000}pv_purchase_blockers/);
  assert.match(M5, /mark_pv_purchase_order_ordered[\s\S]{0,2000}pv_purchase_blockers/);
  assert.ok(!/create_pv_purchase_order[\s\S]{0,1500}pv_purchase_blockers/.test(M5));
});

// --- 8. Tarifs datés ---------------------------------------------------------

test("PV-7 : un tarif fournisseur est DATÉ et son historique survit", () => {
  assert.match(M1, /valid_from\s+date not null/);
  assert.match(M1, /valid_until\s+date/);
  assert.match(M1, /unique \(tenant_id, material_id, supplier_id, valid_from\)/);
  // Enregistrer un nouveau prix CLÔT la période précédente, ne l'écrase pas.
  assert.match(M4, /set valid_until = v_from - 1/);
  assert.ok(!/delete from hermes_os\.pv_supplier_prices/.test(sqlIdentifiers(ALL_PV7)));
});

// --- 9. Libellés, pas seulement des couleurs --------------------------------

test("PV-7 : tout vocabulaire affiché a un libellé français", () => {
  for (const c of PV_MATERIAL_CATEGORIES) {
    assert.ok(PV_MATERIAL_CATEGORY_LABELS[c], `catégorie sans libellé : ${c}`);
    assert.ok(M1.includes(`'${c}'`), `catégorie absente du CHECK SQL : ${c}`);
  }
  for (const s of PV_PURCHASE_ORDER_STATUSES) {
    assert.ok(PV_PURCHASE_ORDER_STATUS_LABELS[s], `statut sans libellé : ${s}`);
    assert.ok(["ok", "warn", "muted", "neutral"].includes(pvOrderTone(s)));
  }
  for (const c of PV_RECEIPT_CONDITIONS) assert.ok(PV_RECEIPT_CONDITION_LABELS[c]);
  for (const o of PV_REQUIREMENT_ORIGINS) assert.ok(PV_REQUIREMENT_ORIGIN_LABELS[o]);
  for (const r of ["NOT_READY", "PARTIAL", "READY"]) {
    assert.ok(PV_MATERIAL_READINESS_LABELS[r]);
    assert.ok(["ok", "warn", "muted", "neutral"].includes(pvMaterialReadinessTone(r)));
  }
  for (const u of PV_MATERIAL_UNITS) assert.ok(M1.includes(`'${u}'`), `unité absente du SQL : ${u}`);
});

test("PV-7 : le tableau d'écart rend un LIBELLÉ, jamais un code", () => {
  const code = tsCode(PANEL);
  assert.match(code, /PV_MATERIAL_GAP_LABELS\[b\.status\]/);
  assert.match(code, /Élément[\s\S]{0,500}Besoin[\s\S]{0,400}Commandé[\s\S]{0,400}Reçu[\s\S]{0,400}Écart[\s\S]{0,400}Statut/);
});

test("PV-7 : les quantités sont lisibles, avec leur unité", () => {
  assert.equal(pvQty(24, "U"), "24");
  assert.equal(pvQty(80, "ML"), "80 mètre linéaire");
  assert.equal(pvQty(1.5, "M2"), "1.5 m²");
  assert.equal(pvQty(1, "FORFAIT"), "1 forfait");
});

test("PV-7 : les classes CSS du lot sont toutes préfixées `pv-`", () => {
  const block = CSS.slice(CSS.indexOf("/* --- PV-7"));
  assert.ok(block.length > 0, "bloc CSS PV-7 absent");
  for (const m of block.matchAll(/^\.([a-z][\w-]*)/gm)) {
    assert.ok(m[1].startsWith("pv-"), `classe non préfixée : .${m[1]}`);
  }
});

// --- 10. Périmètre, sécurité, isolation -------------------------------------

test("PV-7 : aucun tenant_id n'est atteignable depuis le navigateur", () => {
  for (const [name, src] of [["éditeur", EDITOR], ["bloc", PANEL], ["route", ROUTE]] as const) {
    const code = tsCode(src);
    assert.ok(!/name="tenant_?[iI]d"/.test(code), `${name} : champ tenant_id`);
    assert.ok(!/searchParams[\s\S]{0,60}tenant/i.test(code), `${name} : tenant en paramètre d'URL`);
    assert.ok(!/tenant_id\s*[:=]/.test(code), `${name} : tenant_id passé en argument`);
  }
  const publicFacades = [...sqlCode(M4).split(/create or replace function /),
                         ...sqlCode(M5).split(/create or replace function /)]
    .filter((c) => c.startsWith("public."));
  assert.ok(publicFacades.length >= 20);
  for (const f of publicFacades) {
    const signature = f.slice(0, f.indexOf(")") + 1);
    assert.ok(!/p_tenant|tenant_id/.test(signature), `façade avec tenant : ${signature.slice(0, 60)}`);
  }
});

test("PV-7 : FK COMPOSITES sur tous les rattachements inter-tables", () => {
  // Sans elles, une commande pourrait citer l'article, le fournisseur ou le
  // devis d'un AUTRE tenant — la faille que PV-1 avait fermée structurellement.
  for (const fk of [
    "pv_material_preferred_supplier_fk",
    "pv_supplier_prices_material_fk",
    "pv_supplier_prices_supplier_fk",
    "pv_material_req_prospect_fk",
    "pv_material_req_site_fk",
    "pv_material_req_quote_fk",
    "pv_material_req_survey_fk",
    "pv_material_req_material_fk",
    "pv_purchase_orders_supplier_fk",
    "pv_purchase_orders_site_fk",
    "pv_po_lines_order_fk",
    "pv_po_lines_material_fk",
    "pv_receipts_line_fk",
  ]) {
    assert.ok(ALL_PV7.includes(fk), `FK composite manquante : ${fk}`);
  }
  const composites = [...ALL_PV7.matchAll(/foreign key \(tenant_id, \w+\)/g)];
  assert.ok(composites.length >= 13, `seulement ${composites.length} FK composites`);
});

test("PV-7 : toutes les tables du lot sont en deny-all", () => {
  for (const t of [
    "pv_material_catalog", "pv_suppliers", "pv_supplier_prices",
    "pv_material_requirements", "pv_purchase_orders", "pv_purchase_order_lines",
    "pv_purchase_receipts", "pv_purchase_order_transitions", "pv_purchase_order_sequences",
  ]) {
    assert.ok(
      ALL_PV7.includes(`alter table hermes_os.${t} enable row level security`),
      `RLS non activée : ${t}`,
    );
    assert.ok(
      ALL_PV7.includes(`revoke all on table hermes_os.${t} from anon, authenticated`),
      `GRANT non révoqué : ${t}`,
    );
  }
  assert.ok(!/create policy/i.test(sqlIdentifiers(ALL_PV7)), "aucune politique RLS attendue");
});

test("PV-7 : rien du périmètre exclu n'est introduit", () => {
  const forbidden = [
    "signature", "docusign", "yousign", "acompte", "stripe", "paiement",
    "facture_client", "consuel", "enedis", "planning", "equipe",
    "n8n", "webhook", "cron", "scheduler", "pg_cron", "mise_en_service", "sav",
  ];
  const sql = sqlIdentifiers(ALL_PV7).toLowerCase();
  for (const f of forbidden) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(sql), `hors périmètre : ${f}`);
  }
  // Aucune capacité d'agent créée : PV_ACTIONS_ENABLED reste NO.
  assert.ok(!ALL_PV7.includes("agent_action_catalog"));
  assert.ok(!ALL_PV7.includes("resolver_runtime_config"));
  assert.ok(!ALL_PV7.includes("sw15_policies"));
});

test("PV-7 : aucun nouveau bucket, aucune suppression directe dans storage", () => {
  for (const [name, sql] of [["migrations", ALL_PV7], ["rollback", ROLLBACK]] as const) {
    const code = sqlIdentifiers(sql);
    assert.ok(!/insert\s+into\s+storage\.buckets/i.test(code), `${name} : nouveau bucket`);
    assert.ok(!/delete\s+from\s+storage\./i.test(code), `${name} : suppression storage`);
    assert.ok(!/create\s+policy[\s\S]{0,120}storage\.objects/i.test(code), `${name} : politique storage`);
  }
});

test("PV-7 : l'audit passe par entity_audit_log, sans journal parallèle", () => {
  assert.ok(sqlIdentifiers(ALL_PV7).includes("_pv_audit"));
  // On inspecte les NOMS de tables créées, pas le texte alentour : chercher le
  // mot « log » à 80 caractères d'un `create table` accusait
  // `pv_material_catalog` (cata-LOG) et laissait passer un vrai journal placé
  // plus loin. Ici on segmente le nom, donc « catalog » ne peut plus mentir.
  const created = [...sqlIdentifiers(ALL_PV7)
    .matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?(\w+)/gi)]
    .map((m) => m[1].toLowerCase());
  assert.ok(created.length >= 9, "aucune table PV-7 détectée : l'analyse a glissé");
  for (const t of created) {
    assert.ok(
      !/(^|_)(audit|journal|log|logs|history|historique|trace|traces)(_|$)/.test(t),
      `journal d'audit parallèle créé par PV-7 : ${t}`,
    );
  }
  // Les cinq entités qui comptent sont tracées.
  for (const e of ["pv_material_catalog", "pv_suppliers", "pv_supplier_prices",
                   "pv_material_requirements", "pv_purchase_orders"]) {
    assert.ok(ALL_PV7.includes(`'${e}'`), `entité non auditée : ${e}`);
  }
});

// --- 11. Rollback et gouvernance --------------------------------------------

test("PV-7 : le rollback dit ce qu'il détruit et restaure AVANT de casser", () => {
  assert.match(ROLLBACK, /DESTRUCTIF/);
  assert.match(ROLLBACK, /historique des prix d'achat/);
  assert.match(ROLLBACK, /n'a jamais envoyé\s*\n?-- de commande réelle|PV-7 n'a jamais envoyé/);
  // L'ordre compte : restaurer get_pv_deal après avoir supprimé
  // pv_material_readiness laisserait toute lecture d'affaire en échec.
  assert.ok(
    ROLLBACK.indexOf("create or replace function public.get_pv_deal") <
      ROLLBACK.indexOf("drop function if exists hermes_os.pv_material_readiness"),
  );
  // Et il ne doit PAS toucher à PV-6.
  assert.ok(!ROLLBACK.includes("drop table if exists hermes_os.pv_site_surveys"));
  assert.ok(!ROLLBACK.includes("drop function if exists hermes_os.pv_survey_gate"));
  assert.match(ROLLBACK, /'survey_gate', v_gate/, "la version restaurée doit rester celle de PV-6");
});

test("PV-7 : les migrations respectent la convention de nommage du dépôt", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.includes("pv7"));
  assert.equal(files.length, 7, "5 migrations + 1 correctif + 1 rollback");
  for (const f of files) assert.match(f, /^\d{8}_pv7_[0-9]b?_[a-z0-9_]+\.sql$/);
  assert.ok(files.some((f) => f.endsWith("_9_rollback.sql")));
});

// --- 12. Couche applicative --------------------------------------------------

test("PV-7 : le service ne contient aucune règle métier d'écart ni de marge", () => {
  const code = tsCode(SERVICE);
  // Interdire la simple PRÉSENCE de ces codes serait faux : `?? "NOT_ORDERED"`
  // est un repli de désérialisation quand la clé RPC manque, pas une règle.
  // Ce qui est interdit, c'est de les COMPARER ou de les BRANCHER : dès que le
  // service teste un statut d'écart, il recommence à décider ce que la base
  // décide déjà, et les deux versions divergeront un jour.
  for (const c of [...PV_MATERIAL_GAP_STATUSES, "NOT_READY", "PARTIAL", "READY"]) {
    for (const m of code.matchAll(new RegExp(`(.{0,16})"${c}"`, "g"))) {
      assert.match(
        m[1],
        /\?\?\s*$/,
        `code d'écart utilisé autrement qu'en repli dans le service : ...${m[0]}`,
      );
    }
  }
  // La fiabilité de la marge est décidée par `pv_material_costs`, pas ici : le
  // service ne fait que recopier le booléen renvoyé.
  assert.ok(!/marginReliable\s*[:=][^,\n]*(&&|\|\||[<>]|===|!==)/.test(code),
    "la fiabilité de la marge est recalculée dans le service");
  assert.match(code, /marginReliable:\s*Boolean\(costs\.margin_reliable\)/);
  assert.ok(code.includes("get_pv_material_plan"));
  assert.ok(code.includes("record_pv_purchase_receipt"));
});

test("PV-7 : la commande reste dans le module solar.studies, sans menu parallèle", () => {
  assert.match(ROUTE, /requireRoute\("\/etudes"\)/);
  assert.equal(routeModule("/etudes/commandes/abc"), "solar.studies");
  assert.ok(isRouteAllowed("/etudes/commandes/abc", grantedModules(["quotes", "worksites"])));
  assert.equal(
    isRouteAllowed("/etudes/commandes/abc", grantedModules(["photo_studio", "leads"])),
    false,
    "un tenant photo ne doit pas atteindre une commande PV",
  );
  const files = readdirSync(url("../app/(dashboard)/"));
  assert.ok(!files.includes("commandes"), "aucune route de commande hors du module études");
});

test("PV-7 : la vue Affaire consomme le plan sans le recalculer", () => {
  const code = tsCode(DEAL_PAGE);
  assert.match(code, /getPvMaterialPlan\(prospectId\)/);
  assert.match(code, /<PvMaterialPanel/);
  assert.ok(!code.includes("pv_material_balance"), "la page ne réimplémente pas le moteur");
});

test("PV-7 : l'écran lit les suites possibles en base, sans redéclarer la machine", () => {
  const code = tsCode(EDITOR);
  assert.match(code, /detail\.nextStatuses/);
  assert.ok(!/DRAFT['"]\s*:\s*\[/.test(code));
});
