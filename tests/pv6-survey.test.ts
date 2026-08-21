import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isRouteAllowed, routeModule } from "@/lib/verticals/navigation";
import { grantedModules } from "@/lib/verticals/modules";
import {
  PV_ADVISORIES,
  PV_ADVISORY_LABELS,
  PV_REQUIREMENT_LABELS,
  resolvePvReadiness,
  type PvReadinessInput,
} from "@/lib/pv/readiness";
import {
  pvAngleDelta,
  pvSurveyComparison,
  pvSurveyStatusTone,
  pvSurveyTone,
  pvSurveyValue,
  PV_SURVEY_FINDING_LABELS,
  PV_SURVEY_RESOLUTION_LABELS,
  PV_SURVEY_SEVERITY_LABELS,
  PV_SURVEY_STATUS_LABELS,
} from "@/lib/pv/surveyLabels";
import {
  PV_SURVEY_FINDING_CODES,
  PV_SURVEY_RESOLUTIONS,
  PV_SURVEY_ROOF_CONDITIONS,
  PV_SURVEY_ROOF_TYPES,
  PV_SURVEY_SHADING_LEVELS,
  type PvSiteSurvey,
} from "@/types/pv";

/**
 * LOT PV-6 — garde-fous de CONTRAT sur la visite technique.
 *
 * Ils complètent `db/tests/pv6_site_survey.test.sql`, qui prouve le COMPORTEMENT
 * en base. Ici on prouve que ce comportement ne peut pas être perdu par une
 * réécriture distraite : une mesure qui écraserait le site sans geste humain, un
 * statut affiché par la seule couleur, un `tenant_id` glissé dans un formulaire,
 * une signature ou un paiement introduits hors périmètre.
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
 * SQL sans commentaires NI littéraux : un mot français dans un `comment on`
 * (« taux stocké tel quel ») ne doit pas faire échouer une recherche
 * d'identifiant interdit.
 *
 * Les commentaires BLOC sont retirés d'abord, et ce n'est pas cosmétique : une
 * apostrophe française isolée dans un commentaire bloc (« ce qu'on ne sait
 * pas ») désynchronise le détecteur de littéraux, qui avale alors tout le reste
 * du fichier — et le test passe en ne regardant plus rien.
 */
