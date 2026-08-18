import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
import PageHeading from "@/components/dashboard/PageHeading";
import TasksPanel from "@/components/dashboard/TasksPanel";
import { getOperationalPriorities } from "@/services/hermes/panels";

export const metadata = { title: "Approbations — Hermès OS" };

/**
 * /approbations — le panneau d'approbations COMPLET (approuver / rejeter + suivi de
 * reprise), qui quitte la Home (où seul un compteur compact reste). ApprovalsPanel se
 * charge lui-même (event-driven, 0 polling). Les priorités opérationnelles donnent le
 * contexte « à traiter ».
 */
export default async function ApprovalsPage() {
  const priorities = await getOperationalPriorities();
  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.approvals" />
      <ApprovalsPanel />
      <TasksPanel priorities={priorities} />
    </div>
  );
}
