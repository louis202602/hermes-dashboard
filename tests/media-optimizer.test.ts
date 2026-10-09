import assert from "node:assert/strict";
import { test } from "node:test";

import { explainBlockers } from "../lib/media-optimizer/explain.ts";
import {
  captionExcerpt,
  computeReductionPct,
  formatAspect,
  formatBytes,
  formatReduction,
  formatSeconds,
  normalizeWarnings,
  statusLabel,
} from "../lib/media-optimizer/format.ts";
import { hasV3Keys, mapJob, mapPreviews, mapState } from "../lib/media-optimizer/map.ts";
import {
  FIXTURE_JOBS_V3,
  FIXTURE_PIXEL_B64,
  FIXTURE_STATE_V2,
  FIXTURE_STATE_V3,
} from "./fixtures/media-optimizer.fixtures.ts";

/**
 * MEDIA-OPT — « Pourquoi ce média est bloqué ? », formatage et normalisation RPC.
 * Les données ci-dessous sont des FIXTURES DE TEST (cf. tests/fixtures), jamais du réel.
 */

const job = (i: number) => mapJob(FIXTURE_JOBS_V3[i]);

// --- explainBlockers -------------------------------------------------------

test("explainBlockers : cas nominal (droits validés, contrôles OK, rien à signaler) → aucune raison", () => {
  const j = { ...job(0), publicReady: true, draftError: null, warnings: [], error: null };
  assert.deepEqual(explainBlockers(j), []);
});

test("explainBlockers : droits en attente → première raison, bloquante", () => {
  const j = { ...job(2) }; // file d'attente, droits à vérifier
  const r = explainBlockers(j);
  assert.equal(r[0].code, "rights_pending");
  assert.equal(r[0].severity, "blocking");
  assert.match(r[0].message, /droits d’utilisation ne sont pas encore validés/);
});

test("explainBlockers : droits refusés cite la note, et l'ordre est stable", () => {
  const r = explainBlockers(job(4)); // failed + rights rejected + error
  assert.deepEqual(r.map((x) => x.code), ["rights_rejected", "status_failed", "error"]);
  assert.match(r[0].message, /Image d’un tiers/);
  assert.match(r[1].message, /3 tentatives/);
});

test("explainBlockers : ig_ok faux → raison Instagram (et pas Facebook quand fb_ok vrai)", () => {
  const r = explainBlockers(job(1));
  const codes = r.map((x) => x.code);
  assert.ok(codes.includes("ig_not_ok"));
  assert.ok(!codes.includes("fb_not_ok"));
  // blocked → status_blocked ; error ; avertissements en dernier
  assert.deepEqual(codes, ["rights_pending", "status_blocked", "error", "ig_not_ok", "warning", "warning"]);
  assert.equal(r[r.length - 1].severity, "warning");
});

test("explainBlockers : erreur remontée par l'optimiseur", () => {
  const j = { ...job(0), error: "Codec non supporté" };
  const r = explainBlockers(j);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, "error");
  assert.match(r[0].message, /Codec non supporté/);
});

test("explainBlockers : prêt mais lien public absent + brouillon en erreur", () => {
  const r = explainBlockers(job(3));
  assert.deepEqual(r.map((x) => x.code), ["not_public_ready", "draft_error"]);
});

test("explainBlockers : public_ready faux n'est PAS un blocage si le média n'est pas « prêt »", () => {
  const j = { ...job(0), status: "optimized" as const, publicReady: false };
  assert.deepEqual(explainBlockers(j), []);
});

test("explainBlockers : fb_ok faux", () => {
  const j = { ...job(0), fbOk: false };
  assert.deepEqual(explainBlockers(j).map((x) => x.code), ["fb_not_ok"]);
});

test("explainBlockers : sans clés v3, ne déduit rien de ce qui n'existe pas", () => {
  const j = mapJob(FIXTURE_STATE_V2.jobs[0]); // v3 absent : publicReady/warnings/draftError nuls
  assert.equal(j.v3, false);
  assert.deepEqual(explainBlockers(j), []);
});

// --- formatage -------------------------------------------------------------

test("formatBytes : unités françaises, valeurs absentes → « — »", () => {
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(undefined), "—");
  assert.equal(formatBytes(-5), "—");
  assert.equal(formatBytes(Number.NaN), "—");
  assert.equal(formatBytes(512), "512 o");
  assert.equal(formatBytes(2048), "2,0 Ko");
  assert.equal(formatBytes(38_400_000).replace(/\s/g, " "), "36,6 Mo");
  assert.equal(formatBytes(1_900_000_000).replace(/\s/g, " "), "1,77 Go");
});

