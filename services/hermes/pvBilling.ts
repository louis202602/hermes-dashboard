import "server-only";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
};

export type PvBillingEligibleQuote = {
  quoteId: string;
  quoteNumber: string;
  companyName: string | null;
  totalTtcEur: number;
  currency: string;
  acceptedOn: string | null;
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
  invoices: PvBillingInvoice[];
  eligibleQuotes: PvBillingEligibleQuote[];
};

const n = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
const s = (value: unknown) => (typeof value === "string" && value ? value : null);

export async function getPvBillingSnapshot(): Promise<PvBillingSnapshot> {
  const unavailable: PvBillingSnapshot = {
    ok: false,
    provenance: "UNAVAILABLE",
    summary: { invoiceCount: 0, invoicedTtcEur: 0, paidEur: 0, outstandingEur: 0, overdueEur: 0, acceptedQuotesWithoutInvoice: 0 },
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
    const p = (data ?? {}) as Record<string, unknown>;
    if (!p.ok) return unavailable;
    const rawSummary = (p.summary ?? {}) as Record<string, unknown>;
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
      })),
      eligibleQuotes: quotes.map((row) => ({
        quoteId: String(row.quote_id ?? ""),
        quoteNumber: String(row.quote_number ?? ""),
        companyName: s(row.company_name),
        totalTtcEur: n(row.total_ttc_eur),
        currency: String(row.currency ?? "EUR"),
        acceptedOn: s(row.accepted_on),
      })),
    };
  } catch (e) {
    logEvent("error", "pv_billing.exception", { message: e instanceof Error ? e.message : "unknown" });
    return unavailable;
  }
}
