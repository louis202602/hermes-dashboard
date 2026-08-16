"use client";

import { Activity, CircuitBoard, PauseCircle, PlayCircle } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { MessageKey } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type {
  ResolverObservability,
  ResolverState,
  ServiceResult,
} from "@/types/hermes";

type Props = {
  resolver: ServiceResult<ResolverObservability>;
};

function stateTone(s: ResolverState): string {
  if (s === "CIRCUIT_OPEN") return "critical";
  if (s === "READY") return "normal";
  return "unavailable"; // DISABLED / NOT_CONFIGURED — expected while dormant
}

function fmtAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function fmtRate(r: number | null): string {
  return r === null || !Number.isFinite(r) ? "—" : `${Math.round(r * 100)} %`;
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("rslv.eyebrow")}</span>
          <h3>{t("rslv.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ResolverStatus({ resolver }: Props) {
  const { t } = useI18n();
  if (!resolver.ok || resolver.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">{t("rslv.unavailable")}</p>
      </Frame>
    );
  }

  const { resolverState, control, queue, outcomes, cost } = resolver.data;
  const tone = stateTone(resolverState);

  const StateIcon =
    resolverState === "READY"
      ? PlayCircle
      : resolverState === "CIRCUIT_OPEN"
        ? CircuitBoard
        : PauseCircle;

  const cells: { label: string; value: string; tone?: string }[] = [
    { label: t("rslv.cell.queue"), value: String(queue.queueDepth) },
    { label: t("rslv.cell.oldest"), value: fmtAge(queue.oldestQueuedAgeSeconds) },
    { label: t("rslv.cell.running"), value: String(queue.runningCount) },
    {
      label: t("rslv.cell.failures"),
      value: outcomes.provenance === "REAL" ? String(outcomes.failedCount) : t("common.none"),
      tone: outcomes.failedCount > 0 ? "critical" : undefined,
    },
    {
      label: t("rslv.cell.deadLetter"),
      value: outcomes.provenance === "REAL" ? String(outcomes.deadLetterCount) : t("common.none"),
      tone: outcomes.deadLetterCount > 0 ? "critical" : undefined,
    },
    {
      label: t("rslv.cell.errorRate"),
      value: outcomes.provenance === "REAL" ? fmtRate(outcomes.errorRate) : t("common.none"),
    },
    { label: t("rslv.cell.dayCost"), value: fmtUsd(cost.daySpendUsd) },
    { label: t("rslv.cell.budgetRemaining"), value: fmtUsd(cost.dailyRemainingUsd) },
  ];

  return (
    <Frame>
      <div className="resolver-state-row">
        <span className={`resolver-state-pill is-${tone}`}>
          <StateIcon size={14} strokeWidth={2} />
          {t(`rslv.state.${resolverState}` as MessageKey)}
        </span>
        <span className="resolver-state-meta">
          <Activity size={12} strokeWidth={1.9} />
          {t("rslv.stateMeta", {
            batch: control.maxBatch ?? t("common.none"),
            concurrency: control.maxConcurrency ?? t("common.none"),
          })}
          {control.circuitState === "OPEN" ? ` · ${t("rslv.circuitOpen")}` : ""}
        </span>
      </div>

      {resolverState === "CIRCUIT_OPEN" && control.circuitReason ? (
        <p className="resolver-circuit-reason">{control.circuitReason}</p>
      ) : null}

      <ul className="resolver-metric-grid">
        {cells.map((c) => (
          <li key={c.label} className={`resolver-metric${c.tone ? ` is-${c.tone}` : ""}`}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
          </li>
        ))}
      </ul>

      <p className="resolver-note">
        {t("rslv.note.idle")}
        {outcomes.provenance !== "REAL" ? ` ${t("rslv.note.noMetrics")}` : ""}
      </p>
    </Frame>
  );
}
