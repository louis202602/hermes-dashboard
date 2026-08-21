import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPvQuotePdfModel, pvQuoteClientName, pvVatBreakdown } from "@/lib/pv/quotePdfModel";
import {
  buildPvQuotePdf,
  money,
  qty,
  PV_QUOTE_DRAFT_BANNER,
  PV_QUOTE_PDF_TITLE,
  PV_QUOTE_STUDY_NOTICE,
  PV_QUOTE_WARNINGS,
  QUOTE_NOT_PROVIDED,
} from "@/lib/pv/quotePdf";
import { NBSP } from "@/lib/pv/quoteLabels";
import type { PvQuoteDetail } from "@/types/pv";

/**
 * LOT PV-5 — le PDF de devis.
 *
 * Les tests portent sur le CONTENU décodé, pas sur l'existence d'un fichier :
 * un PDF vide passerait un test d'existence et ne prouverait rien.
 */

const latin1 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/**
 * WinAnsi → Unicode pour 0x80–0x9F, la seule plage où CP1252 diffère de Latin-1.
 * Sans elle, un tiret cadratin décodé vaudrait U+0097 et aucune comparaison de
 * chaîne ne tomberait juste — le test échouerait alors que le PDF serait correct.
 */
const WINANSI_REVERSE: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/** Extrait le texte réellement écrit dans les flux de contenu du PDF. */
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

/** Texte aplati : la césure ne doit pas défaire une assertion de phrase. */
const pdfFlat = (bytes: Uint8Array): string =>
  // On NE normalise PAS l'espace insécable : c'est le séparateur de milliers, et
  // le confondre avec une espace ordinaire ferait passer un test qui ne teste rien.
  pdfText(bytes).join(" ").replace(/[ \t\n\r]+/g, " ");

/** Montant attendu, avec le séparateur insécable EXPLICITE. */
const eur = (s: string): string => s.replace(/_/g, NBSP);

const baseDetail: PvQuoteDetail = {
  quote: {
    id: "q1",
    prospectId: "p1",
    siteId: "s1",
    studyId: "st1",
    economicsId: "e1",
    quoteNumber: "DEV-2026-000007",
    version: 2,
    supersedesQuoteId: "q0",
    status: "READY",
    currency: "EUR",
    discountPct: 5,
    subtotalHtEur: 5281.11,
    discountAmountEur: 264.06,
    totalHtEur: 5017.05,
    totalVatEur: 813.41,
    totalTtcEur: 5830.46,
    issuedOn: "2026-08-22",
    validUntil: "2026-09-21",
    observations: "Pose prévue sur deux journées.",
    terms: "Acompte à la commande, solde à la mise en service.",
    sentBy: null,
    sentAt: null,
    acceptedBy: null,
    acceptedAt: null,
    acceptedOn: null,
    acceptanceReference: null,
    refusedAt: null,
    refusalReason: null,
    expiredAt: null,
    cancelledAt: null,
    createdAt: "2026-08-22T10:00:00Z",
    updatedAt: "2026-08-22T10:00:00Z",
  },
  lines: [
    {
      id: "l1", quoteId: "q1", position: 0, category: "PANNEAUX",
      designation: "Panneau photovoltaïque 425 Wc", description: "Monocristallin, garantie 25 ans",
      quantity: 20, unit: "U", unitPriceHtEur: 180, vatRatePct: 20, discountPct: 10,
      lineTotalHtEur: 3240,
    },
    {
      id: "l2", quoteId: "q1", position: 1, category: "POSE",
      designation: "Pose et raccordement", description: null,
      quantity: 1, unit: "FORFAIT", unitPriceHtEur: 2000, vatRatePct: 10, discountPct: 0,
      lineTotalHtEur: 2000,
    },
    {
      id: "l3", quoteId: "q1", position: 2, category: "CABLAGE",
      designation: "Câble solaire", description: null,
      quantity: 12.345, unit: "M", unitPriceHtEur: 3.33, vatRatePct: 20, discountPct: 0,
      lineTotalHtEur: 41.11,
    },
  ],
  prospect: {
    id: "p1", prospectType: "PARTICULIER", firstName: "Marie", lastName: "Durand",
    companyName: null, phone: "0600000011", email: "marie@example.fr", source: "MANUAL",
    ownerUserId: null, contactConsent: true, contactConsentAt: "2026-08-01T10:00:00Z",
    optedOut: false, status: "OFFER_PREPARED",
  },
  site: {
    id: "s1", label: null, addressLine1: "7 rue du Soleil", postalCode: "13100", city: "Aix",
    buildingType: null, buildingUse: null, occupancy: null, roofType: null, roofMaterial: null,
    roofCondition: null, roofAreaTotalM2: null, roofAreaUsableM2: null, azimuthDeg: null,
    tiltDeg: null, shadingLevel: null, accessDifficulty: null,
  },
  study: {
    id: "st1", version: 3, status: "VALIDATED", targetPowerKwc: 8.5, panelCount: 20,
    panelUnitPowerW: 425, panelBrand: null, inverterType: null, inverterBrand: null,
    hasBattery: false, batteryCapacityKwh: null, annualProductionKwh: null,
    specificYieldKwhKwc: null, selfConsumptionRatePct: null, selfProductionRatePct: null,
    surplusKwh: null, systemLossesPct: null, source: "MANUAL", preparedBy: "MANUAL",
    validatedAt: "2026-08-20T10:00:00Z", calculatedAt: null, createdAt: "2026-08-19T10:00:00Z",
  },
  blockers: [],
  isExpired: false,
};

