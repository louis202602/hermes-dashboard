import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canConfirmBooking,
  canTransition,
  computeDeposit,
  nextBookingAction,
  type BookingConditions,
  type BookingState,
} from "../lib/photo/booking.ts";
import { scoreLead } from "../lib/photo/leadScore.ts";
import { nextLifecycleOpportunities, type LifecycleRule } from "../lib/photo/lifecycle.ts";
import { canReadResource, filterOwned, projectSection, type PortalScope } from "../lib/photo/portal.ts";
import {
  adaptPayment,
  adaptSignature,
  providerReadiness,
  PAYMENT_ADAPTERS,
  SIGNATURE_ADAPTERS,
} from "../lib/photo/providers.ts";
import { buildUpsellProposals, upsellCounters } from "../lib/photo/upsell.ts";
import { resolveTenantComposition } from "../lib/verticals/composition.ts";

/**
 * HERMÈS STUDIO — simulation DORMANTE de bout en bout.
 *
 * Aucun appel externe, aucune écriture, aucun prestataire. Le parcours complet
 * d'une cliente est joué en mémoire, à travers les moteurs réels, et les
 * chemins d'ÉCHEC sont joués aussi — c'est là que se cache la valeur : un
 * parcours nominal qui marche ne prouve pas qu'un parcours dégradé refuse.
 */

const NOW = new Date("2026-08-20T12:00:00Z");
const TENANT = "studio-vanessa";
const CLIENT = "client-mariage-1";

// ═══ 1. PARCOURS NOMINAL COMPLET ═════════════════════════════════════════════

test("E2E — lead → devis → contrat → acompte → réservation → livraison → upsell → fidélisation", () => {
  const trace: string[] = [];

  // --- (a) LEAD : qualifié par un score déterministe, sans LLM.
  const { score, factors } = scoreLead({
    phone: "+33600000000",
    email: "cliente@example.com",
    requestedDate: "2026-10-03",
    location: "Annecy",
    budgetEur: 2400,
    serviceType: "MARIAGE",
    source: "REFERRAL",
    now: NOW,
  });
  assert.ok(score > 0, "un lead complet doit scorer");
  assert.ok(factors.length > 0, "chaque point doit porter sa raison");
  trace.push(`LEAD score=${score}`);

  // --- (b) ACOMPTE : calculé depuis une règle configurée, jamais deviné.
  const deposit = computeDeposit(2400, { percent: 30, fixedEur: null, minEur: null });
  assert.deepEqual(deposit, { ok: true, amountEur: 720, basis: "PERCENT" });
  trace.push("DEPOSIT=720");

  // --- (c) MACHINE D'ÉTATS : chaque pas est légal, aucun n'est sauté.
  const path: BookingState[] = [
    "QUOTE_DRAFT", "QUOTE_SENT", "QUOTE_ACCEPTED", "CONTRACT_PENDING",
    "CONTRACT_SIGNED", "DEPOSIT_PENDING", "DEPOSIT_PAID", "BOOKING_CONFIRMED",
  ];
  for (let i = 1; i < path.length; i += 1) {
    assert.ok(canTransition(path[i - 1], path[i]), `transition illégale ${path[i - 1]}→${path[i]}`);
  }
  trace.push("PATH=8 étapes légales");

  // --- (d) SIGNATURE : normalisée par l'adaptateur, donc VÉRIFIÉE.
  const sig = adaptSignature("yousign", {
    signature_request_id: "sr_abc123",
    signer_full_name: "Camille D.",
    signed_at: "2026-08-21T09:00:00Z",
    signature_level: "advanced_electronic_signature",
    template_id: "contrat-mariage",
    template_version: "v3",
    status: "done",
  });
  assert.ok(sig.ok, "la signature aurait dû être admise");
  assert.equal(sig.ok && sig.signature.fact.provenance, "VERIFIED");
  trace.push("SIGNATURE=VERIFIED");

  // --- (e) ACOMPTE ENCAISSÉ : idem, par l'adaptateur de paiement.
  const pay = adaptPayment("stripe", {
    id: "pi_abc123",
    amount_received: 72000, // centimes
    currency: "eur",
    status: "succeeded",
    created: 1787000000,
  });
  assert.ok(pay.ok, "le paiement aurait dû être admis");
  assert.equal(pay.ok && pay.payment.amountEur, 720);
  trace.push("PAYMENT=720 VERIFIED");

  // --- (f) LA PORTE : toutes les conditions réunies ⇒ réservation confirmable.
  const conditions: BookingConditions = {
    state: "DEPOSIT_PAID",
    requirements: {
      contractRequired: true,
      signatureRequired: true,
      depositRequired: true,
      humanApprovalRequired: true,
    },
    signature: sig.ok ? sig.signature.fact : null,
    depositPayment: pay.ok ? pay.payment.fact : null,
    depositExpectedEur: 720,
    depositReceivedEur: pay.ok ? pay.payment.amountEur : null,
    humanApproval: { provenance: "VERIFIED", at: NOW, reference: "sw15_req_77" },
    dateAvailable: true,
    now: NOW,
  };
  assert.deepEqual(canConfirmBooking(conditions), { allowed: true });
  assert.equal(nextBookingAction(conditions).action, "CONFIRM_BOOKING");
  trace.push("BOOKING=CONFIRMED");

  // --- (g) LIVRAISON puis UPSELL, depuis le catalogue réel.
  const { proposals } = buildUpsellProposals(
    [{ ruleId: "r1", moment: "AFTER_DELIVERY", sessionTypes: ["MARIAGE"], offeringId: "off-album", priority: 10, active: true }],
    [{ offeringId: "off-album", kind: "ALBUM", label: "Album 30×30", priceEur: 290, active: true, autoProposable: true }],
    { moment: "AFTER_DELIVERY", sessionType: "MARIAGE", alreadyProposedOfferingIds: [], optedOut: false, maxProposals: 3 },
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].amountEur, 290);
  trace.push("UPSELL=290");

  const counters = upsellCounters([{ status: "ACCEPTED", revenueGeneratedEur: 290 }]);
  assert.equal(counters.revenueEur, 290);
  assert.equal(counters.conversionRate, 1);

  // --- (h) FIDÉLISATION : chaînée depuis un fait POSÉ, jamais déduite.
  const rules: LifecycleRule[] = [{
    ruleId: "lr-mariage", anchor: "SESSION_DELIVERED", anchorValue: "MARIAGE",
    offsetMonths: 12, recommendedService: "FAMILLE", leadTimeDays: 60, active: true,
  }];
  const opportunities = nextLifecycleOpportunities(
    [{ kind: "SESSION_DELIVERED", sessionType: "MARIAGE", deliveredAt: new Date("2026-10-10T00:00:00Z") }],
    rules,
    { consentStatus: "GRANTED", consentExpiresAt: null, optedOut: false, hasChannel: true },
    new Date("2027-09-01T00:00:00Z"),
  );
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].recommendedService, "FAMILLE");
  assert.equal(opportunities[0].basedOn, "SESSION_DELIVERED");
  trace.push("LIFECYCLE=FAMILLE");

  assert.equal(trace.length, 8, `parcours incomplet : ${trace.join(" → ")}`);
});

