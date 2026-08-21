"use client";

import { useActionState, useState } from "react";

import { recordConsentAction, type PhotoActionState } from "@/app/actions/photo";
import {
  CONSENT_MEDIA_TYPES,
  CONSENT_USE_CASES,
  CONSENT_USE_CASE_LABEL,
  DEFAULT_IDENTITY_SCOPE,
  DEFAULT_LOCATION_SCOPE,
  IDENTITY_SCOPES,
  IDENTITY_SCOPE_LABEL,
  LOCATION_SCOPES,
  LOCATION_SCOPE_LABEL,
} from "@/lib/photo/consent";

const INITIAL: PhotoActionState = { phase: "idle" };

/**
 * PHOTO-P0 — Saisie du consentement média.
 *
 * Doctrine appliquée telle quelle (rapport §13) :
 *   * la portée d'identité par défaut est la plus restrictive (« aucune ») ;
 *   * cocher « des mineurs apparaissent » IMPOSE le consentement du représentant
 *     légal — le bouton reste inactif tant qu'il n'est pas coché, et la base le
 *     refuserait de toute façon (contrainte de table + façade).
 */
export default function PhotoConsentForm({
  clients,
}: {
  clients: { clientId: string; displayName: string }[];
}) {
  const [state, formAction, pending] = useActionState(recordConsentAction, INITIAL);
  const [includesMinors, setIncludesMinors] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);

  const blocked = includesMinors && !guardianConsent;

  return (
    <section className="dashboard-card photo-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HERMÈS STUDIO</span>
          <h3>Consentement média</h3>
        </div>
      </div>
      <p className="photo-note">
        Sans consentement enregistré, aucune publication ne sera possible plus tard : le
        contrôle est en base et ne peut pas être contourné.
      </p>

      <form action={formAction} className="agent-action-form">
        <label className="agent-field">
          <span>Client</span>
          <select name="client_id" required defaultValue={clients[0]?.clientId}>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="agent-field">
          <span>Usages autorisés</span>
          <div className="settings-chips">
            {CONSENT_USE_CASES.map((useCase) => (
              <label key={useCase} className="settings-chip">
                <input type="checkbox" name="use_case" value={useCase} />{" "}
                {CONSENT_USE_CASE_LABEL[useCase]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="agent-field">
          <span>Types de média</span>
          <div className="settings-chips">
            {CONSENT_MEDIA_TYPES.map((mediaType) => (
              <label key={mediaType} className="settings-chip">
                <input type="checkbox" name="media_type" value={mediaType} defaultChecked={mediaType === "PHOTO"} />{" "}
                {mediaType === "PHOTO" ? "Photo" : "Vidéo"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="agent-field-row">
          <label className="agent-field">
            <span>Portée d’identité</span>
            <select name="identity_scope" defaultValue={DEFAULT_IDENTITY_SCOPE}>
              {IDENTITY_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {IDENTITY_SCOPE_LABEL[scope]}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-field">
            <span>Portée de lieu</span>
            <select name="location_scope" defaultValue={DEFAULT_LOCATION_SCOPE}>
              {LOCATION_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {LOCATION_SCOPE_LABEL[scope]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="agent-field">
          <span>
            <input
              type="checkbox"
              name="includes_minors"
              checked={includesMinors}
              onChange={(e) => setIncludesMinors(e.target.checked)}
            />{" "}
            Des mineurs apparaissent sur ces images
          </span>
        </label>

        {includesMinors ? (
          <label className="agent-field">
            <span>
              <input
                type="checkbox"
                name="guardian_consent"
                checked={guardianConsent}
                onChange={(e) => setGuardianConsent(e.target.checked)}
              />{" "}
              Le représentant légal a donné son consentement écrit
            </span>
          </label>
        ) : null}

        <label className="agent-field">
          <span>Version du texte signé</span>
          <input type="text" name="consent_text_version" required maxLength={40} placeholder="v2026-01" />
        </label>

        <button type="submit" className="card-secondary-button" disabled={pending || blocked}>
          {pending ? "Enregistrement…" : "Enregistrer le consentement"}
        </button>
        {blocked ? (
          <p className="photo-note" role="alert">
            Consentement du représentant légal requis pour un consentement couvrant des mineurs.
          </p>
        ) : null}
      </form>

      {state.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Consentement enregistré.
        </p>
      ) : null}
    </section>
  );
}
