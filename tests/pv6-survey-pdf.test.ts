import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPvSurveyPdf,
  PV_SURVEY_DRAFT_BANNER,
  PV_SURVEY_NOTICES,
  PV_SURVEY_PDF_TITLE,
  SURVEY_NOT_MEASURED,
  SURVEY_NOT_PROVIDED,
} from "@/lib/pv/surveyPdf";
import {
  buildPvSurveyPdfModel,
  pvSurveyClientName,
  pvSurveyOutcomeSentence,
} from "@/lib/pv/surveyPdfModel";
import type { PvSiteSurvey, PvSiteSurveyDetail } from "@/types/pv";

/**
 * LOT PV-6 — le rapport de visite technique.
 *
 * Les tests portent sur le CONTENU DÉCODÉ, pas sur l'existence d'un fichier :
 * un PDF vide passerait un test d'existence et ne prouverait rien.
 */

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** WinAnsi → Unicode pour 0x80–0x9F, seule plage où CP1252 diffère de Latin-1. */
const WINANSI_REVERSE: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function pdfText(bytes: Uint8Array): string[] {
  const raw = latin1(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^()\\])*)\) Tj/g)) {
    let s = "";
    const body = m[1];
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== "\\") {
        s += body[i];
        continue;
      }
      const next = body[i + 1] ?? "";
      if (/[0-7]/.test(next)) {
        const oct = body.slice(i + 1, i + 4);
        const code = parseInt(oct, 8);
        s += WINANSI_REVERSE[code] ?? String.fromCharCode(code);
        i += 3;
      } else {
        s += next;
        i += 1;
      }
    }
    out.push(s);
  }
  return out;
}

const pdfFlat = (bytes: Uint8Array): string =>
  pdfText(bytes).join(" ").replace(/[ \t\n\r]+/g, " ");

// --- Jeu d'essai -------------------------------------------------------------

const SURVEY: PvSiteSurvey = {
  id: "v1", prospectId: "p1", siteId: "s1", technicianUserId: null,
  scheduledOn: "2026-08-23", startedAt: "2026-08-23T08:00:00Z",
  completedAt: "2026-08-23T11:30:00Z", validatedAt: null, validatedBy: null,
  status: "DONE",
  weatherConditions: "SEC", roofAccess: "MOYEN", accessMeans: "ECHELLE",
  siteCondition: "BON",
  safetyConstraints: "Ligne de vie à poser avant intervention.",
  observations: "Chien-assis en pignon sud.",
  remarks: "Voisin à prévenir pour l'accès cour.",
  roofAreaTotalMeasuredM2: 118, roofAreaUsableMeasuredM2: 62,
  azimuthMeasuredDeg: 10, tiltMeasuredDeg: 30,
  roofTypeMeasured: "PENTE", roofConditionMeasured: "MOYEN",
  shadingMeasured: null, accessDifficultyMeasured: null,
  heightMeasuredM: 7.5, ridgeLengthM: 12, eaveLengthM: 12, slopeLengthM: 5.2,
  obstacles: "Antenne râteau, deux cheminées.",
  asbestosSuspicion: true,
  asbestosNote: "Plaques ondulées grises sous la couverture.",
  panelLocation: "Versant sud", inverterLocation: "Garage",
  batteryLocation: null, cableRoute: "Gaine existante le long du pignon",
  cableDistanceM: 22, panelBoardLocation: "Entrée",
  panelBoardCondition: "MOYEN", panelBoardFreeSlots: 4, mainBreakerRatingA: 45,
  earthingObserved: "PRESENTE", earthingNote: null,
  createdAt: "2026-08-23T07:00:00Z", updatedAt: "2026-08-23T11:30:00Z",
};

