import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildPvDealPdfModel } from "@/lib/pv/dealPdfModel";
import { resolvePvReadiness } from "@/lib/pv/readiness";
import {
  buildPvStudyPdf,
  NOT_PROVIDED,
  PV_PDF_DISCLAIMER,
  PV_PDF_DRAFT_BANNER,
  PV_PDF_TITLE,
  pvValue,
} from "@/lib/pv/studyPdf";
import type { PvDeal } from "@/types/pv";

/**
 * LOT PV-4 — la synthèse d'étude PDF.
 *
 * Les tests portent sur le CONTENU produit, pas sur l'existence d'un fichier :
 * un PDF vide passerait un test d'existence et ne prouverait rien. On décode
 * donc les octets et on vérifie ce qui est réellement écrit dedans.
 */

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/**
 * Décodage WinAnsi → Unicode pour la plage 0x80–0x9F, la seule où CP1252 diffère
 * de Latin-1. Sans cette table, un tiret cadratin décodé vaudrait U+0097 (un
 * caractère de contrôle) et aucune comparaison de chaîne ne tomberait juste —
 * le test échouerait alors que le PDF, lui, serait correct.
 */
const WINANSI_REVERSE: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/**
 * Extrait le texte des flux de contenu. Les chaînes littérales PDF sont en
 * WinAnsi avec échappement octal — on les rétablit pour pouvoir chercher des
 * mots accentués.
 */
function pdfText(bytes: Uint8Array): string {
  const raw = latin1(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    const decoded = m[1]
      .replace(/\\(\d{3})/g, (_, oct: string) => {
        const code = parseInt(oct, 8);
        return WINANSI_REVERSE[code] ?? String.fromCharCode(code);
      })
      .replace(/\\([()\\])/g, "$1");
    out.push(decoded);
  }
  return out.join("\n");
}

/**
 * Texte APLATI : les lignes sont recollées et les espaces normalisés. La césure
 * est une décision de mise en page ; une assertion de CONTENU ne doit pas
 * échouer parce qu'une phrase a été coupée en deux lignes.
 */
function pdfFlat(bytes: Uint8Array): string {
  return pdfText(bytes).replace(/\s+/g, " ");
}

const deal: PvDeal = {
  prospect: {
    id: "11111111-2222-3333-4444-555555555555",
    prospectType: "PARTICULIER",
    firstName: "Léa",
    lastName: "Roux",
    companyName: null,
    phone: "0600000000",
    email: "lea@example.test",
    source: "WEB",
    ownerUserId: null,
    contactConsent: true,
    contactConsentAt: "2026-08-01T10:00:00Z",
    optedOut: false,
    status: "QUALIFIED",
  },
  site: {
    id: "site-1",
    label: "Maison",
    addressLine1: "1 rue du Soleil",
    postalCode: "13100",
    city: "Aix-en-Provence",
    buildingType: "MAISON",
    buildingUse: "RESIDENTIEL",
    occupancy: "PROPRIETAIRE",
    roofType: "PENTE",
    roofMaterial: "TUILE",
    roofCondition: "BON",
    roofAreaTotalM2: 90,
    roofAreaUsableM2: 60,
    azimuthDeg: 180,
    tiltDeg: 30,
    shadingLevel: "FAIBLE",
    accessDifficulty: "FACILE",
  },
  consumption: {
    id: "c1",
    energySupplier: "EDF",
    subscribedPowerKva: 9,
    annualConsumptionKwh: 5200,
    annualCostEur: 1300,
    unitPriceEurKwh: 0.25,
    tariffOption: "BASE",
    deliveryPointRef: null,
    periodStart: null,
    periodEnd: null,
    dataSource: "BILL",
    verificationStatus: "VERIFIED",
  },
  verifiedBill: null,
  retainedStudy: {
    id: "s1",
    version: 2,
    status: "VALIDATED",
    targetPowerKwc: 9,
    panelCount: 20,
    panelUnitPowerW: 450,
    panelBrand: "Marque X",
    inverterType: "MICRO",
    inverterBrand: "Marque Y",
    hasBattery: false,
    batteryCapacityKwh: null,
    annualProductionKwh: 11500,
    specificYieldKwhKwc: 1278,
    selfConsumptionRatePct: 62,
    selfProductionRatePct: 48,
    surplusKwh: 4300,
    // Volontairement ABSENT : le PDF doit écrire « Non renseigné », pas 0.
    systemLossesPct: null,
    source: "MANUAL",
    preparedBy: "MANUAL",
    validatedAt: "2026-08-19T10:00:00Z",
    calculatedAt: null,
    createdAt: null,
  },
  latestStudy: null,
  retainedAssumptions: {
    studyId: "s1",
    energyPriceEurKwh: 0.2516,
    energyPriceInflationPct: 4,
    analysisHorizonYears: 25,
    discountRatePct: null,
    panelDegradationPctYear: 0.4,
    systemLossesPct: null,
    surplusSalePriceEurKwh: 0.1269,
    subsidyTotalEur: 1200,
    subsidyScheme: "Prime à l’autoconsommation",
    vatRatePct: 10,
  },
  retainedEconomics: {
    id: "e1",
    studyId: "s1",
    investmentHtEur: 15000,
    investmentTtcEur: 16500,
    subsidyTotalEur: 1200,
    netCostEur: 15300,
    year1SavingsEur: 900,
    surplusRevenueEur: 540,
    annualGainEur: 1440,
    simpleRoiPct: null,
    paybackYears: 10.6,
    npvEur: null,
    irrPct: null,
    status: "VERIFIED",
    computedBy: "MANUAL",
    verifiedAt: "2026-08-19T11:00:00Z",
    createdAt: null,
  },
  studies: [],
  documents: [],
};

