"use client";

import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  CalendarDays,
  ChevronRight,
  FileText,
  Home,
  Inbox,
  Layers3,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

import { HermesLogoSymbol } from "@/components/common/HermesLogo";

// `active` = the section that is actually built (the current Command Center).
// `soon` = a section not yet implemented — shown honestly as "Bientôt", never as
// a working button (no fake navigation).
const navigation = [
  { label: "Accueil", icon: Home, active: true },
  { label: "Hermès", icon: Sparkles, soon: true },
  { label: "Agents IA", icon: Bot, soon: true },
  { label: "Workflows", icon: Workflow, soon: true },
  { label: "CRM", icon: Users, soon: true },
  { label: "Projets", icon: Building2, soon: true },
  { label: "Documents", icon: FileText, soon: true },
  { label: "Planning", icon: CalendarDays, soon: true },
  { label: "Messages", icon: Inbox, soon: true },
  { label: "Analytics", icon: BarChart3, soon: true },
];

const secondaryNavigation = [
  { label: "Système", icon: Activity, soon: true },
  { label: "Sécurité", icon: ShieldCheck, soon: true },
  { label: "Mémoire IA", icon: BrainCircuit, soon: true },
  { label: "Infrastructure", icon: Layers3, soon: true },
  { label: "Paramètres", icon: Settings, soon: true },
];

export default function Sidebar() {
  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <HermesLogoSymbol size={24} />
        </div>

        <div className="sidebar-brand-copy">
          <strong>HERMÈS OS</strong>
          <span>DIRECTEUR GÉNÉRAL IA</span>
        </div>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-section-label">COMMAND CENTER</span>

        <nav className="sidebar-navigation" aria-label="Navigation principale">
          {navigation.map((item) => {
            const Icon = item.icon;
            const soon = "soon" in item && item.soon;

            return (
              <button
                type="button"
                key={item.label}
                className={`sidebar-link ${item.active ? "is-active" : ""} ${
                  soon ? "is-soon" : ""
                }`}
                disabled={soon}
                aria-disabled={soon || undefined}
                title={soon ? "Bientôt disponible" : undefined}
              >
                <span className="sidebar-link-content">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </span>

                {item.active ? (
                  <span className="sidebar-active-dot" />
                ) : soon ? (
                  <span className="sidebar-soon-pill">Bientôt</span>
                ) : (
                  <ChevronRight
                    className="sidebar-link-chevron"
                    size={15}
                    strokeWidth={1.8}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-separator" />

      <div className="sidebar-section sidebar-section-secondary">
        <span className="sidebar-section-label">GESTION</span>

        <nav className="sidebar-navigation" aria-label="Navigation secondaire">
          {secondaryNavigation.map((item) => {
            const Icon = item.icon;
            const soon = "soon" in item && item.soon;

            return (
              <button
                type="button"
                key={item.label}
                className={`sidebar-link ${soon ? "is-soon" : ""}`}
                disabled={soon}
                aria-disabled={soon || undefined}
                title={soon ? "Bientôt disponible" : undefined}
              >
                <span className="sidebar-link-content">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </span>

                {soon ? (
                  <span className="sidebar-soon-pill">Bientôt</span>
                ) : (
                  <ChevronRight
                    className="sidebar-link-chevron"
                    size={15}
                    strokeWidth={1.8}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-agent-card">
        <div className="sidebar-agent-row">
          <div className="sidebar-agent-avatar">
            <Bot size={18} strokeWidth={1.8} />
          </div>

          <div>
            <strong>Hermès</strong>
            <span>Directeur Général IA</span>
          </div>
        </div>

          <div className="sidebar-agent-status">
          <span className="status-pulse" />
          <span>Directeur Général IA</span>
        </div>
      </div>
    </aside>
  );
}