function pdfFor(stage: "DRAFT" | "FINAL", d: PvQuoteDetail = baseDetail): Uint8Array {
  return buildPvQuotePdf(
    buildPvQuotePdfModel({ detail: d, stage, company: "HélioSolar SARL", generatedOn: "2026-08-22" }),
  );
}

// --- Structure du fichier ----------------------------------------------------

test("le PDF de devis est un fichier PDF valide et autonome", () => {
  const bytes = pdfFor("FINAL");
  const raw = latin1(bytes);
  assert.ok(raw.startsWith("%PDF-1.4"), "en-tête PDF manquant");
  assert.ok(raw.trimEnd().endsWith("%%EOF"), "trailer manquant");
  assert.match(raw, /\/Type \/Catalog/);
  assert.match(raw, /startxref/);
  // Deux polices de base, aucun fichier de police embarqué.
  assert.match(raw, /\/BaseFont \/Helvetica /);
  assert.match(raw, /\/BaseFont \/Helvetica-Bold/);
  assert.equal(/\/FontFile/.test(raw), false, "aucune police ne doit être embarquée");
});

// --- 28. Le BROUILLON se voit --------------------------------------------------

test("28 — un PDF DRAFT porte le bandeau BROUILLON", () => {
  const flat = pdfFlat(pdfFor("DRAFT"));
  assert.ok(flat.includes(PV_QUOTE_DRAFT_BANNER), `bandeau absent : ${flat.slice(0, 300)}`);
  assert.ok(PV_QUOTE_DRAFT_BANNER.includes("BROUILLON"));
  assert.ok(PV_QUOTE_DRAFT_BANNER.includes("NON ÉMIS"));
});

test("28b — le cachet BROUILLON est répété sur CHAQUE page", () => {
  const lines = pdfText(pdfFor("DRAFT"));
  const stamps = lines.filter((l) => l === "BROUILLON — NON ÉMIS");
  assert.ok(stamps.length >= 1, "aucun cachet de pied de page");
  // Une page détachée d'un brouillon ne doit pas passer pour un devis émis.
  const footers = lines.filter((l) => l.startsWith(`${PV_QUOTE_PDF_TITLE} n°`));
  assert.equal(stamps.length, footers.length, "le cachet manque sur au moins une page");
});

test("28c — un PDF FINAL ne porte AUCUNE mention BROUILLON", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.equal(flat.includes("BROUILLON"), false, "un devis émis ne doit pas se dire brouillon");
});

// --- 30. Le contenu contractuel ------------------------------------------------

test("30 — le PDF affiche référence, client, site, dates et étude de référence", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.ok(flat.includes("DEV-2026-000007"), "référence absente");
  assert.ok(flat.includes("version 2"), "version absente");
  assert.ok(flat.includes("Marie Durand"), "client absent");
  assert.ok(flat.includes("7 rue du Soleil"), "site absent");
  assert.ok(flat.includes("2026-08-22"), "date d’émission absente");
  assert.ok(flat.includes("2026-09-21"), "date de validité absente");
  assert.ok(flat.includes("HélioSolar SARL"), "entreprise absente");
  assert.ok(flat.includes("version 3 (VALIDATED)"), "étude de référence absente");
  assert.ok(flat.includes(PV_QUOTE_STUDY_NOTICE), "mention de rattachement à l’étude absente");
});

