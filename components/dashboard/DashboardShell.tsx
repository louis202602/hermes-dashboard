"use client";

import { Check, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import ActionAuditTrail from "@/components/dashboard/ActionAuditTrail";
import AgendaPanel from "@/components/dashboard/AgendaPanel";
import AgentActionPanel from "@/components/dashboard/AgentActionPanel";
import AgentActivityPanel from "@/components/dashboard/AgentActivityPanel";
import AppearanceSync from "@/components/dashboard/AppearanceSync";
import AlertsPanel from "@/components/dashboard/AlertsPanel";
import ApprovalsPanel from "@/components/dashboard/ApprovalsPanel";
import ChantierMapWidget from "@/components/dashboard/ChantierMapWidget";
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
import {
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
  type Behavior,
} from "@/lib/dashboard/preferences";
import {
  normalizeOrder,
  resolveWidgetLayout,
  setWidgetHidden,
  setWidgetSize,
  type LayoutPreferences,
  type WidgetSize,
} from "@/lib/dashboard/widgets";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";

// Edit mode pulls dnd-kit — loaded ONLY when the user enters edit mode, so the
// normal dashboard bundle never carries the drag/drop code.
const EditableWidgetGrid = dynamic(
  () => import("@/components/dashboard/EditableWidgetGrid"),
  { ssr: false },
);
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
  layout: LayoutPreferences;
  availableWidgets: string[];
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
  layout: initialLayout,
  availableWidgets,
  contextSegments,
}: DashboardShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(behavior.sidebarCollapsed);

  // DASH-4C: widget layout is now client-driven (edit mode). Server-resolved on
  // first paint (pure, hydration-safe); edits mutate this state + persist.
  const [layout, setLayout] = useState<LayoutPreferences>(initialLayout);
  const [editing, setEditing] = useState(false);
  const versionRef = useRef<number>(preferencesVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableSet = useMemo(
    () => new Set(availableWidgets),
    [availableWidgets],
  );
  const resolved = useMemo(
    () => resolveWidgetLayout(layout, availableSet),
    [layout, availableSet],
  );
  const visibleItems = resolved.items.filter(
    (it) => it.available && !it.hidden,
  );

  // Persist the layout sub-object through the SAME optimistic upsert as DASH-4A/4B
  // (shared version, VERSION_CONFLICT ⇒ reload). Committed on drag-end / resize /
  // hide only — never during pointer move. Debounced for rapid edits.
  const persistLayout = useCallback((next: LayoutPreferences) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveDashboardPreferencesAction(
        { layout: next, schema_version: PREFERENCES_SCHEMA_VERSION },
        versionRef.current,
      );
      if (res.ok && typeof res.version === "number") {
        versionRef.current = res.version;
      } else if (res.status === "VERSION_CONFLICT") {
        window.location.reload(); // pull canonical; no silent last-write-wins
      }
    }, 500);
  }, []);

  const commitLayout = useCallback(
    (next: LayoutPreferences) => {
      setLayout(next);
      persistLayout(next);
    },
    [persistLayout],
  );

  const onReorder = useCallback(
    (orderedVisibleIds: string[]) =>
      commitLayout({ ...layout, order: normalizeOrder(orderedVisibleIds) }),
    [commitLayout, layout],
  );
  const onResize = useCallback(
    (id: string, size: WidgetSize) =>
      commitLayout({ ...layout, sizes: setWidgetSize(layout.sizes, id, size) }),
    [commitLayout, layout],
  );
  const onHideWidget = useCallback(
    (id: string) =>
      commitLayout({ ...layout, hidden: setWidgetHidden(layout.hidden, id, true) }),
    [commitLayout, layout],
  );

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
    "chantiers-map": () => <ChantierMapWidget />,
  };
  const renderWidget = (id: string): React.ReactNode =>
    widgetNodes[id]?.() ?? null; // unknown id ⇒ nothing (safe)

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

          {/* 2 — Widgets configurables : ordre + taille + affichage user-scoped.
              Mode « Modifier le dashboard » (DASH-4C) : drag/drop tactile+clavier,
              contrôle de taille S/M/L, masquer. Persisté dans le layout JSONB
              (concurrence optimiste). Chaque widget lit un snapshot déjà chargé. */}
          <div className="dashboard-widgets-toolbar">
            <button
              type="button"
              className={`edit-toggle-btn${editing ? " is-active" : ""}`}
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? (
                <>
                  <Check size={16} strokeWidth={1.9} aria-hidden /> Terminé
                </>
              ) : (
                <>
                  <Pencil size={15} strokeWidth={1.8} aria-hidden /> Modifier le
                  dashboard
                </>
              )}
            </button>
            {editing ? (
              <span className="edit-hint" role="status">
                Glissez pour réorganiser · redimensionnez (S/M/L) · masquez
              </span>
            ) : null}
          </div>

          {editing ? (
            <EditableWidgetGrid
              items={visibleItems}
              renderWidget={renderWidget}
              onReorder={onReorder}
              onResize={onResize}
              onHide={onHideWidget}
            />
          ) : (
            <div className="dashboard-widgets">
              {visibleItems.map((it) => (
                <section
                  key={it.id}
                  id={`widget-${it.id}`}
                  className={`dash-widget size-${it.size}`}
                >
                  {renderWidget(it.id)}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
