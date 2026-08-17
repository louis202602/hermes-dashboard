import PageHeading from "@/components/dashboard/PageHeading";

export const metadata = { title: "Aide & Support — Hermès OS" };

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "Naviguer dans Hermès",
    body: "Le Command Center est la synthèse : état global, KPI, alertes critiques et actions rapides. Les menus de gauche ouvrent le détail — Chat, Activité, Entreprise, Agents, Approbations, Sécurité, Intégrations, Notifications et Facturation.",
  },
  {
    title: "Profils & personnalisation",
    body: "Le sélecteur de profil (en haut) recompose instantanément le fond d'écran et l'apparence selon le mode choisi (Direction, Chantiers, Commerce, Personnalisé). La configuration détaillée des widgets, de l'ordre, des tailles et du fond d'écran se fait dans Paramètres.",
  },
  {
    title: "Demander à Hermès",
    body: "Depuis le Chat (ou la zone « Demander à Hermès » de la Home), formulez une demande en langage naturel. Hermès propose une action ; l'exécution passe toujours par le canal sécurisé orchestrateur → gateway → permissions.",
  },
  {
    title: "Sécurité & approbations",
    body: "Les actions sensibles requièrent une approbation explicite. Retrouvez-les dans Approbations (approuver / rejeter, avec suivi de reprise). Le contrôle du résolveur et le journal d'audit sont dans Sécurité & Autonomie, selon vos droits.",
  },
  {
    title: "Coûts & gouvernance",
    body: "Facturation & Coûts IA affiche l'exposition du jour et du mois, le budget restant et les quotas — à partir des mesures réelles, sans donnée artificielle.",
  },
  {
    title: "Support",
    body: "Pour toute assistance, contactez votre administrateur Hermès OS. Cette page évoluera avec des ressources d'aide supplémentaires.",
  },
];

/**
 * /aide — page d'aide simple et statique (aucun backend). Contenu en français (langue par
 * défaut de l'application) ; l'internationalisation complète de l'aide suivra.
 */
export default function HelpPage() {
  return (
    <div className="page-stack">
      <PageHeading titleKey="sidebar.help" />
      <div className="help-grid">
        {SECTIONS.map((s) => (
          <section className="dashboard-card help-card" key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
