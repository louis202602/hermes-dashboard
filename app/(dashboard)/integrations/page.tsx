import PageHeading from "@/components/dashboard/PageHeading";
import { requireAuthedUser } from "@/lib/dashboard/requestScope";
import { isProviderImplemented } from "@/lib/integrations/connectionState";
import { getTenantIntegrations } from "@/services/hermes/integrations";
import type { IntegrationStatus } from "@/types/integrations";

export const metadata = { title: "Intégrations — Hermès OS" };

/** Libellés d'état des comptes de l'utilisatrice. */
const CONNECTION_LABEL: Record<IntegrationStatus, string> = {
  NOT_CONNECTED: "Non connecté",
  CONNECTING: "Connexion en cours",
  CONNECTED: "Connecté",
  ERROR: "Erreur",
  REAUTH_REQUIRED: "Reconnexion requise",
  REVOKED: "Révoqué",
};

/** Ce que l'état implique concrètement — dit honnêtement, sans jargon. */
const CONNECTION_HINT: Record<IntegrationStatus, string> = {
  NOT_CONNECTED:
    "Non connecté. Le standard répond et qualifie quand même, mais n’annonce aucune disponibilité.",
  CONNECTING: "Connexion en cours chez le fournisseur.",
  CONNECTED: "Connecté. Vous pouvez révoquer l’accès à tout moment.",
  ERROR: "La dernière tentative a échoué. Vous pouvez réessayer.",
  REAUTH_REQUIRED: "L’autorisation a expiré : une reconnexion est nécessaire.",
  REVOKED: "Accès révoqué. Aucune donnée n’est lue.",
};

// Only integrations that REALLY exist in Hermès today. No invented connections. Where a
// live status would require a dedicated read we don't have (COST-FIRST: 0 new RPC), the
// status is stated honestly as "À venir" rather than a fake "Connecté" badge. The two core
// dependencies (orchestrateur, base de données) are structurally active — the app cannot
// run without them — so "Actif (cœur)" is a true statement, not a fabricated one.
type CoreStatus = "core" | "conditional" | "soon";

const INTEGRATIONS: {
  name: string;
  role: string;
  status: CoreStatus;
  note: string;
}[] = [
  {
    name: "Hermès — Orchestrateur & Gateway",
    role: "Exécution sécurisée des actions (orchestrateur → gateway → permissions → SW15)",
    status: "core",
    note: "Noyau d'Hermès. Toujours actif — c'est le chemin de toute action.",
  },
  {
    name: "Supabase",
    role: "Base de données Postgres, authentification et stockage",
    status: "core",
    note: "Dépendance structurelle : données, auth et fichiers.",
  },
  {
    name: "n8n",
    role: "Moteur d'automatisation / workflows (consommateurs d'actions)",
    status: "soon",
    note: "Configuré via le gateway. Supervision d'exécution détaillée : à venir.",
  },
  {
    name: "Résolveur IA",
    role: "Traitement des messages Hermès et proposition d'actions",
    status: "conditional",
    note: "État en direct (activé, circuit, file) dans « Agents ».",
  },
  {
    name: "Open-Meteo",
    role: "Météo de la barre de contexte et des chantiers",
    status: "conditional",
    note: "Active uniquement lorsqu'une localisation est configurée (mise en cache).",
  },
];

const STATUS_LABEL: Record<CoreStatus, string> = {
  core: "Actif (cœur)",
  conditional: "Selon configuration",
  soon: "Supervision à venir",
};

/**
 * /integrations — deux sections, deux natures très différentes :
 *
 *   1. MES OUTILS — les comptes qui appartiennent à l'utilisatrice (agenda,
 *      messagerie, réseaux). Elle les connecte ELLE-MÊME par OAuth : Hermès ne
 *      lui demande jamais son mot de passe et n'en stocke aucun.
 *   2. NOYAU HERMÈS — l'infrastructure fournie par Hermès (orchestrateur, base,
 *      n8n, téléphonie). Rien à connecter : c'est notre part du contrat.
 *
 * La liste des outils vient d'une lecture RÉELLE (`get_tenant_integrations`),
 * bornée au tenant appelant. Aucun jeton ne transite : la façade n'en renvoie
 * pas, et les types n'en portent pas.
 */
export default async function IntegrationsPage() {
  await requireAuthedUser();
  const { integrations, resolutionStatus } = await getTenantIntegrations();

  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.integrations" />

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">MES OUTILS</span>
            <h3>Connecter mes comptes</h3>
          </div>
        </div>
        <p className="integration-note">
          Vous vous connectez directement chez le fournisseur. Hermès ne voit jamais
          votre mot de passe et reçoit uniquement l’autorisation que vous accordez —
          révocable à tout moment.
        </p>
        {resolutionStatus !== "OK" ? (
          <p className="integration-note">
            État des connexions indisponible pour le moment.
          </p>
        ) : integrations.length === 0 ? (
          <p className="integration-note">
            Aucun outil n’est encore proposé à la connexion pour votre compte.
          </p>
        ) : (
          <ul className="integrations-grid">
            {integrations.map((it) => (
              <li className="dashboard-card integration-card" key={it.provider}>
                <div className="dashboard-card-header">
                  <div>
                    <span className="panel-eyebrow">Mon compte</span>
                    <h3>{it.label}</h3>
                  </div>
                  <span className="integration-status">
                    {CONNECTION_LABEL[it.status] ?? it.status}
                  </span>
                </div>
                {it.accountLabel ? (
                  <p className="integration-role">{it.accountLabel}</p>
                ) : null}
                <p className="integration-note">
                  {isProviderImplemented(it.provider)
                    ? CONNECTION_HINT[it.status]
                    : "Prévu — pas encore disponible à la connexion."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">NOYAU HERMÈS</span>
            <h3>Fourni par Hermès</h3>
          </div>
        </div>
        <p className="integration-note">
          Rien à connecter ici : ces briques sont opérées par Hermès. Vous n’avez ni
          compte à créer, ni clé à saisir.
        </p>
        <ul className="integrations-grid">
          {INTEGRATIONS.map((it) => (
            <li className="dashboard-card integration-card" key={it.name}>
              <div className="dashboard-card-header">
                <div>
                  <span className="panel-eyebrow">Intégration</span>
                  <h3>{it.name}</h3>
                </div>
                <span className={`integration-status is-${it.status}`}>
                  {STATUS_LABEL[it.status]}
                </span>
              </div>
              <p className="integration-role">{it.role}</p>
              <p className="integration-note">{it.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="page-foot-note">
        {"Aucune connexion n'est inventée : un outil non connecté est affiché comme tel, jamais avec un faux état « connecté »."}
      </p>
    </div>
  );
}
