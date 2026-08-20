"use client";

import { useActionState } from "react";

import { generatePvStudySummaryAction, PV_INITIAL_STATE } from "@/app/actions/pv";
import type { PvReadiness } from "@/lib/pv/readiness";

/**
 * PV-4 — génération de la synthèse d'étude PDF.
 *
 * Deux boutons, deux gestes clairement distincts :
 *   * BROUILLON — toujours disponible, pour un usage interne. Le document porte
 *     un bandeau « NE PAS TRANSMETTRE AU CLIENT » impossible à manquer.
 *   * DÉFINITIVE — proposée seulement quand le dossier l'autorise. Si l'écran se
 *     trompait, le serveur refuserait (`PDF_FINAL_NOT_READY`) et la base
 *     revérifierait encore : trois gardes sur la seule chose qu'on ne veut pas
 *     rater.
 *
 * `request_id` porte l'idempotence : une même demande rejouée renvoie le
 * document déjà produit au lieu d'en créer un second.
 */
export default function PvStudySummaryForm({
  prospectId,
  readiness,
  requestId,
  company,
}: {
  prospectId: string;
  readiness: PvReadiness;
  requestId: string;
  company: string;
}) {
  const [state, formAction, pending] = useActionState(
    generatePvStudySummaryAction,
    PV_INITIAL_STATE,
  );

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">AFFAIRE</span>
          <h3>Synthèse d’étude</h3>
        </div>
      </div>

      <p className="photo-note">
        Document <strong>non contractuel</strong> : ce n’est ni un devis, ni un contrat, ni
        une garantie de rendement. Il est déposé dans le stockage privé et n’est lisible que
        par une URL signée à durée courte.
      </p>

      <form action={formAction} className="pv-inline-form">
        <input type="hidden" name="prospect_id" value={prospectId} />
        <input type="hidden" name="company" value={company} />
        <input type="hidden" name="request_id" value={`${requestId}-draft`} />
        <button type="submit" name="stage" value="DRAFT" className="card-secondary-button" disabled={pending}>
          {pending ? "Génération…" : "Générer un brouillon"}
        </button>
      </form>

      {readiness.canGenerateFinalPdf ? (
        <form action={formAction} className="pv-inline-form">
          <input type="hidden" name="prospect_id" value={prospectId} />
          <input type="hidden" name="company" value={company} />
          <input type="hidden" name="request_id" value={`${requestId}-final`} />
          <button type="submit" name="stage" value="FINAL" className="card-secondary-button" disabled={pending}>
            {pending ? "Génération…" : "Générer la synthèse définitive"}
          </button>
        </form>
      ) : (
        <p className="photo-note">
          La synthèse définitive n’est pas proposée : le dossier n’est pas prêt. Il faut une
          étude <strong>validée</strong> et un chiffrage <strong>vérifié</strong> par un
          humain.
        </p>
      )}

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
