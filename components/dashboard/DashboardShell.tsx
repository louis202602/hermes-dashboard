"use client";

import { useState } from "react";

import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
import CostGovernance from "@/components/dashboard/CostGovernance";
import Header from "@/components/dashboard/Header";
import HermesPanel from "@/components/dashboard/HermesPanel";
import KpiGrid from "@/components/dashboard/KpiGrid";
import ProjectsTable from "@/components/dashboard/ProjectsTable";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentConversations from "@/components/dashboard/RecentConversations";
import Sidebar from "@/components/dashboard/Sidebar";
import SystemStatus from "@/components/dashboard/SystemStatus";
import TasksPanel from "@/components/dashboard/TasksPanel";
import type {
  AvailableCapabilities,
  CostGovernanceSnapshot,
  DashboardProjects,
  ObservabilitySnapshot,
  OperationalPriorities,
  PublicKpis,
  RecentConversations as RecentConversationsData,
  ServiceResult,
} from "@/types/hermes";

type DashboardShellProps = {
  userEmail: string;
  kpis: ServiceResult<PublicKpis>;
  projects: ServiceResult<DashboardProjects>;
  conversations: ServiceResult<RecentConversationsData>;
  capabilities: ServiceResult<AvailableCapabilities>;
  priorities: ServiceResult<OperationalPriorities>;
  observability: ServiceResult<ObservabilitySnapshot>;
  cost: ServiceResult<CostGovernanceSnapshot>;
};

export default function DashboardShell({
  userEmail,
  kpis,
  projects,
  conversations,
  capabilities,
  priorities,
  observability,
  cost,
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
          {/* Compact executive header — the workspace, not a hero banner. */}
          <section className="dashboard-intro dashboard-intro-compact">
            <div>
              <span className="panel-eyebrow">HELIOSOLAR OS · COMMAND CENTER</span>
              <h2>Poste de commande</h2>
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

          {/* 7 — Coûts / informations techniques secondaires. */}
          <CostGovernance cost={cost} />
        </div>
      </div>
    </main>
  );
}
