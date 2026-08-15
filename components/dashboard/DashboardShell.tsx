"use client";

import { useState } from "react";

import ActionAuditTrail from "@/components/dashboard/ActionAuditTrail";
import AgendaPanel from "@/components/dashboard/AgendaPanel";
import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import AgentActivityPanel from "@/components/dashboard/AgentActivityPanel";
import AppearanceSync from "@/components/dashboard/AppearanceSync";
import AlertsPanel from "@/components/dashboard/AlertsPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
import CommercialPanel from "@/components/dashboard/CommercialPanel";
import ContextBar from "@/components/dashboard/ContextBar";
import CostGovernance from "@/components/dashboard/CostGovernance";
import Header from "@/components/dashboard/Header";
import HermesPanel from "@/components/dashboard/HermesPanel";
import KpiGrid from "@/components/dashboard/KpiGrid";
import ProjectsTable from "@/components/dashboard/ProjectsTable";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentConversations from "@/components/dashboard/RecentConversations";
import ResolverControlPanel from "@/components/dashboard/ResolverControlPanel";
import ResolverStatus from "@/components/dashboard/ResolverStatus";
import Sidebar from "@/components/dashboard/Sidebar";
import SystemHealthPanel from "@/components/dashboard/SystemHealthPanel";
import SystemStatus from "@/components/dashboard/SystemStatus";
import TasksPanel from "@/components/dashboard/TasksPanel";
import TenantBadge from "@/components/dashboard/TenantBadge";
import type {
  ActionAuditTrail as ActionAuditTrailData,
  AvailableCapabilities,
  CostGovernanceSnapshot,
  DashboardProjects,
  ObservabilitySnapshot,
  OperationalPriorities,
  PlatformHealth,
  PublicKpis,
  RecentConversations as RecentConversationsData,
  ResolverObservability,
  ServiceResult,
  TenantIdentity,
} from "@/types/hermes";
import type {
  DashboardAgenda,
  UnifiedAlerts,
} from "@/lib/dashboard/agenda";
import type { Appearance, Behavior } from "@/lib/dashboard/preferences";
import { widgetById } from "@/lib/dashboard/widgets";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
import type {
  AgentActionStats,
  DashboardCommercial,
} from "@/lib/dashboard/systemActivity";
import type { ResolverControl } from "@/lib/resolver/controlState";

type DashboardShellProps = {
  userEmail: string;
  tenant: ServiceResult<TenantIdentity>;
  kpis: ServiceResult<PublicKpis>;
  projects: ServiceResult<DashboardProjects>;
  conversations: ServiceResult<RecentConversationsData>;
  capabilities: ServiceResult<AvailableCapabilities>;
  priorities: ServiceResult<OperationalPriorities>;
  observability: ServiceResult<ObservabilitySnapshot>;
  cost: ServiceResult<CostGovernanceSnapshot>;
  audit: ServiceResult<ActionAuditTrailData>;
  resolver: ServiceResult<ResolverObservability>;
  resolverControl: ServiceResult<ResolverControl>;
  contextBar: ContextBarModel;
  initialClock: { time: string; date: string; offset: string };
  agenda: ServiceResult<DashboardAgenda>;
  alerts: ServiceResult<UnifiedAlerts>;
  locale: string;
  platformHealth: ServiceResult<PlatformHealth>;
  actionStats: ServiceResult<AgentActionStats>;
  commercial: ServiceResult<DashboardCommercial>;
  timezone: string;
  hour12: boolean;
  appearance: Appearance;
  behavior: Behavior;
  preferencesVersion: number;
  visibleWidgets: string[];
  contextSegments: string[];
};