test("30b — le PDF affiche CHAQUE ligne avec sa quantité, son prix et sa TVA", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.ok(flat.includes("Panneau photovoltaïque 425 Wc"));
  assert.ok(flat.includes("Monocristallin, garantie 25 ans"));
  assert.ok(flat.includes("Pose et raccordement"));
  assert.ok(flat.includes("Câble solaire"));
  assert.ok(flat.includes("20 U"), "quantité de la première ligne absente");
  assert.ok(flat.includes("12.345 M"), "quantité décimale absente ou arrondie");
  assert.ok(flat.includes(eur("180,00_€")), "prix unitaire absent");
  assert.ok(flat.includes("20 %") && flat.includes("10 %"), "taux de TVA absents");
  // Une remise de ligne est ÉCRITE : un total plus bas sans explication ferait douter.
  assert.ok(flat.includes("remise 10 %"), "la remise de ligne doit être visible");
});

test("30c — le PDF affiche les totaux, dont la ventilation par taux de TVA", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.ok(flat.includes(eur("5_281,11_€")), "sous-total HT absent");
  assert.ok(flat.includes(eur("264,06_€")), "montant de la remise absent");
  assert.ok(flat.includes(eur("5_017,05_€")), "total HT absent");
  assert.ok(flat.includes(eur("813,41_€")), "total TVA absent");
  assert.ok(flat.includes(eur("5_830,46_€")), "total TTC absent");
  assert.ok(flat.includes("TOTAL TTC"), "libellé du total TTC absent");
  // Ventilation : deux taux, deux lignes.
  assert.ok(flat.includes("TVA 20 % sur"), "ventilation 20 % absente");
  assert.ok(flat.includes("TVA 10 % sur"), "ventilation 10 % absente");
});

test("30d — conditions, observations et avertissements figurent au document", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.ok(flat.includes("Acompte à la commande, solde à la mise en service."));
  assert.ok(flat.includes("Pose prévue sur deux journées."));
  for (const w of PV_QUOTE_WARNINGS) {
    assert.ok(flat.includes(w), `avertissement absent : ${w.slice(0, 40)}…`);
  }
  // PV-5 ne recueille aucune signature : le document ne doit pas le laisser croire.
  assert.ok(flat.includes("n’est pas un bon de commande signé"));
});

test("30e — le pied de page rappelle la référence et le total sur chaque page", () => {
  const lines = pdfText(pdfFor("FINAL"));
  const footers = lines.filter((l) => l.startsWith(`${PV_QUOTE_PDF_TITLE} n° DEV-2026-000007 v2`));
  assert.ok(footers.length >= 1, "pied de page absent");
  const totals = lines.filter((l) => l.startsWith(eur("Total TTC : 5_830,46_€")));
  assert.equal(totals.length, footers.length, "le rappel du total manque sur une page");
});

// --- 31. Aucune valeur inventée ------------------------------------------------

test("31 — une donnée absente s’affiche « Non renseigné », jamais un zéro", () => {
  const d: PvQuoteDetail = {
    ...baseDetail,
    quote: { ...baseDetail.quote, issuedOn: null, validUntil: null, observations: null, terms: null },
    site: null,
    study: null,
  };
  const flat = pdfFlat(pdfFor("DRAFT", d));
  assert.ok(flat.includes(QUOTE_NOT_PROVIDED), "« Non renseigné » attendu");
  assert.equal(QUOTE_NOT_PROVIDED, "Non renseigné");
  // Le site absent ne doit pas devenir une adresse vide ni inventée.
  assert.equal(flat.includes("7 rue du Soleil"), false);
});

test("31b — un devis SANS ligne le DIT, plutôt que d’afficher un tableau vide", () => {
  const d: PvQuoteDetail = {
    ...baseDetail,
    lines: [],
    quote: { ...baseDetail.quote, subtotalHtEur: 0, totalHtEur: 0, totalVatEur: 0, totalTtcEur: 0,
             discountPct: 0, discountAmountEur: 0 },
  };
  const flat = pdfFlat(pdfFor("DRAFT", d));
  assert.ok(flat.includes("Aucune ligne saisie."));
});

