"use client";

import { useActionState } from "react";

import {
  cancelPvPurchaseOrderAction,
  deletePvPurchaseOrderLineAction,
  markPvPurchaseOrderOrderedAction,
  PV_INITIAL_STATE,
  recordPvPurchaseReceiptAction,
  setPvPurchaseOrderReadyAction,
  upsertPvPurchaseOrderLineAction,
} from "@/app/actions/pv";
import { pvMoney } from "@/lib/pv/quoteLabels";
import {
  pvOrderTone,
  pvQty,
  PV_PURCHASE_BLOCKER_LABELS,
  PV_PURCHASE_ORDER_STATUS_LABELS,
  PV_RECEIPT_CONDITION_LABELS,
} from "@/lib/pv/materialLabels";
import { PV_MATERIAL_UNITS, PV_RECEIPT_CONDITIONS } from "@/types/pv";
import type { PvMaterial, PvPurchaseOrderDetail, PvPurchaseOrderLine } from "@/types/pv";

function Feedback({ state }: { state: { phase: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

function LineForm({
  orderId,
  line,
  materials,
}: {
  orderId: string;
  line: PvPurchaseOrderLine | null;
  materials: PvMaterial[];
}) {
  const [state, formAction, pending] = useActionState(
    upsertPvPurchaseOrderLineAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-order-line-form">
      <input type="hidden" name="order_id" value={orderId} />
      {line !== null ? <input type="hidden" name="line_id" value={line.id} /> : null}
      <label className="agent-field">
        <span>Article</span>
        <select name="material_id" defaultValue={line?.materialId ?? ""}>
          <option value="">— hors catalogue —</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.sku} — {m.designation}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Désignation</span>
        <input type="text" name="designation" defaultValue={line?.designation ?? ""} required maxLength={300} />
      </label>
      <label className="agent-field">
        <span>Réf. fournisseur</span>
        <input type="text" name="supplier_ref" defaultValue={line?.supplierRef ?? ""} />
      </label>
      <label className="agent-field">
        <span>Quantité</span>
        <input
          type="number"
          name="quantity"
          step="0.001"
          min="0.001"
          defaultValue={line === null ? "" : String(line.quantity)}
          required
        />
      </label>
      <label className="agent-field">
        <span>Unité</span>
        <select name="unit" defaultValue={line?.unit ?? "U"}>
          {PV_MATERIAL_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Prix unitaire HT (€)</span>
        <input
          type="number"
          name="unit_price_ht_eur"
          step="0.0001"
          min="0"
          defaultValue={line === null ? "" : String(line.unitPriceHtEur)}
        />
      </label>
      <label className="agent-field">
        <span>TVA (%)</span>
        <input
          type="number"
          name="vat_rate_pct"
          step="0.01"
          min="0"
          max="100"
          defaultValue={String(line?.vatRatePct ?? 20)}
        />
      </label>
      <label className="agent-field">
        <span>Livraison attendue</span>
        <input type="date" name="expected_delivery_on" defaultValue={line?.expectedDeliveryOn ?? ""} />
      </label>
      {/* Aucun champ de TOTAL : il vient d'une colonne générée en base. */}
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : line === null ? "Ajouter la ligne" : "Enregistrer"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function DeleteLineForm({ orderId, lineId }: { orderId: string; lineId: string }) {
  const [state, formAction, pending] = useActionState(
    deletePvPurchaseOrderLineAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="pv-line-delete">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="line_id" value={lineId} />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Retirer"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ReceiptForm({
  orderId,
  line,
}: {
  orderId: string;
  line: PvPurchaseOrderLine;
}) {
  const [state, formAction, pending] = useActionState(
    recordPvPurchaseReceiptAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-receipt-form">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="line_id" value={line.id} />
      <label className="agent-field">
        <span>Quantité reçue</span>
        <input
          type="number"
          name="quantity"
          step="0.001"
          min="0.001"
          max={String(line.quantityMissing)}
          required
        />
      </label>
      <label className="agent-field">
        <span>Reçue le</span>
        <input type="date" name="received_on" />
      </label>
      <label className="agent-field">
        <span>Réf. bon de livraison</span>
        <input type="text" name="delivery_note_ref" maxLength={100} />
      </label>
      <label className="agent-field">
        <span>État</span>
        <select name="condition" defaultValue="CONFORME">
          {PV_RECEIPT_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {PV_RECEIPT_CONDITION_LABELS[c] ?? c}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Commentaire (obligatoire si non conforme)</span>
        <input type="text" name="comment" maxLength={500} />
      </label>
      <p className="photo-note">
        Réception <strong>partielle</strong> acceptée : saisissez ce qui est arrivé. Ce qui
        manque reste visible tant que la ligne n’est pas complète.
      </p>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer la réception"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function ReadyForm({ orderId, blockers }: { orderId: string; blockers: string[] }) {
  const [state, formAction, pending] = useActionState(
    setPvPurchaseOrderReadyAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="order_id" value={orderId} />
      {blockers.length > 0 ? (
        <div className="pv-warning" role="note">
          <strong>Ce qui empêche d’engager cette commande :</strong>
          <ul className="pv-blockers">
            {blockers.map((b) => (
              <li key={b}>{PV_PURCHASE_BLOCKER_LABELS[b] ?? b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Marquer prête à commander"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * DÉCLARER la commande passée.
 *
 * Hermès n'envoie rien : ce bouton enregistre un fait que l'humain rapporte.
 * Le dire à l'endroit du clic évite le malentendu le plus coûteux du lot.
 */
function OrderedForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(
    markPvPurchaseOrderOrderedAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-danger-zone">
      <input type="hidden" name="order_id" value={orderId} />
      <p className="pv-warning" role="note">
        Hermès <strong>n’envoie rien</strong> au fournisseur. Cochez cette case si vous avez
        réellement passé la commande — par téléphone, par courriel ou sur son portail.
      </p>
      <label className="agent-field">
        <span>Passée le</span>
        <input type="date" name="ordered_on" />
      </label>
      <label className="agent-field pv-checkbox">
        <input type="checkbox" name="confirm" value="COMMANDER" required />
        <span>Je confirme avoir passé cette commande auprès du fournisseur.</span>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Déclarer la commande passée"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function CancelForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(
    cancelPvPurchaseOrderAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="order_id" value={orderId} />
      <label className="agent-field">
        <span>Motif d’annulation</span>
        <input type="text" name="reason" required maxLength={300} />
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Annuler la commande"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export default function PvPurchaseOrderEditor({
  detail,
  materials,
}: {
  detail: PvPurchaseOrderDetail;
  materials: PvMaterial[];
}) {
  const o = detail.order;
  const editable = o.status === "DRAFT" || o.status === "READY";
  const receivable = o.status === "ORDERED" || o.status === "PARTIALLY_RECEIVED";
  const cancellable = detail.nextStatuses.includes("CANCELLED");

  return (
    <>
      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">COMMANDE FOURNISSEUR</span>
            <h2>{o.orderNumber}</h2>
          </div>
          <span className={`pv-badge is-${pvOrderTone(o.status)}`}>
            {PV_PURCHASE_ORDER_STATUS_LABELS[o.status] ?? o.status}
          </span>
        </header>

        <dl className="pv-facts">
          <div>
            <dt>Fournisseur</dt>
            <dd>{detail.supplier?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>Total HT</dt>
            <dd>{pvMoney(o.subtotalHtEur)}</dd>
          </div>
          <div>
            <dt>TVA</dt>
            <dd>{pvMoney(o.totalVatEur)}</dd>
          </div>
          <div>
            <dt>Total TTC</dt>
            <dd>{pvMoney(o.totalTtcEur)}</dd>
          </div>
          <div>
            <dt>Livraison attendue</dt>
            <dd>{o.expectedDeliveryOn ?? "—"}</dd>
          </div>
          <div>
            <dt>Passée le</dt>
            <dd>{o.orderedOn ?? "—"}</dd>
          </div>
        </dl>

        {o.cancellationReason !== null ? (
          <p className="photo-note">Annulée : {o.cancellationReason}</p>
        ) : null}

        {!editable && o.status !== "CANCELLED" ? (
          <p className="photo-note">
            Cette commande a été passée : son contenu commercial est{" "}
            <strong>figé</strong> (article, quantité, prix, TVA). Seules les réceptions
            peuvent encore évoluer.
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">LIGNES</span>
            <h2>{detail.lines.length === 0 ? "Aucune ligne" : `${detail.lines.length} ligne(s)`}</h2>
          </div>
        </header>

        {detail.lines.length > 0 ? (
          <table className="pv-order-table">
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Commandé</th>
                <th scope="col">Reçu</th>
                <th scope="col">Manquant</th>
                <th scope="col">P.U. HT</th>
                <th scope="col">Total HT</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <th scope="row">
                    {l.designation}
                    {l.sku === null ? null : <span className="photo-note"> ({l.sku})</span>}
                  </th>
                  <td>{pvQty(l.quantity, l.unit)}</td>
                  <td>{pvQty(l.quantityReceived, l.unit)}</td>
                  <td>{l.quantityMissing === 0 ? "—" : pvQty(l.quantityMissing, l.unit)}</td>
                  <td>{pvMoney(l.unitPriceHtEur)}</td>
                  <td>{pvMoney(l.lineTotalHtEur)}</td>
                  <td>
                    {editable ? <DeleteLineForm orderId={o.id} lineId={l.id} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {editable ? (
          <>
            <h3 className="panel-eyebrow">Ajouter une ligne</h3>
            <LineForm orderId={o.id} line={null} materials={materials} />
          </>
        ) : null}
      </section>

      {receivable ? (
        <section className="dashboard-card pv-card">
          <header className="panel-head">
            <div>
              <span className="panel-eyebrow">RÉCEPTION</span>
              <h2>Enregistrer une livraison</h2>
            </div>
          </header>
          {detail.lines
            .filter((l) => l.quantityMissing > 0)
            .map((l) => (
              <div key={l.id} className="pv-receipt-block">
                <p className="pv-receipt-head">
                  <strong>{l.designation}</strong>{" "}
                  <span className="photo-note">
                    il manque {pvQty(l.quantityMissing, l.unit)} sur{" "}
                    {pvQty(l.quantity, l.unit)}
                  </span>
                </p>
                <ReceiptForm orderId={o.id} line={l} />
              </div>
            ))}
          {detail.lines.every((l) => l.quantityMissing === 0) ? (
            <p className="photo-note">Toutes les lignes sont complètes.</p>
          ) : null}
        </section>
      ) : null}

      {detail.receipts.length > 0 ? (
        <section className="dashboard-card pv-card">
          <header className="panel-head">
            <div>
              <span className="panel-eyebrow">HISTORIQUE</span>
              <h2>Réceptions</h2>
            </div>
          </header>
          <ul className="pv-receipt-list">
            {detail.receipts.map((r) => {
              const line = detail.lines.find((l) => l.id === r.lineId);
              return (
                <li key={r.id}>
                  <span>{r.receivedOn}</span>
                  <span>{line?.designation ?? "—"}</span>
                  <span>{pvQty(r.quantityReceived, line?.unit ?? "U")}</span>
                  <span className="pv-badge">
                    {PV_RECEIPT_CONDITION_LABELS[r.condition] ?? r.condition}
                  </span>
                  <span className="photo-note">
                    {r.deliveryNoteRef === null ? "sans BL" : `BL ${r.deliveryNoteRef}`}
                  </span>
                  {r.comment === null ? null : <span className="photo-note">{r.comment}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">PIÈCES JOINTES</span>
            <h2>Documents fournisseur</h2>
          </div>
        </header>
        {detail.documents.length === 0 ? (
          <p className="photo-note">
            Aucun document rattaché. Devis fournisseur, accusé de réception et bon de
            livraison se déposent depuis la fiche du site et restent dans le bucket privé
            existant.
          </p>
        ) : (
          <ul className="pv-document-list">
            {detail.documents.map((d) => (
              <li key={d.id}>
                {d.signedUrl === null ? (
                  <span>{d.originalFilename ?? d.docType}</span>
                ) : (
                  <a href={d.signedUrl} target="_blank" rel="noreferrer">
                    {d.originalFilename ?? d.docType}
                  </a>
                )}
                <span className="photo-note">
                  {d.docType} — {Math.round(d.sizeBytes / 1024)} Ko
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">SUITES</span>
            <h2>Actions</h2>
          </div>
        </header>
        {o.status === "DRAFT" ? <ReadyForm orderId={o.id} blockers={detail.blockers} /> : null}
        {o.status === "READY" ? <OrderedForm orderId={o.id} /> : null}
        {cancellable ? <CancelForm orderId={o.id} /> : null}
        {!cancellable && o.status === "RECEIVED" ? (
          <p className="photo-note">
            Commande reçue : c’est un état terminal. Une correction passe par une nouvelle
            commande — l’historique reste entier.
          </p>
        ) : null}
      </section>
    </>
  );
}
