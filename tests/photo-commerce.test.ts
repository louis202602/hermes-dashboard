import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  BOOKING_STATES,
  BOOKING_TRANSITIONS,
  canConfirmBooking,
  canTransition,
  computeDeposit,
  factHolds,
  isQuoteExpired,
  nextBookingAction,
  type BookingConditions,
  type VerifiedFact,
} from "../lib/photo/booking.ts";
import {
  DEFAULT_CADENCE,
  decideMissedCallRecovery,
  effectiveCadence,
  quoteFollowUpStage,
} from "../lib/photo/recovery.ts";
import {
  canReadResource,
  filterOwned,
  isScopeUsable,
  PORTAL_FIELDS,
  PORTAL_SECTIONS,
  projectSection,
  visibleSections,
  type PortalScope,
} from "../lib/photo/portal.ts";
import {
  buildUpsellProposals,
  resolveReferral,
  upsellCounters,
  type UpsellOffering,
  type UpsellRule,
} from "../lib/photo/upsell.ts";
import {
  addMonths,
  contactAllowed,
  nextLifecycleOpportunities,
  type LifecycleFact,
  type LifecycleRule,
} from "../lib/photo/lifecycle.ts";
import {
  kpiAmount,
  kpiRatio,
  STUDIO_KPI_KEYS,
  STUDIO_KPI_REGISTRY,
  unmeasuredKpis,
} from "../lib/photo/studioKpi.ts";

/**
 * HERMÈS STUDIO P2 — les 5 briques prioritaires.
 *
 * Chaque test porte sur un invariant qu'un LLM trop sûr de lui casserait :
 * réserver sans paiement, chiffrer un produit inexistant, écrire à quelqu'un
 * sans consentement, montrer à un client le dossier d'un autre.
 */

const NOW = new Date("2026-08-20T12:00:00Z");
const verified = (ref: string, at = NOW): VerifiedFact => ({
  provenance: "VERIFIED",
  at,
  reference: ref,
});
const declared: VerifiedFact = { provenance: "DECLARED", at: NOW, reference: "je confirme" };

// ═══ BRIQUE 1 — devis → contrat → acompte → réservation ═══════════════════════

test("la machine d'états couvre les 9 états du brief + l'expiration", () => {
  for (const s of [
    "QUOTE_DRAFT", "QUOTE_SENT", "QUOTE_ACCEPTED", "CONTRACT_PENDING", "CONTRACT_SIGNED",
    "DEPOSIT_PENDING", "DEPOSIT_PAID", "BOOKING_CONFIRMED", "CANCELLED",
  ]) {
    assert.ok((BOOKING_STATES as readonly string[]).includes(s), `état manquant : ${s}`);
  }
  assert.ok((BOOKING_STATES as readonly string[]).includes("QUOTE_EXPIRED"));
});

test("on ne saute aucune étape", () => {
  assert.equal(canTransition("QUOTE_SENT", "BOOKING_CONFIRMED"), false);
  assert.equal(canTransition("QUOTE_DRAFT", "DEPOSIT_PAID"), false);
  assert.equal(canTransition("QUOTE_ACCEPTED", "CONTRACT_SIGNED"), false);
  assert.equal(canTransition("DEPOSIT_PAID", "BOOKING_CONFIRMED"), true);
});

test("une annulation est toujours possible, sauf depuis un état terminal", () => {
  for (const s of BOOKING_STATES) {
    if (s === "CANCELLED") continue;
    assert.equal(canTransition(s, "CANCELLED"), true, `${s} devrait pouvoir s'annuler`);
  }
  assert.deepEqual(BOOKING_TRANSITIONS.CANCELLED, []);
});

test("un contrat signé ne redevient jamais un brouillon", () => {
  assert.equal(canTransition("CONTRACT_SIGNED", "QUOTE_DRAFT"), false);
  assert.equal(canTransition("BOOKING_CONFIRMED", "QUOTE_SENT"), false);
  // Seule exception assumée : un devis expiré peut être réémis.
  assert.equal(canTransition("QUOTE_EXPIRED", "QUOTE_DRAFT"), true);
});

test("un fait DÉCLARÉ ne vaut rien — seul un fait VÉRIFIÉ compte", () => {
  assert.equal(factHolds(verified("pi_123")), true);
  assert.equal(factHolds(declared), false);
  assert.equal(factHolds({ provenance: "VERIFIED", at: null, reference: "x" }), false);
  assert.equal(factHolds({ provenance: "VERIFIED", at: NOW, reference: "" }), false);
  assert.equal(factHolds(null), false);
});

const fullRequirements = {
  contractRequired: true,
  signatureRequired: true,
  depositRequired: true,
  humanApprovalRequired: false,
};

