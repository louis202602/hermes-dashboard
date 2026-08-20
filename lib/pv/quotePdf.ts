/**
 * DEVIS PHOTOVOLTAÏQUE — le CONTENU du document contractuel.
 *
 * Distinct de la synthèse d'étude, et il doit le rester visiblement : l'un est
 * une projection indicative, l'autre engage un prix. Les confondre serait la
 * faute la plus coûteuse du Pack PV. Trois choses les séparent à l'œil : le
 * titre, le tableau de lignes chiffrées, et l'absence de la mention
 * « non contractuel » — remplacée ici par des conditions et une durée de validité.
 *
 * La mécanique PDF vit dans `lib/pv/pdfEngine.ts`, partagée avec la synthèse.
 *
 * AUCUNE VALEUR N'EST INVENTÉE. Une donnée absente s'affiche « Non renseigné ».
 * Sur un devis, un chiffre comblé serait un engagement fabriqué.
 */

import {
  boxedText,
  createPainter,
  emitPdf,
  ensure,
  hline,
  LINE,
  MARGIN,
  PAGE_W,
  rect,
  text,
  textAt,
  textWidth,
  wrap,
  type Painter,
} from "@/lib/pv/pdfEngine";
import { NBSP, PV_QUOTE_NOT_PROVIDED, pvMoney } from "@/lib/pv/quoteLabels";

export const PV_QUOTE_PDF_TITLE = "Devis photovoltaïque";

export const PV_QUOTE_DRAFT_BANNER = "BROUILLON — NON ÉMIS — NE PAS TRANSMETTRE AU CLIENT";

/**
 * Mention de rattachement : le devis s'appuie sur une étude, et le lecteur doit
 * pouvoir remonter à laquelle. Un prix sans son étude n'est pas vérifiable.
 */
export const PV_QUOTE_STUDY_NOTICE =
  "Ce devis s’appuie sur l’étude photovoltaïque référencée ci-dessus. " +
  "Les caractéristiques techniques retenues y figurent en détail.";

/**
 * Avertissements obligatoires. Ils ne rendent PAS le devis non contractuel — il
 * l’est — mais bornent honnêtement ce qui reste conditionnel.
 */
export const PV_QUOTE_WARNINGS = [
  "Devis valable jusqu’à la date de validité indiquée. Passé ce délai, les prix sont susceptibles d’être révisés.",
  "L’exécution reste soumise à la visite technique préalable, à la faisabilité constatée sur site et aux autorisations administratives requises.",
  "Les taux de TVA appliqués figurent ligne par ligne. Ils relèvent de la réglementation en vigueur à la date d’émission.",
];

export const QUOTE_NOT_PROVIDED = PV_QUOTE_NOT_PROVIDED;
export { NBSP };

export type PvQuotePdfLine = {
  position: number;
  category: string;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceHtEur: number;
  vatRatePct: number;
  discountPct: number;
  lineTotalHtEur: number;
};

export type PvQuotePdfModel = {
  stage: "DRAFT" | "FINAL";
  company: string;
  quoteNumber: string;
  version: number;
  status: string;
  clientName: string;
  clientContact: string | null;
  siteAddress: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  generatedOn: string;
  currency: string;
  studyReference: string;
  lines: PvQuotePdfLine[];
  subtotalHtEur: number;
  discountPct: number;
  discountAmountEur: number;
  totalHtEur: number;
  totalVatEur: number;
  totalTtcEur: number;
  /** Ventilation par taux : un devis à plusieurs taux doit les montrer. */
  vatBreakdown: { ratePct: number; baseHtEur: number; vatEur: number }[];
  observations: string | null;
  terms: string | null;
};

/**
 * Montant formaté. Délègue à l'implémentation CANONIQUE de `quoteLabels` : une
 * seule pour l'écran et pour le document. Deux formatages divergeraient, et le
 * PDF finirait par imprimer un total différent de celui affiché à l'opérateur.
 */
export function money(v: number | null | undefined, currency = "EUR"): string {
  return pvMoney(v, currency, QUOTE_NOT_PROVIDED);
}

