import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  FOLLOW_UP_LIMITS,
  LEAD_SCORE_RULES,
  canFollowUp,
  daysUntil,
  funnelRatios,
  nextLeadAction,
  scoreLead,
} from "../lib/photo/leadScore.ts";

/**
 * PHOTO-P1 — Scoring déterministe, relances anti-spam, entonnoir honnête.
 */

const NOW = new Date("2026-08-19T12:00:00Z");

const baseLead = {
  phone: null,
  email: null,
  requestedDate: null,
  location: null,
  budgetEur: null,
  serviceType: "PORTRAIT" as const,
  source: "WEBSITE",
  now: NOW,
};

// --- Score --------------------------------------------------------------------
test("un lead vide vaut 0 et n'invente aucun facteur", () => {
  const { score, factors } = scoreLead(baseLead);
  assert.equal(score, 0);
  assert.deepEqual(factors, []);
});

test("chaque point attribué sort avec sa raison (score auditable)", () => {
  const { score, factors } = scoreLead({
    ...baseLead,
    phone: "+33600000000",
    requestedDate: "2026-09-12",
    location: "Aix-en-Provence",
    serviceType: "MARIAGE",
  });
  const codes = factors.map((f) => f.code).sort();
  assert.deepEqual(codes, [
    "DATE_WITHIN_120_DAYS",
    "HAS_LOCATION",
    "HAS_PHONE",
    "HAS_REQUESTED_DATE",
    "HIGH_VALUE_SERVICE",
  ]);
  // Le total est exactement la somme des facteurs — aucun point orphelin.
  assert.equal(score, factors.reduce((s, f) => s + f.points, 0));
  assert.ok(factors.every((f) => f.label.length > 0), "chaque facteur doit être expliqué");
});

test("une date PASSÉE ne donne pas le bonus de proximité", () => {
  const past = scoreLead({ ...baseLead, requestedDate: "2026-01-01" });
  const codes = past.factors.map((f) => f.code);
  assert.ok(codes.includes("HAS_REQUESTED_DATE"), "la date reste un signal");
  assert.ok(!codes.includes("DATE_WITHIN_120_DAYS"), "mais pas une urgence");
});

test("le score est borné à 100 même si toutes les règles s'appliquent", () => {
  const max = scoreLead({
    ...baseLead,
    phone: "+33600000000",
    email: "a@b.fr",
    requestedDate: "2026-09-01",
    location: "Marseille",
    budgetEur: 2000,
    serviceType: "MARIAGE",
    source: "REFERRAL",
  });
  const theoretical = Object.values(LEAD_SCORE_RULES).reduce((a, b) => a + b, 0);
  assert.equal(theoretical, 110, "le barème brut dépasse volontairement 100");
  assert.equal(max.score, 100, "la sortie doit rester bornée");
});

test("un budget nul ou négatif n'est pas un budget annoncé", () => {
  for (const budgetEur of [0, -100]) {
    const codes = scoreLead({ ...baseLead, budgetEur }).factors.map((f) => f.code);
    assert.ok(!codes.includes("HAS_BUDGET"), `budget ${budgetEur} ne doit pas scorer`);
  }
});

test("daysUntil : date illisible ⇒ null, jamais une valeur inventée", () => {
  assert.equal(daysUntil("pas-une-date", NOW), null);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil("2026-08-19", NOW), 0);
  assert.equal(daysUntil("2026-08-29", NOW), 10);
});

// --- Prochaine action ----------------------------------------------------------
const baseAction = {
  status: "NEW" as const,
  conversionStatus: "OPEN" as const,
  lastOutboundAt: null,
  lastInboundAt: null,
  quoteSentAt: null,
  quoteExpiresAt: null,
  callbackRequestedAt: null,
  bookingConfirmed: false,
  now: NOW,
};

test("un rappel demandé par le prospect passe avant tout le reste", () => {
  assert.equal(
    nextLeadAction({
      ...baseAction,
      status: "QUOTED",
      quoteSentAt: "2026-08-01T00:00:00Z",
      callbackRequestedAt: "2026-08-18T00:00:00Z",
    }),
    "CALL_BACK",
  );
});

test("cycle commercial : qualifier → devis → relance → expiration", () => {
  assert.equal(nextLeadAction(baseAction), "QUALIFY");
  assert.equal(nextLeadAction({ ...baseAction, status: "QUALIFIED" }), "SEND_QUOTE");
  assert.equal(
    nextLeadAction({ ...baseAction, status: "QUOTED", quoteSentAt: "2026-08-01T00:00:00Z" }),
    "FOLLOW_UP_QUOTE_UNSIGNED",
  );
  assert.equal(
    nextLeadAction({
      ...baseAction,
      status: "QUOTED",
      quoteSentAt: "2026-08-01T00:00:00Z",
      quoteExpiresAt: "2026-08-22T00:00:00Z",
    }),
    "OFFER_EXPIRING",
  );
});

