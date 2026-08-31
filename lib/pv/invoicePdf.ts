import {
  createPainter,
  emitPdf,
  ensure,
  hline,
  MARGIN,
  PAGE_W,
  rect,
  text,
  textAt,
  wrap,
  type Painter,
} from "@/lib/pv/pdfEngine";

export type PvInvoicePdfLine = {
  position: number;
  designation: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceHtEur: number;
  vatRatePct: number;
  lineTotalHtEur: number;
};

export type PvInvoicePdfModel = {
  invoiceNumber: string;
  kind: string;
  status: string;
  currency: string;
  issuedOn: string;
  dueOn: string;
  subtotalHtEur: number;
  totalVatEur: number;
  totalTtcEur: number;
  amountPaidEur: number;
  operationCategory: "GOODS" | "SERVICES" | "BOTH";
  seller: {
    legalName: string;
    tradeName: string | null;
    address: string;
    siren: string;
    siret: string;
    vatNumber: string | null;
    vatExemptionMention: string | null;
    earlyPaymentDiscountTerms: string;
    latePenaltyTerms: string;
    recoveryIndemnityEur: number;
  };
  buyer: {
    legalName: string;
    billingAddress: string;
    siren: string | null;
    email: string | null;
    deliveryAddress: string | null;
  };
  lines: PvInvoicePdfLine[];
  vatBreakdown: { ratePct: number; baseHtEur: number; vatEur: number }[];
};

const TABLE_W = PAGE_W - 2 * MARGIN;
const money = (v: number, currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(v);

function row(p: Painter, line: PvInvoicePdfLine, currency: string) {
  const designation = wrap(line.designation, 9, 230);
  ensure(p, Math.max(28, designation.length * 11 + 8));
  const y = p.y;
  for (const part of designation) {
    textAt(p, part, MARGIN + 4, 9, false, p.y);
    p.y -= 11;
  }
  textAt(p, `${line.quantity} ${line.unit}`, MARGIN + 245, 9, false, y);
  textAt(p, money(line.unitPriceHtEur, currency), MARGIN + 315, 9, false, y);
  textAt(p, `${line.vatRatePct} %`, MARGIN + 405, 9, false, y);
  textAt(p, money(line.lineTotalHtEur, currency), MARGIN + 452, 9, true, y);
  if (line.description) {
    for (const part of wrap(line.description, 8, 230)) {
      textAt(p, part, MARGIN + 10, 8, false, p.y);
      p.y -= 9;
    }
  }
  p.y -= 5;
  hline(p, p.y + 2);
  p.y -= 5;
}

export function buildPvInvoicePdf(model: PvInvoicePdfModel): Uint8Array {
  const p = createPainter();
  text(p, model.kind === "ACOMPTE" ? "Facture d’acompte" : model.kind === "SOLDE" ? "Facture de solde" : "Facture", 20, true);
  text(p, `N° ${model.invoiceNumber}`, 12, true);
  text(p, `Date d’émission : ${model.issuedOn}`, 10, false);
  text(p, `Date d’échéance : ${model.dueOn}`, 10, false);
  p.y -= 6;
  hline(p);
  p.y -= 14;

  text(p, "Émetteur", 13, true);
  text(p, model.seller.legalName, 10, true, 10);
  if (model.seller.tradeName) text(p, `Nom commercial : ${model.seller.tradeName}`, 10, false, 10);
  text(p, model.seller.address, 10, false, 10);
  text(p, `SIREN : ${model.seller.siren} — SIRET : ${model.seller.siret}`, 10, false, 10);
  if (model.seller.vatNumber) text(p, `N° TVA : ${model.seller.vatNumber}`, 10, false, 10);
  if (model.seller.vatExemptionMention) text(p, model.seller.vatExemptionMention, 10, true, 10);
  p.y -= 8;

  text(p, "Client", 13, true);
  text(p, model.buyer.legalName, 10, true, 10);
  text(p, model.buyer.billingAddress, 10, false, 10);
  if (model.buyer.siren) text(p, `SIREN client : ${model.buyer.siren}`, 10, false, 10);
  if (model.buyer.deliveryAddress && model.buyer.deliveryAddress !== model.buyer.billingAddress) {
    text(p, `Adresse de livraison / chantier : ${model.buyer.deliveryAddress}`, 10, false, 10);
  }
  text(p, `Nature des opérations : ${model.operationCategory === "GOODS" ? "livraisons de biens" : model.operationCategory === "SERVICES" ? "prestations de services" : "livraisons de biens et prestations de services"}`, 10, false, 10);
  p.y -= 12;

  rect(p, MARGIN, p.y - 4, TABLE_W, 16, 0.9);
  textAt(p, "Désignation", MARGIN + 4, 9, true, p.y + 1);
  textAt(p, "Qté", MARGIN + 245, 9, true, p.y + 1);
  textAt(p, "P.U. HT", MARGIN + 315, 9, true, p.y + 1);
  textAt(p, "TVA", MARGIN + 405, 9, true, p.y + 1);
  textAt(p, "Total HT", MARGIN + 452, 9, true, p.y + 1);
  p.y -= 20;
  for (const line of model.lines) row(p, line, model.currency);

  p.y -= 8;
  ensure(p, 120);
  textAt(p, "Total HT", MARGIN + 350, 10, false);
  textAt(p, money(model.subtotalHtEur, model.currency), MARGIN + 452, 10, true);
  p.y -= 14;
  for (const vat of model.vatBreakdown) {
    textAt(p, `TVA ${vat.ratePct} %`, MARGIN + 350, 10, false);
    textAt(p, money(vat.vatEur, model.currency), MARGIN + 452, 10, false);
    p.y -= 13;
  }
  textAt(p, "Total TVA", MARGIN + 350, 10, false);
  textAt(p, money(model.totalVatEur, model.currency), MARGIN + 452, 10, true);
  p.y -= 15;
  hline(p, p.y + 5);
  textAt(p, "TOTAL TTC", MARGIN + 350, 12, true);
  textAt(p, money(model.totalTtcEur, model.currency), MARGIN + 452, 12, true);
  p.y -= 24;

  text(p, "Conditions de paiement", 12, true);
  text(p, `Escompte pour paiement anticipé : ${model.seller.earlyPaymentDiscountTerms}`, 9, false, 10);
  text(p, `Pénalités de retard : ${model.seller.latePenaltyTerms}`, 9, false, 10);
  text(p, `Indemnité forfaitaire pour frais de recouvrement due par un client professionnel en cas de retard : ${money(model.seller.recoveryIndemnityEur, "EUR")}.`, 9, false, 10);

  return emitPdf(p, {
    footer: (i, total) => [
      `Facture ${model.invoiceNumber} — ${model.seller.legalName} — page ${i + 1} / ${total}`,
      `Total TTC : ${money(model.totalTtcEur, model.currency)} — échéance ${model.dueOn}`,
    ],
  });
}
