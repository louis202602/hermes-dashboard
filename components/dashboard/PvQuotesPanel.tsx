"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  createPvQuoteAction,
  expirePvQuotesAction,
  PV_INITIAL_STATE,
} from "@/app/actions/pv";
import {
  pvMoney,
  pvQuoteTone,
  PV_QUOTE_STATUS_LABELS,
} from "@/lib/pv/quoteLabels";
import type { PvQuoteSummary } from "@/types/pv";

/**
 * BLOC « DEVIS » de la vue Affaire.
 *
 * Il ne décide rien : il montre ce qui existe et propose UN geste — créer un
 * devis. La base refuse la création si le dossier n'est pas prêt, avec ses
 * raisons ; l'écran les affiche telles quelles plutôt que de griser un bouton
 * sans expliquer pourquoi.
 */
export default function PvQuotesPanel({
  prospectId,
  quotes,
  canQuote,
}: {
  prospectId: string;
  quotes: PvQuoteSummary[];
  /** Dossier `READY_FOR_OFFER` d'après le moteur d'état — indication, pas garde. */
  canQuote: boolean;
}) {
  const [state, formAction, pending] = useActionState(createPvQuoteAction, PV_INITIAL_STATE);
  const [expiry, expiryAction, expiring] = useActionState(expirePvQuotesAction, PV_INITIAL_STATE);
  const hasExpirable = quotes.some((q) => q.isExpired);

  return (
    <section className="dashboard-card pv-card">
      <header className="panel-head">
        <div>
          <span className="panel-eyebrow">DEVIS</span>
          <h2>Propositions commerciales</h2>
        </div>
        <form action={formAction}>
          <input type="hidden" name="prospect_id" value={prospectId} />
          <button type="submit" className="card-secondary-button" disabled={pending}>
            {pending ? "Création…" : "Créer un devis"}
          </button>
        </form>
      </header>

      {!canQuote ? (
        <p className="photo-note">
          Ce dossier n’est pas encore prêt pour une offre. La création restera refusée
          tant que l’étude n’est pas <strong>validée</strong> et le chiffrage{" "}
          <strong>vérifié</strong> — le serveur le revérifie de son côté.
        </p>
      ) : null}

      {state.message ? (
        <p
          className="photo-session-meta"
          role={state.phase === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}

      {hasExpirable ? (
        <form action={expiryAction} className="agent-action-form">
          <p className="photo-note">
            Un ou plusieurs devis ont dépassé leur date de validité. Hermès{" "}
            <strong>ne planifie rien</strong> : la péremption s’applique quand vous la
            demandez. L’échéance est déjà signalée ci-dessous sans cette action.
          </p>
          <label className="agent-field pv-checkbox">
            <input type="checkbox" name="confirm" value="EXPIRER" required />
            <span>Je confirme le passage en « périmé » des devis échus.</span>
          </label>
          <button type="submit" className="card-secondary-button" disabled={expiring}>
            {expiring ? "Application…" : "Appliquer la péremption"}
          </button>
          {expiry.message ? (
            <p
              className="photo-session-meta"
              role={expiry.phase === "error" ? "alert" : "status"}
            >
              {expiry.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {quotes.length === 0 ? (
        <p className="photo-note">Aucun devis pour cette affaire.</p>
      ) : (
        <ul className="pv-quote-list">
          {quotes.map((q) => (
            <li key={q.id} className="pv-quote-row">
              <Link href={`/etudes/devis/${q.id}`} className="pv-quote-ref">
                {q.quoteNumber} <span className="pv-quote-version">v{q.version}</span>
              </Link>
              <span className={`pv-badge is-${pvQuoteTone(q.status)}`}>
                {PV_QUOTE_STATUS_LABELS[q.status] ?? q.status}
                {q.isExpired && q.status === "SENT" ? " · échu" : ""}
              </span>
              <span className="pv-quote-total">{pvMoney(q.totalTtcEur, q.currency)} TTC</span>
              <span className="photo-note">
                {q.validUntil === null ? "sans date de validité" : `valable jusqu’au ${q.validUntil}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
