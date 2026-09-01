import { configureQontoCredentialsAction } from "@/app/actions/integrations";
import PageHeading from "@/components/dashboard/PageHeading";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { isProviderImplemented } from "@/lib/integrations/connectionState";
import { getOperationalIntegrationHealth } from "@/services/hermes/integrationHealth";
import { getTenantIntegrations } from "@/services/hermes/integrations";
import type { IntegrationStatus } from "@/types/integrations";

export const metadata = { title: "Intégrations — Hermès OS" };

const LABEL: Record<IntegrationStatus, string> = {
  NOT_CONNECTED: "Non connecté",
  CONNECTING: "Connexion en cours",
  CONNECTED: "Connecté",
  ERROR: "Erreur",
  REAUTH_REQUIRED: "Reconnexion requise",
  REVOKED: "Révoqué",
};

export default async function IntegrationsPage() {
  const ctx = await requireRoute("/integrations");
  const [{ integrations: allIntegrations, resolutionStatus }, health] = await Promise.all([
    getTenantIntegrations(),
    getOperationalIntegrationHealth(),
  ]);
  const allowed = new Set(ctx.composition.integrationProviders);
  const integrations = allIntegrations.filter((item) => allowed.has(item.provider));

  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.integrations" />

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div><span className="panel-eyebrow">ÉTAT RÉEL</span><h3>Noyau & automatisations</h3></div>
        </div>
        {!health.ok ? (
          <p className="integration-note">La vérification en direct est indisponible. Aucun statut positif n’est supposé.</p>
        ) : (
          <ul className="integrations-grid">
            <li className="dashboard-card integration-card">
              <div className="dashboard-card-header"><div><span className="panel-eyebrow">BASE</span><h3>Supabase</h3></div><span className="integration-status">{health.supabase.status}</span></div>
              <p className="integration-note">Preuve : la lecture RPC et la base répondent pendant le rendu de cette page.</p>
            </li>
            <li className="dashboard-card integration-card">
              <div className="dashboard-card-header"><div><span className="panel-eyebrow">PROSPECTION</span><h3>Hermès Business</h3></div><span className="integration-status">{health.hermesBusiness.status}</span></div>
              <p className="integration-note">{health.hermesBusiness.eventsLast24h} événements d’automatisation vérifiés sur les dernières 24 h. Dernière activité : {health.hermesBusiness.lastSeenAt ?? "aucune"}.</p>
            </li>
            <li className="dashboard-card integration-card">
              <div className="dashboard-card-header"><div><span className="panel-eyebrow">AUTOMATISATION</span><h3>n8n</h3></div><span className="integration-status">{health.n8n.status}</span></div>
              <p className="integration-note">
                {health.n8n.lastSeenAt
                  ? `Heartbeat PostgreSQL direct : ${health.n8n.lastSeenAt}${health.n8n.dbRole ? ` · rôle ${health.n8n.dbRole}` : ""}.`
                  : "Aucun heartbeat n8n vérifié : l’écran ne suppose pas que le moteur tourne."}
              </p>
            </li>
          </ul>
        )}
      </section>

      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div><span className="panel-eyebrow">COMPTES EXTERNES</span><h3>Connexions sécurisées</h3></div>
        </div>
        <p className="integration-note">Un fournisseur n’est affiché « connecté » que si la base confirme la connexion. Les secrets OAuth sont chiffrés dans Vault et ne sont jamais renvoyés au navigateur.</p>

        {health.ok ? (
          <div className="dashboard-card integration-card">
            <div className="dashboard-card-header">
              <div><span className="panel-eyebrow">AGENDA EXTERNE</span><h3>Google Agenda</h3></div>
              <span className="integration-status">{health.googleCalendar.provisioned ? health.googleCalendar.status : "NON PROVISIONNÉ"}</span>
            </div>
            <p className="integration-note">
              {health.googleCalendar.provisioned
                ? "Le connecteur OAuth Google est provisionné. Son état ci-dessus vient de la connexion réelle du tenant."
                : "Le dashboard utilise son agenda PV interne réel. La synchronisation Google reste désactivée tant qu’un client OAuth Google n’est pas provisionné."}
            </p>
            {health.googleCalendar.lastErrorCode ? <p className="integration-note">Dernière erreur : {health.googleCalendar.lastErrorCode}</p> : null}
          </div>
        ) : null}

        {resolutionStatus !== "OK" ? (
          <p className="integration-note">La liste des comptes connectables est momentanément indisponible.</p>
        ) : integrations.length === 0 ? (
          <p className="integration-note">Aucun fournisseur n’est actuellement disponible pour cette verticale.</p>
        ) : (
          <ul className="integrations-grid">
            {integrations.map((item) => (
              <li className="dashboard-card integration-card" key={item.provider}>
                <div className="dashboard-card-header">
                  <div><span className="panel-eyebrow">MON COMPTE</span><h3>{item.label}</h3></div>
                  <span className="integration-status">{item.provisioned ? (LABEL[item.status] ?? item.status) : "NON PROVISIONNÉ"}</span>
                </div>
                {item.accountLabel ? <p className="integration-role">{item.accountLabel}</p> : null}

                {item.provider === "qonto" && !item.provisioned ? (
                  <form action={configureQontoCredentialsAction} className="agent-action-form">
                    <p className="integration-note">Configure une fois l’application OAuth Qonto. Le secret est envoyé au serveur puis stocké chiffré dans Supabase Vault.</p>
                    <label className="agent-field">
                      <span>Qonto Client ID</span>
                      <input name="client_id" autoComplete="off" minLength={3} maxLength={300} required />
                    </label>
                    <label className="agent-field">
                      <span>Qonto Client Secret</span>
                      <input name="client_secret" type="password" autoComplete="new-password" minLength={8} maxLength={1000} required />
                    </label>
                    <button className="card-secondary-button" type="submit">Enregistrer dans Vault</button>
                  </form>
                ) : isProviderImplemented(item.provider) ? (
                  item.status === "CONNECTED" ? (
                    <form action={`/api/integrations/${item.provider}/disconnect`} method="post">
                      <button className="card-secondary-button" type="submit">Déconnecter</button>
                    </form>
                  ) : item.provisioned ? (
                    <a className="card-secondary-button" href={`/api/integrations/${item.provider}/start`}>Connecter</a>
                  ) : (
                    <p className="integration-note">Le fournisseur doit d’abord être provisionné.</p>
                  )
                ) : <p className="integration-note">Connecteur non implémenté : aucune action n’est proposée.</p>}

                {item.lastErrorCode ? <p className="integration-note">Dernière erreur : {item.lastErrorCode}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="page-foot-note">Aucun statut décoratif : chaque état positif est issu d’une lecture réelle, sinon l’écran affiche explicitement l’absence de preuve.</p>
    </div>
  );
}