const okConditions: BookingConditions = {
  state: "DEPOSIT_PAID",
  requirements: fullRequirements,
  signature: verified("sig_abc"),
  depositPayment: verified("pi_abc"),
  depositExpectedEur: 300,
  depositReceivedEur: 300,
  humanApproval: null,
  dateAvailable: true,
  now: NOW,
};

test("toutes conditions réunies ⇒ la réservation est confirmable", () => {
  assert.deepEqual(canConfirmBooking(okConditions), { allowed: true });
});

test("AUCUNE réservation sur simple affirmation : le paiement doit être vérifié", () => {
  const r = canConfirmBooking({ ...okConditions, depositPayment: declared });
  assert.equal(r.allowed, false);
  assert.ok(!r.allowed && r.blockers.includes("DEPOSIT_NOT_VERIFIED"));
});

test("une signature non traçable bloque et se distingue d'une absence de signature", () => {
  const notTraceable = canConfirmBooking({ ...okConditions, signature: declared });
  assert.ok(!notTraceable.allowed && notTraceable.blockers.includes("SIGNATURE_NOT_TRACEABLE"));
  const missing = canConfirmBooking({ ...okConditions, signature: null });
  assert.ok(!missing.allowed && missing.blockers.includes("CONTRACT_NOT_SIGNED"));
});

test("un acompte partiel ne réserve pas", () => {
  const r = canConfirmBooking({ ...okConditions, depositReceivedEur: 299.99 });
  assert.ok(!r.allowed && r.blockers.includes("DEPOSIT_INSUFFICIENT"));
});

test("un montant d'acompte inconnu bloque — il n'est jamais supposé payé", () => {
  const r = canConfirmBooking({ ...okConditions, depositExpectedEur: null });
  assert.ok(!r.allowed && r.blockers.includes("DEPOSIT_AMOUNT_UNKNOWN"));
});

test("une disponibilité INCONNUE bloque autant qu'une date prise", () => {
  const unknown = canConfirmBooking({ ...okConditions, dateAvailable: null });
  assert.ok(!unknown.allowed && unknown.blockers.includes("DATE_AVAILABILITY_UNKNOWN"));
  const taken = canConfirmBooking({ ...okConditions, dateAvailable: false });
  assert.ok(!taken.allowed && taken.blockers.includes("DATE_NOT_AVAILABLE"));
});

test("une approbation humaine exigée et absente bloque", () => {
  const r = canConfirmBooking({
    ...okConditions,
    requirements: { ...fullRequirements, humanApprovalRequired: true },
  });
  assert.ok(!r.allowed && r.blockers.includes("HUMAN_APPROVAL_MISSING"));
});

test("tous les obstacles sont rendus d'un coup, pas un par un", () => {
  const r = canConfirmBooking({
    state: "QUOTE_SENT",
    requirements: { ...fullRequirements, humanApprovalRequired: true },
    signature: null,
    depositPayment: null,
    depositExpectedEur: null,
    depositReceivedEur: null,
    humanApproval: null,
    dateAvailable: null,
    now: NOW,
  });
  assert.ok(!r.allowed);
  assert.ok(r.blockers.length >= 5, `un seul obstacle rendu : ${r.blockers.join(",")}`);
});

test("l'acompte se calcule depuis une règle configurée, jamais par défaut", () => {
  assert.deepEqual(computeDeposit(1000, { percent: 30, fixedEur: null, minEur: null }), {
    ok: true, amountEur: 300, basis: "PERCENT",
  });
  assert.deepEqual(computeDeposit(1000, { percent: null, fixedEur: 250, minEur: null }), {
    ok: true, amountEur: 250, basis: "FIXED",
  });
  // Aucune règle ⇒ ERREUR, surtout pas 0 € (qui réserverait gratuitement).
  assert.deepEqual(computeDeposit(1000, null), { ok: false, code: "NO_RULE" });
  assert.deepEqual(computeDeposit(null, { percent: 30, fixedEur: null, minEur: null }), {
    ok: false, code: "NO_TOTAL",
  });
  assert.deepEqual(
    computeDeposit(1000, { percent: 30, fixedEur: 250, minEur: null }),
    { ok: false, code: "AMBIGUOUS_RULE" },
  );
  assert.deepEqual(computeDeposit(1000, { percent: 150, fixedEur: null, minEur: null }), {
    ok: false, code: "INVALID_RULE",
  });
});

test("le plancher s'applique, mais l'acompte ne dépasse jamais le total", () => {
  assert.deepEqual(computeDeposit(200, { percent: 10, fixedEur: null, minEur: 100 }), {
    ok: true, amountEur: 100, basis: "PERCENT",
  });
  assert.deepEqual(computeDeposit(50, { percent: 10, fixedEur: null, minEur: 100 }), {
    ok: true, amountEur: 50, basis: "PERCENT",
  });
});

