"use client";

import { useState } from "react";

import ContextBar from "@/components/dashboard/ContextBar";
import HermesOrb from "@/components/dashboard/HermesOrb";
import HermesPanel from "@/components/dashboard/HermesPanel";
import QuickActions from "@/components/dashboard/QuickActions";
import TenantBadge from "@/components/dashboard/TenantBadge";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
import type {
  AvailableCapabilities,
  OperationalPriorities,
  PublicKpis,
  ServiceResult,
  TenantIdentity,
} from "@/types/hermes";
import { useI18n } from "@/lib/i18n/I18nProvider";

type CommandCenterProps = {
  // Z1 — floating context
  contextBar: ContextBarModel;
  initialClock: { time: string; date: string; offset: string };
  contextSegments: string[];
  // Z2 — hero identity + real platform état
  tenant: ServiceResult<TenantIdentity>;
  heroStatus: "OPERATIONAL" | "DEGRADED" | "UNAVAILABLE";
  // Z3 — synthesis (compact counters, from already-loaded snapshots)
  alertCount: number | null;
  alertTone: "critical" | "warning" | "none";
  priorities: ServiceResult<OperationalPriorities>;
  kpis: ServiceResult<PublicKpis>;
  // Z4 — quick action chips (capability-gated)
  capabilities: ServiceResult<AvailableCapabilities>;
  quickActions: string[];
};

/**
 * Command Center — the épuré premium cockpit Home. A synthesis, not a dashboard: FOUR
 * light zones floating over the wallpaper. Details now live in the métier sub-pages.
 *   Z1 floating context bar · Z2 hero command post (Hermès orb + "Demander à Hermès")
 *   Z3 compact synthesis counters · Z4 quick-action chips.
 * No full lists, no heavy panels. Every value reads an already-loaded snapshot (0 extra
 * DB read, 0 LLM, 0 polling). The chrome (sidebar/header/wallpaper/profile switcher) comes
 * from the route-group layout.
 */
export default function CommandCenter({
  contextBar,
  initialClock,
  contextSegments,
  tenant,
  heroStatus,
  alertCount,
  alertTone,
  priorities,
  kpis,
  capabilities,
  quickActions,
}: CommandCenterProps) {
  const { t } = useI18n();
  // Hermès thinking → the identity orb's star comes alive (reported by the hero composer).
  const [thinking, setThinking] = useState(false);

  // Real Hermès/platform état (never a fabricated green "operational").
  const heroTone =
    heroStatus === "OPERATIONAL" ? "ok" : heroStatus === "DEGRADED" ? "warn" : "muted";
  const heroLabel =
    heroStatus === "OPERATIONAL"
      ? t("home.hero.operational")
      : heroStatus === "DEGRADED"
        ? t("home.hero.degraded")
        : t("common.unavailable");

  // Z3 synthesis — three counters + one headline KPI, all from loaded snapshots.
  const summary = priorities.ok ? priorities.data.summary : null;
  const toHandle = summary
    ? summary.openIncidents + summary.toQualify + summary.late
    : null;
  const approvals = summary ? summary.pendingApprovals : null;
  const agents = kpis.ok ? kpis.data.agentsIaActive : null;
  const fmt = (n: number | null): string => (n === null ? "—" : String(n));

  return (
    <div className="command-center cc-premium">
      {/* Z1 — barre de contexte, presque flottante sur le wallpaper. */}
      <ContextBar
        model={contextBar}
        initialClock={initialClock}
        visibleSegments={contextSegments}
      />

      {/* Z2 — poste de commande : identité Hermès + « Demander à Hermès ». */}
      <section className="cc-hero" aria-label={t("home.hero.title")}>
        <div className="cc-hero-head">
          <HermesOrb
            size={46}
            state={thinking ? "thinking" : "idle"}
            className="cc-hero-orb"
          />
          <div className="cc-hero-copy">
            <TenantBadge identity={tenant} />
            <h1 className="cc-hero-title">{t("home.hero.title")}</h1>
            <span className={`cc-hero-state is-${heroTone}`}>
              <span className="status-pulse" />
              Hermès · {heroLabel}
            </span>
          </div>
        </div>
        <div id="hermes-command" className="cc-hero-ask">
          <HermesPanel variant="hero" onThinkingChange={setThinking} />
        </div>
      </section>

      {/* Z3 — synthèse à traiter : compteurs compacts (pas de listes). */}
      <section className="cc-synthese" aria-label={t("intro.title")}>
        <div
          className={`cc-stat${
            alertTone === "critical"
              ? " is-critical"
              : alertTone === "warning"
                ? " is-warning"
                : ""
          }`}
        >
          <strong>{fmt(alertCount)}</strong>
          <span>{t("home.stat.alerts")}</span>
        </div>
        <div className={`cc-stat${toHandle && toHandle > 0 ? " is-warning" : ""}`}>
          <strong>{fmt(toHandle)}</strong>
          <span>{t("home.stat.todo")}</span>
        </div>
        <div className="cc-stat">
          <strong>{fmt(approvals)}</strong>
          <span>{t("home.stat.approvals")}</span>
        </div>
        <div className="cc-stat cc-stat-kpi">
          <strong>{fmt(agents)}</strong>
          <span>{t("home.stat.agents")}</span>
        </div>
      </section>

      {/* Z4 — actions rapides : chips premium compactes (capability-gated) + « Voir plus ». */}
      <section className="cc-quick" aria-label={t("qa.title")}>
        <QuickActions
          capabilities={capabilities}
          selected={quickActions}
          variant="chips"
          limit={3}
          moreHref="/chat"
        />
      </section>
    </div>
  );
}
