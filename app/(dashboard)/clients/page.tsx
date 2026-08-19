import PhotoConsentForm from "@/components/dashboard/PhotoConsentForm";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPhotoClients, getPhotoValueSnapshot } from "@/services/hermes/photo";

export const metadata = { title: "Clients — Hermès Studio" };

/**
 * /clients — mémoire client du studio + saisie du consentement média.
 *
 * Le consentement se collecte AU MOMENT de la séance, pas rétroactivement : c'est
 * pourquoi il est en P0 et non avec le marketing. Sans lui, aucune publication ne
 * sera possible plus tard (gate fail-closed en base).
 */
export default async function PhotoClientsPage() {
  // Même garde que le menu et que /chantiers/carte : une seule liste de modules.
  const ctx = await requireRoute("/clients");

  const [clients, value] = await Promise.all([getPhotoClients(200), getPhotoValueSnapshot()]);

  return (
    <div className="page-stack">
      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Valeur créée</h3>
          </div>
          <ProvenanceBadge
            provenance={
              value.ok && value.data.provenance === "DERIVED" ? "DERIVED" : "UNAVAILABLE"
            }
          />
        </div>
        {value.ok && value.data.provenance === "DERIVED" ? (
          <div className="photo-stat-row">
            <span className="photo-stat">
              <span className="photo-stat-value">
                {value.data.netTimeSavedMinutes !== null
                  ? `${Math.round(value.data.netTimeSavedMinutes)} min`
                  : "—"}
              </span>
              <span className="photo-stat-label">temps net gagné</span>
            </span>
            <span className="photo-stat">
              <span className="photo-stat-value">{value.data.photosReviewed}</span>
              <span className="photo-stat-label">photos triées</span>
            </span>
            <span className="photo-stat">
              <span className="photo-stat-value">{value.data.sessionsProcessed}</span>
              <span className="photo-stat-label">séances traitées</span>
            </span>
          </div>
        ) : (
          <p className="photo-note">
            Non mesuré. Le temps gagné n’est calculable qu’après l’enregistrement d’une
            baseline réelle (SW19) — aucun chiffre n’est estimé à sa place.
          </p>
        )}
      </section>

      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Clients</h3>
          </div>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {!clients.ok || clients.data.clients.length === 0 ? (
          <p className="photo-empty">Aucun client enregistré.</p>
        ) : (
          <ul className="photo-session-list">
            {clients.data.clients.map((c) => (
              <li key={c.clientId} className="photo-session-item">
                <span className="photo-session-main">
                  <strong>{c.displayName}</strong>
                  <span className="photo-session-meta">
                    {c.sessionCount} séance(s)
                    {c.lastSessionAt
                      ? ` · dernière le ${new Date(c.lastSessionAt).toLocaleDateString(ctx.locale)}`
                      : ""}
                  </span>
                </span>
                <span className="photo-session-side">
                  <span className="photo-session-meta">
                    {c.hasActiveConsent ? "consentement en cours" : "aucun consentement"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {clients.ok && clients.data.clients.length > 0 ? (
        <PhotoConsentForm
          clients={clients.data.clients.map((c) => ({
            clientId: c.clientId,
            displayName: c.displayName,
          }))}
        />
      ) : null}
    </div>
  );
}
