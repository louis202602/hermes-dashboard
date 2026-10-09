import { JobCard, type MediaCardActions } from "@/components/media-optimizer/JobCard";
import type { MediaOptimizerState } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Corps de la page Médiathèque (présentation pure ; les données et
 * actions viennent de la page ou du harnais de captures).
 * `state === null` : les RPC ont échoué.
 */

export interface MediaViewActions extends MediaCardActions {
  activateStop: () => void | Promise<void>;
}

export function StopBanner({ publishStop, known, onActivate }: { publishStop: boolean; known: boolean; onActivate?: MediaViewActions["activateStop"] }) {
  const tone = !known ? "unknown" : publishStop ? "on" : "off";
  return (
    <div className={`mo-stop mo-stop-${tone}`} role="status">
      <div>
        <strong>
          {!known
            ? "STOP publication : état inconnu"
            : publishStop
              ? "STOP publication : ACTIF"
              : "STOP publication : désactivé"}
        </strong>
        <span>
          {!known
            ? "Le service ne répond pas. Ce module ne publie jamais, quoi qu’il arrive."
            : publishStop
              ? "Aucune publication automatique ne peut partir. Ce module prépare des fichiers et des brouillons uniquement."
              : "Les publications ne sont plus bloquées par le STOP. Ce module, lui, ne publie jamais."}
        </span>
      </div>
      {known && !publishStop && onActivate ? (
        <form action={onActivate}>
          <button type="submit" className="mo-btn mo-btn-primary">
            Réactiver le STOP publication
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function MediaOptimizerView({ state, actions }: { state: MediaOptimizerState | null; actions: MediaViewActions }) {
  if (!state) {
    return (
      <div className="page-stack mo-page">
        <StopBanner publishStop known={false} />
        <section className="dashboard-card mo-notice" role="alert">
          <h3>Module non activé / migration en attente</h3>
          <p className="mo-note">
            Le service de l’optimiseur de médias ne répond pas : la migration de base de données n’est peut-être pas encore appliquée.
            Aucun état n’est supposé et aucune donnée n’est affichée.
          </p>
        </section>
      </div>
    );
  }

  const { publishStop, jobs, resolutionStatus, v3 } = state;
  return (
    <div className="page-stack mo-page">
      <StopBanner publishStop={publishStop} known onActivate={actions.activateStop} />

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">OPTIMISEUR DE MÉDIAS</span>
            <h3>Photos et vidéos prêtes pour Instagram et Facebook</h3>
          </div>
        </div>
        <p className="mo-note">
          Ce module prépare les fichiers (compression, métadonnées sensibles retirées, contrôle qualité). Il ne publie jamais.
          Les originaux restent dans Google Drive, intacts.
        </p>
      </section>

      {v3 === "absent" ? (
        <section className="dashboard-card mo-notice" role="status">
          <h3>Migration v3 en attente</h3>
          <p className="mo-note">
            Les aperçus avant / après, les brouillons Buffer, le format et les avertissements ne sont pas encore activés : ces sections sont
            masquées. Les tailles, droits et états ci-dessous restent réels.
          </p>
        </section>
      ) : null}

      {resolutionStatus !== "OK" ? (
        <p className="mo-note">Aucune entreprise active associée à ce compte ({resolutionStatus}).</p>
      ) : jobs.length === 0 ? (
        <p className="mo-note">Aucun média découvert pour le moment.</p>
      ) : (
        <ul className="mo-grid">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} actions={actions} v3={job.v3} />
          ))}
        </ul>
      )}
    </div>
  );
}
