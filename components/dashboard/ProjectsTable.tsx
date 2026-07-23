"use client";

import {
  ArrowUpRight,
  Building2,
  ChevronRight,
  CircleDollarSign,
  MapPin,
  MoreHorizontal,
  PanelsTopLeft,
} from "lucide-react";

const projects = [
  {
    name: "Toulouse — Centrale photovoltaïque",
    location: "Toulouse",
    power: "126 kWc",
    value: "148 000 €",
    progress: 82,
    status: "Installation",
    tone: "active",
  },
  {
    name: "SOCOMAC — Site industriel",
    location: "Ytrac",
    power: "151,6 kWc",
    value: "176 500 €",
    progress: 64,
    status: "Préparation",
    tone: "planning",
  },
  {
    name: "Fermelec — Bâtiment professionnel",
    location: "Marseille",
    power: "49,14 kWc",
    value: "51 000 €",
    progress: 38,
    status: "Étude",
    tone: "study",
  },
  {
    name: "Jean Dépôt — Toiture commerciale",
    location: "Aubagne",
    power: "67 kWc",
    value: "75 000 €",
    progress: 100,
    status: "Terminé",
    tone: "done",
  },
];

export default function ProjectsTable() {
  return (
    <section className="dashboard-card projects-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PORTEFEUILLE</span>
          <h3>Projets actifs</h3>
        </div>

        <div className="projects-header-actions">
          <button type="button" className="card-secondary-button">
            <PanelsTopLeft size={16} strokeWidth={1.8} />
            <span>Vue projets</span>
          </button>

          <button
            type="button"
            className="card-icon-button"
            aria-label="Options des projets"
          >
            <MoreHorizontal size={19} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="projects-overview">
        <div className="projects-overview-item">
          <Building2 size={18} strokeWidth={1.8} />
          <div>
            <span>Projets suivis</span>
            <strong>18</strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <CircleDollarSign size={18} strokeWidth={1.8} />
          <div>
            <span>Valeur totale</span>
            <strong>1,26 M€</strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <ArrowUpRight size={18} strokeWidth={1.8} />
          <div>
            <span>Pipeline mensuel</span>
            <strong>+24 %</strong>
          </div>
        </div>
      </div>

      <div className="projects-table-wrapper">
        <table className="projects-table">
          <thead>
            <tr>
              <th>Projet</th>
              <th>Puissance</th>
              <th>Valeur</th>
              <th>Avancement</th>
              <th>Statut</th>
              <th aria-label="Action" />
            </tr>
          </thead>

          <tbody>
            {projects.map((project) => (
              <tr key={project.name}>
                <td>
                  <div className="project-name-cell">
                    <span className="project-icon">
                      <Building2 size={18} strokeWidth={1.8} />
                    </span>

                    <div>
                      <strong>{project.name}</strong>
                      <span>
                        <MapPin size={13} strokeWidth={1.8} />
                        {project.location}
                      </span>
                    </div>
                  </div>
                </td>

                <td>{project.power}</td>
                <td>{project.value}</td>

                <td>
                  <div className="project-progress-cell">
                    <div className="project-progress-track">
                      <span style={{ width: `${project.progress}%` }} />
                    </div>
                    <strong>{project.progress}%</strong>
                  </div>
                </td>

                <td>
                  <span className={`project-status is-${project.tone}`}>
                    {project.status}
                  </span>
                </td>

                <td>
                  <button
                    type="button"
                    className="project-row-button"
                    aria-label={`Ouvrir ${project.name}`}
                  >
                    <ChevronRight size={16} strokeWidth={1.8} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
