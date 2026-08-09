"use client";

import { useState } from "react";

import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
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
  DashboardProjects,
  PublicKpis,
  ServiceResult,
} from "@/types/hermes";

type DashboardShellProps = {
  userEmail: string;
  kpis: ServiceResult<PublicKpis>;
  projects: ServiceResult<DashboardProjects>;
};

export default function DashboardShell({
  userEmail,
  kpis,
  projects,
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
                Indicateurs plateforme et portefeuille projets en données réelles.
                Les autres panneaux sont illustratifs et seront connectés
                progressivement.
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

          <KpiGrid kpis={kpis} />

          <ProjectsTable projects={projects} />

          <AgentActionPanel />

          <ApprovalsPanel />

          <div className="dashboard-primary-grid dashboard-mock-region">
            <HermesPanel />
            <QuickActions />
          </div>

          <div className="dashboard-secondary-grid dashboard-mock-region">
            <TasksPanel />
            <RecentConversations />
          </div>

          <div className="dashboard-mock-region">
            <SystemStatus />
          </div>
        </div>
      </div>
    </main>
  );
}
