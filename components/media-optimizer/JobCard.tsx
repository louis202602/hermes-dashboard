import { PreviewComparator } from "@/components/media-optimizer/PreviewComparator";
import { explainBlockers } from "@/lib/media-optimizer/explain";
import {
  bufferStatusLabel,
  captionExcerpt,
  compatLabel,
  computeReductionPct,
  formatBytes,
  formatDateTimeFr,
  formatReduction,
  formatSeconds,
  networkLabel,
  statusLabel,
  statusTone,
} from "@/lib/media-optimizer/format";
import type { MediaOptimizerJob, MediaPreviewsResult } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Carte d'un média. Composant serveur sans état : les actions sont
 * injectées (Server Actions en production, no-op dans le harnais de captures).
 * Rien ici ne publie ; le brouillon Buffer est affiché en lecture seule.
 */

export interface MediaCardActions {
  requestOptimization: (formData: FormData) => void | Promise<void>;
  setRights: (formData: FormData) => void | Promise<void>;
  loadPreviews: (jobId: string) => Promise<MediaPreviewsResult>;
}

const RIGHTS_LABEL = {
  pending_review: "Droits à vérifier",
  authorized: "Droits validés",
  rejected: "Droits refusés",
} as const;

function Compat({ label, ok }: { label: string; ok: boolean | null }) {
  const tone = ok === true ? "ok" : ok === false ? "danger" : "neutral";
  return (
    <div className="mo-metric">
      <dt>{label}</dt>
      <dd>
        <span className={`mo-chip mo-chip-${tone}`}>
          <span aria-hidden="true">{ok === true ? "✓ " : ok === false ? "✗ " : "? "}</span>
          {compatLabel(ok)}
        </span>
      </dd>
    </div>
  );
}

