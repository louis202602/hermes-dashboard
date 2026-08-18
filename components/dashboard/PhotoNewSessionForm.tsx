"use client";

import { useActionState } from "react";

import { createPhotoSessionAction, type PhotoActionState } from "@/app/actions/photo";
import { PHOTO_SESSION_TYPES } from "@/types/photo";

const INITIAL: PhotoActionState = { phase: "idle" };

const TYPE_LABEL: Record<string, string> = {
  MARIAGE: "Mariage",
  FAMILLE: "Famille",
  GROSSESSE: "Grossesse",
  NAISSANCE: "Naissance",
  PORTRAIT: "Portrait",
  EVENEMENT: "Événement",
  ENTREPRISE: "Entreprise",
  AUTRE: "Autre",
};

/**
 * PHOTO-P0 — Création d'une séance.
 *
 * Le client est réutilisé s'il existe déjà (clé naturelle côté base), créé sinon :
 * la photographe n'a pas à gérer un référentiel client avant de créer une séance.
 * L'écriture est idempotente sur (client, type, date), donc un double envoi ne
 * crée jamais deux séances.
 */
export default function PhotoNewSessionForm() {
  const [state, formAction, pending] = useActionState(createPhotoSessionAction, INITIAL);

  return (
    <section className="dashboard-card photo-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HERMÈS STUDIO</span>
          <h3>Nouvelle séance</h3>
        </div>
      </div>

      <form action={formAction} className="agent-action-form">
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Client</span>
            <input type="text" name="client_name" required maxLength={200} placeholder="Famille Dupont" />
          </label>
          <label className="agent-field">
            <span>Type</span>
            <select name="session_type" defaultValue="FAMILLE">
              {PHOTO_SESSION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type] ?? type}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Date</span>
            <input type="datetime-local" name="scheduled_at" />
          </label>
          <label className="agent-field">
            <span>Lieu</span>
            <input type="text" name="location" maxLength={300} placeholder="Parc de la Tête d’Or" />
          </label>
        </div>
        <label className="agent-field">
          <span>Intitulé (facultatif)</span>
          <input type="text" name="title" maxLength={200} />
        </label>

        <button type="submit" className="card-secondary-button" disabled={pending}>
          {pending ? "Création…" : "Créer la séance"}
        </button>
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Séance enregistrée.
        </p>
      ) : null}
    </section>
  );
}
