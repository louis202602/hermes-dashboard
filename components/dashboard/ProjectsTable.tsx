import { Building2, CircleDollarSign, LayoutList, MapPin } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  DashboardProjects,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

type ProjectsTableProps = {
  projects: ServiceResult<DashboardProjects>;
};

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const RESOLUTION_MESSAGES: Record<TenantResolutionStatus, string> = {
  OK: "",
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucun tenant n’est associé à votre compte.",
  ACCESS_DENIED: "Accès refusé pour le tenant demandé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION:
    "Plusieurs tenants disponibles : sélection requise.",
};

function statusTone(status: string | null): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("TERMIN") || s.includes("DONE") || s.includes("CLOS")) return "done";
  if (s.includes("QUALIF") || s.includes("ETUDE") || s.includes("DRAFT")) return "study";
  if (s.includes("PLAN") || s.includes("PREPAR")) return "planning";
  return "active";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card projects-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PORTEFEUILLE</span>
          <h3>Projets (production)</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ProjectsTable({ projects }: ProjectsTableProps) {
  if (!projects.ok) {
    return (
      <Frame>
        <p className="projects-empty">
          Le portefeuille projets est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { resolutionStatus, projects: rows, aggregates } = projects.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="projects-empty">{RESOLUTION_MESSAGES[resolutionStatus]}</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="projects-overview">
        <div className="projects-overview-item">
          <Building2 size={18} strokeWidth={1.8} />
          <div>
            <span>Projets suivis</span>
            <strong>{aggregates.totalProjects}</strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <CircleDollarSign size={18} strokeWidth={1.8} />
          <div>
            <span>Valeur estimée totale</span>
            <strong>
              {aggregates.totalEstimatedValueEur === null
                ? "—"
                : eur.format(aggregates.totalEstimatedValueEur)}
            </strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <LayoutList size={18} strokeWidth={1.8} />
          <div>
            <span>Statuts distincts</span>
            <strong>{Object.keys(aggregates.byStatus).length}</strong>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="projects-empty">
          Aucun projet en environnement de production pour ce tenant.
        </p>
      ) : (
        <div className="projects-table-wrapper">
          <table className="projects-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Client</th>
                <th>Coût estimé</th>
                <th>Avancement</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((project) => {
                const progress =
                  project.progressionPct === null
                    ? null
                    : Math.max(0, Math.min(100, Math.round(project.progressionPct)));

                return (
                  <tr key={project.id}>
                    <td>
                      <div className="project-name-cell">
                        <span className="project-icon">
                          <Building2 size={18} strokeWidth={1.8} />
                        </span>
                        <div>
                          <strong>{project.chantierName ?? "Sans nom"}</strong>
                          <span>
                            <MapPin size={13} strokeWidth={1.8} />
                            {project.typeChantier ?? "—"}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>{project.clientName ?? "—"}</td>
                    <td>
                      {project.coutEstimeEur === null
                        ? "—"
                        : eur.format(project.coutEstimeEur)}
                    </td>

                    <td>
                      {progress === null ? (
                        "—"
                      ) : (
                        <div className="project-progress-cell">
                          <div className="project-progress-track">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <strong>{progress}%</strong>
                        </div>
                      )}
                    </td>

                    <td>
                      <span className={`project-status is-${statusTone(project.status)}`}>
                        {project.status ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  );
}
