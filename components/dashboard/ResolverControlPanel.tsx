"use client";

import { CircuitBoard, PlayCircle, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import {
  resolverDisableAction,
  resolverEnableAction,
  resolverReapAction,
  resolverRefreshControlAction,
  resolverResetCircuitAction,
  type OperatorResult,
} from "@/app/actions/resolver-control";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type { MessageKey } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  deriveResolverControl,
  parseResolverControl,
  type ResolverControl,
} from "@/lib/resolver/controlState";
import type { ServiceResult } from "@/types/hermes";

type Props = {
  control: ServiceResult<ResolverControl>;
};

function toneForStatus(s: string): string {
  if (s === "READY") return "normal";
  if (s === "CIRCUIT_OPEN" || s === "BLOCKED_BUDGET") return "critical";
  return "unavailable";
}

export default function ResolverControlPanel({ control }: Props) {
  const { t } = useI18n();
  const initial: ResolverControl | null = control.ok ? control.data : null;
  const [model, setModel] = useState<ResolverControl | null>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Operator-only surface: nothing is shown to non-operators (the read-only
  // ResolverStatus panel already covers everyone). Fail-closed.
  if (!model || !model.authorized) return null;

  const view = deriveResolverControl(model);

  function refresh() {
    startTransition(async () => {
      const raw = await resolverRefreshControlAction();
      if (raw) setModel(parseResolverControl(raw));
    });
  }

  function run(
    action: () => Promise<OperatorResult>,
    okMessage: string,
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    startTransition(async () => {
      const res = await action();
      setMsg(
        res.ok
          ? okMessage
          : t("rctl.refused", { status: res.status ?? t("rctl.error") }),
      );
      const raw = await resolverRefreshControlAction();
      if (raw) setModel(parseResolverControl(raw));
    });
  }

  const cells: { label: string; value: string; tone?: string }[] = [
    { label: t("rctl.cell.killSwitch"), value: model.enabled ? t("rctl.on") : t("rctl.off"), tone: model.enabled ? undefined : "muted" },
    { label: t("rctl.cell.circuit"), value: t(`rctl.circuit.${model.circuitState}` as MessageKey), tone: model.circuitState === "OPEN" ? "critical" : undefined },
    { label: t("rctl.cell.queue"), value: String(model.queueDepth) },
    { label: t("rctl.cell.running"), value: String(model.runningCount) },
    { label: t("rctl.cell.protectedExclusions"), value: String(model.protectedExclusionsCount) },
    { label: t("rctl.cell.preflight"), value: view.canEnable ? t("rctl.ready") : t("rctl.notReady"), tone: view.canEnable ? "normal" : "critical" },
  ];

  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("rctl.eyebrow")}</span>
          <h3>{t("rctl.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <div className="resolver-state-row">
        <span className={`resolver-state-pill is-${toneForStatus(view.status)}`}>
          {t(`rctl.status.${view.status}` as MessageKey)}
        </span>
        <span className="resolver-state-meta">
          {t("rctl.controlMeta", {
            batch: model.maxBatch ?? t("common.none"),
            concurrency: model.maxConcurrency ?? t("common.none"),
            cadence: model.cadenceSeconds ?? t("common.none"),
          })}
        </span>
      </div>

      {model.circuitState === "OPEN" && model.circuitReason ? (
        <p className="resolver-circuit-reason">{model.circuitReason}</p>
      ) : null}

      <ul className="resolver-metric-grid">
        {cells.map((c) => (
          <li key={c.label} className={`resolver-metric${c.tone ? ` is-${c.tone}` : ""}`}>
            <span>{c.label}</span>
            <strong>{c.value}</strong>
          </li>
        ))}
      </ul>

      {!view.canEnable && view.blockers.length > 0 ? (
        <p className="resolver-note">
          {t("rctl.activationBlocked")}{" "}
          {view.blockers
            .map((b) => t(`rctl.blocker.${b}` as MessageKey))
            .join(" · ")}
        </p>
      ) : null}

      <div className="resolver-control-actions">
        <button
          type="button"
          className="resolver-btn is-primary"
          disabled={!view.canEnable || pending}
          onClick={() =>
            run(
              resolverEnableAction,
              t("rctl.msg.enabled"),
              t("rctl.confirm.enable"),
            )
          }
        >
          <PlayCircle size={14} strokeWidth={2} /> {t("rctl.action.enable")}
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canDisable || pending}
          onClick={() => run(resolverDisableAction, t("rctl.msg.disabled"))}
        >
          <PowerOff size={14} strokeWidth={2} /> {t("rctl.action.disable")}
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canResetCircuit || pending}
          onClick={() =>
            run(
              resolverResetCircuitAction,
              t("rctl.msg.circuitReset"),
            )
          }
        >
          <CircuitBoard size={14} strokeWidth={2} /> {t("rctl.action.resetCircuit")}
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canReap || pending}
          onClick={() =>
            run(
              resolverReapAction,
              t("rctl.msg.reaped"),
              t("rctl.confirm.reap"),
            )
          }
        >
          <Trash2 size={14} strokeWidth={2} /> {t("rctl.action.reap")}
        </button>
        <button
          type="button"
          className="resolver-btn is-ghost"
          disabled={pending}
          onClick={refresh}
          aria-label={t("common.refresh")}
        >
          <RefreshCw size={14} strokeWidth={2} />
        </button>
      </div>

      {msg ? <p className="resolver-note">{msg}</p> : null}
      <p className="resolver-note">{t("rctl.note.circuitReset")}</p>
    </section>
  );
}
