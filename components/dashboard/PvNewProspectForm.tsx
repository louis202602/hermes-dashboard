"use client";

import { useActionState } from "react";

import { createPvProspectAction, PV_INITIAL_STATE } from "@/app/actions/pv";
import { PV_PROSPECT_TYPE_LABELS } from "@/lib/pv/status";

/**
 * PV-2 — création d'un prospect photovoltaïque.
 *
 * Le formulaire ne pré-remplit RIEN et n'invente RIEN. Il n'expose pas non plus
 * de champ `statut` : un prospect naît `NEW`, et n'avance que par la machine à
 * états (fiche prospect). Il n'expose évidemment aucun champ d'entreprise :
 * le tenant est décidé côté serveur, il n'a pas de représentation ici.
 */
export default function PvNewProspectForm() {
  const [state, formAction, pending] = useActionState(createPvProspectAction, PV_INITIAL_STATE);

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Nouveau prospect</h3>
        </div>
      </div>

      <form action={formAction} className="agent-action-form">
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Type</span>
            <select name="prospect_type" defaultValue="PARTICULIER">
              {Object.entries(PV_PROSPECT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-field">
            <span>Source</span>
            <select name="source" defaultValue="UNKNOWN">
              <option value="WEB">Web</option>
              <option value="PHONE">Téléphone</option>
              <option value="REFERRAL">Recommandation</option>
              <option value="PARTNER">Partenaire</option>
              <option value="FIELD">Terrain</option>
              <option value="EVENT">Événement</option>
              <option value="INBOUND_MAIL">Courrier entrant</option>
              <option value="CAMPAIGN">Campagne</option>
              <option value="UNKNOWN">Non renseignée</option>
            </select>
          </label>
        </div>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Prénom</span>
            <input type="text" name="first_name" maxLength={120} />
          </label>
          <label className="agent-field">
            <span>Nom (obligatoire pour un particulier)</span>
            <input type="text" name="last_name" maxLength={120} />
          </label>
        </div>

        <label className="agent-field">
          <span>Raison sociale (obligatoire hors particulier)</span>
          <input type="text" name="company_name" maxLength={200} />
        </label>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Téléphone</span>
            <input type="tel" name="phone" maxLength={40} />
          </label>
          <label className="agent-field">
            <span>E-mail</span>
            <input type="email" name="email" maxLength={320} />
          </label>
        </div>
        <p className="photo-note">
          Au moins un moyen de contact — téléphone ou e-mail — est exigé par la base.
        </p>

        <label className="agent-field pv-checkbox">
          <input type="checkbox" name="contact_consent" />
          <span>Consentement au contact recueilli</span>
        </label>
        <p className="photo-note">
          La date du consentement est posée par la base au moment où vous le cochez —
          elle n’est pas saisissable.
        </p>

        <label className="agent-field">
          <span>Notes</span>
          <textarea name="notes" rows={2} maxLength={2000} />
        </label>

        <button type="submit" className="card-secondary-button" disabled={pending}>
          {pending ? "Création…" : "Créer le prospect"}
        </button>
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Prospect enregistré.
        </p>
      ) : null}
    </section>
  );
}