test("la prochaine action ne saute jamais une étape non remplie", () => {
  assert.equal(nextBookingAction(okConditions).action, "CONFIRM_BOOKING");
  assert.equal(
    nextBookingAction({ ...okConditions, depositPayment: declared }).action,
    "RESOLVE_BLOCKERS",
  );
  assert.equal(nextBookingAction({ ...okConditions, state: "QUOTE_SENT" }).action,
    "AWAIT_QUOTE_RESPONSE");
  assert.equal(nextBookingAction({ ...okConditions, state: "QUOTE_EXPIRED" }).action,
    "REISSUE_QUOTE");
});

test("un devis sans date de validité n'expire pas tout seul", () => {
  assert.equal(isQuoteExpired(null, NOW), false);
  assert.equal(isQuoteExpired(new Date("2026-08-19T00:00:00Z"), NOW), true);
  assert.equal(isQuoteExpired(new Date("2026-09-01T00:00:00Z"), NOW), false);
});

// ═══ BRIQUE 2 — relances & appels manqués ═════════════════════════════════════

test("la cadence d'un studio peut RESSERRER, jamais desserrer", () => {
  const loose = effectiveCadence({ minHoursBetweenAny: 1, maxTotalPerLead: 99, maxPerReason: 9 });
  assert.equal(loose.minHoursBetweenAny, DEFAULT_CADENCE.minHoursBetweenAny);
  assert.equal(loose.maxTotalPerLead, DEFAULT_CADENCE.maxTotalPerLead);
  assert.equal(loose.maxPerReason, DEFAULT_CADENCE.maxPerReason);

  const strict = effectiveCadence({ minHoursBetweenAny: 168, maxTotalPerLead: 1 });
  assert.equal(strict.minHoursBetweenAny, 168);
  assert.equal(strict.maxTotalPerLead, 1);
});

const missedBase = {
  callStatus: "ABANDONED",
  callerPhone: "+33600000000",
  existingLeadId: null,
  optedOut: false,
  sentTotal: 0,
  sentForMissedCall: 0,
  lastFollowUpAt: null,
  smsAllowed: true,
  callerPhoneUsable: true,
  cadence: DEFAULT_CADENCE,
  now: NOW,
};

test("un appel manqué crée le lead ET prépare le SMS quand tout est permis", () => {
  const d = decideMissedCallRecovery(missedBase);
  assert.equal(d.leadAction, "CREATE_LEAD");
  assert.equal(d.contactAction, "SEND_SMS");
});

test("le lead est TOUJOURS enregistré, même quand aucun message ne peut partir", () => {
  for (const variant of [
    { optedOut: true },
    { smsAllowed: false },
    { sentTotal: 3 },
    { lastFollowUpAt: new Date(NOW.getTime() - 3600_000).toISOString() },
  ]) {
    const d = decideMissedCallRecovery({ ...missedBase, ...variant });
    assert.notEqual(d.leadAction, "NONE", `lead perdu pour ${JSON.stringify(variant)}`);
  }
});

test("opposition ⇒ aucun contact, jamais", () => {
  const d = decideMissedCallRecovery({ ...missedBase, optedOut: true });
  assert.equal(d.contactAction, "NONE");
  assert.equal(d.code, "OPTED_OUT");
});

test("SMS non autorisé par le studio ⇒ rappel préparé, rien n'est envoyé", () => {
  const d = decideMissedCallRecovery({ ...missedBase, smsAllowed: false });
  assert.equal(d.contactAction, "PREPARE_CALLBACK");
  assert.equal(d.code, "SMS_NOT_ALLOWED");
});

test("quota épuisé ⇒ la main revient à l'humaine, pas au silence", () => {
  const d = decideMissedCallRecovery({ ...missedBase, sentTotal: 3 });
  assert.equal(d.contactAction, "PREPARE_CALLBACK");
});

test("numéro masqué ⇒ mise en file humaine, aucun lead fantôme", () => {
  const d = decideMissedCallRecovery({ ...missedBase, callerPhoneUsable: false });
  assert.equal(d.leadAction, "NONE");
  assert.equal(d.contactAction, "QUEUE_FOR_HUMAN");
});

test("un appel abouti n'est pas un appel manqué", () => {
  const d = decideMissedCallRecovery({ ...missedBase, callStatus: "COMPLETED" });
  assert.deepEqual(d, { leadAction: "NONE", contactAction: "NONE", code: "NOT_A_MISSED_CALL" });
});

