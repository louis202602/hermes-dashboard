"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BillingActionState = { phase: "idle" | "success" | "error"; message: string | null };
export const BILLING_INITIAL_STATE: BillingActionState = { phase: "idle", message: null };

const MESSAGES: Record<string, string> = {
  QUOTE_NOT_FOUND: "Devis introuvable.",
  QUOTE_NOT_ACCEPTED: "La facture ne peut être créée qu’à partir d’un devis accepté.",
  QUOTE_HAS_NO_LINES: "Le devis accepté ne contient aucune ligne facturable.",
  INVALID_PERCENTAGE: "Le pourcentage doit être compris entre 0 et 100 %.",
  INVALID_KIND: "Type de facture invalide.",
  INVALID_OPERATION_CATEGORY: "La nature de l’opération est invalide.",
  LEGAL_PROFILE_INCOMPLETE: "Émission bloquée : l’identité juridique HelioSolar n’est pas encore complète et vérifiée.",
  CLIENT_BILLING_ADDRESS_MISSING: "Émission bloquée : l’adresse de facturation du client manque.",
  CLIENT_SIREN_MISSING_OR_INVALID: "Émission bloquée : le SIREN du client professionnel manque ou est invalide.",
  CLIENT_LEGAL_NAME_MISSING: "Émission bloquée : la raison sociale du client manque.",
  INVOICE_NOT_FOUND: "Facture introuvable.",
  INVOICE_CANCELLED: "Cette facture est annulée.",
  ALREADY_PAID: "Cette facture est déjà payée.",
  INVALID_AMOUNT: "Le montant doit être supérieur à zéro.",
  OVERPAYMENT: "Le paiement dépasse le solde restant.",
};

function errorMessage(code: string): string {
  return MESSAGES[code] ?? `Action refusée (${code}).`;
}

export async function createPvInvoiceAction(
  _previous: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const quoteId = String(formData.get("quote_id") ?? "");
  const kind = String(formData.get("kind") ?? "FACTURE");
  const percentage = Number(formData.get("percentage") ?? 100);
  const dueOn = String(formData.get("due_on") ?? "").trim() || null;
  const operationCategory = String(formData.get("operation_category") ?? "BOTH");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_pv_invoice_from_quote", {
    p_quote_id: quoteId,
    p_kind: kind,
    p_percentage: percentage,
    p_due_on: dueOn,
    p_operation_category: operationCategory,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  if (error || !payload.ok) {
    const code = String(payload.code ?? error?.code ?? "UNAVAILABLE");
    return { phase: "error", message: errorMessage(code) };
  }
  revalidatePath("/facturation");
  return { phase: "success", message: `Facture ${String(payload.invoice_number ?? "")} créée avec snapshot légal figé.` };
}

export async function recordPvInvoicePaymentAction(
  _previous: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const amount = Number(formData.get("amount_eur") ?? 0);
  const receivedOn = String(formData.get("received_on") ?? "").trim() || null;
  const method = String(formData.get("method") ?? "VIREMENT");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_pv_invoice_payment", {
    p_invoice_id: invoiceId,
    p_amount_eur: amount,
    p_received_on: receivedOn,
    p_method: method,
    p_reference: reference,
  });
  const payload = (data ?? {}) as Record<string, unknown>;
  if (error || !payload.ok) {
    const code = String(payload.code ?? error?.code ?? "UNAVAILABLE");
    return { phase: "error", message: errorMessage(code) };
  }
  revalidatePath("/facturation");
  return { phase: "success", message: "Paiement enregistré et solde recalculé." };
}
