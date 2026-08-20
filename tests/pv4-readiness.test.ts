import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PV_DEAL_STATE_LABELS,
  PV_REQUIREMENT_LABELS,
  PV_REQUIREMENTS,
  resolvePvReadiness,
  type PvReadinessInput,
} from "@/lib/pv/readiness";

/**
 * LOT PV-4 — le moteur d'état d'une affaire.
 *
 * Module PUR : ces tests le prouvent au comportement, pas au diff. La propriété
 * centrale, testée sous plusieurs angles : `READY_FOR_OFFER` exige une étude
 * VALIDATED **et** un chiffrage VERIFIED. Un `CALCULATED` ne suffit jamais.
 */

const completeSite = {
  addressLine1: "1 rue du Soleil",
  postalCode: "13100",
  city: "Aix-en-Provence",
  roofAreaUsableM2: 60,
  azimuthDeg: 180,
  tiltDeg: 30,
};

const base: PvReadinessInput = {
  prospect: { status: "QUALIFIED", optedOut: false },
  site: completeSite,
  consumption: { annualConsumptionKwh: 5200, verificationStatus: "VERIFIED" },
  verifiedBill: null,
  retainedStudy: { status: "VALIDATED" },
  latestStudy: { status: "VALIDATED" },
  retainedEconomics: { status: "VERIFIED" },
  hasAnyEconomics: true,
};

test("19 — dossier complet ⇒ READY_FOR_OFFER, aucun blocage", () => {
  const r = resolvePvReadiness(base);
  assert.equal(r.state, "READY_FOR_OFFER");
  assert.deepEqual(r.missingRequirements, []);
  assert.equal(r.canGenerateFinalPdf, true);
});

test("16 — données manquantes ⇒ INCOMPLETE", () => {
  const r = resolvePvReadiness({
    ...base,
    site: null,
    consumption: null,
    retainedStudy: null,
    latestStudy: null,
    retainedEconomics: null,
    hasAnyEconomics: false,
  });
  assert.equal(r.state, "INCOMPLETE");
  assert.ok(r.missingRequirements.includes("NO_SITE"));
  assert.ok(r.missingRequirements.includes("NO_ENERGY_DATA"));
  assert.ok(r.missingRequirements.includes("NO_STUDY"));
  assert.ok(r.missingRequirements.includes("NO_ECONOMICS"));
  assert.equal(r.canGenerateFinalPdf, false);
});

test("16b — site techniquement incomplet ⇒ INCOMPLETE, motif précis", () => {
  for (const missing of ["roofAreaUsableM2", "azimuthDeg", "tiltDeg"] as const) {
    const r = resolvePvReadiness({ ...base, site: { ...completeSite, [missing]: null } });
    assert.ok(
      r.missingRequirements.includes("SITE_TECHNICAL_INCOMPLETE"),
      `${missing} absent doit bloquer`,
    );
    assert.equal(r.canGenerateFinalPdf, false);
  }
  // L'azimut 0 (plein nord) est une VALEUR, pas une absence.
  const north = resolvePvReadiness({ ...base, site: { ...completeSite, azimuthDeg: 0 } });
  assert.equal(north.state, "READY_FOR_OFFER");
});

test("17 — une étude NON VALIDÉE bloque READY_FOR_OFFER", () => {
  for (const status of ["DRAFT", "CALCULATED", "NEEDS_REVIEW", "REJECTED", "SUPERSEDED"]) {
    const r = resolvePvReadiness({
      ...base,
      retainedStudy: null,
      latestStudy: { status },
    });
    assert.notEqual(r.state, "READY_FOR_OFFER", `${status} ne doit pas suffire`);
    assert.ok(r.missingRequirements.includes("STUDY_NOT_VALIDATED"));
    assert.equal(r.canGenerateFinalPdf, false);
  }
});

test("18 — un chiffrage NON VÉRIFIÉ bloque READY_FOR_OFFER", () => {
  for (const status of ["DRAFT", "CALCULATED", "NEEDS_REVIEW", "REJECTED"]) {
    const r = resolvePvReadiness({
      ...base,
      retainedEconomics: null,
      hasAnyEconomics: true,
    });
    void status;
    assert.notEqual(r.state, "READY_FOR_OFFER");
    assert.ok(r.missingRequirements.includes("ECONOMICS_NOT_VERIFIED"));
  }
});

