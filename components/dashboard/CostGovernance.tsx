"use client";

import {
  AlertOctagon,
  Ban,
  CircleSlash,
  Coins,
  Cpu,
  Gauge,
  Wallet,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type {
  CostGovernanceSnapshot,
  CostLimitState,
  CostPeriod,
  ServiceResult,
} from "@/types/hermes";

type CostGovernanceProps = {
  cost: ServiceResult<CostGovernanceSnapshot>;
};

function stateTone(state: CostLimitState): string {
  if (state === "HARD_LIMIT" || state === "BLOCKED") return "critical";
  if (state === "WARNING" || state === "SOFT_LIMIT") return "urgent";
  return "normal";
}

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
}

function fmtRatio(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return "—";
  return `${Math.round(r * 100)} %`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Frame({
  state,
  children,
}: {
  state?: CostLimitState;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("cost.eyebrow")}</span>
          <h3>{t("cost.heading")}</h3>
        </div>
        {state ? (
          <span className={`cost-state-pill is-${stateTone(state)}`}>
            {t(`cost.state.${state}` as MessageKey)}
          </span>
        ) : (
          <ProvenanceBadge provenance="REAL" />
        )}
      </div>
      {children}
    </section>
  );
}

function PeriodCard({ label, period }: { label: string; period: CostPeriod }) {
  const { t } = useI18n();
  const configured = period.provenance === "REAL";
  return (
    <div className="system-metric">
      <Wallet size={17} strokeWidth={1.8} />
      <div>
        <span>
          {label} · {t(`cost.state.${period.limitState}` as MessageKey)}
        </span>
        <strong>
          {fmtUsd(period.exposureUsd)}
          {configured
            ? ` / ${fmtUsd(period.budgetUsd)}`
            : ` ${t("cost.withoutBudget")}`}
        </strong>
        {configured ? (
          <small className="cost-sub">
            {t("cost.remainingUsed", {
              amount: fmtUsd(period.remainingUsd),
              ratio: fmtRatio(period.usageRatio),
            })}
          </small>
        ) : (
          <small className="cost-sub">{t("cost.budgetNotConfigured")}</small>
        )}
      </div>
    </div>
  );
}