const DETAIL: PvSiteSurveyDetail = {
  survey: SURVEY,
  site: {
    id: "s1", label: "Maison", addressLine1: "12 rue du Zénith",
    postalCode: "13100", city: "Aix-en-Provence",
    buildingType: null, buildingUse: null, occupancy: null,
    roofType: "PENTE", roofMaterial: null, roofCondition: "BON",
    roofAreaTotalM2: 120, roofAreaUsableM2: 80,
    azimuthDeg: 350, tiltDeg: 30,
    shadingLevel: "FAIBLE", accessDifficulty: "MOYEN",
  },
  prospect: {
    id: "p1", prospectType: "PARTICULIER", firstName: "Claire", lastName: "Durand",
    companyName: null, phone: null, email: null, source: "MANUAL",
    ownerUserId: null, contactConsent: true, contactConsentAt: null,
    optedOut: false, status: "STUDY_DELIVERED",
  },
  findings: [
    {
      id: "f1", surveyId: "v1", code: "USABLE_AREA_MISMATCH", category: "TOITURE",
      severity: "BLOCKING", isBlocking: true,
      declaredValue: "80.00", measuredValue: "62.00", unit: "m²",
      comment: "Écart de 22.5 % entre la surface exploitable déclarée et mesurée.",
      resolution: null, resolvedBy: null, resolvedAt: null,
    },
    {
      id: "f2", surveyId: "v1", code: "ASBESTOS_SUSPICION", category: "SECURITE",
      severity: "REVIEW", isBlocking: false,
      declaredValue: null, measuredValue: "suspicion", unit: null,
      comment: "Suspicion d’amiante relevée sur site.",
      resolution: "STUDY_TO_REVISE", resolvedBy: "u1", resolvedAt: "2026-08-23T12:00:00Z",
    },
  ],
  documents: [
    {
      id: "d1", docType: "PHOTO_TOITURE", documentStage: "SOURCE",
      originalFilename: "toiture-sud.jpg", mimeType: "image/jpeg",
      sizeBytes: 1_200_000, status: "LINKED", storagePath: null,
      uploadedAt: "2026-08-23T11:00:00Z", signedUrl: null,
    },
  ],
  gate: "NOT_VALIDATED",
  nextStatuses: ["BLOCKING", "IN_PROGRESS", "NEEDS_REVIEW"],
};

const model = (over: Partial<PvSiteSurveyDetail> = {}) =>
  buildPvSurveyPdfModel({
    detail: { ...DETAIL, ...over },
    company: "Hélio Solar",
    generatedOn: "2026-08-23",
    technicianLabel: null,
  });

// --- 1. Ce que le document EST, et ce qu'il n'est pas -----------------------

test("PV-6 PDF : c'est un RAPPORT DE VISITE, jamais un devis", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes(PV_SURVEY_PDF_TITLE));
  assert.ok(t.includes(PV_SURVEY_NOTICES[0]));
  assert.ok(t.includes("ni un devis"));
  // Aucun montant, aucun total, aucune signature : ils n'ont rien à faire ici.
  for (const forbidden of ["€", "Total TTC", "Total HT", "TVA", "Signature", "Bon pour accord"]) {
    assert.ok(!t.includes(forbidden), `contenu hors périmètre dans le rapport : ${forbidden}`);
  }
});

test("PV-6 PDF : une visite non validée porte son bandeau ET son tampon", () => {
  const bytes = buildPvSurveyPdf(model());
  const t = pdfFlat(bytes);
  assert.ok(t.includes(PV_SURVEY_DRAFT_BANNER));
  assert.ok(t.includes("VISITE NON VALIDÉE"));
});

test("PV-6 PDF : une visite validée perd le bandeau et affiche sa date", () => {
  const validated: PvSiteSurvey = {
    ...SURVEY, status: "VALIDATED",
    validatedAt: "2026-08-24T09:00:00Z", validatedBy: "u1",
  };
  const t = pdfFlat(
    buildPvSurveyPdf(
      buildPvSurveyPdfModel({
        detail: { ...DETAIL, survey: validated },
        company: "Hélio Solar",
        generatedOn: "2026-08-24",
        technicianLabel: null,
      }),
    ),
  );
  assert.ok(!t.includes(PV_SURVEY_DRAFT_BANNER));
  assert.ok(!t.includes("VISITE NON VALIDÉE"));
  assert.ok(t.includes("2026-08-24"));
  assert.ok(t.includes("VALIDÉE — la preuve terrain est disponible"));
});

// --- 2. Le tableau comparatif -----------------------------------------------

