"use client";

import { useActionState } from "react";

import {
  acceptPvQuoteAction,
  cancelPvQuoteAction,
  deletePvQuoteLineAction,
  generatePvQuotePdfAction,
  PV_INITIAL_STATE,
  refusePvQuoteAction,
  revisePvQuoteAction,
  sendPvQuoteAction,
  setPvQuoteReadyAction,
  updatePvQuoteAction,
  upsertPvQuoteLineAction,
} from "@/app/actions/pv";
import {
  pvMoney,
  pvQuoteTone,
  PV_QUOTE_BLOCKER_LABELS,
  PV_QUOTE_CATEGORY_LABELS,
  PV_QUOTE_STATUS_LABELS,
} from "@/lib/pv/quoteLabels";
import { PV_QUOTE_LINE_CATEGORIES, type PvQuoteDetail } from "@/types/pv";

/** Nom du client, ou `null`. Jamais « Client inconnu » : une absence se dit. */
function clientName(detail: PvQuoteDetail): string | null {
  const company = detail.prospect?.companyName?.trim() ?? "";
  if (company.length > 0) return company;
  const parts = [detail.prospect?.firstName, detail.prospect?.lastName]
    .map((p) => p?.trim() ?? "")
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Message de retour d'une action, rendu tel quel — un refus reste un refus. */
function Feedback({ state }: { state: { phase: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}

function LineForm({ quoteId, locked }: { quoteId: string; locked: boolean }) {
  const [state, formAction, pending] = useActionState(upsertPvQuoteLineAction, PV_INITIAL_STATE);
  if (locked) return null;
  return (
    <form action={formAction} className="agent-action-form pv-line-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <label className="agent-field">
        <span>Catégorie</span>
        <select name="category" defaultValue="PANNEAUX">
          {PV_QUOTE_LINE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PV_QUOTE_CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-field">
        <span>Désignation</span>
        <input type="text" name="designation" required maxLength={300} />
      </label>
      <label className="agent-field">
        <span>Description (optionnelle)</span>
        <input type="text" name="description" />
      </label>
      <label className="agent-field">
        <span>Quantité</span>
        <input type="number" name="quantity" step="0.001" min="0.001" defaultValue="1" required />
      </label>
      <label className="agent-field">
        <span>Unité</span>
        <input type="text" name="unit" defaultValue="U" maxLength={16} />
      </label>
      <label className="agent-field">
        <span>Prix unitaire HT (€)</span>
        <input type="number" name="unit_price_ht_eur" step="0.01" min="0" defaultValue="0" required />
      </label>
      <label className="agent-field">
        <span>TVA (%)</span>
        <input type="number" name="vat_rate_pct" step="0.01" min="0" max="100" defaultValue="20" />
      </label>
      <label className="agent-field">
        <span>Remise ligne (%)</span>
        <input type="number" name="discount_pct" step="0.01" min="0" max="100" defaultValue="0" />
      </label>
      {/* AUCUN champ « total » : il est calculé en base et ne peut pas être envoyé. */}
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Ajout…" : "Ajouter la ligne"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function DeleteLineButton({ quoteId, lineId }: { quoteId: string; lineId: string }) {
  const [state, formAction, pending] = useActionState(deletePvQuoteLineAction, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="pv-line-delete">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="line_id" value={lineId} />
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "…" : "Retirer"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function HeaderForm({ detail, locked }: { detail: PvQuoteDetail; locked: boolean }) {
  const [state, formAction, pending] = useActionState(updatePvQuoteAction, PV_INITIAL_STATE);
  if (locked) return null;
  const q = detail.quote;
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="quote_id" value={q.id} />
      <label className="agent-field">
        <span>Remise globale (%)</span>
        <input
          type="number"
          name="discount_pct"
          step="0.01"
          min="0"
          max="100"
          defaultValue={String(q.discountPct)}
        />
      </label>
      <label className="agent-field">
        <span>Valable jusqu’au</span>
        <input type="date" name="valid_until" defaultValue={q.validUntil ?? ""} />
      </label>
      <label className="agent-field">
        <span>Observations</span>
        <input type="text" name="observations" defaultValue={q.observations ?? ""} />
      </label>
      <label className="agent-field">
        <span>Conditions</span>
        <input type="text" name="terms" defaultValue={q.terms ?? ""} />
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer l’en-tête"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function SimpleAction({
  action,
  quoteId,
  label,
  busyLabel,
  children,
}: {
  action: typeof setPvQuoteReadyAction;
  quoteId: string;
  label: string;
  busyLabel: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      {children}
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? busyLabel : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function AcceptForm({ quoteId }: { quoteId: string }) {
  const [state, formAction, pending] = useActionState(acceptPvQuoteAction, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="agent-action-form pv-danger-zone">
      <input type="hidden" name="quote_id" value={quoteId} />
      <p className="pv-warning" role="note">
        Enregistrer une acceptation engage l’entreprise.
        <strong> Un devis accepté ne peut plus être révisé.</strong>
      </p>
      <label className="agent-field">
        <span>Date d’acceptation</span>
        <input type="date" name="accepted_on" />
      </label>
      <label className="agent-field">
        <span>Référence / preuve (bon de commande, courriel…)</span>
        <input type="text" name="reference" maxLength={200} />
      </label>
      <label className="agent-field pv-checkbox">
        <input type="checkbox" name="confirm" value="ACCEPTER" required />
        <span>
          Je confirme avoir reçu l’accord écrit du client pour ce devis.
          Hermès ne recueille <strong>aucune signature électronique</strong>.
        </span>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer l’acceptation"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function PdfForm({ quoteId, canFinal }: { quoteId: string; canFinal: boolean }) {
  const [state, formAction, pending] = useActionState(generatePvQuotePdfAction, PV_INITIAL_STATE);
  return (
    <form action={formAction} className="agent-action-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <label className="agent-field">
        <span>Type de document</span>
        <select name="stage" defaultValue="DRAFT">
          <option value="DRAFT">Brouillon interne (filigrané)</option>
          <option value="FINAL" disabled={!canFinal}>
            Devis à transmettre{canFinal ? "" : " — indisponible"}
          </option>
        </select>
      </label>
      <button type="submit" className="card-secondary-button" disabled={pending}>
        {pending ? "Génération…" : "Générer le PDF"}
      </button>
      {!canFinal ? (
        <p className="photo-note">
          Le devis à transmettre reste indisponible tant que des blocages subsistent.
          Le serveur le revérifie : contourner cet écran ne produit pas un document définitif.
        </p>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}

/**
 * ÉDITEUR DE DEVIS.
 *
 * Deux propriétés portent tout l'écran :
 *   1. AUCUN total n'est saisissable. Les colonnes de totaux sont des lectures ;
 *      la base les recalcule à chaque mouvement de ligne.
 *   2. Un devis TRANSMIS n'est plus modifiable — les formulaires disparaissent
 *      et la seule voie est « Créer une nouvelle version ». Ce n'est pas une
 *      politesse d'interface : la base refuse aussi.
 */
export default function PvQuoteEditor({ detail }: { detail: PvQuoteDetail }) {
  const q = detail.quote;
  const locked = q.status !== "DRAFT" && q.status !== "READY";
  const cur = q.currency;
  const canFinal = detail.blockers.length === 0 && q.status !== "DRAFT";

  return (
    <>
      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">DEVIS</span>
            <h2>
              {q.quoteNumber} <span className="pv-quote-version">version {q.version}</span>
            </h2>
          </div>
          <span className={`pv-badge is-${pvQuoteTone(q.status)}`}>
            {PV_QUOTE_STATUS_LABELS[q.status] ?? q.status}
            {detail.isExpired ? " · échu" : ""}
          </span>
        </header>

        <dl className="pv-facts">
          <div>
            <dt>Client</dt>
            <dd>{clientName(detail) ?? "—"}</dd>
          </div>
          <div>
            <dt>Site</dt>
            <dd>{detail.site?.addressLine1 ?? "—"}</dd>
          </div>
          <div>
            <dt>Étude de référence</dt>
            <dd>
              {detail.study === null
                ? "—"
                : `version ${detail.study.version} (${detail.study.status})`}
            </dd>
          </div>
          <div>
            <dt>Émis le</dt>
            <dd>{q.issuedOn ?? "—"}</dd>
          </div>
          <div>
            <dt>Valable jusqu’au</dt>
            <dd>{q.validUntil ?? "—"}</dd>
          </div>
          {q.supersedesQuoteId !== null ? (
            <div>
              <dt>Révision de</dt>
              <dd>une version précédente du même devis</dd>
            </div>
          ) : null}
        </dl>

        {detail.blockers.length > 0 ? (
          <>
            <p className="panel-eyebrow">CE QUI MANQUE</p>
            <ul className="pv-blockers">
              {detail.blockers.map((b) => (
                <li key={b}>{PV_QUOTE_BLOCKER_LABELS[b] ?? b}</li>
              ))}
            </ul>
          </>
        ) : null}

        {locked ? (
          <p className="photo-note">
            Ce devis a été transmis : son contenu commercial est <strong>figé</strong>.
            Pour le modifier, créez une nouvelle version — la version transmise reste
            intacte et auditable.
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">LIGNES</span>
            <h2>Détail de la prestation</h2>
          </div>
        </header>

        {detail.lines.length === 0 ? (
          <p className="photo-note">Aucune ligne. Un devis sans ligne ne peut pas être préparé.</p>
        ) : (
          <table className="pv-quote-table">
            <thead>
              <tr>
                <th scope="col">Désignation</th>
                <th scope="col">Qté</th>
                <th scope="col">P.U. HT</th>
                <th scope="col">TVA</th>
                <th scope="col">Total HT</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.designation}</strong>
                    <span className="photo-note">
                      {PV_QUOTE_CATEGORY_LABELS[l.category] ?? l.category}
                      {l.description === null ? "" : ` — ${l.description}`}
                      {l.discountPct > 0 ? ` — remise ${l.discountPct} %` : ""}
                    </span>
                  </td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td>{pvMoney(l.unitPriceHtEur, cur)}</td>
                  <td>{l.vatRatePct} %</td>
                  {/* Lecture seule : cette valeur vient d'une colonne générée. */}
                  <td>{pvMoney(l.lineTotalHtEur, cur)}</td>
                  <td>{locked ? null : <DeleteLineButton quoteId={q.id} lineId={l.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <dl className="pv-quote-totals">
          <div>
            <dt>Sous-total HT</dt>
            <dd>{pvMoney(q.subtotalHtEur, cur)}</dd>
          </div>
          {q.discountPct > 0 ? (
            <div>
              <dt>Remise {q.discountPct} %</dt>
              <dd>- {pvMoney(q.discountAmountEur, cur)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Total HT</dt>
            <dd>{pvMoney(q.totalHtEur, cur)}</dd>
          </div>
          <div>
            <dt>Total TVA</dt>
            <dd>{pvMoney(q.totalVatEur, cur)}</dd>
          </div>
          <div className="pv-quote-grand">
            <dt>Total TTC</dt>
            <dd>{pvMoney(q.totalTtcEur, cur)}</dd>
          </div>
        </dl>

        <LineForm quoteId={q.id} locked={locked} />
        <HeaderForm detail={detail} locked={locked} />
      </section>

      <section className="dashboard-card pv-card">
        <header className="panel-head">
          <div>
            <span className="panel-eyebrow">CYCLE COMMERCIAL</span>
            <h2>Actions</h2>
          </div>
        </header>

        <PdfForm quoteId={q.id} canFinal={canFinal} />

        {q.status === "DRAFT" ? (
          <SimpleAction
            action={setPvQuoteReadyAction}
            quoteId={q.id}
            label="Marquer prêt à transmettre"
            busyLabel="Vérification…"
          />
        ) : null}

        {q.status === "READY" ? (
          <SimpleAction
            action={sendPvQuoteAction}
            quoteId={q.id}
            label="Marquer comme transmis"
            busyLabel="Enregistrement…"
          >
            <p className="photo-note">
              Hermès <strong>n’envoie aucun courriel</strong>. Ce bouton enregistre
              seulement que vous avez transmis le devis.
            </p>
            <label className="agent-field">
              <span>Date d’émission</span>
              <input type="date" name="issued_on" />
            </label>
          </SimpleAction>
        ) : null}

        {q.status === "SENT" ? (
          <>
            <AcceptForm quoteId={q.id} />
            <SimpleAction
              action={refusePvQuoteAction}
              quoteId={q.id}
              label="Enregistrer un refus"
              busyLabel="Enregistrement…"
            >
              <label className="agent-field">
                <span>Motif du refus (optionnel)</span>
                <input type="text" name="reason" />
              </label>
            </SimpleAction>
          </>
        ) : null}

        {q.status !== "ACCEPTED" && q.status !== "SUPERSEDED" ? (
          <SimpleAction
            action={revisePvQuoteAction}
            quoteId={q.id}
            label="Créer une nouvelle version"
            busyLabel="Création…"
          />
        ) : null}

        {q.status === "DRAFT" || q.status === "READY" || q.status === "SENT" ? (
          <SimpleAction
            action={cancelPvQuoteAction}
            quoteId={q.id}
            label="Annuler ce devis"
            busyLabel="Annulation…"
          />
        ) : null}

        {q.status === "ACCEPTED" ? (
          <p className="photo-note">
            Acceptation enregistrée le {q.acceptedOn ?? "—"}
            {q.acceptanceReference === null ? "" : ` — référence : ${q.acceptanceReference}`}.
            Ce devis est définitif.
          </p>
        ) : null}
      </section>
    </>
  );
}
