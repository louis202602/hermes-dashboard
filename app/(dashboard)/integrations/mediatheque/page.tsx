import {
  activateStopAction,
  requestOptimizationAction,
  setRightsAction,
} from "@/app/actions/media-optimizer";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getMediaOptimizerState } from "@/services/hermes/mediaOptimizer";
import type { MediaJobStatus, MediaOptimizerJob } from "@/types/mediaOptimizer";

export const metadata = { title: "Médiathèque — Optimiseur de médias" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<MediaJobStatus, string> = {
  discovered: "Découvert",
  technically_usable: "Techniquement utilisable",
  queued: "En file d’attente",
  processing: "Optimisation en cours",
  optimized: "Optimisé",
  ready_to_publish: "Prêt à publier",
  blocked: "Bloqué",
  failed: "Échec",
};

const RIGHTS_LABEL = {
  pending_review: "Droits à vérifier",
  authorized: "Droits validés",
  rejected: "Droits refusés",
} as const;

function mo(bytes: number | null): string {
  if (bytes === null) return "—";
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} Go` : `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

function Row({ job }: { job: MediaOptimizerJob }) {
  const busy = job.status === "queued" || job.status === "processing";
  return (
    <li className="dashboard-card integration-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{job.kind === "photo" ? "PHOTO" : "VIDÉO"} · {job.folderLabel ?? "—"}</span>
          <h3>{job.sourceName}</h3>
        </div>
        <span className="integration-status">{STATUS_LABEL[job.status]}</span>
      </div>
      <p className="integration-note">
        {job.sizeAfter !== null
          ? `${mo(job.sizeBefore)} → ${mo(job.sizeAfter)} (−${job.reductionPct ?? 0} %) · encodage ${job.encodeSec ?? "—"} s · mémoire max ${job.peakRamMb ?? "—"} Mo · SSIM ${job.ssimMin ?? "—"} (indicatif)`
          : `Taille d’origine ${mo(job.sizeBefore)} — pas encore optimisé.`}
      </p>
      <p className="integration-note">
        Instagram : {job.igOk === null ? "—" : job.igOk ? "compatible" : "à vérifier"} · Facebook :{" "}
        {job.fbOk === null ? "—" : job.fbOk ? "compatible" : "à vérifier"} · {RIGHTS_LABEL[job.rightsStatus]}
        {job.rightsNote ? ` (${job.rightsNote})` : ""}
      </p>
      {job.error ? <p className="integration-note">Détail : {job.error}</p> : null}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <form action={requestOptimizationAction} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="hidden" name="job_id" value={job.id} />
          <label><input type="checkbox" name="pad_vertical" /> Format vertical 9:16 sans recadrage</label>
          <button type="submit" disabled={busy}>{busy ? "En cours…" : "Optimiser maintenant"}</button>
        </form>
        <form action={setRightsAction} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="hidden" name="job_id" value={job.id} />
          <input name="note" placeholder="Origine / accord (obligatoire pour valider)" maxLength={500} />
          <button type="submit" name="status" value="authorized">Valider les droits</button>
          <button type="submit" name="status" value="rejected">Refuser</button>
        </form>
      </div>
    </li>
  );
}

export default async function MediathequePage() {
  await requireRoute("/integrations/mediatheque");
  const result = await getMediaOptimizerState();

  if (!result.ok || !result.data) {
    return (
      <div className="page-stack">
        <section className="dashboard-card pv-card">
          <h3>Médiathèque</h3>
          <p className="integration-note">Le service est indisponible. Aucun état positif n’est supposé.</p>
        </section>
      </div>
    );
  }
  const { publishStop, jobs, resolutionStatus } = result.data;

  return (
    <div className="page-stack">
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">OPTIMISEUR DE MÉDIAS</span>
            <h3>Photos et vidéos prêtes pour Instagram et Facebook</h3>
          </div>
          <span className="integration-status">{publishStop ? "STOP publication : ACTIF" : "STOP publication : désactivé"}</span>
        </div>
        <p className="integration-note">
          Ce module prépare les fichiers (compression, métadonnées sensibles retirées, contrôle qualité). Il ne publie jamais.
          Les originaux restent dans Google Drive, intacts.
        </p>
        {!publishStop ? (
          <form action={activateStopAction}><button type="submit">Réactiver le STOP publication</button></form>
        ) : null}
      </section>

      {resolutionStatus !== "OK" ? (
        <p className="integration-note">Aucune entreprise active associée à ce compte ({resolutionStatus}).</p>
      ) : jobs.length === 0 ? (
        <p className="integration-note">Aucun média découvert pour le moment.</p>
      ) : (
        <ul className="integrations-grid">{jobs.map((job) => <Row key={job.id} job={job} />)}</ul>
      )}
    </div>
  );
}
