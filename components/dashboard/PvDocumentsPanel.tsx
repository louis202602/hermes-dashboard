"use client";

import { useActionState } from "react";

import {
  deletePvDocumentAction,
  purgePvDocumentsAction,
  PV_INITIAL_STATE,
  uploadPvDocumentAction,
} from "@/app/actions/pv";
import type { PvDocument } from "@/types/pv";

const DOC_TYPE_LABELS: Record<string, string> = {
  FACTURE_ENERGIE: "Facture d’énergie",
  RELEVE_TOITURE: "Relevé de toiture",
  PHOTO_SITE: "Photo du site",
  PLAN: "Plan",
  SCHEMA_ELECTRIQUE: "Schéma électrique",
  NOTE_TECHNIQUE: "Note technique",
  ATTESTATION: "Attestation",
  AUTRE: "Autre",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * PV-3 — documents d'un site : dépôt, liste, téléchargement, retrait.
 *
 * LE NAVIGATEUR NE CHOISIT RIEN de ce qui compte. Le fichier part vers une
 * Server Action ; c'est la base qui attribue l'identifiant du document et
 * construit le chemin `<tenant>/<site>/<document>/<fichier>`, puis le revalide
 * à la finalisation. Un chemin forgé n'a aucun point d'entrée.
 *
 * Le lien de téléchargement est une URL SIGNÉE à TTL court, produite à la
 * demande côté serveur et jamais persistée : la source de vérité reste le
 * couple (bucket privé, chemin).
 *
 * Deux gestes DISTINCTS, et c'est volontaire : « Retirer » est une suppression
 * LOGIQUE (la ligne survit, traçable) ; « Purger » efface réellement les octets.
 * Les confondre rendrait une erreur de clic irréversible.
 */
export default function PvDocumentsPanel({
  siteId,
  documents,
}: {
  siteId: string;
  documents: PvDocument[];
}) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadPvDocumentAction,
    PV_INITIAL_STATE,
  );
  const [deleteState, deleteAction] = useActionState(deletePvDocumentAction, PV_INITIAL_STATE);
  const [purgeState, purgeAction, purging] = useActionState(
    purgePvDocumentsAction,
    PV_INITIAL_STATE,
  );

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Documents</h3>
        </div>
        <span className="photo-session-meta">
          {documents.length === 0 ? "aucun document" : `${documents.length}`}
        </span>
      </div>

      {documents.length === 0 ? (
        <p className="photo-empty">
          Aucun document pour ce site. Déposez une facture, un relevé de toiture ou un plan
          ci-dessous.
        </p>
      ) : (
        <ul className="photo-session-list">
          {documents.map((d) => (
            <li key={d.id} className="photo-session-item">
              <span className="photo-session-main">
                <strong>{d.originalFilename ?? DOC_TYPE_LABELS[d.docType] ?? d.docType}</strong>
                <span className="photo-session-meta">
                  {DOC_TYPE_LABELS[d.docType] ?? d.docType} · {humanSize(d.sizeBytes)}
                  {d.uploadedAt ? ` · ${d.uploadedAt.slice(0, 10)}` : ""}
                  {d.billId ? " · rattaché à une facture" : ""}
                </span>
              </span>
              <div className="photo-session-side">
                {d.signedUrl ? (
                  <a
                    className="photo-badge"
                    href={d.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir
                  </a>
                ) : (
                  <span className="photo-session-meta">lien indisponible</span>
                )}
                <form action={deleteAction} className="pv-inline-form">
                  <input type="hidden" name="document_id" value={d.id} />
                  <input type="hidden" name="site_id" value={siteId} />
                  <button type="submit" className="card-secondary-button">
                    Retirer
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="photo-note">
        Le lien d’ouverture est signé pour 5 minutes. Aucune URL publique n’est enregistrée :
        seuls le bucket privé et le chemin sont conservés.
      </p>

      <form action={uploadAction} className="agent-action-form">
        <input type="hidden" name="site_id" value={siteId} />
        <p className="panel-eyebrow">Déposer un document</p>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Type</span>
            <select name="doc_type" defaultValue="FACTURE_ENERGIE">
              {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-field">
            <span>Fichier</span>
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
          </label>
        </div>
        <p className="photo-note">
          PDF, JPEG, PNG ou WebP. 25 Mo maximum. Le format et la taille sont revérifiés par
          la base — un fichier hors des règles est refusé, jamais accepté à moitié.
        </p>
        <button type="submit" className="card-secondary-button" disabled={uploading}>
          {uploading ? "Téléversement…" : "Déposer"}
        </button>
      </form>

      {uploadState.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {uploadState.message}
        </p>
      ) : null}
      {uploadState.phase === "ok" ? (
        <p className="photo-session-meta" role="status">
          Document enregistré.
        </p>
      ) : null}
      {deleteState.phase === "error" ? (
        <p className="photo-session-meta" role="alert">
          {deleteState.message}
        </p>
      ) : null}

      <form action={purgeAction} className="pv-inline-form">
        <input type="hidden" name="site_id" value={siteId} />
        <button type="submit" className="card-secondary-button" disabled={purging}>
          {purging ? "Purge…" : "Purger les documents retirés"}
        </button>
      </form>
      <p className="photo-note">
        La purge efface DÉFINITIVEMENT les octets des documents retirés depuis plus de 7
        jours. La ligne d’inventaire, elle, survit : un document purgé reste traçable.
        Rejouer la purge est sans effet.
      </p>
      {purgeState.message ? (
        <p
          className="photo-session-meta"
          role={purgeState.phase === "error" ? "alert" : "status"}
        >
          {purgeState.message}
        </p>
      ) : null}
    </section>
  );
}