test("PV-6 PDF : le tableau porte les cinq colonnes annoncées", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  for (const h of ["Élément", "Déclaré", "Mesuré", "Écart", "Statut"]) {
    assert.ok(t.includes(h), `en-tête manquante : ${h}`);
  }
  assert.ok(t.includes("Surface exploitable"));
  assert.ok(t.includes("80 m²"), "la valeur DÉCLARÉE reste visible");
  assert.ok(t.includes("62 m²"), "la valeur MESURÉE aussi");
  assert.ok(t.includes("-18 m²"), "et l'écart, signé");
});

test("PV-6 PDF : l'écart d'azimut est circulaire — 350° vs 10° donne 20°", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("±20 °"), "un écart de 340° trahirait un calcul linéaire");
  assert.ok(!t.includes("340"));
});

test("PV-6 PDF : « non mesuré » n'est JAMAIS écrit « conforme »", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  // Ombrage et difficulté d'accès n'ont pas été relevés dans ce jeu d'essai.
  assert.ok(t.includes(SURVEY_NOT_MEASURED));
  // Et l'inclinaison, mesurée sans écart retenu, est bien « Conforme ».
  assert.ok(t.includes("Conforme"));
});

test("PV-6 PDF : le statut de chaque ligne est un LIBELLÉ, jamais un code", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("Bloquant"));
  for (const code of ["BLOCKING", "REVIEW", "INFO", "NON_MESURE"]) {
    assert.ok(!t.includes(code), `code brut affiché : ${code}`);
  }
});

// --- 3. Les écarts -----------------------------------------------------------

test("PV-6 PDF : chaque écart porte déclaré, mesuré, gravité et résolution", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("Surface exploitable — Bloquant"));
  assert.ok(t.includes("déclaré : 80.00 m²"));
  assert.ok(t.includes("mesuré : 62.00 m²"));
  assert.ok(t.includes("Résolution : Étude à réviser"));
});

test("PV-6 PDF : sans écart, le rapport le DIT plutôt que de laisser un vide", () => {
  const t = pdfFlat(buildPvSurveyPdf(model({ findings: [] })));
  assert.ok(t.includes("Aucun écart retenu par les règles de comparaison."));
});

// --- 4. Amiante et électricité : constat, pas diagnostic --------------------

test("PV-6 PDF : la suspicion d'amiante est bornée par une mention explicite", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("Suspicion d’amiante"));
  assert.ok(t.includes("opérateur certifié"));
  assert.ok(!t.includes("diagnostic amiante positif"));
});

test("PV-6 PDF : les observations électriques sont dites VISUELLES", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("remplacent pas un contrôle réglementaire"));
  assert.ok(t.includes("Présente (observée)"), "la prise de terre est OBSERVÉE, pas contrôlée");
});

test("PV-6 PDF : les vocabulaires sont TRADUITS, jamais imprimés en code", () => {
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(t.includes("Toiture en pente"));
  assert.ok(t.includes("Échelle"));
  for (const code of ["PENTE", "ECHELLE", "PRESENTE", "MOYEN", "SEC "]) {
    assert.ok(!t.includes(code), `code de vocabulaire imprimé tel quel : ${code}`);
  }
});

test("PV-6 PDF : aucun caractère du rapport n'est perdu à l'encodage", () => {
  // WinAnsi ne connaît ni « − » (U+2212) ni « ≠ » (U+2260) : le moteur les
  // remplacerait par « ? ». Le jeu d'essai ne contient aucune interrogation ;
  // un « ? » dans le texte décodé signale donc une substitution silencieuse.
  const t = pdfFlat(buildPvSurveyPdf(model()));
  assert.ok(!t.includes("?"), `caractère non encodable dans le rapport : ${t.slice(Math.max(0, t.indexOf("?") - 40), t.indexOf("?") + 40)}`);
});

// --- 5. Pièces jointes : référencées, pas incorporées ------------------------

test("PV-6 PDF : les photos sont RÉFÉRENCÉES par leur nom, pas embarquées", () => {
  const bytes = buildPvSurveyPdf(model());
  const t = pdfFlat(bytes);
  assert.ok(t.includes("toiture-sud.jpg"));
  assert.ok(t.includes("non incorporées à ce document"));
  // Aucun XObject image : un rapport de 40 Mo n'aide personne sur un chantier.
  assert.ok(!latin1(bytes).includes("/Subtype /Image"));
  assert.ok(bytes.byteLength < 200_000, `PDF trop lourd : ${bytes.byteLength} octets`);
});

