import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INSTRUCTION_KIND_LABEL,
  extractKeyword,
  parseCullingInstruction,
} from "../lib/photo/instructions.ts";

/**
 * PHOTO-P0 — consignes de tri en langage naturel.
 *
 * La propriété la plus importante testée ici est un BIAIS DE SÛRETÉ : le doute
 * ne doit JAMAIS aboutir à « écarter ». Une phrase incomprise est refusée
 * (`null`), et l'UI demande alors un choix explicite.
 */

// --- PROTECTION --------------------------------------------------------------
test("PROTECT: « garde toutes les photos des grands-parents »", () => {
  const parsed = parseCullingInstruction("garde toutes les photos des grands-parents");
  assert.deepEqual(parsed, { kind: "PROTECT", keyword: "grands-parents" });
});

test("PROTECT: la négation d'un verbe d'exclusion protège, elle n'exclut pas", () => {
  // C'est LE cas du cahier des charges : « ne supprime aucune photo de X ».
  const parsed = parseCullingInstruction("ne supprime aucune photo des grands-parents");
  assert.equal(parsed?.kind, "PROTECT");
  assert.equal(parsed?.keyword, "grands-parents");
});

test("PROTECT: variantes verbales et guillemets", () => {
  assert.equal(parseCullingInstruction("conserve les photos de Mamie")?.kind, "PROTECT");
  assert.equal(parseCullingInstruction("protège les photos du chien")?.kind, "PROTECT");
  assert.deepEqual(parseCullingInstruction("garde « la table d’honneur »"), {
    kind: "PROTECT",
    keyword: "la table d’honneur",
  });
});

// --- PRÉFÉRENCE --------------------------------------------------------------
test("PREFER: « privilégie les sourires naturels »", () => {
  const parsed = parseCullingInstruction("privilégie les sourires naturels");
  assert.deepEqual(parsed, { kind: "PREFER", keyword: "sourires naturels" });
});

// --- EXCLUSION ---------------------------------------------------------------
test("EXCLUDE: une exclusion explicite et non ambiguë est acceptée", () => {
  const parsed = parseCullingInstruction("écarte les photos du parking");
  assert.deepEqual(parsed, { kind: "EXCLUDE", keyword: "parking" });
});

// --- BIAIS DE SÛRETÉ ---------------------------------------------------------
test("SÛRETÉ: « ne garde pas … » n'est JAMAIS transformé en exclusion automatique", () => {
  assert.equal(parseCullingInstruction("ne garde pas les photos du parking"), null);
});

test("SÛRETÉ: une phrase mêlant protection et exclusion est refusée", () => {
  assert.equal(parseCullingInstruction("garde et écarte les photos de Paul"), null);
});

test("SÛRETÉ: une phrase sans verbe reconnu est refusée", () => {
  assert.equal(parseCullingInstruction("les photos des grands-parents"), null);
  assert.equal(parseCullingInstruction(""), null);
  assert.equal(parseCullingInstruction("   "), null);
});

test("SÛRETÉ: aucune entrée ne produit EXCLUDE par défaut", () => {
  const ambiguous = [
    "",
    "   ",
    "photos",
    "ne garde pas ça",
    "peut-être les photos de Paul",
    "x".repeat(600),
  ];
  for (const input of ambiguous) {
    const parsed = parseCullingInstruction(input);
    assert.notEqual(parsed?.kind, "EXCLUDE", `« ${input.slice(0, 30)} » ne doit pas exclure`);
  }
});

test("SÛRETÉ: une consigne trop longue est refusée (borne de la façade)", () => {
  assert.equal(parseCullingInstruction("garde les photos de " + "a".repeat(600)), null);
});

// --- EXTRACTION DU SUJET -----------------------------------------------------
test("extractKeyword retire les articles et la ponctuation finale", () => {
  assert.equal(extractKeyword("garde toutes les photos des grands-parents."), "grands-parents");
  assert.equal(extractKeyword("conserve les photos de la mariée"), "mariée");
  assert.equal(extractKeyword("garde"), null);
});

test("extractKeyword borne la longueur du sujet", () => {
  const long = extractKeyword("garde les photos de " + "b".repeat(150));
  assert.equal(long, null);
});

// --- LIBELLÉS ----------------------------------------------------------------
test("chaque nature de consigne a un libellé d'affichage", () => {
  assert.deepEqual(Object.keys(INSTRUCTION_KIND_LABEL).sort(), ["EXCLUDE", "PREFER", "PROTECT"]);
  for (const label of Object.values(INSTRUCTION_KIND_LABEL)) {
    assert.ok(label.length > 0);
  }
});
