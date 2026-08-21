import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CONSENT_MEDIA_TYPES,
  CONSENT_USE_CASES,
  DEFAULT_IDENTITY_SCOPE,
  DEFAULT_LOCATION_SCOPE,
  IDENTITY_SCOPES,
  identityScopeAtLeast,
  validateConsentForm,
  type ConsentFormInput,
} from "../lib/photo/consent.ts";

/**
 * PHOTO-P0 — consentement média.
 *
 * Ce que ces tests protègent : la doctrine mineurs (rapport §13) et le fait que
 * la validation de formulaire ne peut RIEN autoriser — elle ne fait que refuser
 * en amont ce que la base refuserait de toute façon.
 */

const VALID: ConsentFormInput = {
  useCases: ["PORTFOLIO", "INSTAGRAM"],
  mediaTypes: ["PHOTO"],
  identityScope: "FACE",
  locationScope: "CITY",
  includesMinors: false,
  guardianConsent: false,
  consentTextVersion: "v2026-01",
};

// --- DOCTRINE MINEURS --------------------------------------------------------
test("MINEURS: un consentement couvrant des mineurs SANS représentant légal est refusé", () => {
  const result = validateConsentForm({ ...VALID, includesMinors: true, guardianConsent: false });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "MINOR_WITHOUT_GUARDIAN");
});

test("MINEURS: avec consentement du représentant légal, la saisie est acceptée", () => {
  const result = validateConsentForm({ ...VALID, includesMinors: true, guardianConsent: true });
  assert.equal(result.ok, true);
});

test("MINEURS: le refus vaut pour toute portée d'identité, y compris « aucune »", () => {
  for (const scope of IDENTITY_SCOPES) {
    const result = validateConsentForm({
      ...VALID,
      identityScope: scope,
      includesMinors: true,
      guardianConsent: false,
    });
    assert.equal(result.ok, false, `portée ${scope} doit rester refusée`);
  }
});

// --- DÉFAUTS RESTRICTIFS -----------------------------------------------------
test("DÉFAUTS: les portées par défaut sont les plus restrictives", () => {
  assert.equal(DEFAULT_IDENTITY_SCOPE, "NONE");
  assert.equal(DEFAULT_LOCATION_SCOPE, "NONE");
});

// --- FAIL-CLOSED -------------------------------------------------------------
test("FAIL-CLOSED: usage, média ou version manquants ⇒ refus explicite", () => {
  const cases: [Partial<ConsentFormInput>, string][] = [
    [{ useCases: [] }, "NO_USE_CASE"],
    [{ mediaTypes: [] }, "NO_MEDIA_TYPE"],
    [{ consentTextVersion: "  " }, "BAD_CONSENT_VERSION"],
    [{ useCases: ["N_IMPORTE_QUOI"] }, "BAD_USE_CASE"],
    [{ mediaTypes: ["HOLOGRAMME"] }, "BAD_MEDIA_TYPE"],
    [{ identityScope: "TOUT" }, "BAD_IDENTITY_SCOPE"],
    [{ locationScope: "GPS" }, "BAD_LOCATION_SCOPE"],
    [{ consentTextVersion: "v".repeat(50) }, "BAD_CONSENT_VERSION"],
  ];
  for (const [patch, code] of cases) {
    const result = validateConsentForm({ ...VALID, ...patch });
    assert.equal(result.ok, false, `${code} aurait dû être refusé`);
    assert.equal(result.ok === false && result.code, code);
  }
});

test("FAIL-CLOSED: aucune entrée invalide ne renvoie ok:true", () => {
  const junk: ConsentFormInput = {
    useCases: [],
    mediaTypes: [],
    identityScope: "",
    locationScope: "",
    includesMinors: true,
    guardianConsent: false,
    consentTextVersion: "",
  };
  assert.equal(validateConsentForm(junk).ok, false);
});

// --- ORDRE DES PORTÉES -------------------------------------------------------
test("l'ordre des portées d'identité est NONE < SILHOUETTE < FACE", () => {
  assert.equal(identityScopeAtLeast("FACE", "NONE"), true);
  assert.equal(identityScopeAtLeast("FACE", "SILHOUETTE"), true);
  assert.equal(identityScopeAtLeast("SILHOUETTE", "FACE"), false);
  assert.equal(identityScopeAtLeast("NONE", "SILHOUETTE"), false);
  assert.equal(identityScopeAtLeast("NONE", "NONE"), true);
  assert.equal(identityScopeAtLeast("INCONNU", "NONE"), false, "valeur inconnue ⇒ refus");
});

// --- VOCABULAIRE -------------------------------------------------------------
test("le vocabulaire de consentement est non vide et sans doublon", () => {
  assert.ok(CONSENT_USE_CASES.length >= 4);
  assert.equal(new Set(CONSENT_USE_CASES).size, CONSENT_USE_CASES.length);
  assert.deepEqual([...CONSENT_MEDIA_TYPES], ["PHOTO", "VIDEO"]);
});

// --- L'AUTORITÉ RESTE EN BASE ------------------------------------------------
test("AUTORITÉ: la contrainte mineurs existe AUSSI en base (défense en profondeur)", () => {
  const schema = readFileSync(
    fileURLToPath(new URL("../db/migrations/20260818_photo_studio_1_schema.sql", import.meta.url)),
    "utf8",
  );
  assert.ok(
    schema.includes("photo_consent_minors_need_guardian"),
    "la contrainte de table doit exister",
  );
  assert.ok(
    schema.includes("check (includes_minors = false or guardian_consent = true)"),
    "la règle mineurs doit être exprimée en SQL, pas seulement en TS",
  );
  const services = readFileSync(
    fileURLToPath(new URL("../db/migrations/20260818_photo_studio_2_services.sql", import.meta.url)),
    "utf8",
  );
  assert.ok(
    services.includes("MINOR_WITHOUT_GUARDIAN"),
    "le gate de consentement doit refuser explicitement",
  );
  assert.ok(services.includes("'allowed', false"), "le gate doit être fail-closed");
});