/** Quantité : décimales conservées telles qu'elles sont, sans arrondi cosmétique. */
export function qty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return QUOTE_NOT_PROVIDED;
  return String(Number(v.toFixed(3)));
}

// Colonnes du tableau, en points depuis la marge gauche.
const COL_DESIGNATION = 0;
const COL_QTY = 250;
const COL_UNIT_PRICE = 310;
const COL_VAT = 390;
const COL_TOTAL = 440;
const TABLE_W = PAGE_W - 2 * MARGIN;

function tableHeader(p: Painter): void {
  ensure(p, LINE * 2);
  rect(p, MARGIN, p.y - 4, TABLE_W, 16, 0.9);
  const y = p.y + 1;
  textAt(p, "Désignation", MARGIN + COL_DESIGNATION + 2, 9, true, y);
  textAt(p, "Qté", MARGIN + COL_QTY, 9, true, y);
  textAt(p, "P.U. HT", MARGIN + COL_UNIT_PRICE, 9, true, y);
  textAt(p, "TVA", MARGIN + COL_VAT, 9, true, y);
  textAt(p, "Total HT", MARGIN + COL_TOTAL, 9, true, y);
  p.y -= 20;
}

/** Une ligne du tableau. Renvoie après avoir avancé le curseur. */
function tableRow(p: Painter, line: PvQuotePdfLine, currency: string): void {
  const wrapped = wrap(line.designation, 9, COL_QTY - 10);
  const detail = line.description === null ? [] : wrap(line.description, 8, COL_QTY - 10);
  ensure(p, LINE * (wrapped.length + detail.length + 1));

  const top = p.y;
  textAt(p, qty(line.quantity) + " " + line.unit, MARGIN + COL_QTY, 9, false, top);
  textAt(p, money(line.unitPriceHtEur, currency), MARGIN + COL_UNIT_PRICE, 9, false, top);
  textAt(p, `${Number(line.vatRatePct)} %`, MARGIN + COL_VAT, 9, false, top);
  textAt(p, money(line.lineTotalHtEur, currency), MARGIN + COL_TOTAL, 9, true, top);

  for (const l of wrapped) {
    textAt(p, l, MARGIN + COL_DESIGNATION + 2, 9, false, p.y);
    p.y -= 11;
  }
  for (const l of detail) {
    textAt(p, l, MARGIN + COL_DESIGNATION + 8, 8, false, p.y);
    p.y -= 10;
  }
  // Une remise de ligne est ÉCRITE : un total plus bas que quantité × prix sans
  // explication ferait douter le client, à juste titre.
  if (line.discountPct > 0) {
    textAt(p, `remise ${Number(line.discountPct)} %`, MARGIN + COL_DESIGNATION + 8, 8, false, p.y);
    p.y -= 10;
  }
  p.y -= 4;
  hline(p, p.y + 2);
  p.y -= 4;
}

function totalLine(p: Painter, label: string, value: string, bold: boolean): void {
  ensure(p, LINE);
  textAt(p, label, MARGIN + COL_UNIT_PRICE - 60, bold ? 11 : 10, bold);
  textAt(p, value, MARGIN + COL_TOTAL, bold ? 11 : 10, bold);
  p.y -= bold ? 16 : 13;
}

/**
 * Construit le devis. Renvoie les octets d'un PDF complet et autonome.
 *
 * Un BROUILLON porte un bandeau en tête ET un cachet en pied de CHAQUE page :
 * une page détachée d'un brouillon ne doit pas pouvoir passer pour un devis émis.
 */
