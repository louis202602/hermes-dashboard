import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveTenantComposition } from "../lib/verticals/composition.ts";

/**
 * HERMÈS STUDIO — les coûts téléphoniques rejoignent SW19 et SW23.
 *
 * Le trou : `photo_calls` gardait ses coûts pour lui. Les appels étaient donc
 * invisibles pour SW23 — hors budget, hors plafond, hors alerte, hors
 * kill-switch. Un standard qui s'emballe n'aurait rien déclenché.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQL = read("db/migrations/20260820_photo_studio_10_phone_costs.sql");
const ROLLBACK = read("db/migrations/20260820_photo_studio_10_rollback.sql");

test("la migration n'est pas appliquée et le dit", () => {
  assert.ok(SQL.includes("⚠️ NON APPLIQUÉE"));
  assert.ok(SQL.includes("GO_LIVE = NO"));
  assert.ok(SQL.includes("begin;"));
  assert.ok(SQL.trimEnd().endsWith("commit;"));
});

test("les neuf champs exigés partent bien vers sw19_cost_events", () => {
  const insert = SQL.slice(
    SQL.indexOf("insert into hermes_os.sw19_cost_events"),
    SQL.indexOf("v_written := v_written + 1"),
  );
  for (const col of [
    "tenant_id", "provider", "model_or_service", "quantity", "unit_cost",
    "total_cost", "currency", "measurement_status", "provider_event_id",
  ]) {
    assert.ok(insert.includes(col), `champ absent de l'insertion : ${col}`);
  }
});

test("AUCUN coût estimé n'est enregistré comme réel", () => {
  // Une seule valeur de measurement_status est écrite, et c'est MEASURED.
  const written = [...SQL.matchAll(/'(MEASURED|DERIVED|ESTIMATED|UNKNOWN)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(written)], ["MEASURED"]);
  // Et rien ne s'écrit tant que le fournisseur n'a pas facturé.
  assert.ok(SQL.includes("if not v_call.cost_reported then"));
  assert.ok(SQL.includes("'COST_NOT_REPORTED'"));
});

test("une composante non facturée est NOMMÉE, pas comblée", () => {
  assert.ok(SQL.includes("v_skipped := v_skipped || procedure_component"));
  assert.ok(SQL.includes("'not_reported', to_jsonb(v_skipped)"));
});

test("le coût par minute est DÉDUIT du facturé, jamais d'un tarif supposé", () => {
  assert.ok(SQL.includes("round(v_amount / v_minutes, 6)"));
  // Durée nulle ou inconnue ⇒ NULL, pas une division hasardeuse.
  assert.ok(SQL.includes("case when v_minutes is null or v_minutes = 0 then null"));
});

test("le rejeu ne double pas les coûts", () => {
  assert.ok(SQL.includes("if exists ("));
  assert.ok(SQL.includes("and e.model_or_service = v_service"));
  assert.ok(SQL.includes("function hermes_os.photo_call_request_id"));
  // request_id DÉTERMINISTE : c'est ce qui rend l'idempotence de SW23 utilisable.
  assert.ok(SQL.includes("'photo_call:' || coalesce(p_call_id, '')"));
});

test("le déclenchement a lieu à la TRANSITION vers « facturé »", () => {
  assert.ok(SQL.includes("after update of cost_reported on hermes_os.photo_calls"));
  assert.ok(SQL.includes("when (new.cost_reported and not coalesce(old.cost_reported, false))"));
});

test("SW23 est RÉUTILISÉ, pas réécrit", () => {
  for (const fn of [
    "hermes_os.sw23_reserve_budget(",
    "hermes_os.sw23_commit_budget(",
    "hermes_os.sw23_release_budget(",
    "hermes_os.sw23_set_session_tenant(",
  ]) {
    assert.ok(SQL.includes(fn), `fonction SW23 non réutilisée : ${fn}`);
  }
  // Aucune table de budget n'est recréée.
  assert.ok(!/create table[\s\S]*sw23_/.test(SQL));
  assert.ok(!/create or replace function hermes_os\.sw23_/.test(SQL));
});

test("le plafond PAR APPEL est appliqué avant toute réservation", () => {
  const gate = SQL.slice(SQL.indexOf("function hermes_os.photo_phone_budget_gate"));
  const perCall = gate.indexOf("per_request_budget_usd");
  const reserve = gate.indexOf("sw23_reserve_budget");
  assert.ok(perCall > 0 && perCall < reserve, "la réservation précède le plafond par appel");
  assert.ok(gate.includes("'PER_CALL_LIMIT_EXCEEDED'"));
  // FAIL-CLOSED : sans estimation, on ne réserve pas « 0 ».
  assert.ok(gate.includes("'ESTIMATE_REQUIRED'"));
});

test("un refus mensuel LIBÈRE la réservation journalière", () => {
  const gate = SQL.slice(SQL.indexOf("function hermes_os.photo_phone_budget_gate"));
  const idx = gate.indexOf("'MONTHLY_BUDGET_EXCEEDED'");
  const release = gate.lastIndexOf("sw23_release_budget", idx);
  assert.ok(release > 0 && release < idx, "le budget journalier resterait consommé");
});

test("un appel jamais facturé libère son budget au lieu de le geler", () => {
  const settle = SQL.slice(SQL.indexOf("function hermes_os.photo_phone_settle_budget"));
  assert.ok(settle.includes("'RELEASED_NO_COST'"));
  assert.ok(settle.includes("measurement_status = 'MEASURED'"));
});

test("le rollback n'efface aucun fait comptable", () => {
  assert.ok(ROLLBACK.includes("drop function if exists hermes_os.record_photo_call_costs(text, text)"));
  assert.ok(ROLLBACK.includes("drop trigger if exists photo_call_cost_sync_trg"));
  // Les lignes de coût déjà écrites sont de l'histoire, pas du schéma.
  assert.ok(!ROLLBACK.includes("delete from hermes_os.sw19_cost_events"));
  assert.ok(!ROLLBACK.includes("drop table if exists hermes_os.sw19_cost_events"));
  assert.ok(!ROLLBACK.includes("drop table if exists hermes_os.sw23_budget_ledger"));
});

test("photo_calls porte le request_id qui le relie au grand livre", () => {
  const lot7 = read("db/migrations/20260819_photo_studio_7_phone.sql");
  assert.ok(lot7.includes("request_id         text check"));
  assert.ok(lot7.includes("⚠️ NON APPLIQUÉE"));
});

// --- Le menu Studio complet, une fois toutes les briques empilées ------------

test("le menu Vanessa contient les 15 entrées cibles, dans l'ordre de la verticale", () => {
  const vanessa = resolveTenantComposition({
    capabilityKeys: [
      "photo.studio", "photo.culling.start", "photo.gallery.publish",
      "photo.marketing.publish", "photo.lead.create", "photo.quote.send",
      "photo.payment.record",
    ],
    permissions: ["tenant.member"],
  });
  const ids = vanessa.navigation.map((n) => n.moduleId);
  const expected = [
    "core.home", "crm.prospects", "crm.clients", "photo.sessions", "agenda",
    "photo.quotes", "photo.payments", "phone", "campaigns", "photo.gallery",
    "photo.portal", "photo.upsell", "photo.lifecycle", "core.integrations",
    "core.settings",
  ];
  for (const e of expected) assert.ok(ids.includes(e), `entrée manquante : ${e}`);
  // L'ORDRE de la verticale est respecté (les entrées du noyau suivent).
  const positions = expected.map((e) => ids.indexOf(e));
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `ordre rompu à ${expected[i]}`);
  }
  // Toujours rien d'une autre verticale.
  for (const f of ["worksites", "solar.studies", "immo.properties"]) {
    assert.ok(!ids.includes(f), `entrée étrangère : ${f}`);
  }
});