test("un lead perdu, non qualifié ou expiré ne déclenche plus rien", () => {
  for (const s of ["LOST", "UNQUALIFIED"] as const) {
    assert.equal(nextLeadAction({ ...baseAction, status: s }), "NONE");
  }
  for (const c of ["LOST", "EXPIRED"] as const) {
    assert.equal(nextLeadAction({ ...baseAction, conversionStatus: c }), "NONE");
  }
});

test("une affaire gagnée mais non confirmée demande une confirmation", () => {
  assert.equal(
    nextLeadAction({ ...baseAction, conversionStatus: "WON", bookingConfirmed: false }),
    "CONFIRM_BOOKING",
  );
});

// --- Anti-spam ------------------------------------------------------------------
const baseGate = {
  reason: "NO_REPLY" as const,
  sentForThisReason: 0,
  sentTotal: 0,
  lastFollowUpAt: null,
  optedOut: false,
  now: NOW,
};

test("l'opposition du prospect bloque toute relance, quel qu'en soit le motif", () => {
  const g = canFollowUp({ ...baseGate, optedOut: true });
  assert.equal(g.allowed, false);
  assert.equal(g.code, "OPTED_OUT");
});

test("un motif déjà relancé ne revient jamais", () => {
  assert.equal(canFollowUp({ ...baseGate, sentForThisReason: 1 }).code, "REASON_EXHAUSTED");
});

test("le plafond global de 3 relances par lead est tenu", () => {
  assert.equal(canFollowUp({ ...baseGate, sentTotal: 3 }).code, "TOTAL_EXHAUSTED");
  assert.equal(FOLLOW_UP_LIMITS.MAX_TOTAL_PER_LEAD, 3);
});

test("deux relances ne peuvent pas être plus rapprochées que 72 h", () => {
  // 71 h : refusé. 73 h : autorisé. La frontière est testée des deux côtés.
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  assert.equal(canFollowUp({ ...baseGate, lastFollowUpAt: at(71) }).code, "TOO_SOON");
  assert.equal(canFollowUp({ ...baseGate, lastFollowUpAt: at(73) }).allowed, true);
});

test("fail-closed : une date de dernière relance illisible refuse l'envoi", () => {
  const g = canFollowUp({ ...baseGate, lastFollowUpAt: "n'importe quoi" });
  assert.equal(g.allowed, false, "au moindre doute, ne pas relancer");
});

// --- Entonnoir --------------------------------------------------------------------
test("CAC et ROAS valent null — jamais 0 — quand la dépense n'est pas renseignée", () => {
  const r = funnelRatios({ leads: 40, bookings: 8, revenueEur: 9600, costEur: null });
  assert.equal(r.cacEur, null, "un CAC de 0 € serait un chiffre faux");
  assert.equal(r.roas, null);
  assert.equal(r.conversionRate, 0.2, "le taux, lui, est mesurable sans coût");
});

test("avec une dépense réelle, CAC et ROAS sont calculés exactement", () => {
  const r = funnelRatios({ leads: 40, bookings: 8, revenueEur: 9600, costEur: 800 });
  assert.equal(r.cacEur, 100);
  assert.equal(r.roas, 12);
});

test("aucun lead ⇒ taux de conversion null, pas une division par zéro", () => {
  const r = funnelRatios({ leads: 0, bookings: 0, revenueEur: 0, costEur: 0 });
  assert.equal(r.conversionRate, null);
  assert.equal(r.cacEur, null, "0 réservation ⇒ CAC non calculable");
  assert.equal(r.roas, null, "0 € dépensé ⇒ ROAS non calculable");
});

// --- Miroir SQL ↔ TypeScript --------------------------------------------------
test("le barème SQL du lot 6 est identique au barème TypeScript", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../db/migrations/20260819_photo_studio_6_acquisition.sql", import.meta.url)),
    "utf8",
  );
  // Une divergence de barème entre la base et l'écran donnerait deux scores
  // différents pour le même lead : on l'interdit par test.
  for (const [code, points] of Object.entries(LEAD_SCORE_RULES)) {
    assert.ok(
      sql.includes(`'code','${code}','points',${points}`),
      `le barème SQL doit porter ${code}=${points}`,
    );
  }
  // Les plafonds anti-spam vivent AUSSI en base (aucun appelant ne les contourne).
  assert.ok(sql.includes("interval '72 hours'"), "le délai de 72 h doit être en base");
  assert.ok(sql.includes("c.sent_for_reason < 1"), "1 relance par motif, en base");
  assert.ok(sql.includes("c.sent_total < 3"), "3 relances par lead, en base");
  assert.ok(sql.includes("l.opted_out = false"), "l'opposition doit être filtrée en base");
});
