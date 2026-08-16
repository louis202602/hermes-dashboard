"use client";

import { Building2, CircleDollarSign, LayoutList, MapPin } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type {
  DashboardProjects,
  ServiceResult,
} from "@/types/hermes";

type ProjectsTableProps = {
  projects: ServiceResult<DashboardProjects>;
};

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function statusTone(status: string | null): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("TERMIN") || s.includes("DONE") || s.includes("CLOS")) return "done";
  if (s.includes("QUALIF") || s.includes("ETUDE") || s.includes("DRAFT")) return "study";
  if (s.includes("PLAN") || s.includes("PREPAR")) return "planning";
  return "active";
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card projects-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("proj.eyebrow")}</span>
          <h3>{t("proj.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ProjectsTable({ projects }: ProjectsTableProps) {
  const { t } = useI18n();

  if (!projects.ok) {
    return (
      <Frame>
        <p className="projects-empty">{t("proj.unavailable")}</p>
      </Frame>
    );
  }

  const { resolutionStatus, projects: rows, aggregates } = projects.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="projects-empty">
          {t(`proj.resolution.${resolutionStatus}` as MessageKey)}
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="projects-overview">
        <div className="projects-overview-item">
          <Building2 size={18} strokeWidth={1.8} />
          <div>
            <span>{t("proj.trackedProjects")}</span>
            <strong>{aggregates.totalProjects}</strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <CircleDollarSign size={18} strokeWidth={1.8} />
          <div>
            <span>{t("proj.totalEstimatedValue")}</span>
            <strong>
              {aggregates.totalEstimatedValueEur === null
                ? t("common.none")
                : eur.format(aggregates.totalEstimatedValueEur)}
            </strong>
          </div>
        </div>

        <div className="projects-overview-item">
          <LayoutList size={18} strokeWidth={1.8} />
          <div>
            <span>{t("proj.distinctStatuses")}</span>
            <strong>{Object.keys(aggregates.byStatus).length}</strong>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="projects-empty">{t("proj.noProjects")}</p>
      ) : (
        <div className="projects-table-wrapper">
          <table className="projects-table">
            <thead>
              <tr>
                <th>{t("proj.colProject")}</th>
                <th>{t("proj.colClient")}</th>
                <th>{t("proj.colEstimatedCost")}</th>
                <th>{t("proj.colProgress")}</th>
                <th>{t("proj.colStatus")}</th>
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
                          <strong>{project.chantierName ?? t("proj.unnamed")}</strong>
                          <span>
                            <MapPin size={13} strokeWidth={1.8} />
                            {project.typeChantier ?? t("common.none")}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>{project.clientName ?? t("common.none")}</td>
                    <td>
                      {project.coutEstimeEur === null
                        ? t("common.none")
                        : eur.format(project.coutEstimeEur)}
                    </td>

                    <td>
                      {progress === null ? (
                        t("common.none")
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
                        {project.status ?? t("common.none")}
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
