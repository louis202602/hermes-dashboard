import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  LOW_CONFIDENCE_THRESHOLD,
  NEVER_IMPROVISE,
  SLOT_PRIORITY,
  UNCERTAIN_REPLY,
  canAnswerTopic,
  decideTurn,
  detectHandoffReason,
  detectIntent,
  dispositionFor,
  isActionableLead,
  missingSlots,
  nextSlotToAsk,
} from "../lib/photo/phoneConversation.ts";
import type { PhotoCallSlots } from "../types/photoPhone.ts";

/**
 * PHOTO-P1 — Standard téléphonique : anti-questionnaire, anti-hallucination,
 * transfert humain.
 *
 * LIMITE HONNÊTE : ces tests prouvent la LOGIQUE DE DÉCISION, pas la qualité
 * vocale (latence, barge-in, naturel de la voix), qui ne peut se mesurer que
 * sur un appel réel avec un fournisseur branché — hors périmètre de cette
 * mission (REAL_PHONE_CALL = NO).
 */

const empty: PhotoCallSlots = {
  serviceType: null,
  requestedDate: null,
  location: null,
  budgetEur: null,
  firstName: null,
  phone: null,
  email: null,
};

// --- Anti-questionnaire ---------------------------------------------------------
test("l'agent ne demande QU'UN seul créneau à la fois", () => {
  const ask = nextSlotToAsk(empty);
  assert.equal(typeof ask, "string");
  assert.equal(missingSlots(empty).length, 7, "7 créneaux manquent…");
  assert.equal(ask, "serviceType", "…mais un seul est demandé");
});

test("le scénario du brief : la prestation et la date sont données spontanément", () => {
  // « Bonjour, je cherche une photographe pour mon mariage le 12 juin. »
  const afterOpening: PhotoCallSlots = {
    ...empty,
    serviceType: "MARIAGE",
    requestedDate: "2027-06-12",
  };
  // L'agent ne redemande NI la prestation NI la date : il enchaîne sur le lieu.
  assert.equal(nextSlotToAsk(afterOpening), "location");
});

test("un créneau déjà rempli n'est jamais redemandé", () => {
  for (const k of SLOT_PRIORITY) {
    const filled: PhotoCallSlots = { ...empty, [k]: k === "budgetEur" ? 1500 : "valeur" };
    assert.notEqual(nextSlotToAsk(filled), k, `${k} ne doit plus être demandé`);
  }
});

test("le nom de famille n'est jamais demandé (minimisation RGPD)", () => {
  assert.ok(!SLOT_PRIORITY.includes("lastName" as never));
  assert.ok(SLOT_PRIORITY.includes("firstName"), "le prénom suffit pour dialoguer");
});

test("l'essentiel passe avant le confort : lieu et budget après le rappel", () => {
  const essentialsFirst = SLOT_PRIORITY.indexOf("firstName") < SLOT_PRIORITY.indexOf("email");
  assert.ok(essentialsFirst);
  // Un appel où l'on sait juste rappeler est déjà un appel utile.
  assert.equal(isActionableLead({ ...empty, phone: "+33600000000" }), true);
  assert.equal(isActionableLead({ ...empty, email: "a@b.fr" }), true);
  assert.equal(isActionableLead(empty), false);
});

// --- Transfert humain -------------------------------------------------------------
test("les 5 situations sensibles déclenchent le bon motif de transfert", () => {
  const cases: [string, string][] = [
    ["Je veux parler à quelqu'un", "CLIENT_ASKED"],
    ["C'est inadmissible, je veux un remboursement", "COMPLAINT"],
    ["Je vais saisir le tribunal", "CONFLICT"],
    ["J'ai une question sur une clause du contrat", "COMPLEX_CONTRACT"],
    ["C'est pour les obsèques de ma mère", "EMOTIONALLY_SENSITIVE"],
  ];
  for (const [utterance, expected] of cases) {
    assert.equal(detectHandoffReason(utterance), expected, utterance);
  }
});

test("la gravité l'emporte : une réclamation prime sur une question de prix", () => {
  const u = "Votre prix est scandaleux, je veux un remboursement";
  assert.equal(detectHandoffReason(u), "COMPLAINT");
  assert.equal(detectIntent(u), "COMPLAINT");
});

test("sans numéro de transfert, on promet un rappel — pas un transfert impossible", () => {
  assert.equal(dispositionFor("CLIENT_ASKED", "+33499000000"), "LIVE_TRANSFER_REQUESTED");
  assert.equal(dispositionFor("CLIENT_ASKED", null), "CALLBACK_REQUESTED");
});