test("la séquence de relance de devis suit envoyé → 1ʳᵉ → 2ᵈᵉ → expiré → abandon", () => {
  const base = { quoteExpiresAt: null, lastInboundAt: null, cadence: DEFAULT_CADENCE, now: NOW };
  const sentAt = new Date("2026-08-15T12:00:00Z");
  assert.equal(quoteFollowUpStage({ ...base, quoteSentAt: sentAt, remindersSent: 0 }).stage,
    "FIRST_REMINDER");
  assert.equal(quoteFollowUpStage({ ...base, quoteSentAt: sentAt, remindersSent: 1 }).stage,
    "SECOND_REMINDER");
  assert.equal(quoteFollowUpStage({ ...base, quoteSentAt: sentAt, remindersSent: 3 }).stage,
    "ABANDONED");
  assert.equal(
    quoteFollowUpStage({
      ...base, quoteSentAt: sentAt, remindersSent: 0,
      quoteExpiresAt: new Date("2026-08-18T00:00:00Z"),
    }).stage,
    "EXPIRED",
  );
  assert.equal(
    quoteFollowUpStage({ ...base, quoteSentAt: new Date("2026-05-01T00:00:00Z"), remindersSent: 0 }).stage,
    "ABANDONED",
  );
});

test("un client qui a répondu sort de la séquence de relance", () => {
  const s = quoteFollowUpStage({
    quoteSentAt: new Date("2026-08-15T12:00:00Z"),
    quoteExpiresAt: null,
    lastInboundAt: new Date("2026-08-16T09:00:00Z"),
    remindersSent: 0,
    cadence: DEFAULT_CADENCE,
    now: NOW,
  });
  assert.equal(s.stage, "NOT_APPLICABLE");
});

test("une expiration proche prime sur « pas de réponse »", () => {
  const s = quoteFollowUpStage({
    quoteSentAt: new Date("2026-08-15T12:00:00Z"),
    quoteExpiresAt: new Date("2026-08-23T00:00:00Z"),
    lastInboundAt: null,
    remindersSent: 0,
    cadence: DEFAULT_CADENCE,
    now: NOW,
  });
  assert.equal(s.reason, "OFFER_EXPIRING");
});

// ═══ BRIQUE 3 — portail client ════════════════════════════════════════════════

const scope: PortalScope = {
  tenantId: "studio-vanessa",
  clientId: "client-1",
  expiresAt: new Date("2026-09-20T00:00:00Z"),
  revokedAt: null,
};

test("un jeton sans expiration est REFUSÉ, pas éternel", () => {
  const r = isScopeUsable({ ...scope, expiresAt: null }, NOW);
  assert.ok(!r.allowed && r.code === "EXPIRED");
});

test("un jeton expiré ou révoqué ne passe pas", () => {
  const expired = isScopeUsable({ ...scope, expiresAt: new Date("2026-08-01T00:00:00Z") }, NOW);
  assert.ok(!expired.allowed && expired.code === "EXPIRED");
  const revoked = isScopeUsable({ ...scope, revokedAt: NOW }, NOW);
  assert.ok(!revoked.allowed && revoked.code === "REVOKED");
});

test("AUCUN client ne lit le dossier d'un autre client", () => {
  const other = { tenantId: "studio-vanessa", clientId: "client-2" };
  const r = canReadResource(scope, other, NOW);
  assert.ok(!r.allowed && r.code === "CLIENT_MISMATCH");
});

test("AUCUN client ne lit le dossier d'un autre tenant", () => {
  const other = { tenantId: "heliosolar", clientId: "client-1" };
  const r = canReadResource(scope, other, NOW);
  assert.ok(!r.allowed && r.code === "TENANT_MISMATCH");
});

test("le bon tenant NE SUFFIT PAS : les deux appartenances sont exigées", () => {
  assert.ok(canReadResource(scope, { tenantId: "studio-vanessa", clientId: "client-1" }, NOW).allowed);
  assert.ok(!canReadResource(scope, { tenantId: "studio-vanessa", clientId: null }, NOW).allowed);
});

test("un filtrage de collection ne laisse passer que ce qui appartient au client", () => {
  const rows = [
    { tenantId: "studio-vanessa", clientId: "client-1", id: "a" },
    { tenantId: "studio-vanessa", clientId: "client-2", id: "b" },
    { tenantId: "heliosolar", clientId: "client-1", id: "c" },
    { tenantId: null, clientId: null, id: "d" },
  ];
  assert.deepEqual(filterOwned(scope, rows, NOW).map((r) => r.id), ["a"]);
});

test("un jeton inutilisable ne rend RIEN, même sur des données qui lui appartiennent", () => {
  const rows = [{ tenantId: "studio-vanessa", clientId: "client-1", id: "a" }];
  assert.deepEqual(filterOwned({ ...scope, revokedAt: NOW }, rows, NOW), []);
});

