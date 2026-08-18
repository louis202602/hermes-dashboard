import Link from "next/link";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { PHOTO_STATUS_LABEL, photoProgressPercent } from "@/lib/photo/sessionState";
import type { ServiceResult } from "@/types/hermes";
import type { PhotoSessions } from "@/types/photo";

/**
 * PHOTO-P0 — Liste des séances. Server Component pur : il rend ce que la façade a
 * renvoyé et ne recalcule aucune règle métier. Une donnée absente est affichée
 * comme absente, jamais remplacée par une valeur plausible.
 *
 * Note i18n (écart Phase 1 assumé) : le vocabulaire métier photo est en français
 * dans les constantes partagées. Le chrome (menu, profils) reste, lui, localisé
 * dans les 6 langues.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card photo-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HERMÈS STUDIO</span>
          <h3>Séances</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function PhotoSessionsPanel({
  sessions,
}: {
  sessions: ServiceResult<PhotoSessions>;
}) {
  if (!sessions.ok) {
    return (
      <Frame>
        <p className="photo-empty">Service indisponible.</p>
      </Frame>
    );
  }

  const { resolutionStatus, sessions: rows } = sessions.data;
  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="photo-empty">
          {resolutionStatus === "MODULE_DISABLED"
            ? "La verticale Studio n’est pas activée pour ce studio."
            : "Aucune donnée accessible."}
        </p>
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="photo-empty">Aucune séance enregistrée.</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <ul className="photo-session-list">
        {rows.map((s) => (
          <li key={s.sessionId} className="photo-session-item">
            <Link href={`/seances/${s.sessionId}`} className="photo-session-main">
              <strong>{s.title ?? s.clientName}</strong>
              <span className="photo-session-meta">
                {s.clientName} · {s.sessionType.toLowerCase()} ·{" "}
                {PHOTO_STATUS_LABEL[s.status] ?? s.status}
              </span>
            </Link>
            <span className="photo-session-side">
              <span className="photo-progress-track" aria-label="Avancement de la séance">
                <span
                  className="photo-progress-fill"
                  style={{ width: `${photoProgressPercent(s.status)}%` }}
                />
              </span>
              {s.undecidedCount > 0 ? (
                <Link href={`/seances/${s.sessionId}/tri`} className="photo-badge">
                  {s.undecidedCount} à trancher
                </Link>
              ) : (
                <span className="photo-session-meta">{s.assetCount} photos</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}