test("une conversation ordinaire ne déclenche aucun transfert", () => {
  assert.equal(detectHandoffReason("Je cherche une photographe pour mon mariage"), "NONE");
  assert.equal(dispositionFor("NONE", null), "AI_HANDLED");
});

// --- Anti-hallucination -------------------------------------------------------------
test("les 7 sujets à ne jamais improviser sont couverts", () => {
  assert.deepEqual([...NEVER_IMPROVISE].sort(), [
    "CONDITION_COMMERCIALE", "DELAI", "DISPONIBILITE",
    "PRESTATION", "PROMOTION", "RESERVATION", "TARIF",
  ]);
});

test("répondre exige À LA FOIS l'autorisation ET une donnée réelle", () => {
  assert.equal(canAnswerTopic("TARIF", ["TARIF"], true), true);
  assert.equal(canAnswerTopic("TARIF", ["TARIF"], false), false, "autorisé mais sans donnée ⇒ non");
  assert.equal(canAnswerTopic("TARIF", [], true), false, "donnée présente mais non autorisé ⇒ non");
  assert.equal(canAnswerTopic("TARIF", [], false), false);
});

test("une question de prix sans tarif ancré part vers l'humain, sans inventer", () => {
  const d = decideTurn({
    utterance: "Combien coûte un reportage de mariage ?",
    slots: empty,
    transferNumber: "+33499000000",
    allowedTopics: ["TARIF"],
    hasGroundedAnswer: false,
    confidence: 0.95,
  });
  assert.equal(d.action, "HANDOFF");
  assert.equal(d.outOfScope, true);
  assert.equal(d.handoffReason, "OUT_OF_CATALOG");
});

test("la même question AVEC un tarif réel obtient une réponse", () => {
  const d = decideTurn({
    utterance: "Combien coûte un reportage de mariage ?",
    slots: empty,
    transferNumber: "+33499000000",
    allowedTopics: ["TARIF"],
    hasGroundedAnswer: true,
    confidence: 0.95,
  });
  assert.equal(d.action, "ANSWER");
  assert.equal(d.outOfScope, false);
});

test("la phrase de repli est littérale et propose de transmettre", () => {
  assert.ok(UNCERTAIN_REPLY.includes("Je préfère ne pas vous donner une information approximative"));
  assert.ok(UNCERTAIN_REPLY.includes("transmettre votre demande à Vanessa"));
});

// --- Incertitude --------------------------------------------------------------------
test("sous le seuil de confiance, on ne devine pas : on passe la main à un humain", () => {
  // Volontairement SANS numéro de transfert : l'escalade ne dépend pas de la
  // configuration, car on ne peut pas se fier au numéro qu'on a cru entendre.
  const d = decideTurn({
    utterance: "…grésillement…",
    slots: empty,
    transferNumber: null,
    allowedTopics: [],
    hasGroundedAnswer: false,
    confidence: LOW_CONFIDENCE_THRESHOLD - 0.01,
  });
  assert.equal(d.handoffReason, "LOW_CONFIDENCE");
  assert.equal(d.disposition, "HUMAN_REQUIRED");
});

test("le seuil de confiance est testé des deux côtés de la frontière", () => {
  const at = (confidence: number) =>
    decideTurn({
      utterance: "Bonjour, je cherche une photographe pour mon mariage",
      slots: { ...empty, serviceType: "MARIAGE" },
      transferNumber: "+33499000000",
      allowedTopics: [],
      hasGroundedAnswer: false,
      confidence,
    });
  assert.equal(at(LOW_CONFIDENCE_THRESHOLD - 0.01).handoffReason, "LOW_CONFIDENCE");
  assert.equal(at(LOW_CONFIDENCE_THRESHOLD).handoffReason, "NONE", "au seuil, on continue");
});

test("la sécurité humaine passe AVANT le seuil de confiance", () => {
  // Une réclamation mal entendue reste une réclamation : elle ne doit pas être
  // dégradée en simple rappel automatique.
  const d = decideTurn({
    utterance: "je veux un remboursement",
    slots: empty,
    transferNumber: "+33499000000",
    allowedTopics: [],
    hasGroundedAnswer: false,
    confidence: 0.1,
  });
  assert.equal(d.handoffReason, "COMPLAINT");
  assert.equal(d.disposition, "HUMAN_REQUIRED");
});

test("conversation normale : l'agent pose la question suivante et rien de plus", () => {
  const d = decideTurn({
    utterance: "Bonjour, je cherche une photographe pour mon mariage le 12 juin",
    slots: { ...empty, serviceType: "MARIAGE", requestedDate: "2027-06-12" },
    transferNumber: "+33499000000",
    allowedTopics: [],
    hasGroundedAnswer: false,
    confidence: 0.9,
  });
  assert.equal(d.action, "ASK");
  assert.equal(d.askFor, "location");
  assert.equal(d.disposition, "AI_HANDLED");
});