test("formatReduction / computeReductionPct : calcul, signe et « agrandi »", () => {
  assert.equal(formatReduction(90.7), "−90,7 %");
  assert.equal(formatReduction(0), "0 %");
  assert.equal(formatReduction(null), "—");
  assert.match(formatReduction(-12.34), /^\+12,3 % \(agrandi\)$/);
  assert.equal(computeReductionPct(100, 25), 75);
  assert.equal(computeReductionPct(100, 25, 70), 70); // la valeur de la base prime
  assert.equal(computeReductionPct(100, null), null); // jamais d'une seule taille
  assert.equal(computeReductionPct(0, 10), null);
});

test("formatSeconds, statusLabel, captionExcerpt", () => {
  assert.equal(formatSeconds(3.2), "3,2 s");
  assert.equal(formatSeconds(125), "2 min 05 s");
  assert.equal(formatSeconds(null), "—");
  assert.equal(statusLabel("queued"), "En file d’attente");
  assert.equal(statusLabel("ready_to_publish"), "Prêt");
  assert.equal(statusLabel("n_importe_quoi"), "État inconnu");
  assert.equal(captionExcerpt(null), null);
  assert.equal(captionExcerpt("  court  "), "court");
  const long = captionExcerpt("mot ".repeat(100), 40) as string;
  assert.ok(long.endsWith("…") && long.length <= 41);
});

test("formatAspect / normalizeWarnings tolèrent les formes JSON libres", () => {
  assert.equal(formatAspect("16:9"), "16:9");
  assert.equal(formatAspect({ width: 1080, height: 1920 }), "1080×1920");
  assert.equal(formatAspect({ label: "9:16" }), "9:16");
  assert.equal(formatAspect(null), null);
  assert.equal(formatAspect({}), null);
  assert.deepEqual(normalizeWarnings(["a", { message: "b" }, { code: "c" }, 3, null, "  "]), ["a", "b", "c"]);
  assert.deepEqual(normalizeWarnings("pas un tableau"), []);
});

// --- normalisation RPC (migration v3 optionnelle) ---------------------------

test("mapState : clés v3 présentes → v3 « present » et champs lus", () => {
  const s = mapState(FIXTURE_STATE_V3);
  assert.equal(s.v3, "present");
  assert.equal(s.publishStop, true);
  const j = s.jobs[0];
  assert.equal(j.isTest, true);
  assert.equal(j.bufferStatus, "draft");
  assert.equal(j.padVertical, true);
  assert.equal(j.hasPreviews, true);
  assert.equal(j.aspect, "16:9");
});

test("mapState : clés v3 absentes → v3 « absent », aucune valeur positive inventée", () => {
  const s = mapState(FIXTURE_STATE_V2);
  assert.equal(s.v3, "absent");
  for (const j of s.jobs) {
    assert.equal(j.v3, false);
    assert.equal(j.isTest, null);
    assert.equal(j.publicReady, null);
    assert.equal(j.bufferStatus, null);
    assert.equal(j.hasPreviews, null);
    assert.deepEqual(j.warnings, []);
  }
  assert.equal(hasV3Keys(FIXTURE_STATE_V2.jobs[0]), false);
});

test("mapState : aucun média → v3 « unknown » ; STOP actif sauf valeur explicite false", () => {
  assert.equal(mapState({ resolution_status: "OK", jobs: [] }).v3, "unknown");
  assert.equal(mapState({ resolution_status: "OK", jobs: [] }).publishStop, true);
  assert.equal(mapState({ resolution_status: "OK", publish_stop: false, jobs: [] }).publishStop, false);
});

test("mapPreviews : ne garde que des images sûres, triées par position", () => {
  const ok = { kind: "opt", pos: 2, t_sec: "3.5", mime: "image/jpeg", width: 10, height: 10, data_b64: FIXTURE_PIXEL_B64 };
  const out = mapPreviews([
    ok,
    { ...ok, kind: "orig", pos: 1 },
    { ...ok, kind: "inconnu" },
    { ...ok, mime: "text/html" },
    { ...ok, data_b64: "<script>alert(1)</script>" },
    { ...ok, data_b64: "" },
    null,
  ]);
  assert.deepEqual(out.map((p) => [p.kind, p.pos]), [["orig", 1], ["opt", 2]]);
  assert.equal(out[1].tSec, 3.5);
  assert.deepEqual(mapPreviews("x"), []);
});