test("le portail ne projette QUE sa liste blanche", () => {
  const row = {
    sessionType: "MARIAGE",
    scheduledAt: "2026-09-01",
    status: "BOOKED",
    // Champs internes qui ne doivent JAMAIS sortir :
    notes: "cliente difficile",
    leadScore: 87,
    lifetimeValueEur: 4200,
    crmExternalId: "notion-abc",
  };
  const projected = projectSection("session", row);
  assert.deepEqual(Object.keys(projected).sort(), ["scheduledAt", "sessionType", "status"]);
  for (const leak of ["notes", "leadScore", "lifetimeValueEur", "crmExternalId"]) {
    assert.ok(!(leak in projected), `fuite : ${leak}`);
  }
});

test("chaque section du portail déclare ses champs — aucune n'est vide par oubli", () => {
  for (const s of PORTAL_SECTIONS) {
    assert.ok((PORTAL_FIELDS[s] ?? []).length > 0, `section sans champs : ${s}`);
  }
});

test("une section vide n'est pas affichée : pas d'onglet Galerie sans galerie", () => {
  const shown = visibleSections(["session", "gallery", "invoices"], ["session"]);
  assert.deepEqual(shown, ["session"]);
});

// ═══ BRIQUE 4 — upsell & parrainage ═══════════════════════════════════════════

const catalog: UpsellOffering[] = [
  { offeringId: "off-album", kind: "ALBUM", label: "Album 30×30", priceEur: 290, active: true, autoProposable: true },
  { offeringId: "off-coffret", kind: "COFFRET", label: "Coffret tirages", priceEur: null, active: true, autoProposable: true },
  { offeringId: "off-old", kind: "TIRAGE", label: "Tirage retiré", priceEur: 40, active: false, autoProposable: true },
];
const rules: UpsellRule[] = [
  { ruleId: "r1", moment: "AFTER_DELIVERY", sessionTypes: [], offeringId: "off-album", priority: 10, active: true },
  { ruleId: "r2", moment: "AFTER_DELIVERY", sessionTypes: [], offeringId: "off-coffret", priority: 20, active: true },
  { ruleId: "r3", moment: "AFTER_DELIVERY", sessionTypes: [], offeringId: "off-old", priority: 30, active: true },
  { ruleId: "r4", moment: "AFTER_DELIVERY", sessionTypes: [], offeringId: "off-inexistant", priority: 40, active: true },
];
const ctx = {
  moment: "AFTER_DELIVERY" as const,
  sessionType: "MARIAGE",
  alreadyProposedOfferingIds: [],
  optedOut: false,
  maxProposals: 5,
};

test("un prix ne peut venir QUE du catalogue réel", () => {
  const { proposals } = buildUpsellProposals(rules, catalog, ctx);
  const album = proposals.find((p) => p.offeringId === "off-album");
  assert.equal(album?.amountEur, 290);
  assert.equal(album?.quotable, true);
});

test("une offre sans prix ne produit AUCUN montant — elle n'est pas chiffrée", () => {
  const { proposals } = buildUpsellProposals(rules, catalog, ctx);
  const coffret = proposals.find((p) => p.offeringId === "off-coffret");
  assert.equal(coffret?.amountEur, null);
  assert.equal(coffret?.quotable, false);
});

test("une offre inexistante ou inactive ne devient jamais une proposition", () => {
  const { proposals, refusals } = buildUpsellProposals(rules, catalog, ctx);
  assert.ok(!proposals.some((p) => p.offeringId === "off-inexistant"));
  assert.ok(!proposals.some((p) => p.offeringId === "off-old"));
  assert.ok(refusals.some((r) => r.code === "OFFERING_UNKNOWN"));
  assert.ok(refusals.some((r) => r.code === "OFFERING_INACTIVE"));
});

test("opposition ⇒ aucune proposition commerciale", () => {
  const { proposals } = buildUpsellProposals(rules, catalog, { ...ctx, optedOut: true });
  assert.deepEqual(proposals, []);
});

test("plafond de propositions inconnu ⇒ on ne propose rien", () => {
  const { proposals, refusals } = buildUpsellProposals(rules, catalog, { ...ctx, maxProposals: null });
  assert.deepEqual(proposals, []);
  assert.ok(refusals.every((r) => r.code === "MAX_PROPOSALS_UNKNOWN"));
});

test("une offre déjà proposée ne revient pas", () => {
  const { proposals } = buildUpsellProposals(rules, catalog, {
    ...ctx, alreadyProposedOfferingIds: ["off-album"],
  });
  assert.ok(!proposals.some((p) => p.offeringId === "off-album"));
});

test("le moment est respecté : rien après réservation si la règle vise la livraison", () => {
  const { proposals } = buildUpsellProposals(rules, catalog, { ...ctx, moment: "AFTER_BOOKING" });
  assert.deepEqual(proposals, []);
});

test("l'ordre est déterministe", () => {
  const a = buildUpsellProposals(rules, catalog, ctx).proposals.map((p) => p.offeringId);
  const b = buildUpsellProposals([...rules].reverse(), catalog, ctx).proposals.map((p) => p.offeringId);
  assert.deepEqual(a, b);
});

