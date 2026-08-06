"use client";

import { useState } from "react";
import Header from "@/components/dashboard/Header";
import HermesPanel from "@/components/dashboard/HermesPanel";
import KpiGrid from "@/components/dashboard/KpiGrid";
import ProjectsTable from "@/components/dashboard/ProjectsTable";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentConversations from "@/components/dashboard/RecentConversations";
import Sidebar from "@/components/dashboard/Sidebar";
import SystemStatus from "@/components/dashboard/SystemStatus";
import TasksPanel from "@/components/dashboard/TasksPanel";

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className="dashboard-shell">
      <div
        className={`dashboard-sidebar-wrapper ${
          mobileMenuOpen ? "is-open" : ""
        }`}
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
        <Header onMenuClick={() => setMobileMenuOpen((value) => !value)} />

        <div className="dashboard-content">
          <section className="dashboard-intro">
            <div>
              <span className="panel-eyebrow">HELIOSOLAR OS</span>
              <h2>Bonsoir Louis</h2>
              <p>
                Hermès supervise actuellement vos agents, vos workflows et vos
                opérations commerciales.
              </p>
            </div>

            <div className="dashboard-intro-status">
              <span className="status-pulse" />
              <div>
                <strong>Système nominal</strong>
                <span>Aucun incident critique détecté</span>
              </div>
            </div>
          </section>

          <KpiGrid />

          <div className="dashboard-primary-grid">
            <HermesPanel />
            <QuickActions />
          </div>

          <div className="dashboard-secondary-grid">
            <TasksPanel />
            <RecentConversations />
          </div>

          <ProjectsTable />

          <SystemStatus />
        </div>
      </div>
    </main>
  );
}
