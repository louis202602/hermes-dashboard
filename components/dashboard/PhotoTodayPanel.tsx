import Link from "next/link";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  PHOTO_BLOCKED_LABEL,
  PHOTO_NEXT_ACTION_LABEL,
  isNextActionAvailable,
  nextActionHref,
} from "@/lib/photo/sessionState";
import type { ServiceResult } from "@/types/hermes";
import type { PhotoToday } from "@/types/photo";

/**
 * PHOTO-P0 — « Aujourd'hui ». Cinq chiffres réels et la prochaine action de chaque
 * séance active, tels que la projection SQL les a calculés.
 *
 * Honnêteté : quand l'étape suivante dépend d'un agent d'exécution indisponible,
 * on l'écrit — jamais un bouton qui ne ferait rien.
 */
export default function PhotoTodayPanel({ today }: { today: ServiceResult<PhotoToday> }) {
  if (!today.ok || today.data.resolutionStatus !== "OK") {
    return (
      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Aujourd’hui</h3>
          </div>
        </div>
        <p className="photo-empty">Données du studio indisponibles.</p>
      </section>
    );
  }

  const { counters, sessions } = today.data;

  return (
    <section className="dashboard-card photo-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HERMÈS STUDIO</span>
          <h3>Aujourd’hui</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <div className="photo-stat-row">
        <span className="photo-stat">
          <span className="photo-stat-value">{counters.sessionsActive}</span>
          <span className="photo-stat-label">séances en cours</span>
        </span>
        <span className="photo-stat">
          <span className="photo-stat-value">{counters.photosAwaitingReview}</span>
          <span className="photo-stat-label">photos à trancher</span>
        </span>
        <span className="photo-stat">
          <span className="photo-stat-value">{counters.sessionsAwaitingShot}</span>
          <span className="photo-stat-label">séances à importer</span>
        </span>
        <span className="photo-stat">
          <span className="photo-stat-value">{counters.upsellOpportunities}</span>
          <span className="photo-stat-label">opportunités détectées</span>
        </span>
        <span className="photo-stat">
          <span className="photo-stat-value">
            {counters.upsellPotentialEur > 0
              ? `${Math.round(counters.upsellPotentialEur)} €`
              : "—"}
          </span>
          <span className="photo-stat-label">revenus potentiels</span>
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="photo-empty">Aucune séance en cours.</p>
      ) : (
        <ul className="photo-session-list">
          {sessions.map((s) => {
            const href = nextActionHref(s.sessionId, s.state.nextAction);
            const actionable = isNextActionAvailable(s.state) && href !== null;
            return (
              <li key={s.sessionId} className="photo-session-item">
                <Link href={`/seances/${s.sessionId}`} className="photo-session-main">
                  <strong>{s.title ?? s.clientName}</strong>
                  <span className="photo-session-meta">
                    {s.clientName} · {s.sessionType.toLowerCase()}
                  </span>
                </Link>
                <span className="photo-session-side">
                  {actionable ? (
                    <Link href={href} className="photo-badge">
                      {PHOTO_NEXT_ACTION_LABEL[s.state.nextAction]}
                    </Link>
                  ) : (
                    <span className="photo-session-meta">
                      {s.state.blockedBy
                        ? (PHOTO_BLOCKED_LABEL[s.state.blockedBy] ?? s.state.blockedBy)
                        : PHOTO_NEXT_ACTION_LABEL[s.state.nextAction]}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
