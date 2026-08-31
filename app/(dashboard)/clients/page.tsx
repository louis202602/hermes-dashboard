import PhotoConsentForm from "@/components/dashboard/PhotoConsentForm";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPhotoClients, getPhotoValueSnapshot } from "@/services/hermes/photo";
import { getPvClients } from "@/services/hermes/pvClients";

export const metadata = { title: "Clients — Hermès" };

function humanStatus(value: string | null): string {
  if (!value) return "Statut non renseigné";
  return value.toLowerCase().replaceAll("_", " ");
}

export default async function ClientsPage() {
  const ctx = await requireRoute("/clients");

  if (ctx.composition.vertical === "solar") {
    const clients = await getPvClients(200);

    return (
      <div className="page-stack">
        <section className="dashboard-card pv-card">
          <div className="dashboard-card-header">
            <div>
              <span className="panel-eyebrow">HELIOSOLAR</span>
              <h3>Clients photovoltaïques</h3>
            </div>
            <ProvenanceBadge provenance="REAL" />
          </div>
          <div className="pv-pilot-grid">
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Clients / dossiers enregistrés</span>
              <strong>{clients.total}</strong>
            </div>
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Avec projet</span>
              <strong>{clients.items.filter((client) => client.projectId).length}</strong>
            </div>
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Puissance renseignée</span>
              <strong>{clients.items.filter((client) => client.puissanceKwc !== null).length}</strong>
            </div>
          </div>
        </section>

        <section className="dashboard-card pv-card">
          <div className="dashboard-card-header">
            <div>
              <span className="panel-eyebrow">CRM SOLAIRE</span>
              <h3>Dossiers</h3>
            </div>
          </div>
          {clients.items.length === 0 ? (
            <p className="photo-empty">Aucun client photovoltaïque enregistré.</p>
          ) : (
            <ul className="photo-session-list">
              {clients.items.map((client) => {
                const person = [client.firstName, client.lastName].filter(Boolean).join(" ");
                const title = client.companyName || person || "Client";
                const contact = [person && client.companyName ? person : null, client.email, client.phone]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={client.prospectId} className="photo-session-item">
                    <span className="photo-session-main">
                      <strong>{title}</strong>
                      <span className="photo-session-meta">
                        {contact || "Coordonnées non renseignées"}
                      </span>
                      <span className="photo-session-meta">
                        Prospect : {humanStatus(client.prospectStatus)}
                        {client.projectStatus ? ` · projet : ${humanStatus(client.projectStatus)}` : ""}
                      </span>
                    </span>
                    <span className="photo-session-side">
                      {client.puissanceKwc !== null && (
                        <span className="photo-badge">{client.puissanceKwc} kWc</span>
                      )}
                      {client.qualificationScore !== null && (
                        <span className="photo-session-meta">Score {client.qualificationScore}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

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
            provenance={value.ok && value.data.provenance === "DERIVED" ? "DERIVED" : "UNAVAILABLE"}
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
            {clients.data.clients.map((client) => (
              <li key={client.clientId} className="photo-session-item">
                <span className="photo-session-main">
                  <strong>{client.displayName}</strong>
                  <span className="photo-session-meta">
                    {client.sessionCount} séance(s)
                    {client.lastSessionAt
                      ? ` · dernière le ${new Date(client.lastSessionAt).toLocaleDateString(ctx.locale)}`
                      : ""}
                  </span>
                </span>
                <span className="photo-session-side">
                  <span className="photo-session-meta">
                    {client.hasActiveConsent ? "consentement en cours" : "aucun consentement"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {clients.ok && clients.data.clients.length > 0 ? (
        <PhotoConsentForm
          clients={clients.data.clients.map((client) => ({
            clientId: client.clientId,
            displayName: client.displayName,
          }))}
        />
      ) : null}
    </div>
  );
}