// ═══ 2. CHEMINS D'ÉCHEC — un par barrière ════════════════════════════════════

const baseConditions = (over: Partial<BookingConditions> = {}): BookingConditions => ({
  state: "DEPOSIT_PAID",
  requirements: {
    contractRequired: true, signatureRequired: true,
    depositRequired: true, humanApprovalRequired: false,
  },
  signature: { provenance: "VERIFIED", at: NOW, reference: "sig_ok" },
  depositPayment: { provenance: "VERIFIED", at: NOW, reference: "pi_ok" },
  depositExpectedEur: 720,
  depositReceivedEur: 720,
  humanApproval: null,
  dateAvailable: true,
  now: NOW,
  ...over,
});

test("ÉCHEC — un webhook de paiement mal formé ne produit AUCUN fait", () => {
  for (const bad of [
    null, "payé", [], {},
    { id: "pi_1", amount_received: 72000, currency: "eur", status: "processing", created: 1787000000 },
    { id: "pi_1", amount_received: 72000, currency: "eur", status: "succeeded" }, // pas d'horodatage
    { id: "", amount_received: 72000, currency: "eur", status: "succeeded", created: 1 },
    { id: "pi_1", amount_received: 72000, currency: "btc", status: "succeeded", created: 1 },
    { id: "pi_1", amount_received: "beaucoup", currency: "eur", status: "succeeded", created: 1 },
  ]) {
    const r = adaptPayment("stripe", bad);
    assert.equal(r.ok, false, `charge utile acceptée à tort : ${JSON.stringify(bad)}`);
  }
});

test("ÉCHEC — un prestataire inconnu n'entre jamais dans le système", () => {
  assert.deepEqual(adaptPayment("provider-inconnu", { id: "x" }), { ok: false, code: "UNKNOWN_PROVIDER" });
  assert.deepEqual(adaptSignature("provider-inconnu", { status: "done" }), { ok: false, code: "UNKNOWN_PROVIDER" });
});

test("ÉCHEC — une signature sans référence opposable est refusée", () => {
  const r = adaptSignature("yousign", {
    signature_request_id: "", signed_at: "2026-08-21T09:00:00Z",
    signature_level: "electronic_signature", status: "done",
  });
  assert.deepEqual(r, { ok: false, code: "MISSING_REFERENCE" });
});

