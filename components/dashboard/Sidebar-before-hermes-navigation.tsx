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
  Gauge,
  Home,
  Inbox,
  Layers3,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

const navigation = [
  { label: "Accueil", icon: Home, active: true },
  { label: "Hermès", icon: Sparkles },
  { label: "Agents IA", icon: Bot },
  { label: "Workflows", icon: Workflow },
  { label: "CRM", icon: Users },
  { label: "Projets", icon: Building2 },
  { label: "Documents", icon: FileText },
  { label: "Planning", icon: CalendarDays },
  { label: "Messages", icon: Inbox },
  { label: "Analytics", icon: BarChart3 },
];

const secondaryNavigation = [
  { label: "Système", icon: Activity },
  { label: "Sécurité", icon: ShieldCheck },
  { label: "Mémoire IA", icon: BrainCircuit },
  { label: "Infrastructure", icon: Layers3 },
  { label: "Paramètres", icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <Gauge size={21} strokeWidth={1.9} />
        </div>

        <div className="sidebar-brand-copy">
          <strong>HELIOSOLAR</strong>
          <span>HERMÈS OS</span>
        </div>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-section-label">COMMAND CENTER</span>

        <nav className="sidebar-navigation" aria-label="Navigation principale">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <button
                type="button"
                key={item.label}
                className={`sidebar-link ${item.active ? "is-active" : ""}`}
              >
                <span className="sidebar-link-content">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </span>

                {item.active ? (
                  <span className="sidebar-active-dot" />
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

            return (
              <button type="button" key={item.label} className="sidebar-link">
                <span className="sidebar-link-content">
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </span>

                <ChevronRight
                  className="sidebar-link-chevron"
                  size={15}
                  strokeWidth={1.8}
                />
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
          <span>Système opérationnel</span>
        </div>
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">LP</div>

        <div className="sidebar-user-copy">
          <strong>Louis Preira</strong>
          <span>Administrateur</span>
        </div>

        <ChevronRight size={16} strokeWidth={1.8} />
      </div>
    </aside>
  );
}