test("PV-6 PDF : sans pièce jointe, le rapport le dit", () => {
  const t = pdfFlat(buildPvSurveyPdf(model({ documents: [] })));
  assert.ok(t.includes("Aucune pièce rattachée à cette visite."));
});

// --- 6. Aucune valeur inventée ----------------------------------------------

test("PV-6 PDF : une absence s'écrit, elle ne s'invente pas", () => {
  const anonymous: PvSiteSurveyDetail = {
    ...DETAIL,
    prospect: null,
    site: null,
    survey: { ...SURVEY, scheduledOn: null, completedAt: null },
  };
  const t = pdfFlat(
    buildPvSurveyPdf(
      buildPvSurveyPdfModel({
        detail: anonymous, company: "Hélio Solar",
        generatedOn: "2026-08-23", technicianLabel: null,
      }),
    ),
  );
  assert.ok(t.includes(SURVEY_NOT_PROVIDED));
  for (const invented of ["Client inconnu", "N/A", "undefined", "null", "Adresse inconnue"]) {
    assert.ok(!t.includes(invented), `valeur inventée : ${invented}`);
  }
  assert.equal(pvSurveyClientName(null), null);
  assert.equal(pvSurveyClientName({ companyName: null, firstName: null, lastName: null }), null);
  assert.equal(
    pvSurveyClientName({ companyName: "  ", firstName: "Claire", lastName: "Durand" }),
    "Claire Durand",
  );
});

// --- 7. Le verdict, en toutes lettres ---------------------------------------

test("PV-6 PDF : chaque statut produit une phrase, pas un code", () => {
  assert.match(pvSurveyOutcomeSentence("VALIDATED", 0), /^VALIDÉE — /);
  assert.match(pvSurveyOutcomeSentence("BLOCKING", 2), /^BLOQUANTE — 2 écart\(s\)/);
  assert.match(pvSurveyOutcomeSentence("BLOCKING", 0), /^BLOQUANTE — /);
  assert.match(pvSurveyOutcomeSentence("NEEDS_REVIEW", 0), /^À REVOIR — /);
  assert.match(pvSurveyOutcomeSentence("DONE", 0), /^TERMINÉE — /);
  assert.match(pvSurveyOutcomeSentence("PLANNED", 0), /^PLANIFIÉE — /);
  assert.match(pvSurveyOutcomeSentence("CANCELLED", 0), /^ANNULÉE — /);
});

test("PV-6 PDF : le verdict imprimé compte les écarts bloquants NON résolus", () => {
  const t = pdfFlat(
    buildPvSurveyPdf(
      buildPvSurveyPdfModel({
        detail: { ...DETAIL, survey: { ...SURVEY, status: "BLOCKING" } },
        company: "Hélio Solar", generatedOn: "2026-08-23", technicianLabel: null,
      }),
    ),
  );
  assert.ok(t.includes("BLOQUANTE — 1 écart(s) bloquant(s) non résolu(s)"));
});

// --- 8. Structure du fichier -------------------------------------------------

test("PV-6 PDF : fichier PDF autonome, valide, paginé", () => {
  const bytes = buildPvSurveyPdf(model());
  const raw = latin1(bytes);
  assert.ok(raw.startsWith("%PDF-1.4"));
  assert.ok(raw.trimEnd().endsWith("%%EOF"));
  assert.ok(raw.includes("/WinAnsiEncoding"), "sans quoi les accents seraient illisibles");
  assert.ok(raw.includes("trailer"));
  assert.match(pdfFlat(bytes), /page 1 \/ \d+/);
  assert.ok(pdfFlat(bytes).includes("Ni devis, ni diagnostic réglementaire."));
  // Aucune ressource externe : le document doit s'ouvrir hors ligne.
  assert.ok(!raw.includes("http://"));
  assert.ok(!raw.includes("https://"));
});

test("PV-6 PDF : le contenu est DÉTERMINISTE — deux constructions identiques", () => {
  const a = buildPvSurveyPdf(model());
  const b = buildPvSurveyPdf(model());
  assert.deepEqual(Array.from(a), Array.from(b));
});