test("ÉCHEC — une méthode de signature inconnue n'est pas traçable", () => {
  const r = adaptSignature("yousign", {
    signature_request_id: "sr_1", signed_at: "2026-08-21T09:00:00Z",
    signature_level: "poignée_de_main", status: "done",
  });
  assert.deepEqual(r, { ok: false, code: "SIGNATURE_NOT_TRACEABLE" });
});

test("ÉCHEC — UN PRESTATAIRE NE PEUT PAS CONFIRMER UNE RÉSERVATION", () => {
  // Paiement parfaitement valide, mais contrat non signé : la porte refuse.
  const pay = adaptPayment("stripe", {
    id: "pi_ok", amount_received: 72000, currency: "eur", status: "succeeded", created: 1787000000,
  });
  assert.ok(pay.ok);
  const r = canConfirmBooking(baseConditions({
    signature: null,
    depositPayment: pay.ok ? pay.payment.fact : null,
  }));
  assert.equal(r.allowed, false);
  assert.ok(!r.allowed && r.blockers.includes("CONTRACT_NOT_SIGNED"));
});

test("ÉCHEC — chaque barrière bloque isolément", () => {
  const cases: [string, Partial<BookingConditions>, string][] = [
    ["état incorrect", { state: "QUOTE_SENT" }, "WRONG_STATE"],
    ["acompte non vérifié", { depositPayment: { provenance: "DECLARED", at: NOW, reference: "je confirme" } }, "DEPOSIT_NOT_VERIFIED"],
    ["acompte partiel", { depositReceivedEur: 719.99 }, "DEPOSIT_INSUFFICIENT"],
    ["montant inconnu", { depositExpectedEur: null }, "DEPOSIT_AMOUNT_UNKNOWN"],
    ["date prise", { dateAvailable: false }, "DATE_NOT_AVAILABLE"],
    ["disponibilité inconnue", { dateAvailable: null }, "DATE_AVAILABILITY_UNKNOWN"],
  ];
  for (const [label, over, expected] of cases) {
    const r = canConfirmBooking(baseConditions(over));
    assert.ok(!r.allowed && r.blockers.includes(expected as never), `${label} : ${expected} absent`);
  }
});

test("ÉCHEC — l'approbation humaine exigée et absente bloque, même tout le reste OK", () => {
  const r = canConfirmBooking(baseConditions({
    requirements: { contractRequired: true, signatureRequired: true, depositRequired: true, humanApprovalRequired: true },
    humanApproval: null,
  }));
  assert.ok(!r.allowed && r.blockers.includes("HUMAN_APPROVAL_MISSING"));
});

test("ÉCHEC — sans consentement, la fidélisation est vue mais jamais envoyée", () => {
  const out = nextLifecycleOpportunities(
    [{ kind: "SESSION_DELIVERED", sessionType: "MARIAGE", deliveredAt: new Date("2026-10-10T00:00:00Z") }],
    [{ ruleId: "lr", anchor: "SESSION_DELIVERED", anchorValue: "MARIAGE", offsetMonths: 12, recommendedService: "FAMILLE", leadTimeDays: 60, active: true }],
    { consentStatus: "REVOKED", consentExpiresAt: null, optedOut: false, hasChannel: true },
    new Date("2027-09-01T00:00:00Z"),
  );
  assert.equal(out.length, 1, "l'opportunité doit rester VISIBLE pour la photographe");
  assert.equal(out[0].contactAllowed, false);
  assert.equal(out[0].nextAction, "ASK_HUMAN");
});

// ═══ 3. PORTAIL — audit d'isolation renforcé ═════════════════════════════════

const vanessaScope: PortalScope = {
  tenantId: TENANT, clientId: CLIENT,
  expiresAt: new Date("2026-09-20T00:00:00Z"), revokedAt: null,
};

test("PORTAIL — jeton client A → JAMAIS une ressource du client B", () => {
  const r = canReadResource(vanessaScope, { tenantId: TENANT, clientId: "client-autre" }, NOW);
  assert.ok(!r.allowed && r.code === "CLIENT_MISMATCH");
});

test("PORTAIL — jeton Vanessa → JAMAIS le tenant heliosolar", () => {
  const r = canReadResource(vanessaScope, { tenantId: "heliosolar", clientId: CLIENT }, NOW);
  assert.ok(!r.allowed && r.code === "TENANT_MISMATCH");
  // Et dans l'autre sens : un jeton heliosolar ne lit rien du studio.
  const helio: PortalScope = { ...vanessaScope, tenantId: "heliosolar" };
  const back = canReadResource(helio, { tenantId: TENANT, clientId: CLIENT }, NOW);
  assert.ok(!back.allowed && back.code === "TENANT_MISMATCH");
});