export function buildPvQuotePdf(model: PvQuotePdfModel): Uint8Array {
  const p = createPainter();
  const cur = model.currency;

  if (model.stage === "DRAFT") {
    rect(p, MARGIN, p.y - 22, TABLE_W, 26, 0.85);
    textAt(p, PV_QUOTE_DRAFT_BANNER, MARGIN + 8, 11, true, p.y - 15);
    p.y -= 40;
  }

  // --- Titre et identification ----------------------------------------------
  text(p, PV_QUOTE_PDF_TITLE, 20, true);
  p.y -= 4;
  text(p, model.company, 11, false);
  text(p, `Devis n° ${model.quoteNumber} — version ${model.version}`, 11, true);
  text(p, `Émis le ${model.issuedOn ?? QUOTE_NOT_PROVIDED}`, 10, false);
  text(p, `Valable jusqu’au ${model.validUntil ?? QUOTE_NOT_PROVIDED}`, 10, false);
  text(p, `Édité le ${model.generatedOn}`, 9, false);
  p.y -= 4;
  hline(p);
  p.y -= 14;

  // --- Client et site --------------------------------------------------------
  text(p, "Client", 13, true);
  text(p, model.clientName, 11, false, 10);
  if (model.clientContact !== null) text(p, model.clientContact, 10, false, 10);
  p.y -= 4;
  text(p, "Site d’installation", 13, true);
  text(p, model.siteAddress ?? QUOTE_NOT_PROVIDED, 11, false, 10);
  p.y -= 4;
  text(p, `Étude de référence : ${model.studyReference}`, 10, false, 10);
  text(p, PV_QUOTE_STUDY_NOTICE, 9, false, 10);
  p.y -= 10;

  // --- Tableau des lignes ----------------------------------------------------
  text(p, "Détail de la prestation", 13, true);
  p.y -= 2;
  tableHeader(p);
  if (model.lines.length === 0) {
    // Un devis sans ligne ne peut pas être émis ; s'il est imprimé en brouillon,
    // il doit le DIRE plutôt que d'afficher un tableau vide sans explication.
    text(p, "Aucune ligne saisie.", 10, false, 10);
    p.y -= 6;
  }
  for (const line of model.lines) tableRow(p, line, cur);

  // --- Totaux ----------------------------------------------------------------
  p.y -= 6;
  ensure(p, LINE * 6);
  totalLine(p, "Sous-total HT", money(model.subtotalHtEur, cur), false);
  if (model.discountPct > 0) {
    totalLine(
      p,
      `Remise ${Number(model.discountPct)} %`,
      `- ${money(model.discountAmountEur, cur)}`,
      false,
    );
  }
  totalLine(p, "Total HT", money(model.totalHtEur, cur), false);
  for (const v of model.vatBreakdown) {
    totalLine(p, `TVA ${Number(v.ratePct)} % sur ${money(v.baseHtEur, cur)}`, money(v.vatEur, cur), false);
  }
  totalLine(p, "Total TVA", money(model.totalVatEur, cur), false);
  hline(p, p.y + 6);
  p.y -= 4;
  totalLine(p, "TOTAL TTC", money(model.totalTtcEur, cur), true);
  p.y -= 8;

  // --- Observations et conditions --------------------------------------------
  if (model.observations !== null) {
    ensure(p, LINE * 3);
    text(p, "Observations", 13, true);
    text(p, model.observations, 10, false, 10);
    p.y -= 8;
  }

  ensure(p, LINE * 3);
  text(p, "Conditions", 13, true);
  text(p, model.terms ?? QUOTE_NOT_PROVIDED, 10, false, 10);
  p.y -= 8;

  for (const w of PV_QUOTE_WARNINGS) boxedText(p, w, 9);

  // --- Acceptation, en clair -------------------------------------------------
  ensure(p, LINE * 4);
  text(p, "Acceptation", 13, true);
  text(
    p,
    "Ce devis n’est pas un bon de commande signé. Son acceptation est enregistrée " +
      "par l’entreprise à réception de votre accord écrit.",
    9,
    false,
    10,
  );

  return emitPdf(p, {
    footer: (i, total) => [
      `${PV_QUOTE_PDF_TITLE} n° ${model.quoteNumber} v${model.version} — ${model.company} — page ${i + 1} / ${total}`,
      `Total TTC : ${money(model.totalTtcEur, cur)} — valable jusqu’au ${model.validUntil ?? QUOTE_NOT_PROVIDED}`,
    ],
    cornerStamp: () => (model.stage === "DRAFT" ? "BROUILLON — NON ÉMIS" : null),
  });
}

/** Largeur utile — exportée pour que les tests puissent vérifier la mise en page. */
export const PV_QUOTE_TABLE_WIDTH = TABLE_W;
export { textWidth as pvQuoteTextWidth };
