import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PvInvoicePdfModel } from "@/lib/pv/invoicePdf";

export type PvBillingInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  kind: string;
  status: string;
  issuedOn: string | null;
  dueOn: string | null;
  totalTtcEur: number;
  amountPaidEur: number;
  remainingEur: number;
  companyName: string | null;
  quoteNumber: string | null;
  pdfUrl: string | null;
};

export type PvBillingEligibleQuote = {
  quoteId: string;
  quoteNumber: string;
  companyName: string | null;
  totalTtcEur: number;
  currency: string;
  acceptedOn: string | null;
  clientSiren: string | null;
  billingAddress: string | null;
};

export type PvBillingLegalReadiness = {
  invoiceIssuanceReady: boolean;
  blockers: string[];
  sellerStatus: string;
  eInvoicePlatform: string | null;
  eInvoiceReceptionReady: boolean;
  receptionDeadline: string;
  emissionDeadlineSmallBusiness: string;
};

export type PvBillingSnapshot = {
  ok: boolean;
  provenance: "REAL" | "UNAVAILABLE";
  summary: {
    invoiceCount: number;
    invoicedTtcEur: number;
    paidEur: number;
    outstandingEur: number;
    overdueEur: number;
    acceptedQuotesWithoutInvoice: number;
  };
  legalReadiness: PvBillingLegalReadiness;
  invoices: PvBillingInvoice[];
  eligibleQuotes: PvBillingEligibleQuote[];
};

