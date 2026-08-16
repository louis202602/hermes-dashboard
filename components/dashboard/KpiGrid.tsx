"use client";

import { Bot, Boxes, CircleSlash, GitBranch, Workflow } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { PublicKpis, ServiceResult } from "@/types/hermes";

type KpiGridProps = {
  kpis: ServiceResult<PublicKpis>;
};

const numberFormat = new Intl.NumberFormat("fr-FR");

export default function KpiGrid({ kpis }: KpiGridProps) {
  const { t } = useI18n();

  if (!kpis.ok) {
    // Compact, full-width UNAVAILABLE state — never an isolated tall card that
    // breaks the grid composition.
    return (
      <section className="kpi-grid" aria-label={t("kpi.ariaUnavailable")}>
        <article className="kpi-card kpi-card-unavailable">
          <div className="kpi-unavailable-inner">
            <span className="kpi-unavailable-icon">
              <CircleSlash size={18} strokeWidth={1.9} />
            </span>
            <div>
              <span className="kpi-title">{t("kpi.platformIndicators")}</span>
              <strong>{t("common.unavailable")}</strong>
              <span className="kpi-subtle">{t("kpi.loadError")}</span>
            </div>
            <ProvenanceBadge provenance="UNAVAILABLE" />
          </div>
        </article>
      </section>
    );
  }

  const k = kpis.data;

  const cards = [
    {
      title: t("kpi.agentsActive"),
      value: numberFormat.format(k.agentsIaActive),
      icon: Bot,
    },
    {
      title: t("kpi.modulesActive"),
      value: numberFormat.format(k.modulesSwActive),
      icon: Workflow,
    },
    {
      title: t("kpi.subworkflowsActive"),
      value: numberFormat.format(k.subworkflowsActive),
      icon: GitBranch,
    },
    {
      title: t("kpi.componentsActive"),
      value: `${numberFormat.format(k.componentsActiveTotal)} / ${numberFormat.format(
        k.componentsRegisteredTotal,
      )}`,
      icon: Boxes,
      hint: t("kpi.activeRate", { rate: k.activeRate }),
    },
  ];

  return (
    <section className="kpi-grid" aria-label={t("kpi.ariaReal")}>
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <article className="kpi-card" key={card.title}>
            <div className="kpi-card-top">
              <div className="kpi-icon">
                <Icon size={22} strokeWidth={1.8} />
              </div>
              <ProvenanceBadge provenance="REAL" />
            </div>

            <span className="kpi-title">{card.title}</span>
            <strong className="kpi-value">{card.value}</strong>
            {card.hint ? <span className="kpi-subtle">{card.hint}</span> : null}
          </article>
        );
      })}
    </section>
  );
}
