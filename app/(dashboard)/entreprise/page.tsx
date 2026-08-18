import AgendaPanel from "@/components/dashboard/AgendaPanel";
import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import ChantierMapWidget from "@/components/dashboard/ChantierMapWidget";
import CommercialPanel from "@/components/dashboard/CommercialPanel";
import KpiGrid from "@/components/dashboard/KpiGrid";
import PageHeading from "@/components/dashboard/PageHeading";
import ProjectsTable from "@/components/dashboard/ProjectsTable";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { getDashboardAgenda } from "@/services/hermes/agenda";
import { getDashboardProjects, getPublicKpis } from "@/services/hermes/dashboard";
import { getDashboardCommercial } from "@/services/hermes/systemActivity";

export const metadata = { title: "Entreprise — Hermès OS" };

/**
 * /entreprise — la vue métier détaillée : commercial, portefeuille projets, agenda, carte
 * des chantiers, KPI détaillés. CAPABILITY-FIRST : les sections BTP (projets, carte des
 * chantiers) ne s'affichent QUE si le tenant a la capacité `btp.*` — via le même
 * `availableWidgetIds` canonical que la Home. Un tenant hors-métier ne voit pas ces blocs.
 */
export default async function EnterprisePage() {
  const ctx = await resolvePageContext();
  const showProjects = ctx.available.has("projects");
  const showMap = ctx.available.has("chantiers-map");

  const [commercial, projects, agenda, kpis] = await Promise.all([
    getDashboardCommercial(),
    showProjects ? getDashboardProjects() : Promise.resolve(null),
    getDashboardAgenda(),
    getPublicKpis(),
  ]);

  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.company" />
      <KpiGrid kpis={kpis} />
      <CommercialPanel commercial={commercial} locale={ctx.locale} />
      {showProjects && projects ? (
        <div className="exec-grid-metier">
          <ProjectsTable projects={projects} />
          <AgentActionPanel />
        </div>
      ) : null}
      <AgendaPanel agenda={agenda} locale={ctx.locale} />
      {showMap ? <ChantierMapWidget /> : null}
    </div>
  );
}
