"use client";

import { useState } from "react";

import ContextBar from "@/components/dashboard/ContextBar";
import HermesOrb, { type OrbState } from "@/components/dashboard/HermesOrb";
import HermesPanel from "@/components/dashboard/HermesPanel";
import QuickActions from "@/components/dashboard/QuickActions";
import TenantBadge from "@/components/dashboard/TenantBadge";
import type { ContextBarModel } from "@/lib/dashboard/contextBar";
import type {
  AvailableCapabilities,
  ServiceResult,
  TenantIdentity,
} from "@/types/hermes";
import { useI18n } from "@/lib/i18n/I18nProvider";

type CommandCenterProps = {
  contextBar: ContextBarModel;
  initialClock: { time: string; date: string; offset: string };
  contextSegments: string[];
  tenant: ServiceResult<TenantIdentity>;
  heroStatus: "OPERATIONAL" | "DEGRADED" | "UNAVAILABLE";
  capabilities: ServiceResult<AvailableCapabilities>;
  quickActions: string[];
};

/**
 * Accueil volontairement strict : aucune synthèse métier générique n'est affichée ici.
 * Les seuls compteurs métier de l'accueil sont rendus plus bas par les widgets PV,
 * alimentés par `get_pv_pilot_snapshot`. Cela évite de présenter comme des faits
 * photovoltaïques des incidents/chantiers/KPI provenant du noyau Hermès multi-métier.
 */
export default function CommandCenter({
  contextBar,
  initialClock,
  contextSegments,
  tenant,
  heroStatus,
  capabilities,
  quickActions,
}: CommandCenterProps) {
  const { t } = useI18n();
  const [orbState, setOrbState] = useState<OrbState>("idle");

  const heroTone =
    heroStatus === "OPERATIONAL" ? "ok" : heroStatus === "DEGRADED" ? "warn" : "muted";
  const heroLabel =
    heroStatus === "OPERATIONAL"
      ? t("home.hero.operational")
      : heroStatus === "DEGRADED"
        ? t("home.hero.degraded")
        : t("common.unavailable");

  return (
    <div className="command-center cc-premium">
      <ContextBar
        model={contextBar}
        initialClock={initialClock}
        visibleSegments={contextSegments}
      />

      <section className="cc-hero" aria-label={t("home.hero.title")}>
        <div className="cc-hero-head">
          <HermesOrb size={30} state={orbState} className="cc-hero-orb" />
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
          <HermesPanel variant="hero" onStateChange={setOrbState} />
        </div>
      </section>

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
