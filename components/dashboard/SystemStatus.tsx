"use client";

import {
  Activity,
  Bot,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";

const services = [
  {
    name: "Hermès Core",
    detail: "Orchestration centrale",
    value: "99,99 %",
    status: "Opérationnel",
    icon: Bot,
  },
  {
    name: "n8n Cloud",
    detail: "Automatisations",
    value: "112 actifs",
    status: "Stable",
    icon: Workflow,
  },
  {
    name: "Supabase",
    detail: "Données et authentification",
    value: "24 ms",
    status: "Disponible",
    icon: Database,
  },
  {
    name: "Vercel",
    detail: "Application et déploiement",
    value: "Déployé",
    status: "En ligne",
    icon: Cloud,
  },
  {
    name: "Infrastructure",
    detail: "Services critiques",
    value: "7 / 7",
    status: "Nominal",
    icon: Server,
  },
];

export default function SystemStatus() {
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">INFRASTRUCTURE</span>
          <h3>État du système</h3>
        </div>

        <div className="system-health-badge">
          <span className="status-pulse" />
          <span>Tous les services sont opérationnels</span>
        </div>
      </div>

      <div className="system-score-panel">
        <div className="system-score-icon">
          <Gauge size={24} strokeWidth={1.8} />
        </div>

        <div className="system-score-copy">
          <span>Score global</span>
          <strong>99,8 / 100</strong>
        </div>

        <div className="system-score-meta">
          <ShieldCheck size={17} strokeWidth={1.8} />
          <span>Sécurité renforcée</span>
        </div>
      </div>

      <div className="system-services-list">
        {services.map((service) => {
          const Icon = service.icon;

          return (
            <div className="system-service-item" key={service.name}>
              <span className="system-service-icon">
                <Icon size={18} strokeWidth={1.8} />
              </span>

              <div className="system-service-copy">
                <strong>{service.name}</strong>
                <span>{service.detail}</span>
              </div>

              <div className="system-service-value">
                <strong>{service.value}</strong>
                <span>{service.status}</span>
              </div>

              <CheckCircle2
                className="system-service-check"
                size={18}
                strokeWidth={1.8}
              />
            </div>
          );
        })}
      </div>

      <div className="system-footer">
        <div>
          <Activity size={17} strokeWidth={1.8} />
          <span>Dernière vérification il y a 2 minutes</span>
        </div>

        <button type="button">Voir le monitoring complet</button>
      </div>
    </section>
  );
}
