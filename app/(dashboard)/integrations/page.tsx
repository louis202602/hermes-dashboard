import PageHeading from "@/components/dashboard/PageHeading";

export const metadata = { title: "Intégrations — Hermès OS" };

// Only integrations that REALLY exist in Hermès today. No invented connections. Where a
// live status would require a dedicated read we don't have (COST-FIRST: 0 new RPC), the
// status is stated honestly as "À venir" rather than a fake "Connecté" badge. The two core
// dependencies (orchestrateur, base de données) are structurally active — the app cannot
// run without them — so "Actif (cœur)" is a true statement, not a fabricated one.
type IntegrationStatus = "core" | "conditional" | "soon";

const INTEGRATIONS: {
  name: string;
  role: string;
  status: IntegrationStatus;
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

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  core: "Actif (cœur)",
  conditional: "Selon configuration",
  soon: "Supervision à venir",
};

/**
 * /integrations — catalogue propre des intégrations réellement connues d'Hermès, avec un
 * état explicite et honnête (jamais une connexion inventée). Page statique : 0 nouveau
 * service, 0 RPC.
 */
export default function IntegrationsPage() {
  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.integrations" />
      <div className="integrations-grid">
        {INTEGRATIONS.map((it) => (
          <section className="dashboard-card integration-card" key={it.name}>
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
          </section>
        ))}
      </div>
      <p className="page-foot-note">
        {"Aucune connexion n'est inventée : les intégrations non encore supervisées affichent « à venir » plutôt qu'un faux état « connecté »."}
      </p>
    </div>
  );
}
