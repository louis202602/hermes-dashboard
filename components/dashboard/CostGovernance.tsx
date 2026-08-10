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
import type {
  CostGovernanceSnapshot,
  CostLimitState,
  CostPeriod,
  ServiceResult,
} from "@/types/hermes";

type CostGovernanceProps = {
  cost: ServiceResult<CostGovernanceSnapshot>;
};

const STATE_LABEL: Record<CostLimitState, string> = {
  NORMAL: "Normal",
  WARNING: "Alerte",
  SOFT_LIMIT: "Dépassement (souple)",
  HARD_LIMIT: "Bloqué (budget)",
  BLOCKED: "Bloqué (quota)",
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
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">GOUVERNANCE COÛTS</span>
          <h3>Budgets, quotas &amp; consommation</h3>
        </div>
        {state ? (
          <span className={`cost-state-pill is-${stateTone(state)}`}>
            {STATE_LABEL[state]}
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
  const configured = period.provenance === "REAL";
  return (
    <div className="system-metric">
      <Wallet size={17} strokeWidth={1.8} />
      <div>
        <span>
          {label} · {STATE_LABEL[period.limitState]}
        </span>
        <strong>
          {fmtUsd(period.exposureUsd)}
          {configured ? ` / ${fmtUsd(period.budgetUsd)}` : " (sans budget)"}
        </strong>
        {configured ? (
          <small className="cost-sub">
            Reste {fmtUsd(period.remainingUsd)} · {fmtRatio(period.usageRatio)}{" "}
            utilisé
          </small>
        ) : (
          <small className="cost-sub">Budget non configuré</small>
        )}
      </div>
    </div>
  );
}

export default function CostGovernance({ cost }: CostGovernanceProps) {
  if (!cost.ok || cost.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">
          La gouvernance des coûts est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { governanceState, budget, period, quota, models, costEvents, unavailable } =
    cost.data;

  return (
    <Frame state={governanceState}>
      {/* Budget exposure per period (REAL from the SW23 ledger, or NOT_CONFIGURED). */}
      <div className="system-metrics">
        <PeriodCard label="Jour" period={period.day} />
        <PeriodCard label="Mois" period={period.month} />
        <div className="system-metric">
          <Gauge size={17} strokeWidth={1.8} />
          <div>
            <span>Appels providers (période enregistrée)</span>
            <strong>{quota.totalCalls.toLocaleString("fr-FR")}</strong>
            <small className="cost-sub">
              Coût cumulé {fmtUsd(quota.totalCostAccumulated)} · blocages
              aujourd’hui {quota.blocksToday}
            </small>
          </div>
        </div>
        <div className="system-metric">
          <Coins size={17} strokeWidth={1.8} />
          <div>
            <span>Budget configuré</span>
            <strong>
              {budget.provenance === "REAL" ? "Oui" : "Non configuré"}
            </strong>
            {budget.provenance === "REAL" ? (
              <small className="cost-sub">
                Jour {fmtUsd(budget.dailyBudgetUsd)} · Mois{" "}
                {fmtUsd(budget.monthlyBudgetUsd)} · Alerte{" "}
                {budget.alertThresholdPct ?? "—"}% ·{" "}
                {budget.hardStop ? "hard-stop" : "souple"}
              </small>
            ) : (
              <small className="cost-sub">Aucun budget pour ce tenant</small>
            )}
          </div>
        </div>
      </div>

      {/* Quota usage by provider (REAL recorded counters). */}
      <div className="system-subsection">
        <div className="system-subsection-head">
          <Gauge size={15} strokeWidth={1.9} />
          <span>Consommation par provider</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {quota.byProvider.length === 0 ? (
          <p className="system-line-empty">Aucun compteur enregistré.</p>
        ) : (
          <ul className="system-line-list">
            {quota.byProvider.slice(0, 6).map((q, idx) => (
              <li key={`q-${idx}`} className="system-line is-normal">
                <strong>
                  {q.provider} · {q.service}
                </strong>
                <span>
                  {q.calls.toLocaleString("fr-FR")} appels ·{" "}
                  {fmtUsd(q.costAccumulated)}
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
          <span>Blocages quota récents</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {quota.recentBlocks.length === 0 ? (
          <p className="system-line-empty">Aucun blocage récent.</p>
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
          <span>Catalogue modèles (tarifs)</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {models.length === 0 ? (
          <p className="system-line-empty">Aucun modèle au catalogue.</p>
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
                    : "tarif indisponible"}
                  {m.enabled ? "" : " · désactivé"}
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
          <span>Coût réel par requête</span>
          <ProvenanceBadge
            provenance={costEvents.provenance === "REAL" ? "REAL" : "UNAVAILABLE"}
          />
        </div>
        {costEvents.provenance === "REAL" ? (
          <ul className="system-line-list">
            {costEvents.byProvider.slice(0, 5).map((c, idx) => (
              <li key={`ce-${idx}`} className="system-line is-normal">
                <strong>
                  {c.provider} · {c.modelOrService ?? "—"}
                </strong>
                <span>
                  {fmtUsd(c.totalUsd)} · {c.requests} req ·{" "}
                  {c.measurementStatus ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="system-line-empty">
            Aucun événement de coût par requête enregistré (mesure non
            instrumentée) — affiché « Indisponible » plutôt qu’estimé.
          </p>
        )}
      </div>

      {/* Explicitly unavailable metrics — never fabricated. */}
      {unavailable.length > 0 ? (
        <div className="system-subsection">
          <div className="system-subsection-head">
            <AlertOctagon size={15} strokeWidth={1.9} />
            <span>Métriques non disponibles</span>
            <ProvenanceBadge provenance="UNAVAILABLE" />
          </div>
          <ul className="system-line-list">
            {unavailable.map((u) => (
              <li key={u} className="system-line is-unavailable">
                <strong>{u}</strong>
                <span>Non mesuré</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Frame>
  );
}