test("les compteurs d'upsell distinguent DÉTECTÉ de PROPOSÉ", () => {
  const c = upsellCounters([
    { status: "DETECTED", revenueGeneratedEur: 0 },
    { status: "PROPOSED", revenueGeneratedEur: 0 },
    { status: "ACCEPTED", revenueGeneratedEur: 290 },
    { status: "DECLINED", revenueGeneratedEur: 0 },
  ]);
  assert.equal(c.offered, 3, "DETECTED ne doit pas compter comme proposé");
  assert.equal(c.accepted, 1);
  assert.equal(c.revenueEur, 290);
  assert.ok(c.conversionRate !== null && Math.abs(c.conversionRate - 1 / 3) < 1e-9);
});

test("aucune proposition ⇒ taux de conversion null, jamais 0 %", () => {
  assert.equal(upsellCounters([]).conversionRate, null);
});

test("sans règle configurée, aucune récompense de parrainage n'est promise", () => {
  const r = resolveReferral({ state: "CONVERTED", refereePaid: true, rule: null });
  assert.equal(r.rewardEur, null);
  assert.equal(r.code, "NO_RULE");
});

test("la récompense n'est due qu'après une conversion RÉELLEMENT payée", () => {
  const rule = { amountEur: 50, requiresPaidConversion: true, active: true };
  const notPaid = resolveReferral({ state: "CONVERTED", refereePaid: false, rule });
  assert.equal(notPaid.code, "NOT_CONVERTED");
  assert.equal(notPaid.rewardEur, null);

  const paid = resolveReferral({ state: "CONVERTED", refereePaid: true, rule });
  assert.equal(paid.nextState, "REWARD_DUE");
  assert.equal(paid.rewardEur, 50);
});

test("conversion acquise mais montant non configuré ⇒ due sans chiffre inventé", () => {
  const r = resolveReferral({
    state: "CONVERTED", refereePaid: true,
    rule: { amountEur: null, requiresPaidConversion: true, active: true },
  });
  assert.equal(r.nextState, "REWARD_DUE");
  assert.equal(r.rewardEur, null);
  assert.equal(r.code, "NO_REWARD_CONFIGURED");
});

// ═══ BRIQUE 5 — cycle de vie client ═══════════════════════════════════════════

const consentOk = {
  consentStatus: "GRANTED",
  consentExpiresAt: new Date("2027-01-01T00:00:00Z"),
  optedOut: false,
  hasChannel: true,
};

test("sans consentement, aucun contact — l'absence vaut refus", () => {
  assert.equal(contactAllowed({ ...consentOk, consentStatus: null }, NOW).code, "NO_CONSENT");
  assert.equal(contactAllowed({ ...consentOk, consentStatus: "REVOKED" }, NOW).code, "CONSENT_REVOKED");
  assert.equal(contactAllowed({ ...consentOk, consentStatus: "EXPIRED" }, NOW).code, "CONSENT_EXPIRED");
  assert.equal(contactAllowed({ ...consentOk, optedOut: true }, NOW).code, "OPTED_OUT");
  assert.equal(contactAllowed({ ...consentOk, hasChannel: false }, NOW).code, "NO_CHANNEL");
  assert.equal(contactAllowed(consentOk, NOW).allowed, true);
});

test("un consentement périmé ne contacte plus", () => {
  const r = contactAllowed({ ...consentOk, consentExpiresAt: new Date("2026-01-01T00:00:00Z") }, NOW);
  assert.ok(!r.allowed && r.code === "CONSENT_EXPIRED");
});

const lifecycleRules: LifecycleRule[] = [
  {
    ruleId: "lr1", anchor: "SESSION_DELIVERED", anchorValue: "GROSSESSE",
    offsetMonths: 3, recommendedService: "NAISSANCE", leadTimeDays: 30, active: true,
  },
  {
    ruleId: "lr2", anchor: "MEMBER_BIRTH", anchorValue: "ENFANT",
    offsetMonths: 12, recommendedService: "FAMILLE", leadTimeDays: 45, active: true,
  },
];

test("le moteur CHAÎNE depuis un fait posé, il ne déduit jamais un événement", () => {
  // Une séance grossesse LIVRÉE est un fait : la cliente est venue.
  const facts: LifecycleFact[] = [
    { kind: "SESSION_DELIVERED", sessionType: "GROSSESSE", deliveredAt: new Date("2026-06-10T00:00:00Z") },
  ];
  const out = nextLifecycleOpportunities(facts, lifecycleRules, consentOk, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].recommendedService, "NAISSANCE");
  assert.equal(out[0].basedOn, "SESSION_DELIVERED");
  assert.equal(out[0].targetDate.toISOString().slice(0, 10), "2026-09-10");
});