export default function CostGovernance({ cost }: CostGovernanceProps) {
  const { t } = useI18n();

  if (!cost.ok || cost.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">{t("cost.unavailableMessage")}</p>
      </Frame>
    );
  }

  const { governanceState, budget, period, quota, models, costEvents, unavailable } =
    cost.data;

  return (
    <Frame state={governanceState}>
      {/* Budget exposure per period (REAL from the SW23 ledger, or NOT_CONFIGURED). */}
      <div className="system-metrics">
        <PeriodCard label={t("cost.period.day")} period={period.day} />
        <PeriodCard label={t("cost.period.month")} period={period.month} />
        <div className="system-metric">
          <Gauge size={17} strokeWidth={1.8} />
          <div>
            <span>{t("cost.providerCalls")}</span>
            <strong>{quota.totalCalls.toLocaleString("fr-FR")}</strong>
            <small className="cost-sub">
              {t("cost.accumulatedBlocks", {
                amount: fmtUsd(quota.totalCostAccumulated),
                count: quota.blocksToday,
              })}
            </small>
          </div>
        </div>
        <div className="system-metric">
          <Coins size={17} strokeWidth={1.8} />
          <div>
            <span>{t("cost.budgetConfigured")}</span>
            <strong>
              {budget.provenance === "REAL" ? t("cost.yes") : t("cost.notConfigured")}
            </strong>
            {budget.provenance === "REAL" ? (
              <small className="cost-sub">
                {t("cost.budgetDetail", {
                  daily: fmtUsd(budget.dailyBudgetUsd),
                  monthly: fmtUsd(budget.monthlyBudgetUsd),
                  pct: budget.alertThresholdPct ?? t("common.none"),
                  mode: budget.hardStop ? "hard-stop" : t("cost.soft"),
                })}
              </small>
            ) : (
              <small className="cost-sub">{t("cost.noBudgetTenant")}</small>
            )}
          </div>
        </div>
      </div>

      {/* Quota usage by provider (REAL recorded counters). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <Gauge size={15} strokeWidth={1.9} />
          <span>{t("cost.consumptionByProvider")}</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {quota.byProvider.length === 0 ? (
          <p className="system-line-empty">{t("cost.noCounters")}</p>
        ) : (
          <ul className="system-line-list">
            {quota.byProvider.slice(0, 6).map((q, idx) => (
              <li key={`q-${idx}`} className="system-line is-normal">
                <strong>
                  {q.provider} · {q.service}
                </strong>
                <span>
                  {t("cost.providerUsage", {
                    calls: q.calls.toLocaleString("fr-FR"),
                    amount: fmtUsd(q.costAccumulated),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quota blocks (REAL, tenant-scoped). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <Ban size={15} strokeWidth={1.9} />
          <span>{t("cost.recentQuotaBlocks")}</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {quota.recentBlocks.length === 0 ? (
          <p className="system-line-empty">{t("cost.noRecentBlocks")}</p>
        ) : (
          <ul className="system-line-list">
            {quota.recentBlocks.slice(0, 4).map((b, idx) => (
              <li key={`b-${idx}`} className="system-line is-critical">
                <strong>
                  {b.provider} · {b.reason}
                </strong>
                <span>
                  {b.service} · {fmtDate(b.blockedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Model catalog (REAL pricing reference, each row carries its cost_status). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <Cpu size={15} strokeWidth={1.9} />
          <span>{t("cost.modelCatalog")}</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {models.length === 0 ? (
          <p className="system-line-empty">{t("cost.noModels")}</p>
        ) : (
          <ul className="system-line-list">
            {models.slice(0, 6).map((m, idx) => (
              <li
                key={`m-${idx}`}
                className={`system-line is-${m.enabled ? "normal" : "unavailable"}`}
              >
                <strong>
                  {m.provider} · {m.modelId}
                </strong>
                <span>
                  {m.costStatus === "real" && m.inputCost !== null
                    ? `in ${m.inputCost} / out ${m.outputCost} ${m.currency} ${m.pricingUnit ?? ""}`
                    : t("cost.priceUnavailable")}
                  {m.enabled ? "" : ` · ${t("cost.disabled")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cost events: REAL per-request cost, or honestly UNAVAILABLE. */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <CircleSlash size={15} strokeWidth={1.9} />
          <span>{t("cost.realCostPerRequest")}</span>
          <ProvenanceBadge
            provenance={costEvents.provenance === "REAL" ? "REAL" : "UNAVAILABLE"}
          />
        </div>
        {costEvents.provenance === "REAL" ? (
          <ul className="system-line-list">
            {costEvents.byProvider.slice(0, 5).map((c, idx) => (
              <li key={`ce-${idx}`} className="system-line is-normal">
                <strong>
                  {c.provider} · {c.modelOrService ?? t("common.none")}
                </strong>
                <span>
                  {fmtUsd(c.totalUsd)} · {c.requests} req ·{" "}
                  {c.measurementStatus ?? t("common.none")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="system-line-empty">{t("cost.noCostEvents")}</p>
        )}
      </div>

      {/* Explicitly unavailable metrics — never fabricated. */}
      {unavailable.length > 0 ? (
        <div className="system-subsection">
          <div className="system-subsection-head">
            <AlertOctagon size={15} strokeWidth={1.9} />
            <span>{t("cost.unavailableMetrics")}</span>
            <ProvenanceBadge provenance="UNAVAILABLE" />
          </div>
          <ul className="system-line-list">
            {unavailable.map((u) => (
              <li key={u} className="system-line is-unavailable">
                <strong>{u}</strong>
                <span>{t("cost.notMeasured")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Frame>
  );
}
