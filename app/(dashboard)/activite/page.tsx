import AgendaPanel from "@/components/dashboard/AgendaPanel";
import AgentActivityPanel from "@/components/dashboard/AgentActivityPanel";
import AlertsPanel from "@/components/dashboard/AlertsPanel";
import DailySummaryPanel from "@/components/dashboard/DailySummaryPanel";
import PageHeading from "@/components/dashboard/PageHeading";
import RecentConversations from "@/components/dashboard/RecentConversations";
import RecommendedActionsPanel from "@/components/dashboard/RecommendedActionsPanel";
import TasksPanel from "@/components/dashboard/TasksPanel";
import { buildDailySummary } from "@/lib/dashboard/dailySummary";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { buildRecommendedActions } from "@/lib/dashboard/recommendedActions";
import { getUnifiedAlertsCached } from "@/lib/dashboard/requestScope";
import { getDashboardAgenda } from "@/services/hermes/agenda";
import { getRecentConversations } from "@/services/hermes/conversations";
import { getDashboardProjects } from "@/services/hermes/dashboard";
import {
  getCostGovernanceSnapshot,
  getObservabilitySnapshot,
  getOperationalPriorities,
} from "@/services/hermes/panels";
import { getDashboardCommercial } from "@/services/hermes/systemActivity";
import { getWorksiteWeather } from "@/services/hermes/worksiteWeather";
import type { ServiceResult } from "@/types/hermes";

export const metadata = { title: "Activité — Hermès OS" };

const unwrap = <T,>(r: ServiceResult<T>): T | null => (r.ok ? r.data : null);

/**
 * /activite — le détail « activité » qui quitte la Home : résumé du jour + actions
 * recommandées (synthèses déterministes, 0 LLM), activité des agents, tâches, alertes,
 * agenda et conversations récentes. Tous les panneaux réutilisés, chacun lisant un
 * snapshot déjà chargé (0 lecture DB en plus au-delà des services).
 */
export default async function ActivityPage() {
  const ctx = await resolvePageContext();
  const [
    agenda,
    priorities,
    projects,
    alerts,
    commercial,
    observability,
    cost,
    conversations,
    worksiteWeather,
  ] = await Promise.all([
    getDashboardAgenda(),
    getOperationalPriorities(),
    getDashboardProjects(),
    getUnifiedAlertsCached(),
    getDashboardCommercial(),
    getObservabilitySnapshot(),
    getCostGovernanceSnapshot(),
    getRecentConversations(),
    getWorksiteWeather(),
  ]);

  const dailySummary = buildDailySummary({
    agenda: unwrap(agenda),
    priorities: unwrap(priorities),
    projects: unwrap(projects),
    alerts: unwrap(alerts),
    commercial: unwrap(commercial),
    worksiteWeather,
    locale: ctx.locale,
  });
  const recommendedActions = buildRecommendedActions({
    agenda: unwrap(agenda),
    priorities: unwrap(priorities),
    alerts: unwrap(alerts),
    cost: unwrap(cost),
    commercial: unwrap(commercial),
    worksiteWeather,
  });

  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.activity" />
      <div className="exec-grid-2">
        <DailySummaryPanel summary={dailySummary} />
        <RecommendedActionsPanel actions={recommendedActions} visibleWidgetIds={[]} />
      </div>
      <div className="exec-grid-2">
        <TasksPanel priorities={priorities} />
        <AlertsPanel alerts={alerts} />
      </div>
      <div className="exec-grid-2">
        <AgendaPanel agenda={agenda} locale={ctx.locale} />
        <AgentActivityPanel
          observability={observability}
          timezone={ctx.timezone}
          locale={ctx.locale}
          hour12={ctx.hour12}
        />
      </div>
      <RecentConversations conversations={conversations} />
    </div>
  );
}