test("SANS règle écrite par la photographe, AUCUNE opportunité n'est produite", () => {
  const facts: LifecycleFact[] = [
    { kind: "SESSION_DELIVERED", sessionType: "GROSSESSE", deliveredAt: new Date("2026-06-10T00:00:00Z") },
  ];
  assert.deepEqual(nextLifecycleOpportunities(facts, [], consentOk, NOW), []);
  assert.deepEqual(
    nextLifecycleOpportunities(facts, [{ ...lifecycleRules[0], active: false }], consentOk, NOW),
    [],
  );
});

test("une naissance n'a que mois + année : la précision est DITE, pas fabriquée", () => {
  const facts: LifecycleFact[] = [
    { kind: "MEMBER_BIRTH", relation: "ENFANT", birthMonth: 3, birthYear: 2026 },
  ];
  const out = nextLifecycleOpportunities(facts, lifecycleRules, consentOk, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].precision, "MONTH");
  assert.equal(out[0].targetDate.toISOString().slice(0, 10), "2027-03-01");
});

test("une opportunité non contactable est TOUT DE MÊME rendue, mais confiée à l'humaine", () => {
  const facts: LifecycleFact[] = [
    { kind: "SESSION_DELIVERED", sessionType: "GROSSESSE", deliveredAt: new Date("2026-05-20T00:00:00Z") },
  ];
  const out = nextLifecycleOpportunities(facts, lifecycleRules, { ...consentOk, optedOut: true }, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].contactAllowed, false);
  assert.equal(out[0].nextAction, "ASK_HUMAN");
});

test("hors fenêtre d'anticipation ⇒ WAIT ; largement dépassée ⇒ NONE", () => {
  const soon: LifecycleFact[] = [
    { kind: "SESSION_DELIVERED", sessionType: "GROSSESSE", deliveredAt: new Date("2026-08-01T00:00:00Z") },
  ];
  assert.equal(nextLifecycleOpportunities(soon, lifecycleRules, consentOk, NOW)[0].nextAction, "WAIT");

  const old: LifecycleFact[] = [
    { kind: "SESSION_DELIVERED", sessionType: "GROSSESSE", deliveredAt: new Date("2025-01-01T00:00:00Z") },
  ];
  assert.equal(nextLifecycleOpportunities(old, lifecycleRules, consentOk, NOW)[0].nextAction, "NONE");
});

test("une ancre illisible ne produit rien plutôt qu'une date fantaisiste", () => {
  const bad: LifecycleFact[] = [
    { kind: "MEMBER_BIRTH", relation: "ENFANT", birthMonth: 13, birthYear: 2026 },
    { kind: "MEMBER_BIRTH", relation: "ENFANT", birthMonth: 3, birthYear: 1200 },
  ];
  assert.deepEqual(nextLifecycleOpportunities(bad, lifecycleRules, consentOk, NOW), []);
});

