import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isRouteAllowed, routeModule } from "@/lib/verticals/navigation";
import { grantedModules } from "@/lib/verticals/modules";
import { PV_QUOTE_BLOCKER_LABELS, PV_QUOTE_STATUS_LABELS, pvQuoteTone } from "@/lib/pv/quoteLabels";
import { PV_QUOTE_LINE_CATEGORIES } from "@/types/pv";

/**
 * LOT PV-5 — garde-fous de CONTRAT sur le devis.
 *
 * Ils complètent `db/tests/pv5_quotes.test.sql`, qui prouve le COMPORTEMENT en
 * base. Ici on prouve que ce comportement ne peut pas être perdu par une
 * réécriture distraite : un total qui redeviendrait saisissable, un envoi de
 * courriel qu'on laisserait croire, un `tenant_id` glissé dans un formulaire,
 * une signature électronique introduite hors périmètre.
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
const M1 = read("../db/migrations/20260822_pv5_1_quotes_schema.sql");
const M2 = read("../db/migrations/20260822_pv5_2_state_machine.sql");
const M3 = read("../db/migrations/20260822_pv5_3_facades.sql");
const M3B = read("../db/migrations/20260822_pv5_3b_blocker_array_cast.sql");
const ROLLBACK = read("../db/migrations/20260822_pv5_9_rollback.sql");
const ALL_PV5 = [M1, M2, M3, M3B].map(sqlCode).join("\n");

/**
 * SQL débarrassé des commentaires ET des littéraux de chaîne. Sans cela, un mot
 * français dans un `comment on column` (« taux stocké tel quel ») ferait échouer
 * une recherche de tables interdites — le test signalerait un faux problème.
 */
const sqlIdentifiers = (sql: string): string =>
  sqlCode(sql).replace(/'(?:[^']|'')*'/g, "''");

const SERVICE = tsCode(read("../services/hermes/pv.ts"));
const ACTIONS = tsCode(read("../app/actions/pv.ts"));
const EDITOR = read("../components/dashboard/PvQuoteEditor.tsx");
const PANEL = read("../components/dashboard/PvQuotesPanel.tsx");
const QUOTE_PDF = tsCode(read("../lib/pv/quotePdf.ts"));

// --- LES TOTAUX NE VIENNENT JAMAIS DU NAVIGATEUR ------------------------------

test("1 — le total de ligne est une colonne GÉNÉRÉE, sans chemin d'écriture", () => {
  assert.match(
    sqlCode(M1),
    /line_total_ht_eur[\s\S]{0,80}generated always as[\s\S]{0,160}stored/,
    "line_total_ht_eur doit être une colonne générée STORED",
  );
});

test("2 — AUCUNE façade n'accepte un total, un sous-total ou un TTC", () => {
  const signatures = [
    ...sqlCode(ALL_PV5).matchAll(/create or replace function ([\s\S]*?)\)\s*\nreturns/g),
  ];
  assert.ok(signatures.length >= 14, `trop peu de signatures : ${signatures.length}`);
  for (const [, sig] of signatures) {
    assert.equal(
      /p_total|p_subtotal|p_ttc|p_line_total|p_amount/.test(sig),
      false,
      `une signature PV-5 accepte un total : ${sig.slice(0, 120)}`,
    );
  }
});

test("3 — le formulaire de ligne ne porte AUCUN champ de total", () => {
  const names = [...EDITOR.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 8, `trop peu de champs analysés : ${names.length}`);
  for (const n of names) {
    assert.equal(
      /total|ttc|subtotal/.test(n),
      false,
      `le formulaire expose un champ de total : ${n}`,
    );
  }
  // Et l'action ne lit aucun total du formulaire.
  assert.equal(/formData[\s\S]{0,20}"(total|total_ttc|total_ht)"/.test(ACTIONS), false);
});

test("4 — les totaux sont recalculés PAR DÉCLENCHEUR à chaque mouvement de ligne", () => {
  assert.match(sqlCode(M1), /create trigger trg_pv_quote_lines_recompute[\s\S]{0,120}after insert or update or delete/);
  assert.match(sqlCode(M1), /recompute_pv_quote_totals/);
  // TVA arrondie PAR TAUX, pas par ligne : la règle est dans le regroupement.
  assert.match(sqlCode(M1), /group by vat_rate_pct/);
});

