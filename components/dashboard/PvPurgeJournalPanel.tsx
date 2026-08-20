import type { PvPurgeJournalEntry } from "@/types/pv";

/**
 * PV-4 — JOURNAL DE PURGE.
 *
 * Aucune table d'audit nouvelle : tout vient de `pv_documents` (qui garde
 * `deleted_at`, `deleted_by`, `purged_at`, `purged_path`) joint à la brique
 * existante `entity_audit_log` (qui garde QUI a agi). La façade fait la
 * jointure ; cet écran ne fait que la lire.
 *
 * Transparence assumée : le journal est ouvert à tout membre du tenant, pas
 * seulement aux administrateurs. Savoir qu'un fichier a été détruit, par qui et
 * quand, est précisément ce qui rend un geste irréversible acceptable.
 */
export default function PvPurgeJournalPanel({
  entries,
}: {
  entries: PvPurgeJournalEntry[];
}) {
  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Journal des purges</h3>
        </div>
        <span className="photo-session-meta">
          {entries.length === 0 ? "aucune purge" : `${entries.length}`}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="photo-empty">
          Aucun document n’a été purgé. Les suppressions logiques restent réversibles.
        </p>
      ) : (
        <ul className="photo-session-list">
          {entries.map((e) => (
            <li key={e.documentId} className="photo-session-item">
              <span className="photo-session-main">
                <strong>{e.originalFilename ?? e.docType}</strong>
                <span className="photo-session-meta">
                  {e.docType} · {(e.sizeBytes / 1024).toFixed(0)} Ko · retiré le{" "}
                  {e.deletedAt ? e.deletedAt.slice(0, 10) : "—"} · purgé le{" "}
                  {e.purgedAt ? e.purgedAt.slice(0, 10) : "—"}
                </span>
                <span className="photo-session-meta">
                  Par {e.purgedBy ?? "—"} · ancien chemin {e.purgedPath ?? "—"}
                </span>
              </span>
              <span className="pv-badge pv-badge-rejected">{e.outcome}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="photo-note">
        Un document purgé n’est plus récupérable : seuls sa fiche et son ancien chemin
        subsistent, pour la traçabilité.
      </p>
    </section>
  );
}
