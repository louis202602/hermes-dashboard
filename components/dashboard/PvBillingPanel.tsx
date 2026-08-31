"use client";

import { useActionState } from "react";

import {
  BILLING_INITIAL_STATE,
  createPvInvoiceAction,
  recordPvInvoicePaymentAction,
} from "@/app/actions/billing";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { PvBillingSnapshot } from "@/services/hermes/pvBilling";

const money = (value: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);

function PaymentForm({ invoiceId, remaining }: { invoiceId: string; remaining: number }) {
  const [state, action, pending] = useActionState(recordPvInvoicePaymentAction, BILLING_INITIAL_STATE);
  return (
    <form action={action} className="agent-action-form">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <div className="agent-form-grid">
        <label className="agent-field">
          <span>Montant reçu</span>
          <input name="amount_eur" type="number" min="0.01" step="0.01" max={remaining} required />
        </label>
        <label className="agent-field">
          <span>Date</span>
          <input name="received_on" type="date" required />
        </label>
        <label className="agent-field">
          <span>Moyen</span>
          <select name="method" defaultValue="VIREMENT">
            <option value="VIREMENT">Virement</option>
            <option value="CB">Carte</option>
            <option value="CHEQUE">Chèque</option>
            <option value="ESPECES">Espèces</option>
            <option value="AUTRE">Autre</option>
          </select>
        </label>
      </div>
      <label className="agent-field">
        <span>Référence bancaire (facultatif)</span>
        <input name="reference" maxLength={160} />
      </label>
      <button className="card-secondary-button" type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le paiement"}
      </button>
      {state.message ? <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}

export default function PvBillingPanel({ snapshot }: { snapshot: PvBillingSnapshot }) {
  const [createState, createAction, creating] = useActionState(createPvInvoiceAction, BILLING_INITIAL_STATE);

  if (!snapshot.ok) {
    return (
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header"><div><span className="panel-eyebrow">FACTURATION</span><h3>Indisponible</h3></div></div>
        <p className="agenda-empty">La source de facturation réelle est indisponible. Aucun montant de remplacement n’est affiché.</p>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div><span className="panel-eyebrow">FACTURATION PV</span><h3>Factures & encaissements</h3></div>
          <ProvenanceBadge provenance="REAL" />
        </div>
        <div className="agenda-summary">
          <div><strong>{snapshot.summary.invoiceCount}</strong><span>factures</span></div>
          <div><strong>{money(snapshot.summary.invoicedTtcEur)}</strong><span>facturé TTC</span></div>
          <div><strong>{money(snapshot.summary.paidEur)}</strong><span>encaissé</span></div>
          <div className={snapshot.summary.outstandingEur > 0 ? "is-overdue" : undefined}><strong>{money(snapshot.summary.outstandingEur)}</strong><span>reste à encaisser</span></div>
          <div className={snapshot.summary.overdueEur > 0 ? "is-overdue" : undefined}><strong>{money(snapshot.summary.overdueEur)}</strong><span>en retard</span></div>
        </div>
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header"><div><span className="panel-eyebrow">ÉMISSION</span><h3>Créer depuis un devis accepté</h3></div></div>
        {snapshot.eligibleQuotes.length === 0 ? (
          <p className="photo-note">Aucun devis accepté n’attend de facture. Une facture ne peut pas être créée à partir d’un devis non accepté.</p>
        ) : (
          <form action={createAction} className="agent-action-form">
            <label className="agent-field">
              <span>Devis accepté</span>
              <select name="quote_id" required>
                {snapshot.eligibleQuotes.map((q) => (
                  <option key={q.quoteId} value={q.quoteId}>{q.quoteNumber} — {q.companyName ?? "Client"} — {money(q.totalTtcEur)}</option>
                ))}
              </select>
            </label>
            <div className="agent-form-grid">
              <label className="agent-field"><span>Type</span><select name="kind" defaultValue="FACTURE"><option value="ACOMPTE">Acompte</option><option value="FACTURE">Facture</option><option value="SOLDE">Solde</option></select></label>
              <label className="agent-field"><span>Part du devis (%)</span><input name="percentage" type="number" min="0.01" max="100" step="0.01" defaultValue="100" required /></label>
              <label className="agent-field"><span>Échéance</span><input name="due_on" type="date" required /></label>
            </div>
            <button className="card-secondary-button" type="submit" disabled={creating}>{creating ? "Création…" : "Créer la facture"}</button>
            {createState.message ? <p className="photo-session-meta" role={createState.phase === "error" ? "alert" : "status"}>{createState.message}</p> : null}
          </form>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header"><div><span className="panel-eyebrow">HISTORIQUE</span><h3>Factures réelles</h3></div></div>
        {snapshot.invoices.length === 0 ? (
          <p className="photo-note">Aucune facture PV n’a encore été émise.</p>
        ) : (
          <div className="agenda-list">
            {snapshot.invoices.map((invoice) => (
              <div className="agenda-item" key={invoice.invoiceId}>
                <span className="agenda-copy">
                  <strong>{invoice.invoiceNumber} · {invoice.companyName ?? "Client"}</strong>
                  <span>{invoice.kind} · {invoice.status} · échéance {invoice.dueOn ?? "non renseignée"} · {money(invoice.totalTtcEur)} TTC · payé {money(invoice.amountPaidEur)}</span>
                </span>
                {invoice.remainingEur > 0 && invoice.status !== "CANCELLED" ? <PaymentForm invoiceId={invoice.invoiceId} remaining={invoice.remainingEur} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
