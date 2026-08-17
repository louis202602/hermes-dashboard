import AgentActivityPanel from "@/components/dashboard/AgentActivityPanel";
import PageHeading from "@/components/dashboard/PageHeading";
import ResolverStatus from "@/components/dashboard/ResolverStatus";
import SystemHealthPanel from "@/components/dashboard/SystemHealthPanel";
import SystemStatus from "@/components/dashboard/SystemStatus";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import {
  getCostGovernanceSnapshot,
  getObservabilitySnapshot,
  getPlatformHealth,
  getResolverObservability,
} from "@/services/hermes/panels";
import { getPublicKpis } from "@/services/hermes/dashboard";
import { getAgentActionStats } from "@/services/hermes/systemActivity";

export const metadata = { title: "Agents — Hermès OS" };

/**
 * /agents — l'état des agents & modules qui quitte la Home : état global Hermès (complet),
 * activité des agents, observabilité et état du résolveur. Panneaux réutilisés tels quels.
 */
export default async function AgentsPage() {
  const ctx = await resolvePageContext();
  const [kpis, observability, platformHealth, actionStats, resolver, cost] =
    await Promise.all([
      getPublicKpis(),
      getObservabilitySnapshot(),
      getPlatformHealth(),
      getAgentActionStats(),
      getResolverObservability(),
      getCostGovernanceSnapshot(),
    ]);

  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.agents" />
      <SystemHealthPanel
        kpis={kpis}
        observability={observability}
        platformHealth={platformHealth}
        actionStats={actionStats}
        resolver={resolver}
        cost={cost}
        locale={ctx.locale}
        timezone={ctx.timezone}
        hour12={ctx.hour12}
      />
      <div className="exec-grid-2">
        <AgentActivityPanel
          observability={observability}
          timezone={ctx.timezone}
          locale={ctx.locale}
          hour12={ctx.hour12}
        />
        <ResolverStatus resolver={resolver} />
      </div>
      <SystemStatus observability={observability} />
    </div>
  );
}
