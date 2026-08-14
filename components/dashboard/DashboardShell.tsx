"use client";

import { useState } from "react";

import ActionAuditTrail from "@/components/dashboard/ActionAuditTrail";
import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
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
  PublicKpis,
  RecentConversations as RecentConversationsData,
  ResolverObservability,
  ServiceResult,
  TenantIdentity,
} from "@/types/hermes";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
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
}: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <main className={`dashboard-shell${collapsed ? " is-collapsed" : ""}`}>
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
        />

        <div className="dashboard-content">
          {/* 0 — Barre de contexte compacte (ville · date · heure locale · météo
              · alertes · coût IA). Horloge live déterministe (Intl, 0 appel) ;
              météo Open-Meteo cachée ; données réelles ou UNAVAILABLE honnête. */}
          <ContextBar model={contextBar} initialClock={initialClock} />

          {/* Compact executive header — the workspace, not a hero banner. The
              tenant (company) identity is DYNAMIC; Hermès OS stays the product
              brand in the sidebar. */}
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

          {/* 1 — Identité / état Hermès + Demander à Hermès. */}
          <div id="hermes-command">
            <HermesPanel />
          </div>

          {/* 2 — KPI exécutifs, above the fold. */}
          <KpiGrid kpis={kpis} />

          {/* 3 — Alertes : approbations à traiter + priorités opérationnelles. */}
          <div className="exec-grid-2">
            <ApprovalsPanel />
            <TasksPanel priorities={priorities} />
          </div>

          {/* 4 — Activité récente (synthétique). */}
          <RecentConversations conversations={conversations} />

          {/* 5 — Métier : portefeuille projets + action agent. */}
          <div className="exec-grid-metier">
            <ProjectsTable projects={projects} />
            <AgentActionPanel />
          </div>

          {/* Actions disponibles (compactes). */}
          <QuickActions capabilities={capabilities} />

          {/* 6 — Observabilité (synthèse). */}
          <SystemStatus observability={observability} />

          {/* 7 — Journal d'audit actions & approbations (redevabilité SW15). */}
          <ActionAuditTrail audit={audit} />

          {/* 8 — État opérationnel du résolveur (dormant : lecture seule). */}
          <ResolverStatus resolver={resolver} />

          {/* 8b — Plan de contrôle opérateur (visible uniquement pour un opérateur
              autorisé ; chaque action appelle une vraie RPC fail-closed). */}
          <ResolverControlPanel control={resolverControl} />

          {/* 9 — Coûts / informations techniques secondaires. */}
          <CostGovernance cost={cost} />
        </div>
      </div>
    </main>
  );
}