const n = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
const s = (value: unknown) => (typeof value === "string" && value ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const EMPTY_LEGAL: PvBillingLegalReadiness = {
  invoiceIssuanceReady: false,
  blockers: ["LEGAL_READINESS_UNAVAILABLE"],
  sellerStatus: "UNAVAILABLE",
  eInvoicePlatform: null,
  eInvoiceReceptionReady: false,
  receptionDeadline: "2026-09-01",
  emissionDeadlineSmallBusiness: "2027-09-01",
};

export async function getPvBillingSnapshot(): Promise<PvBillingSnapshot> {
  const unavailable: PvBillingSnapshot = {
    ok: false,
    provenance: "UNAVAILABLE",
    summary: { invoiceCount: 0, invoicedTtcEur: 0, paidEur: 0, outstandingEur: 0, overdueEur: 0, acceptedQuotesWithoutInvoice: 0 },
    legalReadiness: EMPTY_LEGAL,
    invoices: [],
    eligibleQuotes: [],
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_pv_billing_snapshot", { p_limit: 100 });
    if (error) {
      logEvent("error", "pv_billing.rpc_error", { code: error.code });
      return unavailable;
    }
    const p = record(data);
    if (!p.ok) return unavailable;
    const rawSummary = record(p.summary);
    const lr = record(p.legal_readiness);
    const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : [];
    const quotes = Array.isArray(p.eligible_quotes) ? (p.eligible_quotes as Record<string, unknown>[]) : [];
    return {
      ok: true,
      provenance: "REAL",
      summary: {
        invoiceCount: n(rawSummary.invoice_count),
        invoicedTtcEur: n(rawSummary.invoiced_ttc_eur),
        paidEur: n(rawSummary.paid_eur),
        outstandingEur: n(rawSummary.outstanding_eur),
        overdueEur: n(rawSummary.overdue_eur),
        acceptedQuotesWithoutInvoice: n(rawSummary.accepted_quotes_without_invoice),
      },
      legalReadiness: {
        invoiceIssuanceReady: Boolean(lr.invoice_issuance_ready),
        blockers: Array.isArray(lr.blockers) ? lr.blockers.map(String) : [],
        sellerStatus: String(lr.seller_status ?? "MISSING"),
        eInvoicePlatform: s(lr.e_invoice_platform),
        eInvoiceReceptionReady: Boolean(lr.e_invoice_reception_ready),
        receptionDeadline: String(lr.reception_deadline ?? "2026-09-01"),
        emissionDeadlineSmallBusiness: String(lr.emission_deadline_small_business ?? "2027-09-01"),
      },
      invoices: items.map((row) => ({
        invoiceId: String(row.invoice_id ?? ""),
        invoiceNumber: String(row.invoice_number ?? ""),
        kind: String(row.kind ?? "FACTURE"),
        status: String(row.status ?? "ISSUED"),
        issuedOn: s(row.issued_on),
        dueOn: s(row.due_on),
        totalTtcEur: n(row.total_ttc_eur),
        amountPaidEur: n(row.amount_paid_eur),
        remainingEur: n(row.remaining_eur),
        companyName: s(row.company_name),
        quoteNumber: s(row.quote_number),
        pdfUrl: s(row.pdf_url),
      })),
      eligibleQuotes: quotes.map((row) => ({
        quoteId: String(row.quote_id ?? ""),
        quoteNumber: String(row.quote_number ?? ""),
        companyName: s(row.company_name),
        totalTtcEur: n(row.total_ttc_eur),
        currency: String(row.currency ?? "EUR"),
        acceptedOn: s(row.accepted_on),
        clientSiren: s(row.client_siren),
        billingAddress: s(row.billing_address),
      })),
    };
  } catch (e) {
    logEvent("error", "pv_billing.exception", { message: e instanceof Error ? e.message : "unknown" });
    return unavailable;
  }
}

export async function getPvInvoicePdfModel(invoiceId: string): Promise<PvInvoicePdfModel | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_pv_invoice_pdf_model", { p_invoice_id: invoiceId });
    if (error) {
      logEvent("error", "pv_invoice_pdf.rpc_error", { code: error.code });
      return null;
    }
    const p = record(data);
    if (!p.ok) return null;
    const invoice = record(p.invoice);
    const seller = record(p.seller);
    const buyer = record(p.buyer);
    const lines = Array.isArray(p.lines) ? (p.lines as Record<string, unknown>[]) : [];
    const vat = Array.isArray(p.vat_breakdown) ? (p.vat_breakdown as Record<string, unknown>[]) : [];
    const operation = String(invoice.operation_category ?? "BOTH");
    if (operation !== "GOODS" && operation !== "SERVICES" && operation !== "BOTH") return null;
    const required = [seller.legal_name, seller.address, seller.siren, seller.siret, buyer.legal_name, buyer.billing_address, invoice.invoice_number, invoice.issued_on, invoice.due_on];
    if (required.some((v) => typeof v !== "string" || v.length === 0)) return null;
    return {
      invoiceNumber: String(invoice.invoice_number),
      kind: String(invoice.kind ?? "FACTURE"),
      status: String(invoice.status ?? "ISSUED"),
      currency: String(invoice.currency ?? "EUR"),
      issuedOn: String(invoice.issued_on),
      dueOn: String(invoice.due_on),
      subtotalHtEur: n(invoice.subtotal_ht_eur),
      totalVatEur: n(invoice.total_vat_eur),
      totalTtcEur: n(invoice.total_ttc_eur),
      amountPaidEur: n(invoice.amount_paid_eur),
      operationCategory: operation,
      seller: {
        legalName: String(seller.legal_name),
        tradeName: s(seller.trade_name),
        address: String(seller.address),
        siren: String(seller.siren),
        siret: String(seller.siret),
        vatNumber: s(seller.vat_number),
        vatExemptionMention: s(seller.vat_exemption_mention),
        earlyPaymentDiscountTerms: String(seller.early_payment_discount_terms ?? "Néant"),
        latePenaltyTerms: String(seller.late_penalty_terms ?? "Selon conditions contractuelles"),
        recoveryIndemnityEur: n(seller.recovery_indemnity_eur),
      },
      buyer: {
        legalName: String(buyer.legal_name),
        billingAddress: String(buyer.billing_address),
        siren: s(buyer.siren),
        email: s(buyer.email),
        deliveryAddress: s(buyer.delivery_address),
      },
      lines: lines.map((line) => ({
        position: n(line.position),
        designation: String(line.designation ?? ""),
        description: s(line.description),
        quantity: n(line.quantity),
        unit: String(line.unit ?? "u"),
        unitPriceHtEur: n(line.unit_price_ht_eur),
        vatRatePct: n(line.vat_rate_pct),
        lineTotalHtEur: n(line.line_total_ht_eur),
      })),
      vatBreakdown: vat.map((row) => ({ ratePct: n(row.rate_pct), baseHtEur: n(row.base_ht_eur), vatEur: n(row.vat_eur) })),
    };
  } catch (e) {
    logEvent("error", "pv_invoice_pdf.exception", { message: e instanceof Error ? e.message : "unknown" });
    return null;
  }
}