export function JobCard({ job, actions, v3 }: { job: MediaOptimizerJob; actions: MediaCardActions; v3: boolean }) {
  const busy = job.status === "queued" || job.status === "processing";
  const reduction = computeReductionPct(job.sizeBefore, job.sizeAfter, job.reductionPct);
  const hasAfter = job.sizeAfter !== null;
  const ratio =
    job.sizeBefore && job.sizeAfter !== null && job.sizeBefore > 0
      ? Math.max(2, Math.min(100, (job.sizeAfter / job.sizeBefore) * 100))
      : null;
  const reasons = explainBlockers(job);
  const blocking = reasons.filter((r) => r.severity === "blocking");
  const excerpt = captionExcerpt(job.caption);
  const titleId = `mo-title-${job.id}`;

  return (
    <li className="dashboard-card mo-card" aria-labelledby={titleId}>
      <header className="mo-card-head">
        <div className="mo-card-title">
          <span className="panel-eyebrow">
            {job.kind === "photo" ? "PHOTO" : job.kind === "video" ? "VIDÉO" : "MÉDIA"} · {job.folderLabel ?? "—"}
          </span>
          <h3 id={titleId}>{job.sourceName}</h3>
        </div>
        <div className="mo-chips">
          {job.isTest ? <span className="mo-chip mo-chip-test">TEST</span> : null}
          <span className={`mo-chip mo-chip-${statusTone(job.status)}`}>{statusLabel(job.status)}</span>
        </div>
      </header>

      <dl className="mo-metrics">
        <div className="mo-metric">
          <dt>Taille originale</dt>
          <dd>{formatBytes(job.sizeBefore)}</dd>
        </div>
        <div className="mo-metric">
          <dt>Taille optimisée</dt>
          <dd>{hasAfter ? formatBytes(job.sizeAfter) : "Pas encore optimisé"}</dd>
        </div>
        <div className="mo-metric">
          <dt>Réduction</dt>
          <dd>{hasAfter ? formatReduction(reduction) : "—"}</dd>
        </div>
        <div className="mo-metric">
          <dt>Réseau cible</dt>
          <dd>{networkLabel(job.network)}</dd>
        </div>
        {v3 ? (
          <div className="mo-metric">
            <dt>Format</dt>
            <dd>
              {job.aspect ?? "—"}
              {job.padVertical ? <span className="mo-chip mo-chip-info">fond flouté 9:16 appliqué</span> : null}
            </dd>
          </div>
        ) : null}
        <Compat label="Instagram" ok={job.igOk} />
        <Compat label="Facebook" ok={job.fbOk} />
        <div className="mo-metric">
          <dt>Droits</dt>
          <dd>
            {RIGHTS_LABEL[job.rightsStatus]}
            {job.rightsNote ? <span className="mo-sub"> — {job.rightsNote}</span> : null}
          </dd>
        </div>
      </dl>

      {ratio !== null ? (
        <div className="mo-bar" role="img" aria-label={`Taille optimisée : ${Math.round(ratio)} % de la taille originale`}>
          <span style={{ width: `${ratio}%` }} />
        </div>
      ) : null}
      {hasAfter && (job.encodeSec !== null || job.peakRamMb !== null || job.ssimMin !== null) ? (
        <p className="mo-note">
          Encodage {formatSeconds(job.encodeSec)} · mémoire max {job.peakRamMb ?? "—"} Mo · SSIM {job.ssimMin ?? "—"} (indicatif)
        </p>
      ) : null}

      <section className="mo-reasons" aria-label="Pourquoi ce média est bloqué ?">
        {reasons.length === 0 ? (
          <p className="mo-ok-line">Aucun blocage détecté dans les données du module.</p>
        ) : (
          <>
            <h4>{blocking.length > 0 ? "Pourquoi ce média est bloqué ?" : "Points d’attention"}</h4>
            <ul>
              {reasons.map((r, i) => (
                <li key={`${r.code}-${i}`} className={r.severity === "warning" ? "is-warning" : undefined}>
                  {r.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {v3 ? (
        <section className="mo-draft" aria-label="Brouillon Buffer">
          <h4>Brouillon Buffer — aucune publication</h4>
          {job.bufferStatus === null && !excerpt && !job.draftError ? (
            <p className="mo-note">Aucun brouillon préparé pour ce média.</p>
          ) : (
            <dl className="mo-draft-list">
              <div>
                <dt>Statut</dt>
                <dd>
                  <span className={`mo-chip mo-chip-${job.bufferStatus === "error" ? "danger" : job.bufferStatus === "draft" ? "info" : "neutral"}`}>
                    {bufferStatusLabel(job.bufferStatus)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Légende</dt>
                <dd>{excerpt ?? "—"}</dd>
              </div>
              <div>
                <dt>Identifiant du brouillon</dt>
                <dd className="mo-mono">{job.bufferPostId ?? "—"}</dd>
              </div>
              <div>
                <dt>Dernière vérification</dt>
                <dd>{formatDateTimeFr(job.draftCheckedAt)}</dd>
              </div>
              {job.draftError ? (
                <div>
                  <dt>Erreur</dt>
                  <dd className="mo-err">{job.draftError}</dd>
                </div>
              ) : null}
            </dl>
          )}
        </section>
      ) : null}

      {v3 && job.hasPreviews ? (
        <PreviewComparator jobId={job.id} sizeBefore={job.sizeBefore} sizeAfter={job.sizeAfter} loadPreviews={actions.loadPreviews} />
      ) : v3 ? (
        <p className="mo-note">Aucun aperçu avant / après n’est disponible pour ce média.</p>
      ) : null}

      {job.error && !reasons.some((r) => r.code === "error") ? <p className="mo-note">Détail : {job.error}</p> : null}

      <div className="mo-actions">
        <form action={actions.requestOptimization} className="mo-form">
          <input type="hidden" name="job_id" value={job.id} />
          <div className="mo-form-row">
            <label className="mo-field">
              <span>Réseau</span>
              <select name="network" defaultValue={job.network}>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
              </select>
            </label>
            <button type="submit" className="mo-btn mo-btn-primary" disabled={busy}>
              {busy ? "En cours…" : "Optimiser maintenant"}
            </button>
          </div>
          <label className="mo-check">
            <input type="checkbox" name="pad_vertical" />
            <span>
              <strong>Option : fond flouté 9:16</strong>
              <small>Passe en vertical sans recadrer. Désactivé par défaut — à cocher seulement si nécessaire.</small>
            </span>
          </label>
        </form>

        <form action={actions.setRights} className="mo-form">
          <input type="hidden" name="job_id" value={job.id} />
          <label className="mo-field mo-field-wide">
            <span>Origine / accord (obligatoire pour valider)</span>
            <input name="note" placeholder="Ex. prise par l’équipe" maxLength={500} />
          </label>
          <div className="mo-form-row">
            <button type="submit" name="status" value="authorized" className="mo-btn">
              Valider les droits
            </button>
            <button type="submit" name="status" value="rejected" className="mo-btn">
              Refuser
            </button>
          </div>
        </form>
      </div>
    </li>
  );
}