export default function DashboardShell({
  userEmail,
  tenant,
  kpis,
  projects,
  conversations,
  capabilities,
  priorities,
  observability,
  cost,
  audit,
  resolver,
  resolverControl,
  contextBar,
  initialClock,
  agenda,
  alerts,
  locale,
  platformHealth,
  actionStats,
  commercial,
  timezone,
  hour12,
  appearance,
  behavior,
  preferencesVersion,
  visibleWidgets,
  contextSegments,
}: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(behavior.sidebarCollapsed);

  // DASH-4B: id → renderer for every registry widget. Each reads an ALREADY-loaded
  // shared snapshot (0 extra DB reads). The order + visibility come from the
  // server-resolved layout; unknown ids simply have no entry and are skipped.
  const widgetNodes: Record<string, () => React.ReactNode> = {
    kpis: () => <KpiGrid kpis={kpis} />,
    "system-health": () => (
      <SystemHealthPanel
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
    ),
    "agent-activity": () => (
      <AgentActivityPanel
        observability={observability}
        timezone={timezone}
        locale={locale}
        hour12={hour12}
      />
    ),
    agenda: () => <AgendaPanel agenda={agenda} locale={locale} />,
    alerts: () => <AlertsPanel alerts={alerts} />,
    approvals: () => <ApprovalsPanel />,
    tasks: () => <TasksPanel priorities={priorities} />,
    conversations: () => <RecentConversations conversations={conversations} />,
    projects: () => (
      <div className="exec-grid-metier">
        <ProjectsTable projects={projects} />
        <AgentActionPanel />
      </div>
    ),
    commercial: () => <CommercialPanel commercial={commercial} locale={locale} />,
    "quick-actions": () => <QuickActions capabilities={capabilities} />,
    "system-status": () => <SystemStatus observability={observability} />,
    audit: () => <ActionAuditTrail audit={audit} />,
    "resolver-status": () => <ResolverStatus resolver={resolver} />,
    "resolver-control": () => <ResolverControlPanel control={resolverControl} />,
    cost: () => <CostGovernance cost={cost} />,
  };

  return (
    <main className={`dashboard-shell${collapsed ? " is-collapsed" : ""}`}>
      {/* DASH-4A: reconcile server-canonical appearance on load + keep the cookie
          mirror fresh (init script already applied it pre-paint). Renders nothing. */}
      <AppearanceSync
        appearance={appearance}
        behavior={behavior}
        version={preferencesVersion}
      />
      <div
        className={`dashboard-sidebar-wrapper ${mobileMenuOpen ? "is-open" : ""}`}
      >
        <Sidebar
          userEmail={userEmail}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
        />
      </div>

      {mobileMenuOpen ? (
        <button
          type="button"
          className="dashboard-mobile-overlay"
          aria-label="Fermer le menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <div className="dashboard-main">
        <Header
          userEmail={userEmail}
          onMenuClick={() => setMobileMenuOpen((value) => !value)}
          appearance={appearance}
          preferencesVersion={preferencesVersion}
        />

        <div className="dashboard-content">
          {/* 0 — Barre de contexte compacte (segments configurables DASH-4B).
              Horloge live déterministe (Intl, 0 appel) ; météo Open-Meteo cachée
              (et non fetchée si le segment est masqué) ; réel ou UNAVAILABLE. */}
          <ContextBar
            model={contextBar}
            initialClock={initialClock}
            visibleSegments={contextSegments}
          />

          {/* Compact executive header — the workspace, not a hero banner. The
              tenant (company) identity is DYNAMIC; Hermès OS stays the product
              brand in the sidebar. Fixed frame (not a reorderable widget). */}
          <section className="dashboard-intro dashboard-intro-compact">
            <div className="dashboard-intro-lead">
              <TenantBadge identity={tenant} />
              <div>
                <span className="panel-eyebrow">COMMAND CENTER</span>
                <h2>Poste de commande</h2>
              </div>
            </div>

            <div className="dashboard-intro-status">
              <span className="status-pulse" />
              <div>
                <strong>Connecté à hermes_os</strong>
                <span>Données réelles · aucune donnée fictive</span>
              </div>
            </div>
          </section>

          {/* 1 — Identité / état Hermès + Demander à Hermès (frame fixe). */}
          <div id="hermes-command">
            <HermesPanel />
          </div>

          {/* 2 — Widgets configurables : ordre + affichage/masquage user-scoped
              (DASH-4B). half ⇒ pairé 2 colonnes desktop ; full ⇒ pleine largeur ;
              une colonne sur mobile. Chaque widget lit un snapshot déjà chargé. */}
          <div className="dashboard-widgets">
            {visibleWidgets.map((id) => {
              const node = widgetNodes[id];
              if (!node) return null; // unknown id ⇒ skip safely
              const def = widgetById(id);
              const span = def?.span === "half" ? "span-half" : "span-full";
              return (
                <section
                  key={id}
                  id={`widget-${id}`}
                  className={`dash-widget ${span}`}
                >
                  {node()}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
