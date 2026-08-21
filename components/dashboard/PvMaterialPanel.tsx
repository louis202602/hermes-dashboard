"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  addPvMaterialRequirementAction,
  confirmPvMaterialRequirementAction,
  createPvPurchaseOrderAction,
  derivePvMaterialRequirementsAction,
  dismissPvMaterialRequirementAction,
  PV_INITIAL_STATE,
} from "@/app/actions/pv";
import { pvMoney } from "@/lib/pv/quoteLabels";
import {
  pvGapTone,
  pvMarginSentence,
  pvMaterialReadinessTone,
  pvOrderTone,
  pvQty,
  PV_MATERIAL_GAP_LABELS,
  PV_MATERIAL_READINESS_LABELS,
  PV_PURCHASE_ORDER_STATUS_LABELS,
  PV_REQUIREMENT_ORIGIN_LABELS,
} from "@/lib/pv/materialLabels";
import { PV_MATERIAL_UNITS } from "@/types/pv";
import type { PvMaterial, PvMaterialPlan, PvMaterialRequirement, PvSupplier } from "@/types/pv";

function Feedback({ state }: { state: { phase: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

/**
 * CONFIRMER un besoin issu de texte libre.
 *
 * C'est le geste qui referme la seule zone d'incertitude du lot : Hermès a lu
 * « Pose de panneaux — forfait » et n'a PAS deviné ce que cela contient. Tant
 * que personne ne l'a dit, l'affaire ne peut pas être déclarée prête.
 */
function ConfirmRequirementForm({
  requirement,
  prospectId,
  materials,
}: {
  requirement: PvMaterialRequirement;
  prospectId: string;
  materials: PvMaterial[];
}) {
  const [state, formAction, pending] = useActionState(
    confirmPvMaterialRequirementAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-material-confirm">
      <input type="hidden" name="requirement_id" value={requirement.id} />
      <input type="hidden" name="prospect_id" value={prospectId} />
      <label className="agent-field">
        <span>Rattacher à un article</span>
        <select name="material_id" defaultValue="">
          <option value="">— laisser en texte libre —</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.sku} — {m.designation}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Quantité confirmée</span>
        <input
          type="number"
          name="quantity"
          step="0.001"
          min="0.001"
          defaultValue={String(requirement.quantityRequired)}
        />
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Confirmer ce besoin"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function DismissRequirementForm({
  requirementId,
  prospectId,
}: {
  requirementId: string;
  prospectId: string;
}) {
  const [state, formAction, pending] = useActionState(
    dismissPvMaterialRequirementAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="pv-material-dismiss">
      <input type="hidden" name="requirement_id" value={requirementId} />
      <input type="hidden" name="prospect_id" value={prospectId} />
      <input type="text" name="reason" placeholder="Motif (obligatoire)" required maxLength={300} />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Écarter"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function AddRequirementForm({
  prospectId,
  materials,
}: {
  prospectId: string;
  materials: PvMaterial[];
}) {
  const [state, formAction, pending] = useActionState(
    addPvMaterialRequirementAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction} className="agent-action-form pv-material-form">
      <input type="hidden" name="prospect_id" value={prospectId} />
      <label className="agent-field">
        <span>Article du catalogue</span>
        <select name="material_id" defaultValue="">
          <option value="">— hors catalogue —</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.sku} — {m.designation}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>… ou désignation libre</span>
        <input type="text" name="free_designation" maxLength={300} />
      </label>
      <label className="agent-field">
        <span>Quantité</span>
        <input type="number" name="quantity" step="0.001" min="0.001" required />
      </label>
      <label className="agent-field">
        <span>Unité</span>
        <select name="unit" defaultValue="U">
          {PV_MATERIAL_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field pv-checkbox">
        <input type="checkbox" name="is_mandatory" defaultChecked />
        <span>Obligatoire pour poser</span>
      </label>
      <p className="photo-note">
        Un besoin saisi <strong>sur le catalogue</strong> est consolidable tel quel. Un
        besoin en <strong>texte libre</strong> devra être confirmé : Hermès n’invente pas
        ce qu’il représente.
      </p>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Ajout…" : "Ajouter un besoin"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function CreateOrderForm({
  prospectId,
  suppliers,
}: {
  prospectId: string;
  suppliers: PvSupplier[];
}) {
  const [state, formAction, pending] = useActionState(
    createPvPurchaseOrderAction,
    PV_INITIAL_STATE,
  );
  if (suppliers.length === 0) {
    return (
      <p className="photo-note">
        Aucun fournisseur actif. Créez-en un avant de préparer une commande.
      </p>
    );
  }
  return (
    <form action={formAction} className="agent-action-form pv-material-form">
      <input type="hidden" name="prospect_id" value={prospectId} />
      <label className="agent-field">
        <span>Fournisseur</span>
        <select name="supplier_id" defaultValue={suppliers[0].id}>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.leadTimeDays === null ? "" : ` — ${s.leadTimeDays} j indicatifs`}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Livraison attendue</span>
        <input type="date" name="expected_delivery_on" />
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Création…" : "Préparer une commande"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function DeriveForm({ prospectId }: { prospectId: string }) {
  const [state, formAction, pending] = useActionState(
    derivePvMaterialRequirementsAction,
    PV_INITIAL_STATE,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="prospect_id" value={prospectId} />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Analyse…" : "Déduire les besoins du devis et de la visite"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * BLOC « MATÉRIEL » de la vue Affaire.
 *
 * Il répond à la question que PV-7 ouvre : de quoi ai-je besoin, qu'ai-je
 * commandé, qu'ai-je reçu — et surtout, où est l'écart. Les trois grandeurs sont
 * montrées SÉPARÉMENT : les fondre reviendrait à cacher le manque.
 */
export default function PvMaterialPanel({
  prospectId,
  plan,
  materials,
  suppliers,
}: {
  prospectId: string;
  plan: PvMaterialPlan | null;
  materials: PvMaterial[];
  suppliers: PvSupplier[];
}) {
  if (plan === null) {
    return (
      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">MATÉRIEL</span>
            <h2>Approvisionnement</h2>
          </div>
        </header>
        <p className="photo-note">Plan matériel indisponible pour cette affaire.</p>
      </section>
    );
  }

  const active = plan.requirements.filter((r) => r.status === "ACTIVE");
  const pending = active.filter((r) => r.needsConfirmation && r.confirmedAt === null);
  const costs = plan.costs;

  return (
    <>
      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">MATÉRIEL</span>
            <h2>Besoin, commandé, reçu</h2>
          </div>
          {/* TEXTUEL d'abord : le ton ne fait que redire le mot. */}
          <span className={`pv-badge is-${pvMaterialReadinessTone(plan.readiness)}`}>
            {PV_MATERIAL_READINESS_LABELS[plan.readiness] ?? plan.readiness}
          </span>
        </header>

        {pending.length > 0 ? (
          <div className="pv-warning" role="note">
            <strong>{pending.length} besoin(s) attendent votre confirmation.</strong> Ils
            proviennent de texte libre — une ligne de devis ou un constat de visite — et
            Hermès n’a pas deviné ce qu’ils représentent. Tant qu’ils ne sont pas
            confirmés, cette affaire ne peut pas être déclarée prête.
          </div>
        ) : null}

        {plan.balance.length === 0 ? (
          <p className="photo-note">
            Aucun besoin enregistré. Déduisez-les du devis accepté et de la visite validée,
            ou saisissez-les à la main.
          </p>
        ) : (
          <table className="pv-material-table">
            <thead>
              <tr>
                <th scope="col">Élément</th>
                <th scope="col">Besoin</th>
                <th scope="col">Commandé</th>
                <th scope="col">Reçu</th>
                <th scope="col">Écart</th>
                <th scope="col">Statut</th>
                <th scope="col">Origine</th>
              </tr>
            </thead>
            <tbody>
              {plan.balance.map((b, i) => (
                <tr key={`${b.materialId ?? "libre"}-${b.designation ?? i}`}>
                  <th scope="row">
                    {b.designation ?? "—"}
                    {b.isMandatory ? null : <span className="photo-note"> (facultatif)</span>}
                    {b.needsConfirmation ? (
                      <span className="photo-note"> — à confirmer</span>
                    ) : null}
                  </th>
                  <td>{pvQty(b.qtyRequired, b.unit)}</td>
                  <td>{pvQty(b.qtyOrdered, b.unit)}</td>
                  <td>{pvQty(b.qtyReceived, b.unit)}</td>
                  <td>{b.gap === 0 ? "—" : pvQty(b.gap, b.unit)}</td>
                  <td className={`pv-material-status is-${pvGapTone(b.status)}`}>
                    {PV_MATERIAL_GAP_LABELS[b.status] ?? b.status}
                  </td>
                  <td className="photo-note">
                    {b.origins.map((o) => PV_REQUIREMENT_ORIGIN_LABELS[o] ?? o).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <DeriveForm prospectId={prospectId} />
      </section>

      {pending.length > 0 ? (
        <section className="dashboard-card pv-card">
          <header className="panel-head">
            <div>
              <span className="panel-eyebrow">À CONFIRMER</span>
              <h2>Ce que Hermès n’a pas deviné</h2>
            </div>
          </header>
          <ul className="pv-material-pending">
            {pending.map((r) => (
              <li key={r.id}>
                <p className="pv-material-pending-head">
                  <strong>{r.designation ?? "—"}</strong>{" "}
                  <span className="pv-badge">
                    {PV_REQUIREMENT_ORIGIN_LABELS[r.origin] ?? r.origin}
                  </span>{" "}
                  <span className="photo-note">{pvQty(r.quantityRequired, r.unit)}</span>
                </p>
                {r.comment !== null ? <p className="photo-note">{r.comment}</p> : null}
                <ConfirmRequirementForm
                  requirement={r}
                  prospectId={prospectId}
                  materials={materials}
                />
                <DismissRequirementForm requirementId={r.id} prospectId={prospectId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">COMMANDES FOURNISSEURS</span>
            <h2>
              {plan.orders.length === 0 ? "Aucune commande" : `${plan.orders.length} commande(s)`}
            </h2>
          </div>
        </header>

        <p className="photo-note">
          Hermès <strong>n’envoie rien</strong> au fournisseur : « Commandée » enregistre
          que vous déclarez l’avoir passée. Aucun e-mail, aucune interface fournisseur.
        </p>

        {plan.orders.length > 0 ? (
          <ul className="pv-order-list">
            {plan.orders.map((o) => (
              <li key={o.id} className="pv-order-row">
                <Link href={`/etudes/commandes/${o.id}`} className="pv-order-ref">
                  {o.orderNumber}
                </Link>
                <span className={`pv-badge is-${pvOrderTone(o.status)}`}>
                  {PV_PURCHASE_ORDER_STATUS_LABELS[o.status] ?? o.status}
                </span>
                <span className="photo-note">{o.supplierName}</span>
                <span className="pv-order-total">{pvMoney(o.subtotalHtEur)} HT</span>
                <span className="photo-note">
                  {o.orderedOn === null
                    ? `${o.lineCount} ligne(s)`
                    : `passée le ${o.orderedOn}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <CreateOrderForm prospectId={prospectId} suppliers={suppliers} />
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">COÛTS</span>
            <h2>Matériel prévu, commandé, reçu</h2>
          </div>
        </header>
        <dl className="pv-facts">
          <div>
            <dt>Coût matériel prévu</dt>
            <dd>{pvMoney(costs.plannedCostHtEur)} HT</dd>
          </div>
          <div>
            <dt>Coût commandé</dt>
            <dd>{pvMoney(costs.orderedCostHtEur)} HT</dd>
          </div>
          <div>
            <dt>Coût reçu</dt>
            <dd>{pvMoney(costs.receivedCostHtEur)} HT</dd>
          </div>
          <div>
            <dt>Devis client accepté</dt>
            <dd>
              {costs.quoteTotalHtEur === null ? "—" : `${pvMoney(costs.quoteTotalHtEur)} HT`}
            </dd>
          </div>
        </dl>

        {/* On n'affiche un montant de marge QUE s'il est fiable. Sinon on dit ce
            qui manque : un chiffre affiché est lu, une nuance ne l'est pas. */}
        {costs.marginReliable && costs.indicativeMaterialMarginHtEur !== null ? (
          <p className="pv-material-margin">
            <strong>{pvMoney(costs.indicativeMaterialMarginHtEur)} HT</strong> —{" "}
            {pvMarginSentence(costs)}
          </p>
        ) : (
          <p className="photo-note">{pvMarginSentence(costs)}</p>
        )}

        <p className="photo-note">
          Le <strong>prix de vente</strong> du devis et le <strong>coût d’achat</strong>{" "}
          fournisseur sont deux données distinctes : aucune ne remplace l’autre.
        </p>
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">BESOIN</span>
            <h2>Ajouter à la main</h2>
          </div>
        </header>
        <AddRequirementForm prospectId={prospectId} materials={materials} />
      </section>
    </>
  );
}
