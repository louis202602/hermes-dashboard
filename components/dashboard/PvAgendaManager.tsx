"use client";

import { useActionState } from "react";

import {
  AGENDA_INITIAL_STATE,
  cancelPvAgendaEventAction,
  createPvAgendaEventAction,
} from "@/app/actions/agenda";
import AgendaPanel from "@/components/dashboard/AgendaPanel";
import type { DashboardAgenda } from "@/lib/dashboard/agenda";
import type { ServiceResult } from "@/types/hermes";

export default function PvAgendaManager({
  agenda,
  locale,
}: {
  agenda: ServiceResult<DashboardAgenda>;
  locale: string;
}) {
  const [state, action, pending] = useActionState(createPvAgendaEventAction, AGENDA_INITIAL_STATE);
  const manual = agenda.ok
    ? agenda.data.events.filter((event) => event.source === "PV_EVENT" && event.status === "SCHEDULED")
    : [];

  return (
    <div className="page-stack">
      <AgendaPanel agenda={agenda} locale={locale} />

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">RENDEZ-VOUS</span>
            <h3>Ajouter un événement réel</h3>
          </div>
        </div>
        <p className="photo-note">
          Les rendez-vous saisis ici sont enregistrés dans la base Hermès. Les échéances de devis,
          d’acomptes et les dates de chantier sont ajoutées automatiquement par le système.
        </p>
        <form action={action} className="agent-action-form">
          <label className="agent-field">
            <span>Titre</span>
            <input name="title" required maxLength={180} placeholder="Rendez-vous client" />
          </label>
          <div className="agent-form-grid">
            <label className="agent-field">
              <span>Date</span>
              <input name="date" type="date" required />
            </label>
            <label className="agent-field">
              <span>Début</span>
              <input name="start_time" type="time" required />
            </label>
            <label className="agent-field">
              <span>Fin</span>
              <input name="end_time" type="time" />
            </label>
          </div>
          <label className="agent-field">
            <span>Notes</span>
            <textarea name="notes" rows={3} placeholder="Adresse, interlocuteur, objectif…" />
          </label>
          <button className="card-secondary-button" type="submit" disabled={pending}>
            {pending ? "Ajout…" : "Ajouter à l’agenda"}
          </button>
          {state.message ? (
            <p role={state.phase === "error" ? "alert" : "status"} className="photo-session-meta">
              {state.message}
            </p>
          ) : null}
        </form>
      </section>

      {manual.length > 0 ? (
        <section className="dashboard-card pv-card">
          <div className="dashboard-card-header">
            <div>
              <span className="panel-eyebrow">GESTION</span>
              <h3>Rendez-vous Hermès planifiés</h3>
            </div>
          </div>
          <div className="agenda-list">
            {manual.map((event) => (
              <div className="agenda-item" key={event.id}>
                <span className="agenda-copy">
                  <strong>{event.title}</strong>
                  <span>{event.subtitle ?? event.eventDate ?? "Événement planifié"}</span>
                </span>
                <form action={cancelPvAgendaEventAction}>
                  <input type="hidden" name="event_id" value={event.sourceId} />
                  <button className="card-secondary-button" type="submit">Annuler</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