test("addMonths ne déborde pas sur le mois suivant", () => {
  assert.equal(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(addMonths(new Date("2024-01-31T00:00:00Z"), 1).toISOString().slice(0, 10), "2024-02-29");
  assert.equal(addMonths(new Date("2026-03-15T00:00:00Z"), 12).toISOString().slice(0, 10), "2027-03-15");
});

// ═══ KPI ══════════════════════════════════════════════════════════════════════

test("les 14 KPI du brief sont déclarés, chacun avec sa source réelle", () => {
  assert.equal(STUDIO_KPI_KEYS.length, 14);
  assert.equal(STUDIO_KPI_REGISTRY.length, 14);
  for (const k of STUDIO_KPI_REGISTRY) {
    assert.ok(k.sources.length > 0, `${k.key} n'a pas de source`);
    assert.ok(k.formula.length > 0, `${k.key} n'a pas de formule`);
    for (const s of k.sources) {
      assert.ok(/^(photo_|sw|hermes_)/.test(s), `${k.key} : source douteuse « ${s} »`);
    }
  }
});

test("un dénominateur nul rend null, JAMAIS 0 %", () => {
  assert.equal(kpiRatio(0, 0), null);
  assert.equal(kpiRatio(3, 0), null);
  assert.equal(kpiRatio(2, 4), 0.5);
  // Un ratio > 100 % signale deux populations différentes : on ne publie pas.
  assert.equal(kpiRatio(5, 4), null);
});

test("un montant non mesuré rend null, jamais 0 €", () => {
  assert.equal(kpiAmount(null, 0), null);
  assert.equal(kpiAmount(120.456, 0), null);
  assert.equal(kpiAmount(120.456, 3), 120.46);
});

test("les KPI non mesurés sont nommés, pas laissés en case vide", () => {
  const missing = unmeasuredKpis({ quote_acceptance_rate: 0.4 });
  assert.ok(missing.includes("collected_revenue_eur"));
  assert.ok(!missing.includes("quote_acceptance_rate"));
  assert.ok(!missing.includes("new_leads"), "un COUNT non nullable ne peut pas être « non mesuré »");
});

// ═══ COHÉRENCE SQL ↔ TypeScript ═══════════════════════════════════════════════

const SQL = readFileSync(
  new URL("../db/migrations/20260820_photo_studio_8_commerce.sql", import.meta.url),
  "utf8",
);

test("la migration n'est pas appliquée et le dit", () => {
  assert.ok(SQL.includes("⚠️ NON APPLIQUÉE"));
  assert.ok(SQL.includes("GO_LIVE = NO"));
  assert.ok(SQL.includes("begin;"));
  assert.ok(SQL.trimEnd().endsWith("commit;"));
});

test("le vocabulaire d'états SQL est EXACTEMENT celui de TypeScript", () => {
  const block = SQL.slice(SQL.indexOf("check (state in ("));
  const listed = new Set((block.slice(0, block.indexOf("))")).match(/'([A-Z_]+)'/g) ?? [])
    .map((s) => s.replaceAll("'", "")));
  for (const s of BOOKING_STATES) {
    assert.ok(listed.has(s), `état absent du SQL : ${s}`);
  }
  assert.equal(listed.size, BOOKING_STATES.length, "le SQL déclare des états inconnus du code");
});

test("chaque table du lot 8 est en RLS deny-all et porte un tenant_id", () => {
  const tables = [...SQL.matchAll(/create table if not exists hermes_os\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 9, `trop peu de tables détectées : ${tables.length}`);
  for (const t of tables) {
    assert.ok(
      SQL.includes(`alter table hermes_os.${t} enable row level security`),
      `${t} : RLS non activée`,
    );
    const body = SQL.slice(
      SQL.indexOf(`create table if not exists hermes_os.${t}`),
      SQL.indexOf(`alter table hermes_os.${t} enable row level security`),
    );
    assert.ok(/tenant_id\s+text/.test(body), `${t} : pas de tenant_id`);
  }
  assert.ok(!/create policy/i.test(SQL), "une politique RLS romprait le deny-all");
});

test("aucune table du lot 8 ne stocke un secret ou un jeton en clair", () => {
  const stripped = SQL.replace(/--.*$/gm, "").replace(/comment on [\s\S]*?;/g, "");
  for (const forbidden of ["api_key", "client_secret", "access_token", "password", "token text"]) {
    assert.ok(!stripped.toLowerCase().includes(forbidden), `secret en clair : ${forbidden}`);
  }
  // Le jeton de portail n'existe qu'en empreinte.
  assert.ok(stripped.includes("token_hash"));
  assert.ok(stripped.includes("length(token_hash) = 64"));
});

test("le trigger SQL rejoue la TABLE DES TRANSITIONS, pas seulement la porte finale", () => {
  // Trou trouvé par la sonde d'exécution : sans cette table, un UPDATE direct
  // sautait de QUOTE_SENT à BOOKING_CONFIRMED et tous les états intermédiaires
  // devenaient décoratifs.
  assert.ok(SQL.includes("ILLEGAL_TRANSITION"));
  const guard = SQL.slice(SQL.indexOf("hermes_os.photo_quote_guard()"));
  for (const from of BOOKING_STATES) {
    if (from === "CANCELLED") continue;
    assert.ok(guard.includes(`old.state = '${from}'`), `transition SQL manquante depuis ${from}`);
  }
});

test("un paiement PAID et un contrat SIGNED sont contraints d'être vérifiables", () => {
  assert.ok(SQL.includes("photo_payment_paid_is_verified"));
  assert.ok(SQL.includes("photo_contract_signature_traceable"));
  // La porte de réservation existe AUSSI en base : un webhook n8n ne la contourne pas.
  assert.ok(SQL.includes("photo_quote_guard"));
  assert.ok(SQL.includes("BOOKING_NOT_CONFIRMABLE"));
});

test("le rollback annule tout ce que le lot 8 a créé", () => {
  const ROLLBACK = readFileSync(
    new URL("../db/migrations/20260820_photo_studio_9_rollback_p2.sql", import.meta.url),
    "utf8",
  );
  const tables = [...SQL.matchAll(/create table if not exists hermes_os\.(\w+)/g)].map((m) => m[1]);
  for (const t of tables) {
    assert.ok(ROLLBACK.includes(`drop table if exists hermes_os.${t}`), `${t} non annulée`);
  }
  // Les colonnes ajoutées à une table PRÉEXISTANTE sont retirées, pas la table.
  for (const c of ["offering_id", "moment", "proposed_at"]) {
    assert.ok(ROLLBACK.includes(`drop column if exists ${c}`), `colonne ${c} non annulée`);
  }
  assert.ok(!ROLLBACK.includes("drop table if exists hermes_os.photo_upsell_opportunities"));
});
