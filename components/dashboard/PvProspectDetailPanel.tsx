"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  PV_INITIAL_STATE,
  setPvProspectStatusAction,
  updatePvProspectAction,
} from "@/app/actions/pv";
import {
  PV_PROSPECT_STATUS_LABELS,
  PV_PROSPECT_TYPE_LABELS,
  pvAzimuthLabel,
  pvProspectName,
} from "@/lib/pv/status";
import type { PvProspectDetail } from "@/types/pv";

/**
 * PV-2 — fiche prospect : identité, coordonnées, statut, historique, sites.
 *
 * LE STATUT NE SE SAISIT PAS LIBREMENT. Le menu ne propose que les transitions
 * réellement déclarées dans `pv_prospect_transitions`, telles que la façade les
 * a renvoyées. L'écran ne redéclare donc pas la machine à états : il la LIT.
 * Et si l'écran se trompait malgré tout, le déclencheur de PV-1 refuserait —
 * ce que l'utilisateur verrait tel quel, sans habillage.
 *
 * L'HISTORIQUE vient de la brique d'audit existante (`entity_audit_log`). Aucun
 * second journal n'a été créé.
 */
export default function PvProspectDetailPanel({ prospect }: { prospect: PvProspectDetail }) {
  const [statusState, statusAction, statusPending] = useActionState(
    setPvProspectStatusAction,
    PV_INITIAL_STATE,
  );
  const [editState, editAction, editPending] = useActionState(
    updatePvProspectAction,
    PV_INITIAL_STATE,
  );

  return (
    <>
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>{pvProspectName(prospect)}</h3>
          </div>
          <div className="photo-session-side">
            <Link href={`/etudes/affaires/${prospect.id}`} className="photo-badge">
              Voir l’affaire
            </Link>
            <span className="photo-badge">
              {PV_PROSPECT_STATUS_LABELS[prospect.status] ?? prospect.status}
            </span>
          </div>
        </div>

        <dl className="pv-facts">
          <div>
            <dt>Type</dt>
            <dd>{PV_PROSPECT_TYPE_LABELS[prospect.prospectType] ?? prospect.prospectType}</dd>
          </div>
          <div>
            <dt>Téléphone</dt>
            <dd>{prospect.phone ?? "—"}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{prospect.email ?? "—"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {prospect.source}
              {prospect.sourceDetail ? ` · ${prospect.sourceDetail}` : ""}
            </dd>
          </div>
          <div>
            <dt>Consentement contact</dt>
            <dd>
              {prospect.contactConsent
                ? `Oui${prospect.contactConsentAt ? ` — ${prospect.contactConsentAt.slice(0, 10)}` : ""}`
                : "Non"}
            </dd>
          </div>
          <div>
            <dt>Désinscrit</dt>
            <dd>{prospect.optedOut ? "Oui" : "Non"}</dd>
          </div>
          <div>
            <dt>Score de qualification</dt>
            <dd>{prospect.qualificationScore ?? "—"}</dd>
          </div>
        </dl>

        <form action={statusAction} className="agent-action-form pv-inline-form">
          <input type="hidden" name="prospect_id" value={prospect.id} />
          <label className="agent-field">
            <span>Faire avancer le statut</span>
            <select name="status" defaultValue={prospect.nextStatuses[0] ?? ""}>
              {prospect.nextStatuses.length === 0 ? (
                <option value="">Aucune transition possible depuis cet état</option>
              ) : (
                prospect.nextStatuses.map((s) => (
                  <option key={s} value={s}>
                    {PV_PROSPECT_STATUS_LABELS[s] ?? s}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="submit"
            className="card-secondary-button"
            disabled={statusPending || prospect.nextStatuses.length === 0}
          >
            {statusPending ? "Enregistrement…" : "Changer le statut"}
          </button>
        </form>
        {statusState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {statusState.message}
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Sites</h3>
          </div>
          <span className="photo-session-meta">
            {prospect.sites.length === 0 ? "aucun site" : `${prospect.sites.length}`}
          </span>
        </div>

        {prospect.sites.length === 0 ? (
          <p className="photo-empty">
            Aucun site d’implantation. Ajoutez-en un ci-dessous : une étude ne peut exister
            que sur un site.
          </p>
        ) : (
          <ul className="photo-session-list">
            {prospect.sites.map((s) => (
              <li key={s.id} className="photo-session-item">
                <Link href={`/etudes/sites/${s.id}`} className="photo-session-main">
                  <strong>{s.label ?? s.addressLine1 ?? "Site"}</strong>
                  <span className="photo-session-meta">
                    {[s.postalCode, s.city].filter(Boolean).join(" ")}
                    {s.roofAreaUsableM2 ? ` · ${s.roofAreaUsableM2} m² exploitables` : ""}
                    {pvAzimuthLabel(s.azimuthDeg) ? ` · ${pvAzimuthLabel(s.azimuthDeg)}` : ""}
                    {s.tiltDeg !== null ? ` · ${s.tiltDeg}° d’inclinaison` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Corriger la fiche</h3>
          </div>
        </div>
        <form action={editAction} className="agent-action-form">
          <input type="hidden" name="prospect_id" value={prospect.id} />
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Prénom</span>
              <input type="text" name="first_name" defaultValue={prospect.firstName ?? ""} maxLength={120} />
            </label>
            <label className="agent-field">
              <span>Nom</span>
              <input type="text" name="last_name" defaultValue={prospect.lastName ?? ""} maxLength={120} />
            </label>
          </div>
          <label className="agent-field">
            <span>Raison sociale</span>
            <input type="text" name="company_name" defaultValue={prospect.companyName ?? ""} maxLength={200} />
          </label>
          <div className="agent-field-row">
            <label className="agent-field">
              <span>Téléphone</span>
              <input type="tel" name="phone" defaultValue={prospect.phone ?? ""} maxLength={40} />
            </label>
            <label className="agent-field">
              <span>E-mail</span>
              <input type="email" name="email" defaultValue={prospect.email ?? ""} maxLength={320} />
            </label>
          </div>
          <label className="agent-field">
            <span>Score de qualification (0-100)</span>
            <input
              type="number"
              name="qualification_score"
              min={0}
              max={100}
              defaultValue={prospect.qualificationScore ?? ""}
            />
          </label>
          <label className="agent-field pv-checkbox">
            <input type="checkbox" name="contact_consent" defaultChecked={prospect.contactConsent} />
            <span>Consentement au contact recueilli</span>
          </label>
          <label className="agent-field">
            <span>Notes</span>
            <textarea name="notes" rows={3} defaultValue={prospect.notes ?? ""} maxLength={2000} />
          </label>
          <button type="submit" className="card-secondary-button" disabled={editPending}>
            {editPending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
        {editState.phase === "error" ? (
          <p className="photo-session-meta" role="alert">
            {editState.message}
          </p>
        ) : null}
        {editState.phase === "ok" ? (
          <p className="photo-session-meta" role="status">
            Fiche mise à jour.
          </p>
        ) : null}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Historique</h3>
          </div>
        </div>
        {prospect.history.length === 0 ? (
          <p className="photo-empty">Aucun changement enregistré pour l’instant.</p>
        ) : (
          <ul className="photo-session-list">
            {prospect.history.map((h, i) => (
              <li key={`${h.at ?? i}`} className="photo-session-item">
                <span className="photo-session-main">
                  <strong>{h.summary ?? "Modification"}</strong>
                  <span className="photo-session-meta">
                    {h.at ? h.at.slice(0, 19).replace("T", " ") : "—"}
                    {h.by ? ` · ${h.by}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