// --- 17-23. MACHINE À ÉTATS ET IMMUTABILITÉ -----------------------------------

test("5 — les transitions du devis sont des DONNÉES, pas du code", () => {
  assert.match(sqlCode(M2), /create table if not exists hermes_os\.pv_quote_transitions/);
  const guard = sqlCode(M2).match(
    /create or replace function hermes_os\.pv_quote_status_guard[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(guard, "garde de transition introuvable");
  assert.match(guard, /from hermes_os\.pv_quote_transitions/);
  // Aucun statut codé en dur dans la garde : elle LIT la table.
  assert.equal(
    /'(DRAFT|READY|SENT|ACCEPTED)'/.test(guard),
    false,
    "la garde ne doit coder aucun statut en dur",
  );
});

test("6 — les chemins interdits ne sont simplement PAS déclarés", () => {
  const rows = [...sqlCode(M2).matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map(
    (m) => `${m[1]}->${m[2]}`,
  );
  for (const forbidden of ["DRAFT->ACCEPTED", "DRAFT->SENT", "ACCEPTED->DRAFT", "ACCEPTED->SENT"]) {
    assert.equal(rows.includes(forbidden), false, `${forbidden} ne doit pas être déclaré`);
  }
  for (const allowed of ["DRAFT->READY", "READY->SENT", "SENT->ACCEPTED", "SENT->REFUSED"]) {
    assert.ok(rows.includes(allowed), `${allowed} doit être déclaré`);
  }
});

test("7 — un devis transmis est FIGÉ, devis ET lignes", () => {
  assert.match(sqlCode(M2), /create or replace function hermes_os\.pv_quote_immutable_guard/);
  assert.match(sqlCode(M2), /create or replace function hermes_os\.pv_quote_lines_immutable_guard/);
  assert.match(sqlCode(M2), /PV_DEVIS_FIGE/);
  // Geler le devis sans geler ses lignes serait une porte fermée à côté d'une
  // fenêtre ouverte : les deux déclencheurs doivent exister.
  assert.match(sqlCode(M2), /create trigger trg_pv_quote_lines_immutable/);
  assert.match(sqlCode(M2), /create trigger trg_pv_quotes_immutable/);
});

test("8 — la RÉVISION est la seule voie de modification d'un devis transmis", () => {
  const revise = sqlCode(M3).match(
    /create or replace function public\.revise_pv_quote[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(revise, "revise_pv_quote introuvable");
  assert.match(revise, /QUOTE_ACCEPTED_IMMUTABLE/);
  assert.match(revise, /quote_number/, "le numéro commercial doit être conservé");
  assert.match(revise, /set status = 'SUPERSEDED'/, "l’ancienne version doit être remplacée");
  assert.match(revise, /insert into hermes_os\.pv_quote_lines/, "les lignes doivent être recopiées");
  // L'écran le dit aussi, dans ces termes.
  assert.match(EDITOR, /créez une nouvelle version/i);
});

// --- 14. ACCEPTATION : UN HUMAIN, PAS UN AGENT --------------------------------

test("9 — un AGENT ne peut pas accepter un devis", () => {
  // On réutilise la garde de validation humaine de PV-1, paramétrée : elle
  // refuse quand auth.uid() est NULL (runner, service_role).
  assert.match(
    sqlCode(M3),
    /create trigger trg_pv_quotes_human_acceptance[\s\S]{0,220}pv_human_validation_guard\(\s*'status',\s*'ACCEPTED',\s*'accepted_by',\s*'accepted_at'\s*\)/,
  );
});

test("10 — l'acceptation exige une confirmation explicite dans l'écran", () => {
  assert.match(EDITOR, /name="confirm"\s+value="ACCEPTER"\s+required/);
  assert.match(ACTIONS, /formData\.get\("confirm"\)\s*!==\s*"ACCEPTER"/);
  assert.match(ACTIONS, /CONFIRMATION_REQUIRED/);
});

test("11 — AUCUNE signature électronique n'est introduite", () => {
  for (const src of [ALL_PV5, SERVICE, ACTIONS, EDITOR, QUOTE_PDF]) {
    assert.equal(
      /docusign|yousign|signature_?electronique|electronic_?signature|signer_url/i.test(src),
      false,
      "PV-5 ne doit introduire aucune signature électronique",
    );
  }
  // Et le PDF le DIT au client, plutôt que de le laisser supposer.
  assert.match(QUOTE_PDF, /n’est pas un bon de commande signé/);
  assert.match(EDITOR, /aucune signature électronique/i);
});

// --- « MARQUER COMME ENVOYÉ » N'EST PAS UN ENVOI ------------------------------

test("12 — l'écran et le message disent que RIEN n'est expédié", () => {
  assert.match(EDITOR, /n’envoie aucun courriel/i);
  assert.match(ACTIONS, /Hermès n’a envoyé aucun message/);
  // Aucun client de messagerie n'est appelé.
  for (const src of [SERVICE, ACTIONS]) {
    assert.equal(/nodemailer|sendgrid|resend|smtp|mailgun/i.test(src), false);
  }
});

// --- 15. EXPIRATION SANS SCHEDULER --------------------------------------------

test("13 — la péremption est calculée à la lecture ET applicable à la demande", () => {
  assert.match(sqlCode(M3), /'is_expired'/, "la lecture doit exposer la péremption calculée");
  assert.match(sqlCode(M3), /create or replace function public\.expire_pv_quotes/);
  // AUCUN cron, AUCUN scheduler, AUCUN workflow.
  assert.equal(/pg_cron|cron\.schedule|pg_timetable/i.test(sqlCode(ALL_PV5)), false);
  assert.equal(/n8n|webhook|scheduler/i.test(sqlCode(ALL_PV5)), false);
});

// --- 16. AUDIT ------------------------------------------------------------------

test("14 — l'audit réutilise entity_audit_log, sans journal parallèle", () => {
  assert.match(sqlCode(M2), /_pv_audit\(/);
  assert.equal(
    /create table[\s\S]{0,120}(audit|journal|log)/i.test(sqlCode(ALL_PV5)),
    false,
    "PV-5 ne doit créer aucune table de journal",
  );
  // Les devis ET les lignes sont tracés.
  assert.match(sqlCode(M2), /create trigger trg_pv_quotes_audit/);
  assert.match(sqlCode(M2), /create trigger trg_pv_quote_lines_audit/);
});

// --- 17. ISOLATION MULTI-TENANT -------------------------------------------------

test("15 — FK COMPOSITES sur toutes les références du devis", () => {
  for (const fk of ["prospect", "site", "study", "economics", "supersedes"]) {
    assert.match(
      sqlCode(M1),
      new RegExp(`pv_quotes_${fk}_fk[\\s\\S]{0,120}foreign key \\(tenant_id, `),
      `la FK ${fk} doit être COMPOSITE`,
    );
  }
  assert.match(sqlCode(M1), /pv_quote_lines_quote_fk[\s\S]{0,120}foreign key \(tenant_id, quote_id\)/);
});

test("16 — aucune façade PUBLIQUE n'accepte de tenant_id ni d'acteur", () => {
  // La règle porte sur ce que le navigateur peut appeler : les façades de
  // `public`. `hermes_os.next_pv_quote_number(p_tenant, …)` est une aide INTERNE,
  // jamais exposée — lui interdire un paramètre de tenant n'aurait aucun sens.
  const signatures = [
    ...sqlCode(ALL_PV5).matchAll(/create or replace function (public\.[\s\S]*?)\)\s*\nreturns/g),
  ];
  assert.ok(signatures.length >= 14, `trop peu de façades publiques : ${signatures.length}`);
  for (const [, sig] of signatures) {
    assert.equal(/p_tenant|tenant_id\s+text/.test(sig), false, `tenant exposé : ${sig.slice(0, 100)}`);
    assert.equal(
      /p_actor|p_user_id|p_accepted_by|p_sent_by/.test(sig),
      false,
      `acteur exposé : ${sig.slice(0, 100)}`,
    );
  }
  // Et aucun formulaire ne porte de tenant.
  for (const src of [EDITOR, PANEL]) {
    assert.equal(/name="tenant[_a-z]*"/.test(src), false, "un formulaire expose un tenant");
  }
});

test("17 — le tenant d'un devis est IMMUABLE (garde G1 de PV-1, réutilisée)", () => {
  assert.match(sqlCode(M2), /trg_pv_quotes_tenant_immutable[\s\S]{0,160}pv_tenant_immutable/);
  assert.match(sqlCode(M2), /trg_pv_quote_lines_tenant_immutable[\s\S]{0,160}pv_tenant_immutable/);
});

test("18 — tables devis en deny-all : RLS activée, aucun GRANT direct", () => {
  for (const t of ["pv_quotes", "pv_quote_lines", "pv_quote_sequences"]) {
    assert.match(sqlCode(M1), new RegExp(`alter table hermes_os\\.${t} enable row level security`));
    assert.match(sqlCode(M1), new RegExp(`revoke all on table hermes_os\\.${t} from anon, authenticated`));
  }
  assert.match(sqlCode(M2), /alter table hermes_os\.pv_quote_transitions enable row level security/);
  // Aucune policy : deny-all est la garantie, pas un oubli.
  assert.equal(/create policy/i.test(sqlCode(ALL_PV5)), false);
});

test("19 — aucun GRANT anon, aucun service_role dans PV-5", () => {
  assert.equal(/to anon/.test(sqlCode(ALL_PV5)), false);
  assert.equal(/service_role/.test(sqlCode(ALL_PV5)), false);
  assert.equal(/service_role|SERVICE_ROLE/.test(SERVICE), false);
});

test("20 — les façades sont SECURITY DEFINER, les déclencheurs ne le sont PAS", () => {
  const fns = [
    ...sqlCode(ALL_PV5).matchAll(/create or replace function [\s\S]*?\$function\$;/g),
  ].map((m) => m[0]);
  assert.ok(fns.length >= 20, `trop peu de fonctions : ${fns.length}`);

  let facades = 0;
  let triggers = 0;
  for (const fn of fns) {
    // `search_path` verrouillé PARTOUT : une fonction sans search_path fixe est
    // détournable par un schéma temporaire, déclencheur compris.
    assert.match(fn, /set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'/);

    if (/returns trigger/.test(fn)) {
      triggers += 1;
      // Un déclencheur s'exécute déjà dans le contexte de l'écriture qu'il garde.
      // Le rendre SECURITY DEFINER lui donnerait des droits qu'il n'a pas besoin
      // d'avoir — et que personne n'aurait demandés.
      assert.equal(
        /security definer/.test(fn),
        false,
        `un déclencheur ne doit pas être SECURITY DEFINER : ${fn.slice(0, 80)}`,
      );
    } else {
      facades += 1;
      assert.match(fn, /security definer/);
    }
  }
  assert.ok(facades >= 14, `trop peu de façades : ${facades}`);
  assert.ok(triggers >= 5, `trop peu de déclencheurs : ${triggers}`);
});

// --- 5. LA SOURCE DE VÉRITÉ DU DEVIS -------------------------------------------

test("21 — un devis ne peut naître que d'une étude VALIDATED et d'un chiffrage VERIFIED", () => {
  const create = sqlCode(M3B).match(
    /create or replace function public\.create_pv_quote[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(create, "create_pv_quote introuvable dans le correctif 3b");
  assert.match(create, /s\.status = 'VALIDATED'/);
  assert.match(create, /e\.status = 'VERIFIED'/);
  assert.match(create, /QUOTE_NOT_READY/);
  assert.match(create, /missing_requirements/);
  // Même règle déterministe que la vue Affaire de PV-4 : version la plus haute.
  assert.match(create, /order by s\.version desc limit 1/);
});

test("22 — les blocages sont des RAISONS, pas un booléen", () => {
  const blockers = sqlCode(M3B).match(
    /create or replace function hermes_os\.pv_quote_blockers[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(blockers, "pv_quote_blockers introuvable");
  for (const code of [
    "STUDY_NOT_VALIDATED",
    "ECONOMICS_NOT_VERIFIED",
    "NO_LINE",
    "TOTAL_NOT_POSITIVE",
    "CLIENT_IDENTITY_MISSING",
    "SITE_MISSING",
    "VALIDITY_DATE_MISSING",
    "PROSPECT_OPTED_OUT",
  ]) {
    assert.ok(blockers.includes(code), `raison manquante : ${code}`);
    assert.ok(PV_QUOTE_BLOCKER_LABELS[code], `libellé manquant pour ${code}`);
  }
  // `array_append` plutôt que `||` : `text[] || 'chaîne'` n'est PAS l'ajout d'un
  // élément — PostgreSQL tente de lire la chaîne comme un array et échoue.
  assert.match(blockers, /array_append\(/);
  assert.equal(/v_out := v_out \|\| '/.test(blockers), false);
});

// --- 25. LE PROSPECT ------------------------------------------------------------

test("23 — les trois états commerciaux existent, et WON n'est plus atteignable directement", () => {
  assert.match(sqlCode(M2), /'OFFER_PREPARED'/);
  assert.match(sqlCode(M2), /'OFFER_SENT'/);
  assert.match(sqlCode(M2), /'OFFER_ACCEPTED'/);
  assert.match(sqlCode(M2), /\('OFFER_ACCEPTED',\s*'WON'\)/);
  // Le raccourci est explicitement RETIRÉ, pas simplement omis.
  assert.match(
    sqlCode(M2),
    /delete from hermes_os\.pv_prospect_transitions[\s\S]{0,120}'STUDY_DELIVERED'[\s\S]{0,60}'WON'/,
  );
});

test("24 — l'acceptation d'un devis ne fait PAS passer le prospect à WON", () => {
  const accept = sqlCode(M3).match(
    /create or replace function public\.accept_pv_quote[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(accept, "accept_pv_quote introuvable");
  assert.match(accept, /set status = 'OFFER_ACCEPTED'/);
  assert.equal(
    /set status = 'WON'/.test(accept),
    false,
    "gagner l’affaire doit rester un second geste délibéré",
  );
});

// --- 10. UI ---------------------------------------------------------------------

test("25 — la vue Affaire porte un bloc Devis, et la route est gardée", () => {
  const deal = read("../app/(dashboard)/etudes/affaires/[prospectId]/page.tsx");
  assert.match(deal, /<PvQuotesPanel/);
  assert.match(deal, /getPvQuotes/);
  const page = read("../app/(dashboard)/etudes/devis/[quoteId]/page.tsx");
  assert.match(page, /requireRoute\("\/etudes"\)/);
  assert.match(page, /notFound\(\)/);
  // La route appartient bien au module solaire, et à lui seul.
  assert.equal(routeModule("/etudes/devis/abc"), "solar.studies");
  assert.ok(isRouteAllowed("/etudes/devis/abc", grantedModules(["quotes", "worksites"])));
  assert.equal(
    isRouteAllowed("/etudes/devis/abc", grantedModules(["photo_studio", "leads", "appointments"])),
    false,
    "un tenant photo ne doit pas atteindre un devis PV",
  );
});

test("26 — les libellés couvrent tous les statuts et toutes les catégories", () => {
  for (const s of ["DRAFT", "READY", "SENT", "ACCEPTED", "REFUSED", "EXPIRED", "CANCELLED", "SUPERSEDED"]) {
    assert.ok(PV_QUOTE_STATUS_LABELS[s], `libellé manquant pour le statut ${s}`);
  }
  // Le ton distingue le seul bon état terminal des autres fins.
  assert.equal(pvQuoteTone("ACCEPTED"), "ok");
  assert.equal(pvQuoteTone("SENT"), "warn");
  assert.equal(pvQuoteTone("REFUSED"), "muted");
  assert.equal(pvQuoteTone("DRAFT"), "neutral");
  // Les catégories du type TS et de la contrainte SQL doivent coïncider.
  const sqlCats = sqlCode(M1)
    .match(/category\s+text not null default 'AUTRE'[\s\S]*?\)\)/)?.[0]
    ?? "";
  for (const c of PV_QUOTE_LINE_CATEGORIES) {
    assert.ok(sqlCats.includes(`'${c}'`), `catégorie ${c} absente de la contrainte SQL`);
  }
});

// --- 20. HORS PÉRIMÈTRE ---------------------------------------------------------

test("27 — PV-5 n'introduit ni acompte, ni paiement, ni facture client", () => {
  for (const forbidden of [
    "acompte",
    "deposit",
    "payment",
    "stripe",
    "facture_client",
    "invoice",
    "supplier",
    "fournisseur",
    "stock",
    "consuel",
    "enedis",
  ]) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`, "i").test(sqlIdentifiers(ALL_PV5)),
      false,
      `PV-5 introduit « ${forbidden} », hors périmètre`,
    );
  }
});

test("28 — AUCUNE capacité IA n'est créée pour le devis", () => {
  assert.equal(/agent_action_catalog|resolver_runtime_config|sw15_policies/.test(sqlCode(ALL_PV5)), false);
  assert.equal(/pv\.quote/.test(sqlCode(ALL_PV5)), false);
  assert.equal(/enabled\s*=\s*true/.test(sqlCode(ALL_PV5)), false);
});

// --- ROLLBACK -------------------------------------------------------------------

test("29 — le rollback PV-5 ne supprime AUCUN objet storage en SQL direct", () => {
  assert.equal(/delete\s+from\s+storage\.(buckets|objects)/i.test(sqlCode(ROLLBACK)), false);
});

test("29b — le rollback DIT ce qu'il détruit, plutôt que de le taire", () => {
  assert.match(ROLLBACK, /DESTRUCTIF SUR LES DONNÉES COMMERCIALES/);
  assert.match(ROLLBACK, /devis ENGAGEANTS perdus/);
  // Il refuse d'écraser silencieusement l'état commercial de vrais prospects.
  assert.match(ROLLBACK, /ECHOUERA sur la\n-- contrainte de statut|ÉCHOUERA sur la/);
  assert.match(ROLLBACK, /requalifier explicitement/);
});

test("29c — le rollback restaure les contraintes AVANT de retirer la colonne", () => {
  const body = sqlCode(ROLLBACK);
  const addCheck = body.indexOf("add constraint pv_documents_synthese_rattachee");
  const dropCol = body.indexOf("drop column if exists quote_id");
  assert.ok(addCheck > 0 && dropCol > addCheck, "l’ordre du rollback est incorrect");
});

test("30 — aucun rollback du dépôt ne supprime storage.objects ou storage.buckets", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && f.includes("rollback"),
  );
  assert.ok(files.length >= 7, `trop peu de rollbacks trouvés : ${files.length}`);
  for (const f of files) {
    const body = sqlCode(readFileSync(`${MIGRATIONS_DIR}${f}`, "utf8"));
    assert.equal(
      /delete\s+from\s+storage\.(buckets|objects)/i.test(body),
      false,
      `${f} contient une suppression SQL directe dans storage`,
    );
  }
});

// --- DÉPENDANCES ET STYLES ------------------------------------------------------

test("31 — le PDF de devis n'ajoute aucune dépendance", () => {
  const pkg = JSON.parse(read("../package.json")) as { dependencies?: Record<string, string> };
  const deps = Object.keys(pkg.dependencies ?? {});
  for (const heavy of ["pdfkit", "jspdf", "pdf-lib", "puppeteer", "playwright", "handlebars"]) {
    assert.ok(!deps.includes(heavy), `dépendance ajoutée : ${heavy}`);
  }
  for (const f of ["../lib/pv/quotePdf.ts", "../lib/pv/quotePdfModel.ts", "../lib/pv/pdfEngine.ts"]) {
    const imports = [...tsCode(read(f)).matchAll(/^import [\s\S]*?from "([^"]+)";/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("node:"),
        `${f} importe le paquet tiers « ${spec} »`,
      );
    }
  }
});

test("32 — les styles PV-5 sont tous préfixés pv-", () => {
  const css = read("../app/globals.css");
  const block = css.slice(css.indexOf("PV-5 : devis"));
  assert.ok(block.length > 0, "bloc CSS PV-5 introuvable");
  const selectors = [...block.matchAll(/^\.([a-z][\w-]*)/gm)].map((m) => m[1]);
  assert.ok(selectors.length >= 5, `trop peu de sélecteurs : ${selectors.length}`);
  for (const s of selectors) {
    assert.ok(s.startsWith("pv-"), `le sélecteur .${s} n’est pas préfixé pv-`);
  }
});
