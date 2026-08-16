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
  contextVisibleSegments,
  normalizeOrder,
  resolveContextConfig,
  resolveWidgetLayout,
  setWidgetHidden,
  setWidgetSize,
  type LayoutPreferences,
  type WidgetSize,
} from "@/lib/dashboard/widgets";
import {
  effectiveProfileAppearance,
  effectiveProfileLayout,
  setActiveProfile,
  setProfileLayout,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import ProfileSwitcher from "@/components/dashboard/ProfileSwitcher";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
import { useI18n } from "@/lib/i18n/I18nProvider";

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
  appearance: Appearance; // GLOBAL appearance (profile overrides layer on top)
  behavior: Behavior;
  preferencesVersion: number;
  globalLayout: LayoutPreferences;
  availableWidgets: string[];
  // DASH-4D: profiles / modes (user-scoped, from the profiles JSONB).
  profiles: ProfilesState;
  activeProfile: ProfileId;
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
  globalLayout,
  availableWidgets,
  profiles: initialProfiles,
  activeProfile: initialActiveProfile,
}: DashboardShellProps) {
  const { t, dir } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(behavior.sidebarCollapsed);

  // DASH-4D: the profiles state + active profile are client-driven so switching a
  // mode recomposes the dashboard from ALREADY-loaded snapshots — 0 extra fetch.
  const [profiles, setProfilesState] = useState<ProfilesState>(initialProfiles);
  const [activeProfile, setActiveState] = useState<ProfileId>(initialActiveProfile);
  const [editing, setEditing] = useState(false);
  const versionRef = useRef<number>(preferencesVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs mirror the latest state so an edit followed immediately by a profile switch
  // (before React re-renders) reads the up-to-date profiles — no stale-closure race,
  // no lost edit, no cross-profile write (see applyProfiles / commitLayout / switch).
  const profilesRef = useRef<ProfilesState>(initialProfiles);
  const activeRef = useRef<ProfileId>(initialActiveProfile);

  // Effective (active-profile) layout + appearance, derived client-side. Edits go
  // into THIS profile only (isolation); other profiles are untouched.
  const layout = useMemo(
    () => effectiveProfileLayout(profiles, activeProfile, globalLayout),
    [profiles, activeProfile, globalLayout],
  );
  const effectiveAppearance = useMemo(
    () => effectiveProfileAppearance(appearance, profiles, activeProfile),
    [appearance, profiles, activeProfile],
  );
  const contextSegments = useMemo(
    () => contextVisibleSegments(resolveContextConfig(layout.context)),
    [layout],
  );

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

  const profileNames = useMemo(() => {
    const out: Partial<Record<ProfileId, string | null>> = {};
    for (const [id, cfg] of Object.entries(profiles.byId)) {
      out[id as ProfileId] = cfg?.name ?? null;
    }
    return out;
  }, [profiles]);

  // Persist the profiles sub-object through the SAME optimistic upsert as DASH-4A/B
  // (shared version, VERSION_CONFLICT ⇒ reload). Debounced for rapid edits; a write
  // happens only on a real switch / edit, never on render.
  const persistProfiles = useCallback((next: ProfilesState) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveDashboardPreferencesAction(
        { profiles: next, schema_version: PREFERENCES_SCHEMA_VERSION },
        versionRef.current,
      );
      if (res.ok && typeof res.version === "number") {
        versionRef.current = res.version;
      } else if (res.status === "VERSION_CONFLICT") {
        window.location.reload(); // pull canonical; no silent last-write-wins
      }
    }, 500);
  }, []);

  // Single writer for the profiles state: updates ref + state + schedules the debounced
  // persist. Always derives from `profilesRef.current`, so concurrent edit→switch never
  // races on a stale closure.
  const applyProfiles = useCallback(
    (next: ProfilesState) => {
      profilesRef.current = next;
      setProfilesState(next);
      persistProfiles(next);
    },
    [persistProfiles],
  );

  // Commit a layout edit into the ACTIVE profile (scoped isolation). Reads the live refs
  // so an edit made just before a switch is stored under the profile it belongs to.
  const commitLayout = useCallback(
    (nextLayout: LayoutPreferences) => {
      applyProfiles(setProfileLayout(profilesRef.current, activeRef.current, nextLayout));
    },
    [applyProfiles],
  );

  // Switch mode: instant client recompose (no refetch), persisted in the background.
  // Uses the latest profiles ref so a pending edit is preserved (not lost, not moved).
  const onSelectProfile = useCallback(
    (id: ProfileId) => {
      if (id === activeRef.current) return;
      activeRef.current = id;
      setActiveState(id);
      applyProfiles(setActiveProfile(profilesRef.current, id));
    },
    [applyProfiles],
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
    <main dir={dir} className={`dashboard-shell${collapsed ? " is-collapsed" : ""}`}>
      {/* DASH-4A: reconcile server-canonical appearance on load + keep the cookie
          mirror fresh (init script already applied it pre-paint). Renders nothing. */}
      <AppearanceSync
        appearance={effectiveAppearance}
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
          appearance={effectiveAppearance}
          preferencesVersion={preferencesVersion}
        />

        <div className="dashboard-content">
          {/* DASH-4D — quick dashboard-mode switcher. Switching recomposes the
              dashboard client-side from already-loaded snapshots (0 extra fetch),
              persisted in the background through the same optimistic upsert. */}
          <ProfileSwitcher
            active={activeProfile}
            names={profileNames}
            onSelect={onSelectProfile}
          />

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
                  <Check size={16} strokeWidth={1.9} aria-hidden /> {t("edit.done")}
                </>
              ) : (
                <>
                  <Pencil size={15} strokeWidth={1.8} aria-hidden />{" "}
                  {t("edit.enter")}
                </>
              )}
            </button>
            {editing ? (
              <span className="edit-hint" role="status">
                {t("edit.hint")}
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
