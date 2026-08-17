"use client";

import AlertsPanel from "@/components/dashboard/AlertsPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
import ContextBar from "@/components/dashboard/ContextBar";
import HermesPanel from "@/components/dashboard/HermesPanel";
import KpiGrid from "@/components/dashboard/KpiGrid";
import QuickActions from "@/components/dashboard/QuickActions";
import SystemHealthPanel from "@/components/dashboard/SystemHealthPanel";
import TasksPanel from "@/components/dashboard/TasksPanel";
import TenantBadge from "@/components/dashboard/TenantBadge";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
import type { UnifiedAlerts } from "@/lib/dashboard/agenda";
import type {
  AgentActionStats,
} from "@/lib/dashboard/systemActivity";
import type { ResolverObservability } from "@/types/hermes";
import type {
  AvailableCapabilities,
  CostGovernanceSnapshot,
  ObservabilitySnapshot,
  OperationalPriorities,
  PlatformHealth,
  PublicKpis,
  ServiceResult,
  TenantIdentity,
} from "@/types/hermes";
import { useI18n } from "@/lib/i18n/I18nProvider";

type CommandCenterProps = {
  // Z1 — context bar
  contextBar: ContextBarModel;
  initialClock: { time: string; date: string; offset: string };
  contextSegments: string[];
  // Z2 — tenant identity + condensed platform state
  tenant: ServiceResult<TenantIdentity>;
  kpis: ServiceResult<PublicKpis>;
  observability: ServiceResult<ObservabilitySnapshot>;
  platformHealth: ServiceResult<PlatformHealth>;
  actionStats: ServiceResult<AgentActionStats>;
  resolver: ServiceResult<ResolverObservability>;
  cost: ServiceResult<CostGovernanceSnapshot>;
  // Z5 — critical alerts / priorities
  alerts: ServiceResult<UnifiedAlerts>;
  priorities: ServiceResult<OperationalPriorities>;
  // Z6 — quick actions
  capabilities: ServiceResult<AvailableCapabilities>;
  quickActions: string[];
  // formatting
  locale: string;
  timezone: string;
  hour12: boolean;
};

/**
 * Command Center — the épuré cockpit Home. A fixed, synthetic overview in 6 zones. It is
 * NOT a widget grid: detailed widget configuration (order / size / add / hide) lives in
 * Paramètres (`/parametres/dashboard`). The chrome (sidebar, header, wallpaper, profile
 * switcher) is provided by the route-group layout; this component renders only content.
 * Every panel reads an already-loaded snapshot — 0 extra DB read, 0 LLM, 0 polling.
 */
export default function CommandCenter({
  contextBar,
  initialClock,
  contextSegments,
  tenant,
  kpis,
  observability,
  platformHealth,
  actionStats,
  resolver,
  cost,
  alerts,
  priorities,
  capabilities,
  quickActions,
  locale,
  timezone,
  hour12,
}: CommandCenterProps) {
  const { t } = useI18n();

  return (
    <div className="command-center">
      {/* Z1 — barre de contexte compacte (segments configurables). Horloge live
          déterministe (Intl, 0 appel) ; météo Open-Meteo cachée (non fetchée si le
          segment est masqué). */}
      <ContextBar
        model={contextBar}
        initialClock={initialClock}
        visibleSegments={contextSegments}
      />

      {/* Z2 — identité tenant + titre + état global Hermès condensé. */}
      <section className="cc-zone cc-overview" aria-label={t("intro.title")}>
        <div className="dashboard-intro dashboard-intro-compact">
          <div className="dashboard-intro-lead">
            <TenantBadge identity={tenant} />
            <div>
              <span className="panel-eyebrow">{t("intro.eyebrow")}</span>
              <h2>{t("intro.title")}</h2>
            </div>
          </div>
          <div className="dashboard-intro-status">
            <span className="status-pulse" />
            <div>
              <strong>{t("intro.connected")}</strong>
              <span>{t("intro.realData")}</span>
            </div>
          </div>
        </div>

        <SystemHealthPanel
          variant="summary"
          kpis={kpis}
          observability={observability}
          platformHealth={platformHealth}
          actionStats={actionStats}
          resolver={resolver}
          cost={cost}
          locale={locale}
          timezone={timezone}
          hour12={hour12}
        />
      </section>

      {/* Z3 — Demander à Hermès (frame fixe, canal sécurisé orchestrateur → gateway). */}
      <section className="cc-zone cc-ask" aria-label={t("chat.header.eyebrow")}>
        <div id="hermes-command">
          <HermesPanel />
        </div>
      </section>

      {/* Z4 — 3–5 KPI max. */}
      <section className="cc-zone cc-kpis" aria-label={t("kpi.platformIndicators")}>
        <KpiGrid kpis={kpis} limit={4} />
      </section>

      {/* Z5 — alertes / priorités critiques + approbations compactes. */}
      <section className="cc-zone cc-priorities">
        <AlertsPanel alerts={alerts} criticalOnly limit={4} />
        <TasksPanel priorities={priorities} limit={3} />
        <ApprovalsPanel compact />
      </section>

      {/* Z6 — actions rapides (capacités accordées, capability-gated). */}
      <section className="cc-zone cc-actions" aria-label={t("qa.title")}>
        <QuickActions capabilities={capabilities} selected={quickActions} />
      </section>
    </div>
  );
}