test("PORTAIL — jeton expiré ou révoqué → refus, et rien n'est rendu", () => {
  const expired: PortalScope = { ...vanessaScope, expiresAt: new Date("2026-08-01T00:00:00Z") };
  const revoked: PortalScope = { ...vanessaScope, revokedAt: NOW };
  const mine = [{ tenantId: TENANT, clientId: CLIENT, id: "a" }];
  for (const [label, scope, code] of [["expiré", expired, "EXPIRED"], ["révoqué", revoked, "REVOKED"]] as const) {
    const r = canReadResource(scope, mine[0], NOW);
    assert.ok(!r.allowed && r.code === code, `${label} accepté`);
    assert.deepEqual(filterOwned(scope, mine, NOW), [], `${label} : des données sortent`);
  }
});

test("PORTAIL — une ressource sans client_id est refusée, même du bon tenant", () => {
  const r = canReadResource(vanessaScope, { tenantId: TENANT, clientId: null }, NOW);
  assert.ok(!r.allowed && r.code === "RESOURCE_UNIDENTIFIED");
});

test("PORTAIL — AUCUN champ interne ne peut sortir", () => {
  const leaky = {
    sessionType: "MARIAGE", scheduledAt: "2026-10-03", status: "BOOKED",
    leadScore: 87, crmExternalId: "notion-abc", lifetimeValueEur: 4200,
    cost: 120, margin: 0.42, internalNotes: "cliente exigeante",
    vaultSecretId: "0000-1111", notes: "interne",
  };
  const out = projectSection("session", leaky);
  for (const forbidden of [
    "leadScore", "crmExternalId", "lifetimeValueEur", "cost", "margin",
    "internalNotes", "vaultSecretId", "notes",
  ]) {
    assert.ok(!(forbidden in out), `fuite du champ interne : ${forbidden}`);
  }
  assert.deepEqual(Object.keys(out).sort(), ["scheduledAt", "sessionType", "status"]);
});

// ═══ 4. INTÉGRATION DES 5 MODULES DANS LE MOTEUR ═════════════════════════════

test("les 5 modules Studio sont reconnus par la composition", () => {
  const c = resolveTenantComposition({
    capabilityKeys: [
      "photo.studio", "photo.quote.send", "photo.payment.record",
      "photo.lead.create", "photo.marketing.publish",
    ],
  });
  for (const m of ["photo.quotes", "photo.payments", "photo.portal", "photo.upsell", "photo.lifecycle"]) {
    assert.ok(c.modules.includes(m as never), `module non reconnu : ${m}`);
  }
});

test("AUCUN module photo n'apparaît pour heliosolar", () => {
  const helio = resolveTenantComposition({
    capabilityKeys: [
      "btp.qualification.create", "btp.planning.phase.add",
      "btp.suivi.progress.report", "diag.echo", "hermes.intent.resolve",
    ],
  });
  const leak = helio.modules.find((m) => m.startsWith("photo."));
  assert.equal(leak, undefined, `module photo chez heliosolar : ${leak}`);
  const navLeak = helio.navigation.find((n) => n.moduleId.startsWith("photo."));
  assert.equal(navLeak, undefined, `entrée photo au menu heliosolar : ${navLeak?.moduleId}`);
});

test("un module non activé ⇒ aucune entrée, même si la verticale le cite", () => {
  // Verticale photographie SANS les capacités de commerce.
  const minimal = resolveTenantComposition({ capabilityKeys: ["photo.studio"] });
  assert.equal(minimal.vertical, "photography");
  for (const m of ["photo.quotes", "photo.payments"]) {
    assert.ok(!minimal.modules.includes(m as never), `${m} accordé sans capacité`);
  }
  assert.ok(minimal.modules.includes("photo.sessions"));
});

// ═══ 5. PRESTATAIRES — déclarés, aucun implémenté ════════════════════════════

test("aucun prestataire n'est implémenté, et le code n'en exige aucun", () => {
  const r = providerReadiness();
  assert.equal(r.payment.implemented, 0);
  assert.equal(r.signature.implemented, 0);
  assert.ok(r.payment.declared >= 2);
  assert.ok(r.signature.declared >= 2);
  assert.equal(r.codeRequiresProvider, false);
  for (const a of [...PAYMENT_ADAPTERS, ...SIGNATURE_ADAPTERS]) {
    assert.equal(a.implemented, false, `${a.provider} marqué implémenté à tort`);
  }
});

test("aucun adaptateur ne porte de secret ni d'appel réseau", () => {
  const src = readFileSync(new URL("../lib/photo/providers.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of ["process.env", "fetch(", "api_key", "secret", "webhook_secret"]) {
    assert.ok(!src.toLowerCase().includes(forbidden.toLowerCase()), `adaptateur impur : ${forbidden}`);
  }
});
