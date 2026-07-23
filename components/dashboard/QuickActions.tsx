"use client";

import {
  Bot,
  FileSearch,
  MailPlus,
  Plus,
  Rocket,
  ScanSearch,
  Workflow,
} from "lucide-react";

const actions = [
  {
    title: "Créer un agent",
    description: "Ajouter un nouvel agent spécialisé à Hermès OS.",
    icon: Bot,
  },
  {
    title: "Lancer un workflow",
    description: "Exécuter rapidement une automatisation n8n.",
    icon: Workflow,
  },
  {
    title: "Analyser un prospect",
    description: "Qualifier un nouveau dossier commercial.",
    icon: ScanSearch,
  },
  {
    title: "Préparer un message",
    description: "Générer un email ou une relance personnalisée.",
    icon: MailPlus,
  },
  {
    title: "Examiner un document",
    description: "Analyser un devis, une facture ou une étude.",
    icon: FileSearch,
  },
  {
    title: "Démarrer une mission",
    description: "Confier une opération complète à Hermès.",
    icon: Rocket,
  },
];

export default function QuickActions() {
  return (
    <section className="dashboard-card quick-actions-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">EXÉCUTION</span>
          <h3>Actions rapides</h3>
        </div>

        <button type="button" className="card-secondary-button">
          <Plus size={16} strokeWidth={1.9} />
          <span>Nouvelle action</span>
        </button>
      </div>

      <div className="quick-actions-grid">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button type="button" className="quick-action-item" key={action.title}>
              <span className="quick-action-icon">
                <Icon size={19} strokeWidth={1.8} />
              </span>

              <span className="quick-action-copy">
                <strong>{action.title}</strong>
                <span>{action.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