test("18b — une consommation NON VÉRIFIÉE bloque, et le dit", () => {
  const r = resolvePvReadiness({
    ...base,
    consumption: { annualConsumptionKwh: 5200, verificationStatus: "UNVERIFIED" },
    verifiedBill: null,
  });
  assert.notEqual(r.state, "READY_FOR_OFFER");
  assert.ok(r.missingRequirements.includes("ENERGY_NOT_VERIFIED"));
  assert.ok(!r.missingRequirements.includes("NO_ENERGY_DATA"), "la donnée existe, elle n'est pas vérifiée");
});

test("18c — une facture VÉRIFIÉE suffit, même sans profil de consommation vérifié", () => {
  const r = resolvePvReadiness({
    ...base,
    consumption: null,
    verifiedBill: { consumptionKwh: 5100 },
  });
  assert.equal(r.state, "READY_FOR_OFFER");
});

test("STUDY_REVIEW_REQUIRED — une étude qui attend un humain prime sur « prêt à étudier »", () => {
  for (const status of ["CALCULATED", "NEEDS_REVIEW"]) {
    const r = resolvePvReadiness({
      ...base,
      retainedStudy: null,
      latestStudy: { status },
      retainedEconomics: null,
      hasAnyEconomics: false,
    });
    assert.equal(r.state, "STUDY_REVIEW_REQUIRED", `${status} doit demander un arbitrage`);
  }
});

test("READY_FOR_STUDY — site et énergie prêts, aucune étude encore", () => {
  const r = resolvePvReadiness({
    ...base,
    retainedStudy: null,
    latestStudy: null,
    retainedEconomics: null,
    hasAnyEconomics: false,
  });
  assert.equal(r.state, "READY_FOR_STUDY");
  assert.ok(r.missingRequirements.includes("NO_STUDY"));
});

test("BLOCKED — un prospect désinscrit ou fermé n'a pas d'avancement", () => {
  const optedOut = resolvePvReadiness({
    ...base,
    prospect: { status: "QUALIFIED", optedOut: true },
  });
  assert.equal(optedOut.state, "BLOCKED");
  assert.deepEqual(optedOut.missingRequirements, ["PROSPECT_OPTED_OUT"]);

  for (const status of ["LOST", "ARCHIVED", "UNQUALIFIED"]) {
    const r = resolvePvReadiness({ ...base, prospect: { status, optedOut: false } });
    assert.equal(r.state, "BLOCKED", `${status} doit arrêter le dossier`);
    assert.deepEqual(r.missingRequirements, ["PROSPECT_CLOSED"]);
    assert.equal(r.canGenerateFinalPdf, false);
  }
});

test("20 — les raisons de blocage sont TOUJOURS explicites et libellées", () => {
  const r = resolvePvReadiness({
    ...base,
    consumption: { annualConsumptionKwh: 5200, verificationStatus: "NEEDS_REVIEW" },
    retainedStudy: null,
    latestStudy: { status: "DRAFT" },
    retainedEconomics: null,
    hasAnyEconomics: false,
  });
  assert.ok(r.missingRequirements.length >= 3);
  // Chaque code renvoyé DOIT être libellé : un code opaque ne fait avancer personne.
  for (const req of r.missingRequirements) {
    assert.ok(PV_REQUIREMENTS.includes(req), `code inconnu: ${req}`);
    assert.ok(
      PV_REQUIREMENT_LABELS[req] && PV_REQUIREMENT_LABELS[req].length > 20,
      `libellé manquant ou trop court pour ${req}`,
    );
  }
});

test("DÉTERMINISME — mêmes entrées, même sortie, quel que soit le nombre d'appels", () => {
  const inputs: PvReadinessInput[] = [
    base,
    { ...base, retainedStudy: null, latestStudy: { status: "CALCULATED" } },
    { ...base, site: null },
    { ...base, prospect: { status: "LOST", optedOut: false } },
  ];
  for (const input of inputs) {
    const a = resolvePvReadiness(input);
    const b = resolvePvReadiness(input);
    const c = resolvePvReadiness({ ...input });
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  }
});

test("chaque état porte un libellé français", () => {
  for (const [state, label] of Object.entries(PV_DEAL_STATE_LABELS)) {
    assert.ok(label.length > 5, `libellé trop court pour ${state}`);
  }
});
