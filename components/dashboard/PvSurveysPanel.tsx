"use client";

import Link from "next/link";
import { useActionState } from "react";

import { planPvSiteSurveyAction, PV_INITIAL_STATE } from "@/app/actions/pv";
import {
  PV_SURVEY_STATUS_LABELS,
  pvSurveyStatusTone,
} from "@/lib/pv/surveyLabels";
import type { PvSurveyGate } from "@/lib/pv/readiness";
import type { PvSiteSurveySummary } from "@/types/pv";

/**
 * BLOC « VISITE TECHNIQUE » de la vue Affaire.
 *
 * Il répond à une seule question, celle qui manquait jusqu'ici : le terrain
 * confirme-t-il, ou non, les données déclarées de toiture sur lesquelles
 * reposent l'étude et le devis ? Trois réponses possibles, et « on ne sait pas »
 * en est une — elle est écrite, pas déduite d'une absence de voyant rouge.
 */
const GATE_NOTICE: Record<PvSurveyGate, string> = {
  NONE:
    "Aucune visite technique n’a été réalisée sur ce site. Les données de toiture restent DÉCLARATIVES : rien ne les confirme ni ne les infirme.",
  NOT_VALIDATED:
    "Une visite existe mais n’est pas validée. Le constat de terrain n’a donc pas encore valeur de preuve.",
  BLOCKING:
    "La visite technique a constaté un BLOCAGE sur site. La pose est impossible en l’état tant que le blocage n’est pas levé.",
  OK: "Une visite validée confirme les données de terrain de ce site.",
};

export default function PvSurveysPanel({
  prospectId,
  surveys,
  gate,
}: {
  prospectId: string;
  surveys: PvSiteSurveySummary[];
  /** Miroir de `hermes_os.pv_survey_gate` — indication d'écran, jamais la garde. */
  gate: PvSurveyGate;
}) {
  const [state, formAction, pending] = useActionState(planPvSiteSurveyAction, PV_INITIAL_STATE);

  return (
    <section className="dashboard-card pv-card">
      <header className="panel-head">
        <div>
          <span className="panel-eyebrow">VISITE TECHNIQUE</span>
          <h2>Ce que le terrain confirme</h2>
        </div>
        <form action={formAction} className="pv-survey-plan">
          <input type="hidden" name="prospect_id" value={prospectId} />
          <label className="agent-field">
            <span>Date prévue</span>
            <input type="date" name="scheduled_on" />
          </label>
          <button type="submit" className="card-secondary-button" disabled={pending}>
            {pending ? "Planification…" : "Planifier une visite"}
          </button>
        </form>
      </header>

      {/* TEXTUEL d'abord. Le ton vient en complément, jamais à la place. */}
      <p className={`pv-survey-gate is-${pvSurveyStatusTone(gate === "OK" ? "VALIDATED" : gate === "BLOCKING" ? "BLOCKING" : "PLANNED")}`}>
        {GATE_NOTICE[gate]}
      </p>

      {state.message ? (
        <p className="photo-session-meta" role={state.phase === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}

      {surveys.length === 0 ? (
        <p className="photo-note">
          Aucune visite enregistrée. Les dossiers déjà engagés ne sont pas cassés pour
          autant : tant qu’aucune visite n’existe, l’absence est <strong>signalée</strong>{" "}
          sans bloquer les devis déjà transmis ou acceptés.
        </p>
      ) : (
        <ul className="pv-survey-list">
          {surveys.map((s) => (
            <li key={s.id} className="pv-survey-row">
              <Link href={`/etudes/visites/${s.id}`} className="pv-survey-ref">
                Visite du {s.scheduledOn ?? s.createdAt.slice(0, 10)}
              </Link>
              <span className={`pv-badge is-${pvSurveyStatusTone(s.status)}`}>
                {PV_SURVEY_STATUS_LABELS[s.status] ?? s.status}
              </span>
              <span className="photo-note">
                {s.findingsTotal === 0
                  ? "aucun écart constaté"
                  : `${s.findingsTotal} écart(s)${s.findingsBlocking > 0 ? ` dont ${s.findingsBlocking} bloquant(s)` : ""}`}
              </span>
              <span className="photo-note">
                {s.validatedAt !== null
                  ? `validée le ${s.validatedAt.slice(0, 10)}`
                  : s.completedAt !== null
                    ? `terminée le ${s.completedAt.slice(0, 10)}`
                    : "non terminée"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