const readinessFor = (d: PvDeal) =>
  resolvePvReadiness({
    prospect: { status: d.prospect.status, optedOut: d.prospect.optedOut },
    site: d.site,
    consumption: d.consumption,
    verifiedBill: d.verifiedBill,
    retainedStudy: d.retainedStudy,
    latestStudy: d.latestStudy,
    retainedEconomics: d.retainedEconomics,
    hasAnyEconomics: d.retainedEconomics !== null,
  });

// Sans cette garde, les cas FINAL ci-dessous ne prouveraient rien : ils
// testeraient un FINAL sur un dossier qui n'y a pas droit.
test("le dossier de reference est bien COMPLET (sinon les cas FINAL ne valent rien)", () => {
  const r = readinessFor(deal);
  assert.equal(r.state, "READY_FOR_OFFER");
  assert.equal(r.canGenerateFinalPdf, true);
});

function pdfFor(stage: "DRAFT" | "FINAL", d: PvDeal = deal) {
  const r = resolvePvReadiness({
    prospect: { status: d.prospect.status, optedOut: d.prospect.optedOut },
    site: d.site,
    consumption: d.consumption,
    verifiedBill: d.verifiedBill,
    retainedStudy: d.retainedStudy,
    latestStudy: d.latestStudy,
    retainedEconomics: d.retainedEconomics,
    hasAnyEconomics: d.retainedEconomics !== null,
  });
  return buildPvStudyPdf(
    buildPvDealPdfModel({
      deal: d,
      readiness: r,
      stage,
      company: "Helio Solar",
      generatedOn: "2026-08-21",
    }),
  );
}

test("le PDF produit est un fichier bien formé et autonome", () => {
  const bytes = pdfFor("FINAL");
  const s = latin1(bytes);
  assert.ok(s.startsWith("%PDF-1.4"), "en-tête PDF");
  assert.ok(s.includes("/Type /Catalog"), "catalogue");
  assert.ok(s.includes("/Type /Pages"), "arbre de pages");
  assert.ok(s.includes("/BaseFont /Helvetica"), "police de base, aucune police embarquée");
  assert.ok(s.includes("/Encoding /WinAnsiEncoding"), "encodage couvrant les accents");
  assert.ok(s.includes("xref"), "table xref");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "fin de fichier");
  // Le compte de pages annoncé doit correspondre aux objets Page réels.
  const count = Number(/\/Count (\d+)/.exec(s)?.[1]);
  const pages = [...s.matchAll(/\/Type \/Page[^s]/g)].length;
  assert.equal(pages, count, `Count=${count} mais ${pages} objets Page`);
  assert.ok(count >= 1);
});

test("23 — un BROUILLON est marqué de façon impossible à manquer", () => {
  const text = pdfText(pdfFor("DRAFT"));
  assert.ok(text.includes(PV_PDF_DRAFT_BANNER), "bandeau de brouillon absent");
  assert.match(text, /NE PAS TRANSMETTRE/);
  // Le rappel figure AUSSI en pied de page : une page détachée reste honnête.
  assert.ok(
    text.split("BROUILLON").length - 1 >= 2,
    "le mot BROUILLON doit apparaître au moins deux fois",
  );
});

test("23b — un FINAL ne porte AUCUNE marque de brouillon", () => {
  const text = pdfText(pdfFor("FINAL"));
  assert.ok(!text.includes("BROUILLON"), "un document final ne doit pas dire brouillon");
  assert.ok(!text.includes("NE PAS TRANSMETTRE"));
});

test("28 — le disclaimer de non-contractualité est présent, entier, sur chaque page", () => {
  const text = pdfFlat(pdfFor("FINAL"));
  // Le disclaimer complet, recollé, doit apparaître mot pour mot.
  assert.ok(text.includes(PV_PDF_DISCLAIMER.replace(/\s+/g, " ")), "disclaimer incomplet");
  // Le disclaimer est coupé en lignes : on vérifie ses fragments porteurs.
  for (const fragment of ["indicative et non contractuelle", "visite technique", "conditions contractuelles"]) {
    assert.ok(text.includes(fragment), `fragment manquant : ${fragment}`);
  }
  assert.ok(text.includes("Document non contractuel."), "rappel de pied de page");
  assert.ok(PV_PDF_DISCLAIMER.length > 80);
});