test("31c — un client sans nom n’est jamais remplacé par un nom inventé", () => {
  assert.equal(pvQuoteClientName(null), null);
  assert.equal(pvQuoteClientName({ companyName: null, firstName: null, lastName: null }), null);
  assert.equal(pvQuoteClientName({ companyName: "  ", firstName: " ", lastName: "" }), null);
  assert.equal(
    pvQuoteClientName({ companyName: "SARL Soleil", firstName: "Marie", lastName: "Durand" }),
    "SARL Soleil",
    "la raison sociale prime sur le nom de la personne",
  );
});

// --- Le devis est DISTINCT de la synthèse d'étude ------------------------------

test("le PDF de devis ne peut pas être confondu avec la synthèse d’étude", () => {
  const flat = pdfFlat(pdfFor("FINAL"));
  assert.ok(flat.includes(PV_QUOTE_PDF_TITLE));
  assert.equal(PV_QUOTE_PDF_TITLE, "Devis photovoltaïque");
  assert.equal(
    flat.includes("Synthèse d’étude photovoltaïque"),
    false,
    "le devis ne doit pas porter le titre de la synthèse",
  );
  // Le devis N'EST PAS « non contractuel » : c'est une offre. La mention de la
  // synthèse ne doit donc pas y apparaître.
  assert.equal(flat.includes("Document non contractuel"), false);
});

// --- Le calcul de ventilation, indépendant de la base --------------------------

test("la ventilation de TVA reproduit EXACTEMENT la règle de la base", () => {
  const b = pvVatBreakdown(
    [
      { vatRatePct: 20, lineTotalHtEur: 3240 },
      { vatRatePct: 10, lineTotalHtEur: 2000 },
      { vatRatePct: 20, lineTotalHtEur: 41.11 },
    ],
    5,
  );
  assert.deepEqual(b, [
    { ratePct: 10, baseHtEur: 1900, vatEur: 190 },
    { ratePct: 20, baseHtEur: 3117.05, vatEur: 623.41 },
  ]);
  // Somme = 813,41 : la valeur que la base calcule de son côté (test SQL T14).
  assert.equal(b.reduce((s, x) => s + x.vatEur, 0), 813.41);
});

test("la ventilation arrondit PAR TAUX, pas par ligne — le cas qui les sépare", () => {
  // Découvert par mutation testing : sur des montants ordinaires, les deux
  // règles tombent sur la même valeur. Trois lignes à 0,03 € les séparent :
  //   par taux  : round(0,09 × 0,20) = 0,02
  //   par ligne : 3 × round(0,03 × 0,20) = 3 × 0,01 = 0,03
  const b = pvVatBreakdown(
    [
      { vatRatePct: 20, lineTotalHtEur: 0.03 },
      { vatRatePct: 20, lineTotalHtEur: 0.03 },
      { vatRatePct: 20, lineTotalHtEur: 0.03 },
    ],
    0,
  );
  assert.deepEqual(b, [{ ratePct: 20, baseHtEur: 0.09, vatEur: 0.02 }]);
  assert.notEqual(b[0].vatEur, 0.03, "arrondir par ligne donnerait 0,03");
});

test("la ventilation regroupe par taux, sans doublon ni taux perdu", () => {
  const b = pvVatBreakdown(
    [
      { vatRatePct: 20, lineTotalHtEur: 100 },
      { vatRatePct: 5.5, lineTotalHtEur: 200 },
      { vatRatePct: 20, lineTotalHtEur: 300 },
      { vatRatePct: 0, lineTotalHtEur: 50 },
    ],
    0,
  );
  assert.deepEqual(b.map((x) => x.ratePct), [0, 5.5, 20]);
  assert.equal(b.find((x) => x.ratePct === 20)?.baseHtEur, 400);
  assert.equal(b.find((x) => x.ratePct === 0)?.vatEur, 0);
});

// --- Formatage -----------------------------------------------------------------

test("les montants sont formatés à la française, et `null` reste « Non renseigné »", () => {
  assert.equal(money(1234567.5), eur("1_234_567,50_€"));
  assert.equal(money(0), eur("0,00_€"));
  assert.equal(money(-12.3), eur("-12,30_€"));
  assert.equal(money(null), QUOTE_NOT_PROVIDED);
  assert.equal(money(Number.NaN), QUOTE_NOT_PROVIDED);
  assert.equal(money(100, "CHF"), eur("100,00_CHF"));
});

test("les quantités gardent leurs décimales, sans arrondi cosmétique", () => {
  assert.equal(qty(12.345), "12.345");
  assert.equal(qty(1), "1");
  assert.equal(qty(null), QUOTE_NOT_PROVIDED);
});
