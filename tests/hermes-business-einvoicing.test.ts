import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyEinvoicingReply,
  nextCommercialAction,
  scoreEinvoicingProspect,
  shouldStopOutbound,
  validateEinvoicingDiagnostic,
} from "@/lib/hermes-business-einvoicing";

const fullEvidence = {
  companyIdentityStatus: true,
  activity: true,
  officialOrCorroboratedDomain: true,
  professionalContact: true,
};

test("scoring is niche-scoped and reaches P1 at 100", () => {
  const result = scoreEinvoicingProspect({
    employeeCount: 12,
    clearB2b: true,
    recurringInvoicingProbable: true,
    prioritySector: true,
    verifiedCompanyWebsite: true,
    verifiedProfessionalEmail: true,
    decisionMakerIdentified: true,
    softwareAbsentLegacyOrUnclear: true,
    adminOrDigitalHelpSignal: true,
    evidence: fullEvidence,
  });
  assert.equal(result.nicheId, "facturation_electronique_fr_v1");
  assert.equal(result.score, 100);
  assert.equal(result.tier, "P1");
  assert.equal(result.hardFail, false);
});

test("critical evidence fails closed into REVIEW regardless of commercial score", () => {
  const result = scoreEinvoicingProspect({
    employeeCount: 10,
    clearB2b: true,
    recurringInvoicingProbable: true,
    prioritySector: true,
    verifiedCompanyWebsite: true,
    verifiedProfessionalEmail: true,
    decisionMakerIdentified: true,
    softwareAbsentLegacyOrUnclear: true,
    adminOrDigitalHelpSignal: true,
    evidence: { ...fullEvidence, professionalContact: false },
  });
  assert.equal(result.score, 0);
  assert.equal(result.tier, "REVIEW");
  assert.equal(result.hardFail, true);
});

test("DNC overrides everything and rejects", () => {
  const result = scoreEinvoicingProspect({
    employeeCount: 8,
    clearB2b: true,
    recurringInvoicingProbable: true,
    prioritySector: true,
    verifiedCompanyWebsite: true,
    verifiedProfessionalEmail: true,
    evidence: fullEvidence,
    doNotContact: true,
  });
  assert.equal(result.tier, "REJECT");
  assert.equal(result.hardFail, true);
  assert.deepEqual(result.reasons, ["do_not_contact"]);
});

const replyFixtures: Array<[string, ReturnType<typeof classifyEinvoicingReply>]> = [
  ["Merci de ne plus me contacter.", "REFUSAL"],
  ["Non merci, pas intéressé.", "REFUSAL"],
  ["STOP", "REFUSAL"],
  ["Retirez-nous de votre liste.", "REFUSAL"],
  ["Notre expert-comptable s'en occupe.", "ACCOUNTANT_HANDLES_IT"],
  ["Voyez avec mon comptable, il gère ça.", "ACCOUNTANT_HANDLES_IT"],
  ["Notre cabinet comptable gère la réforme.", "ACCOUNTANT_HANDLES_IT"],
  ["Nous avons déjà choisi une plateforme agréée.", "HAS_PLATFORM"],
  ["On a déjà une plateforme.", "HAS_PLATFORM"],
  ["La plateforme est déjà choisie.", "HAS_PLATFORM"],
  ["Nous utilisons Sage pour facturer.", "HAS_SOFTWARE"],
  ["Nous avons un logiciel de facturation.", "HAS_SOFTWARE"],
  ["On utilise EBP pour facturer.", "HAS_SOFTWARE"],
  ["Notre ERP gère la facturation.", "HAS_SOFTWARE"],
  ["Nous sommes déjà prêts et opérationnels.", "READY"],
  ["Tout est configuré chez nous.", "READY"],
  ["Nous sommes déjà configurés.", "READY"],
  ["Nous n'avons rien fait pour le moment.", "NOT_READY"],
  ["Pas encore choisi de plateforme.", "NOT_READY"],
  ["On n'a rien fait.", "NOT_READY"],
  ["Aucune plateforme pour l'instant.", "NOT_READY"],
  ["Cela m'intéresse, envoyez-moi plus d'informations.", "INTERESTED"],
  ["Pouvez-vous m'envoyer vos tarifs ?", "INTERESTED"],
  ["Je veux un rendez-vous.", "INTERESTED"],
  ["Pouvez-vous m'expliquer votre offre ?", "INTERESTED"],
  ["Quand devons-nous être prêts ?", "QUESTION"],
  ["Comment fonctionne la réception ?", "QUESTION"],
  ["Est-ce que cela concerne les micro-entreprises ?", "QUESTION"],
  ["Bonjour, j'ai bien reçu votre message.", "UNSURE"],
  ["Merci pour votre email.", "UNSURE"],
  ["", "UNSURE"],
];

for (const [index, [input, expected]] of replyFixtures.entries()) {
  test(`reply classifier fixture ${index + 1}: ${expected}`, () => {
    assert.equal(classifyEinvoicingReply(input), expected);
  });
}

test("outbound stops on READY and REFUSAL only", () => {
  assert.equal(shouldStopOutbound("READY"), true);
  assert.equal(shouldStopOutbound("REFUSAL"), true);
  assert.equal(shouldStopOutbound("INTERESTED"), false);
  assert.equal(shouldStopOutbound("UNSURE"), false);
});

test("complete diagnostic is accepted", () => {
  const result = validateEinvoicingDiagnostic({
    sirenSiret: "123 456 789",
    employeeBand: "10-19",
    vatSituation: "assujetti",
    customerMix: ["B2B_FR"],
    currentInvoicingSoftware: "Sage",
    approvedPlatformSelected: "NO",
    invoiceVolumeMonthly: 80,
    numberOfUsersEntities: 2,
    receptionOperational: "NO",
    emissionPreparationNeeded: "YES",
  });
  assert.deepEqual(result, { complete: true, missing: [], invalid: [] });
});

test("diagnostic fails closed on missing/invalid fields", () => {
  const result = validateEinvoicingDiagnostic({
    sirenSiret: "123",
    employeeBand: "2-9",
    vatSituation: "assujetti",
    customerMix: ["B2B_FR"],
    currentInvoicingSoftware: "aucun",
    approvedPlatformSelected: "UNKNOWN",
    invoiceVolumeMonthly: -1,
    numberOfUsersEntities: 0,
    receptionOperational: "UNKNOWN",
    emissionPreparationNeeded: "UNKNOWN",
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.invalid.sort(), ["invoice_volume_monthly", "number_of_users_entities", "siren_siret"].sort());
});

test("commercial routing never auto-answers unsure replies", () => {
  assert.equal(nextCommercialAction("REFUSAL"), "STOP_DNC");
  assert.equal(nextCommercialAction("READY"), "CLOSE_READY");
  assert.equal(nextCommercialAction("NOT_READY"), "OPEN_DIAGNOSTIC");
  assert.equal(nextCommercialAction("QUESTION"), "ANSWER_FROM_OFFICIAL_SOURCE");
  assert.equal(nextCommercialAction("UNSURE"), "HUMAN_REVIEW");
});