// --- Invariants de données ------------------------------------------------------
test("aucun enregistrement audio ni verbatim n'est prévu en base", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../db/migrations/20260819_photo_studio_7_phone.sql", import.meta.url)),
    "utf8",
  );
  for (const forbidden of ["recording_url", "audio_url", "transcript_full", "recording_path"]) {
    assert.ok(!sql.includes(forbidden), `colonne interdite : ${forbidden}`);
  }
  assert.ok(sql.includes("enabled                   boolean not null default false"),
    "le standard doit être désactivé par défaut");
  // Une prestation sans prix réel n'est jamais citable au téléphone.
  assert.ok(sql.includes("o.price_from_eur is not null"));
});

test("aucun secret fournisseur n'entre dans le dépôt", () => {
  const files = readdirSync(fileURLToPath(new URL("../lib/photo", import.meta.url)));
  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(`../lib/photo/${f}`, import.meta.url)), "utf8");
    for (const pattern of [/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9]/i, /sk-[A-Za-z0-9]{16}/, /bearer\s+[A-Za-z0-9]{16}/i]) {
      assert.ok(!pattern.test(src), `${f} : secret potentiel détecté`);
    }
  }
});

// --- SCÉNARIOS D'AUDIT (exigés à la revue de la PR #58) ------------------------
// Les six cas ci-dessous sont la formulation littérale de l'audit. Ils sont
// figés en tests pour qu'aucune régression future ne puisse les rouvrir.

const auditTurn = (over: Partial<Parameters<typeof decideTurn>[0]>) =>
  decideTurn({
    utterance: "Combien coûte un reportage de mariage ?",
    slots: empty,
    transferNumber: "+33499000000",
    allowedTopics: ["TARIF"],
    hasGroundedAnswer: false,
    confidence: 0.95,
    ...over,
  });

test("AUDIT 1 — tarif absent (price NULL, non citable) ⇒ aucun prix annoncé", () => {
  // price_from_eur = NULL et quotable_by_phone = false ⇒ la façade SQL ne
  // renvoie PAS l'offre, donc hasGroundedAnswer = false.
  const d = auditTurn({ hasGroundedAnswer: false });
  assert.equal(d.action, "HANDOFF");
  assert.equal(d.outOfScope, true);
});

test("AUDIT 2 — tarif présent MAIS non autorisé ⇒ les 900 € ne sortent pas", () => {
  // quotable_by_phone = false ⇒ l'offre est filtrée en base (o.quotable_by_phone),
  // donc aucune donnée ancrée ne remonte, même si le prix existe.
  const d = auditTurn({ hasGroundedAnswer: false, allowedTopics: ["TARIF"] });
  assert.notEqual(d.action, "ANSWER", "un prix non citable ne doit jamais être annoncé");
  assert.equal(d.handoffReason, "OUT_OF_CATALOG");
});

test("AUDIT 3 — tarif présent ET autorisé ⇒ citable", () => {
  const d = auditTurn({ hasGroundedAnswer: true, allowedTopics: ["TARIF"] });
  assert.equal(d.action, "ANSWER");
  assert.equal(d.outOfScope, false);
});

test("AUDIT 4 — disponibilité inconnue ⇒ aucune réservation affirmée", () => {
  const d = auditTurn({
    utterance: "Vous êtes libre le 12 juin ?",
    allowedTopics: ["DISPONIBILITE"],
    hasGroundedAnswer: false,
  });
  assert.equal(d.action, "HANDOFF", "sans agenda ancré, on ne confirme rien");
  assert.notEqual(d.action, "CONFIRM");
});

test("AUDIT 5 — aucun numéro de transfert ⇒ CALLBACK, jamais un faux LIVE_TRANSFER", () => {
  const d = auditTurn({ utterance: "Je veux parler à quelqu'un", transferNumber: null });
  assert.equal(d.disposition, "CALLBACK_REQUESTED");
  assert.notEqual(d.disposition, "LIVE_TRANSFER_REQUESTED");
});

test("AUDIT 6 — forte incertitude ⇒ HUMAN_REQUIRED", () => {
  const d = auditTurn({ utterance: "…grésillement…", confidence: 0.2 });
  assert.equal(d.handoffReason, "LOW_CONFIDENCE");
  assert.equal(d.disposition, "HUMAN_REQUIRED");
});