test("27 — une donnée absente n'est JAMAIS inventée", () => {
  const text = pdfText(pdfFor("FINAL"));
  assert.ok(text.includes(NOT_PROVIDED), "les champs absents doivent afficher « Non renseigné »");
  // `systemLossesPct`, `npvEur`, `irrPct` et `simpleRoiPct` sont nuls dans le jeu
  // d'essai : aucun zéro ne doit être imprimé à leur place.
  assert.ok(!/Pertes syst.me\s*0/.test(text), "une perte absente ne devient pas 0");
  assert.ok(!/VAN\s*0 /.test(text), "une VAN absente ne devient pas 0");
});

test("34 — la synthèse cite la bonne version d'étude et le statut réel des données", () => {
  const text = pdfText(pdfFor("FINAL"));
  assert.ok(text.includes("étude version 2"), "la version retenue doit apparaître");
  assert.ok(text.includes("VALIDÉE par un humain"), "statut de l'étude");
  assert.ok(text.includes("Chiffrage économique VÉRIFIÉ par un humain."));
  assert.ok(text.includes("READY_FOR_OFFER"), "état du dossier imprimé");
});

test("34b — un dossier non prêt imprime ses blocages, sans les adoucir", () => {
  const incomplete: PvDeal = {
    ...deal,
    retainedStudy: null,
    latestStudy: { ...deal.retainedStudy!, status: "CALCULATED" },
    retainedEconomics: null,
  };
  const text = pdfText(pdfFor("DRAFT", incomplete));
  assert.ok(text.includes("NON VALIDÉE"), "l'étude non validée doit être dite");
  assert.ok(text.includes("Aucun chiffrage vérifié"), "l'absence de chiffrage vérifié doit être dite");
  assert.ok(text.includes("STUDY_REVIEW_REQUIRED"));
});

test("le contenu métier attendu est réellement imprimé", () => {
  const text = pdfText(pdfFor("FINAL"));
  for (const expected of [
    PV_PDF_TITLE,
    "Helio Solar",
    "Léa Roux",
    "1 rue du Soleil",
    "2026-08-21",
    "Installation étudiée",
    "Production estimée",
    "Chiffrage estimé",
    "Hypothèses importantes",
    "Statut des données utilisées",
  ]) {
    assert.ok(text.includes(expected), `contenu manquant : ${expected}`);
  }
  // Les accents survivent à l'encodage WinAnsi.
  assert.ok(text.includes("Léa"), "les accents doivent être préservés");
  assert.ok(text.includes("Synthèse"), "titre accentué");
});

test("les chiffres portés au PDF sont ceux de l'affaire, pas des approximations", () => {
  const text = pdfText(pdfFor("FINAL"));
  for (const value of ["9 kWc", "20", "450 W", "11500 kWh", "16500 EUR", "10.6 ans", "1200 EUR"]) {
    assert.ok(text.includes(value), `valeur absente du PDF : ${value}`);
  }
});

test("aucune promesse de rendement n'est imprimée", () => {
  const text = pdfFlat(pdfFor("FINAL"));
  assert.ok(text.includes("ni une garantie de production"), "réserve sur la production");
  assert.ok(text.includes("ni un devis"), "réserve commerciale");
  for (const f of ["garantie de rendement", "rendement garanti", "économies garanties"]) {
    assert.ok(!text.toLowerCase().includes(f), `formule interdite : ${f}`);
  }
});

test("pvValue — une valeur vide n'est jamais transformée en zéro", () => {
  assert.equal(pvValue(null), null);
  assert.equal(pvValue(undefined), null);
  assert.equal(pvValue(""), null);
  assert.equal(pvValue("   "), null);
  assert.equal(pvValue(Number.NaN), null);
  assert.equal(pvValue(0), "0");
  assert.equal(pvValue(9, "kWc"), "9 kWc");
});

test("le module PDF reste PUR : aucune I/O, aucun réseau, aucune horloge", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/pv/studyPdf.ts", import.meta.url)),
    "utf8",
  );
  for (const forbidden of ["fetch(", "require(", "node:fs", "Date.now", "new Date("]) {
    assert.ok(!src.includes(forbidden), `le constructeur PDF doit rester pur : ${forbidden}`);
  }
  // Le modèle non plus ne lit ni l'horloge ni le réseau : la date lui est donnée.
  const model = readFileSync(
    fileURLToPath(new URL("../lib/pv/dealPdfModel.ts", import.meta.url)),
    "utf8",
  );
  for (const forbidden of ["fetch(", "Date.now", "new Date("]) {
    assert.ok(!model.includes(forbidden), `la projection doit rester pure : ${forbidden}`);
  }
});