const sqlIdentifiers = (sql: string): string =>
  sqlCode(sql.replace(/\/\*[\s\S]*?\*\//g, " ")).replace(/'(?:''|[^'])*'/g, "''");

const MIGRATIONS_DIR = url("../db/migrations/");
const M1 = read("../db/migrations/20260823_pv6_1_survey_schema.sql");
const M2 = read("../db/migrations/20260823_pv6_2_state_machine.sql");
const M3 = read("../db/migrations/20260823_pv6_3_findings_engine.sql");
const M3B = read("../db/migrations/20260823_pv6_3b_gate_blocking_priority.sql");
const M4 = read("../db/migrations/20260823_pv6_4_facades.sql");
const ROLLBACK = read("../db/migrations/20260823_pv6_9_rollback.sql");
const ALL_PV6 = [M1, M2, M3, M3B, M4].map(sqlCode).join("\n");

const SERVICE = read("../services/hermes/pv.ts");
const ACTIONS = read("../app/actions/pv.ts");
const PANEL = read("../components/dashboard/PvSurveysPanel.tsx");
const EDITOR = read("../components/dashboard/PvSurveyEditor.tsx");
const ROUTE = read("../app/(dashboard)/etudes/visites/[surveyId]/page.tsx");
const DEAL_PAGE = read("../app/(dashboard)/etudes/affaires/[prospectId]/page.tsx");
const CSS = read("../app/globals.css");

// --- 1. Les mesures sont des colonnes, pas un blob ---------------------------

test("PV-6 : chaque mesure comparée est une COLONNE typée, pas une clé JSON", () => {
  for (const col of [
    "roof_area_total_measured_m2",
    "roof_area_usable_measured_m2",
    "azimuth_measured_deg",
    "tilt_measured_deg",
    "roof_type_measured",
    "roof_condition_measured",
    "shading_measured",
    "access_difficulty_measured",
  ]) {
    assert.ok(M1.includes(col), `colonne typée absente : ${col}`);
  }
  // Une seule colonne jsonb, et elle s'appelle `metadata` : le complément, pas
  // la source. Si une mesure y migrait, la comparaison cesserait d'être exacte.
  const jsonbCols = sqlCode(M1).match(/^\s*(\w+)\s+jsonb/gm) ?? [];
  assert.equal(jsonbCols.length, 1);
  assert.match(jsonbCols[0], /metadata/);
});

test("PV-6 : les vocabulaires mesurés sont ALIGNÉS sur ceux de pv_sites", () => {
  // Deux échelles différentes pour la même grandeur rendraient la comparaison
  // approximative. Les listes TS et les CHECK SQL doivent coïncider.
  for (const v of PV_SURVEY_ROOF_TYPES) assert.ok(M1.includes(`'${v}'`), `roof_type ${v}`);
  for (const v of PV_SURVEY_ROOF_CONDITIONS) assert.ok(M1.includes(`'${v}'`), `roof_condition ${v}`);
  for (const v of PV_SURVEY_SHADING_LEVELS) assert.ok(M1.includes(`'${v}'`), `shading ${v}`);
});

test("PV-6 : les 14 codes d'écart de la base ont tous un libellé français", () => {
  for (const code of PV_SURVEY_FINDING_CODES) {
    assert.ok(M1.includes(`'${code}'`), `code absent de la contrainte SQL : ${code}`);
    assert.ok(PV_SURVEY_FINDING_LABELS[code], `libellé manquant : ${code}`);
  }
  for (const res of PV_SURVEY_RESOLUTIONS) {
    assert.ok(M1.includes(`'${res}'`), `résolution absente du SQL : ${res}`);
    assert.ok(PV_SURVEY_RESOLUTION_LABELS[res], `libellé manquant : ${res}`);
  }
});

// --- 2. Seuils centralisés ---------------------------------------------------

test("PV-6 : aucun seuil de tolérance en dur dans l'UI ni dans les actions", () => {
  // Les seuils vivent dans `pv_survey_thresholds`. Un nombre magique réintroduit
  // à l'écran divergerait silencieusement de ce que la base applique.
  for (const [name, src] of [["éditeur", EDITOR], ["bloc affaire", PANEL], ["actions", ACTIONS]] as const) {
    const code = tsCode(src);
    for (const token of ["AZIMUTH_REVIEW", "TILT_REVIEW", "USABLE_AREA_REVIEW", "BLOCKING_PCT", "BLOCKING_DEG"]) {
      assert.ok(!code.includes(token), `${name} : seuil recopié (${token})`);
    }
  }
  for (const code of [
    "AZIMUTH_REVIEW_DEG", "AZIMUTH_BLOCKING_DEG", "TILT_REVIEW_DEG", "TILT_BLOCKING_DEG",
    "USABLE_AREA_REVIEW_PCT", "USABLE_AREA_BLOCKING_PCT", "ROOF_AREA_REVIEW_PCT",
    "HEIGHT_INFO_M", "CABLE_DISTANCE_REVIEW_M",
  ]) {
    assert.ok(M1.includes(code), `seuil non semé : ${code}`);
  }
});

// --- 3. La machine à états est en données ------------------------------------

test("PV-6 : PLANNED -> VALIDATED et BLOCKING -> VALIDATED sont ABSENTS", () => {
  const rows = sqlCode(M2)
    .split("\n")
    .filter((l) => /^\s*\('[A-Z_]+',\s*'[A-Z_]+'\)/.test(l));
  assert.equal(rows.length, 15, "la table de transitions doit contenir 15 chemins");
  const has = (from: string, to: string) =>
    rows.some((l) => new RegExp(`\\('${from}',\\s*'${to}'\\)`).test(l));
  assert.ok(!has("PLANNED", "VALIDATED"), "on ne valide pas une visite non faite");
  assert.ok(!has("BLOCKING", "VALIDATED"), "un blocage ne se lève pas par un statut");
  assert.ok(!rows.some((l) => /\('VALIDATED',/.test(l)), "VALIDATED doit être terminal");
  assert.ok(has("DONE", "VALIDATED"));
  assert.ok(has("BLOCKING", "IN_PROGRESS"), "un blocage doit pouvoir se lever par le terrain");
});

test("PV-6 : la validation réutilise la garde humaine existante, sans en créer une", () => {
  assert.match(M2, /pv_human_validation_guard\(\s*\n?\s*'status',\s*'VALIDATED',\s*'validated_by',\s*'validated_at'\)/);
  assert.ok(!sqlIdentifiers(ALL_PV6).includes("create or replace function hermes_os.pv_human_validation_guard"));
  // Aucun système de rôles parallèle : la visite passe par `pv_guard()`.
  assert.ok(ALL_PV6.includes("hermes_os.pv_guard()"));
  assert.ok(!ALL_PV6.includes("pv_guard_admin()"), "la visite ne doit pas exiger tenant.admin");
});

// --- 4. Aucune écriture silencieuse sur le site ------------------------------

test("PV-6 : seul `apply_pv_survey_measurement` écrit dans pv_sites", () => {
  const writes = sqlIdentifiers(ALL_PV6)
    .split(/\bcreate or replace function\b/)
    .filter((chunk) => /update\s+hermes_os\.pv_sites/.test(chunk));
  assert.equal(writes.length, 1, "une seule fonction PV-6 doit écrire dans pv_sites");
  assert.match(writes[0], /apply_pv_survey_measurement/);
  // Et aucun déclencheur ne le fait à sa place.
  assert.ok(!/create trigger[\s\S]{0,200}pv_sites/.test(sqlIdentifiers(ALL_PV6)));
});

test("PV-6 : appliquer une mesure exige une confirmation explicite", () => {
  assert.match(tsCode(ACTIONS), /formData\.get\("confirm"\) !== "APPLIQUER"/);
  assert.match(tsCode(ACTIONS), /formData\.get\("confirm"\) !== "VALIDER"/);
  assert.match(tsCode(EDITOR), /value="APPLIQUER"/);
  assert.match(tsCode(EDITOR), /value="VALIDER"/);
});

test("PV-6 : le moteur d'écarts est déterministe — aucun appel externe, aucune IA", () => {
  for (const forbidden of ["http", "openai", "anthropic", "pg_background", "net.", "random()"]) {
    assert.ok(!sqlIdentifiers(M3).includes(forbidden), `appel non déterministe : ${forbidden}`);
  }
  // La régénération préserve la décision humaine.
  assert.match(M3, /do update set[\s\S]{0,400}updated_at = now\(\)/);
  assert.ok(!/do update set[\s\S]{0,400}resolution\s*=/.test(sqlCode(M3)));
  assert.match(M3, /and f\.resolution is null/, "seuls les écarts NON résolus disparaissent");
});

// --- 5. Impact devis ---------------------------------------------------------

test("PV-6 : la porte de devis a UNE seule source, étendue et non dupliquée", () => {
  assert.match(M4, /create or replace function hermes_os\.pv_quote_blockers/);
  for (const code of ["SITE_SURVEY_REQUIRED", "SITE_SURVEY_BLOCKING", "SITE_SURVEY_NOT_VALIDATED"]) {
    assert.ok(M4.includes(code), `code absent de la porte : ${code}`);
    assert.ok(tsCode(ACTIONS).includes(code), `message absent des actions : ${code}`);
  }
  // La création d'un DRAFT reste possible : PV-6 ne verrouille que READY et au-delà.
  assert.ok(!M4.includes("create or replace function public.create_pv_quote"));
});

test("PV-6 : un blocage prime sur une validation antérieure", () => {
  // Le correctif 3b : sans lui, une visite validée masquerait une visite
  // ultérieure ayant constaté un toit devenu impraticable.
  const body = sqlCode(M3B);
  assert.ok(body.indexOf("'BLOCKING'") < body.indexOf("return 'OK'"));
});

// --- 6. Readiness : deux niveaux, sans casser l'existant ---------------------

const READY_INPUT: PvReadinessInput = {
  prospect: { status: "STUDY_DELIVERED", optedOut: false },
  site: {
    addressLine1: "12 rue du Zénith",
    postalCode: "13100",
    city: "Aix",
    roofAreaUsableM2: 80,
    azimuthDeg: 180,
    tiltDeg: 30,
  },
  consumption: { annualConsumptionKwh: 9000, verificationStatus: "VERIFIED" },
  verifiedBill: { consumptionKwh: 9000 },
  retainedStudy: { status: "VALIDATED" },
  latestStudy: { status: "VALIDATED" },
  retainedEconomics: { status: "VERIFIED" },
  hasAnyEconomics: true,
};

test("PV-6 : sans visite, le dossier reste PRÊT mais porte un SIGNALEMENT", () => {
  const r = resolvePvReadiness({ ...READY_INPUT, surveyGate: "NONE" });
  assert.equal(r.state, "READY_FOR_OFFER", "un dossier engagé ne casse pas");
  assert.deepEqual(r.missingRequirements, []);
  assert.ok(r.advisories.includes("SITE_NOT_SURVEYED"));
  assert.equal(r.canEmitFinalQuote, false, "mais aucun devis FINAL sans preuve terrain");
});

test("PV-6 : une visite non validée est un signalement, pas un blocage", () => {
  const r = resolvePvReadiness({ ...READY_INPUT, surveyGate: "NOT_VALIDATED" });
  assert.equal(r.state, "READY_FOR_OFFER");
  assert.ok(r.advisories.includes("SITE_SURVEY_NOT_VALIDATED"));
  assert.equal(r.canEmitFinalQuote, false);
});

test("PV-6 : une visite BLOQUANTE bloque le dossier, avec sa raison", () => {
  const r = resolvePvReadiness({ ...READY_INPUT, surveyGate: "BLOCKING" });
  assert.equal(r.state, "BLOCKED");
  assert.deepEqual(r.missingRequirements, ["SITE_SURVEY_BLOCKING"]);
  assert.ok(PV_REQUIREMENT_LABELS.SITE_SURVEY_BLOCKING);
  assert.equal(r.canEmitFinalQuote, false);
});

test("PV-6 : une visite validée ouvre le devis FINAL", () => {
  const r = resolvePvReadiness({ ...READY_INPUT, surveyGate: "OK" });
  assert.equal(r.state, "READY_FOR_OFFER");
  assert.deepEqual(r.advisories, []);
  assert.equal(r.canEmitFinalQuote, true);
});

test("PV-6 : l'absence de `surveyGate` ne change rien aux appelants existants", () => {
  // Rétro-compatibilité : les écrans PV-4/PV-5 qui ne passent pas la porte
  // continuent d'obtenir exactement le verdict qu'ils obtenaient.
  const r = resolvePvReadiness(READY_INPUT);
  assert.equal(r.state, "READY_FOR_OFFER");
  assert.deepEqual(r.missingRequirements, []);
});

test("PV-6 : chaque signalement a un libellé", () => {
  for (const a of PV_ADVISORIES) assert.ok(PV_ADVISORY_LABELS[a], `libellé manquant : ${a}`);
});

// --- 7. La vue comparative -------------------------------------------------

const SURVEY: PvSiteSurvey = {
  id: "v1", prospectId: "p1", siteId: "s1", technicianUserId: null,
  scheduledOn: "2026-08-23", startedAt: null, completedAt: null,
  validatedAt: null, validatedBy: null, status: "DONE",
  weatherConditions: null, roofAccess: null, accessMeans: null, siteCondition: null,
  safetyConstraints: null, observations: null, remarks: null,
  roofAreaTotalMeasuredM2: null, roofAreaUsableMeasuredM2: 70,
  azimuthMeasuredDeg: 10, tiltMeasuredDeg: 30,
  roofTypeMeasured: "PENTE", roofConditionMeasured: null,
  shadingMeasured: null, accessDifficultyMeasured: null,
  heightMeasuredM: null, ridgeLengthM: null, eaveLengthM: null, slopeLengthM: null,
  obstacles: null, asbestosSuspicion: false, asbestosNote: null,
  panelLocation: null, inverterLocation: null, batteryLocation: null,
  cableRoute: null, cableDistanceM: null, panelBoardLocation: null,
  panelBoardCondition: null, panelBoardFreeSlots: null, mainBreakerRatingA: null,
  earthingObserved: null, earthingNote: null,
  createdAt: "2026-08-23T10:00:00Z", updatedAt: "2026-08-23T10:00:00Z",
};

const SITE = {
  roofAreaTotalM2: 120, roofAreaUsableM2: 80, azimuthDeg: 350, tiltDeg: 30,
  roofType: "PENTE", roofCondition: "BON", shadingLevel: "FAIBLE", accessDifficulty: "MOYEN",
};

test("PV-6 : « non mesuré » n'est JAMAIS présenté comme « conforme »", () => {
  const rows = pvSurveyComparison(SURVEY, SITE, []);
  const total = rows.find((r) => r.field === "roof_area_total_m2");
  assert.equal(total?.status, "NON_MESURE");
  assert.equal(total?.applicable, false, "on n'applique pas une mesure absente");
  const tilt = rows.find((r) => r.field === "tilt_deg");
  assert.equal(tilt?.status, "OK", "mesuré et sans écart retenu = conforme");
});

test("PV-6 : l'écart d'azimut affiché est CIRCULAIRE (350° vs 10° = 20°)", () => {
  assert.equal(pvAngleDelta(350, 10), 20);
  assert.equal(pvAngleDelta(10, 350), 20);
  const row = pvSurveyComparison(SURVEY, SITE, []).find((r) => r.field === "azimuth_deg");
  assert.equal(row?.delta, "±20");
});

test("PV-6 : la gravité affichée vient de la BASE, jamais d'un recalcul d'écran", () => {
  const rows = pvSurveyComparison(SURVEY, SITE, [
    { code: "USABLE_AREA_MISMATCH", severity: "BLOCKING" },
  ]);
  const usable = rows.find((r) => r.field === "roof_area_usable_m2");
  assert.equal(usable?.status, "BLOCKING");
  assert.equal(usable?.findingCode, "USABLE_AREA_MISMATCH");
  assert.equal(usable?.declared, "80");
  assert.equal(usable?.measured, "70");
  // ASCII, pas le moins typographique : c'est la seule forme que WinAnsi sait
  // encoder, donc la seule qui se lise pareil à l'écran et dans le rapport PDF.
  assert.equal(usable?.delta, "-10");
});

// --- 8. L'écran : libellés, pas seulement des couleurs ----------------------

test("PV-6 : tout état affiché a un libellé textuel", () => {
  for (const s of ["PLANNED", "IN_PROGRESS", "DONE", "NEEDS_REVIEW", "VALIDATED", "BLOCKING", "CANCELLED"]) {
    assert.ok(PV_SURVEY_STATUS_LABELS[s], `statut sans libellé : ${s}`);
    assert.ok(["ok", "warn", "muted", "neutral"].includes(pvSurveyStatusTone(s)));
  }
  for (const s of ["INFO", "REVIEW", "BLOCKING", "OK", "NON_MESURE"]) {
    assert.ok(PV_SURVEY_SEVERITY_LABELS[s], `gravité sans libellé : ${s}`);
    assert.ok(["ok", "warn", "muted", "neutral"].includes(pvSurveyTone(s)));
  }
  assert.equal(pvSurveyValue("TRES_DIFFICILE"), "Très difficile");
  assert.equal(pvSurveyValue(null), null);
});

test("PV-6 : la colonne Statut du tableau rend un LIBELLÉ, pas une classe seule", () => {
  const code = tsCode(EDITOR);
  assert.match(code, /PV_SURVEY_SEVERITY_LABELS\[r\.status\]/);
  assert.match(code, /Élément[\s\S]{0,400}Déclaré[\s\S]{0,400}Mesuré[\s\S]{0,400}Écart[\s\S]{0,400}Statut/);
});

test("PV-6 : les classes CSS de la visite sont toutes préfixées `pv-`", () => {
  const block = CSS.slice(CSS.indexOf("/* --- PV-6"));
  assert.ok(block.length > 0, "bloc CSS PV-6 absent");
  for (const m of block.matchAll(/^\.([a-z][\w-]*)/gm)) {
    assert.ok(m[1].startsWith("pv-"), `classe non préfixée : .${m[1]}`);
  }
});

// --- 9. Périmètre et sécurité ----------------------------------------------

test("PV-6 : aucun tenant_id n'est atteignable depuis le navigateur", () => {
  // Ce qui est interdit, ce n'est pas de CONNAÎTRE le tenant côté serveur — la
  // route le résout par `getActiveTenantIdentity()` — c'est de l'ACCEPTER du
  // navigateur : ni champ de formulaire, ni paramètre d'URL, ni argument client.
  for (const [name, src] of [["éditeur", EDITOR], ["bloc", PANEL], ["route", ROUTE]] as const) {
    const code = tsCode(src);
    assert.ok(!/name="tenant_?[iI]d"/.test(code), `${name} : champ tenant_id`);
    assert.ok(!/searchParams[\s\S]{0,60}tenant/i.test(code), `${name} : tenant en paramètre d'URL`);
    assert.ok(!/tenant_id\s*[:=]/.test(code), `${name} : tenant_id passé en argument`);
  }
  // Les façades PUBLIQUES de PV-6 n'ont aucun paramètre de tenant. Le helper
  // interne `pv_survey_threshold(p_tenant, …)` en a un : il vit dans `hermes_os`,
  // n'est accordé à personne, et son tenant vient de `pv_guard()`.
  const publicFacades = sqlCode(M4)
    .split(/create or replace function /)
    .filter((c) => c.startsWith("public."));
  assert.ok(publicFacades.length >= 11);
  for (const f of publicFacades) {
    const signature = f.slice(0, f.indexOf(")") + 1);
    assert.ok(!/p_tenant|tenant_id/.test(signature), `façade avec tenant : ${signature.slice(0, 60)}`);
  }
});

test("PV-6 : la visite reste dans le module solar.studies, sans menu parallèle", () => {
  assert.match(ROUTE, /requireRoute\("\/etudes"\)/);
  assert.equal(routeModule("/etudes/visites/abc"), "solar.studies");
  assert.ok(isRouteAllowed("/etudes/visites/abc", grantedModules(["quotes", "worksites"])));
  assert.equal(
    isRouteAllowed("/etudes/visites/abc", grantedModules(["photo_studio", "leads"])),
    false,
    "un tenant photo ne doit pas atteindre une visite technique PV",
  );
  const files = readdirSync(url("../app/(dashboard)/"));
  assert.ok(!files.includes("visites"), "aucune route de visite hors du module études");
});

test("PV-6 : rien du périmètre exclu n'est introduit", () => {
  // MOTS ENTIERS : `scheduled_on` est la date d'une visite, pas un ordonnanceur.
  // Un test qui confondrait les deux signalerait un faux problème et finirait
  // par être désactivé — ce qui vaut moins que pas de test du tout.
  const forbidden = [
    "signature", "docusign", "yousign", "acompte", "stripe", "paiement",
    "facture_client", "consuel", "enedis", "fournisseur", "commande_materiel",
    "n8n", "webhook", "cron", "scheduler", "pg_cron",
  ];
  const sql = sqlIdentifiers(ALL_PV6).toLowerCase();
  for (const f of forbidden) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(sql), `hors périmètre dans les migrations PV-6 : ${f}`);
  }
  // Aucune capacité d'agent créée : PV_ACTIONS_ENABLED reste NO.
  assert.ok(!ALL_PV6.includes("agent_action_catalog"));
  assert.ok(!ALL_PV6.includes("resolver_runtime_config"));
});

test("PV-6 : aucun nouveau bucket, aucune suppression directe dans storage", () => {
  for (const [name, sql] of [["migrations", ALL_PV6], ["rollback", ROLLBACK]] as const) {
    const code = sqlIdentifiers(sql);
    assert.ok(!/insert\s+into\s+storage\.buckets/i.test(code), `${name} : nouveau bucket`);
    assert.ok(!/delete\s+from\s+storage\./i.test(code), `${name} : suppression storage`);
    assert.ok(!/create\s+policy[\s\S]{0,120}storage\.objects/i.test(code), `${name} : politique storage`);
  }
  assert.ok(ALL_PV6.includes("hermes-pv-documents"), "le bucket existant doit être réutilisé");
});

test("PV-6 : l'audit passe par entity_audit_log, sans journal parallèle", () => {
  assert.ok(sqlIdentifiers(ALL_PV6).includes("_pv_audit"));
  assert.ok(!/create table[\s\S]{0,80}(audit|journal|log)/i.test(sqlIdentifiers(ALL_PV6)));
});

test("PV-6 : le rollback dit ce qu'il détruit et restaure la porte AVANT de la casser", () => {
  const rb = ROLLBACK;
  assert.match(rb, /DESTRUCTIF/);
  assert.match(rb, /pv_site_surveys/);
  // L'ordre compte : restaurer pv_quote_blockers après avoir supprimé
  // pv_survey_gate laisserait tout passage en READY en échec.
  assert.ok(
    rb.indexOf("create or replace function hermes_os.pv_quote_blockers") <
      rb.indexOf("drop function if exists hermes_os.pv_survey_gate"),
  );
  assert.ok(
    rb.indexOf("create or replace function public.get_pv_deal") <
      rb.indexOf("drop function if exists hermes_os.pv_survey_gate"),
  );
});

test("PV-6 : les migrations respectent la convention de nommage du dépôt", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.includes("pv6"));
  assert.equal(files.length, 6, "4 migrations + 1 correctif + 1 rollback");
  for (const f of files) assert.match(f, /^\d{8}_pv6_[0-9]b?_[a-z0-9_]+\.sql$/);
  assert.ok(files.some((f) => f.endsWith("_9_rollback.sql")));
});

test("PV-6 : le service ne contient aucune règle métier de gravité", () => {
  const code = tsCode(SERVICE);
  for (const t of ["BLOCKING_PCT", "REVIEW_DEG", "severity =", "isBlocking ="]) {
    assert.ok(!code.includes(t), `règle métier dans le service : ${t}`);
  }
  assert.ok(code.includes("get_pv_site_survey"));
  assert.ok(code.includes("apply_pv_survey_measurement"));
});

test("PV-6 : la vue Affaire consomme la porte sans la recalculer", () => {
  const code = tsCode(DEAL_PAGE);
  assert.match(code, /surveyGate: deal\.surveyGate/);
  assert.match(code, /<PvSurveysPanel/);
  assert.ok(!code.includes("pv_survey_gate"), "la page ne réimplémente pas la porte");
});

test("PV-6 : l'écran lit les suites possibles dans la base, sans redéclarer la machine", () => {
  const code = tsCode(EDITOR);
  assert.match(code, /detail\.nextStatuses/);
  // Aucune liste de transitions codée en dur à l'écran.
  assert.ok(!/IN_PROGRESS['"]\s*:\s*\[/.test(code));
  assert.ok(!code.includes('"VALIDATED"] as const'));
});
