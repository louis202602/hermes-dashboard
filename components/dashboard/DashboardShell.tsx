"use client";

import { useState } from "react";

import ActionAuditTrail from "@/components/dashboard/ActionAuditTrail";
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
  ActionAuditTrail as ActionAuditTrailData,
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
  audit: ServiceResult<ActionAuditTrailData>;
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
  audit,
}: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className="dashboard-shell">
      <div
        className={`dashboard-sidebar-wrapper ${mobileMenuOpen ? "is-open" : ""}`}
      >
        <Sidebar />
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
          <section className="dashboard-intro">
            <div>
              <span className="panel-eyebrow">HELIOSOLAR OS</span>
              <h2>Poste de commande</h2>
              <p>
                Tous les panneaux sont branchés sur des données réelles ou
                marqués « Indisponible » lorsqu’une mesure n’existe pas. Aucune
                donnée fictive n’est présentée comme réelle.
              </p>
            </div>

            <div className="dashboard-intro-status">
              <span className="status-pulse" />
              <div>
                <strong>Connecté à hermes_os</strong>
                <span>Données réelles via contrats backend</span>
              </div>
            </div>
          </section>

          <div id="hermes-command">
            <HermesPanel />
          </div>

          <KpiGrid kpis={kpis} />

          <ProjectsTable projects={projects} />

          <AgentActionPanel />

          <ApprovalsPanel />

          <div className="dashboard-secondary-grid">
            <RecentConversations conversations={conversations} />
            <TasksPanel priorities={priorities} />
          </div>

          <QuickActions capabilities={capabilities} />

          <SystemStatus observability={observability} />

          <ActionAuditTrail audit={audit} />

          <CostGovernance cost={cost} />
        </div>
      </div>
    </main>
  );
}
