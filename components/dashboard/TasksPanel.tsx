"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ListChecks,
} from "lucide-react";

const tasks = [
  {
    title: "Valider les nouvelles opportunités commerciales",
    meta: "5 prospects à qualifier",
    priority: "Haute",
    status: "urgent",
  },
  {
    title: "Contrôler les workflows critiques SW1 → SW6",
    meta: "Dernier contrôle il y a 24 min",
    priority: "Critique",
    status: "critical",
  },
  {
    title: "Préparer le rapport hebdomadaire HelioSolar",
    meta: "Échéance aujourd’hui à 18:00",
    priority: "Moyenne",
    status: "normal",
  },
  {
    title: "Vérifier les documents du chantier Toulouse",
    meta: "3 fichiers à examiner",
    priority: "Moyenne",
    status: "normal",
  },
];

export default function TasksPanel() {
  return (
    <section className="dashboard-card tasks-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PRIORITÉS</span>
          <h3>Tâches en cours</h3>
        </div>

        <button type="button" className="card-icon-button" aria-label="Voir toutes les tâches">
          <ListChecks size={18} strokeWidth={1.8} />
        </button>
      </div>

      <div className="tasks-summary">
        <div>
          <strong>8</strong>
          <span>à traiter</span>
        </div>

        <div>
          <strong>3</strong>
          <span>urgentes</span>
        </div>

        <div>
          <strong>12</strong>
          <span>terminées</span>
        </div>
      </div>

      <div className="tasks-list">
        {tasks.map((task) => (
          <button type="button" className="task-item" key={task.title}>
            <span className={`task-status-icon is-${task.status}`}>
              {task.status === "critical" ? (
                <AlertTriangle size={17} strokeWidth={1.9} />
              ) : task.status === "urgent" ? (
                <Clock3 size={17} strokeWidth={1.9} />
              ) : (
                <Circle size={16} strokeWidth={1.8} />
              )}
            </span>

            <span className="task-copy">
              <strong>{task.title}</strong>
              <span>{task.meta}</span>
            </span>

            <span className={`task-priority is-${task.status}`}>
              {task.priority}
            </span>

            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      <button type="button" className="tasks-footer-button">
        <CheckCircle2 size={17} strokeWidth={1.8} />
        <span>Afficher toutes les tâches</span>
      </button>
    </section>
  );
}
