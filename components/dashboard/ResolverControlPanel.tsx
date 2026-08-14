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
import {
  deriveResolverControl,
  parseResolverControl,
  RESOLVER_BLOCKER_LABELS,
  RESOLVER_STATUS_LABELS,
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
      setMsg(res.ok ? okMessage : `Refusé : ${res.status ?? "erreur"}`);
      const raw = await resolverRefreshControlAction();
      if (raw) setModel(parseResolverControl(raw));
    });
  }

  const cells: { label: string; value: string; tone?: string }[] = [
    { label: "Kill-switch", value: model.enabled ? "ON" : "OFF", tone: model.enabled ? undefined : "muted" },
    { label: "Circuit", value: model.circuitState, tone: model.circuitState === "OPEN" ? "critical" : undefined },
    { label: "File", value: String(model.queueDepth) },
    { label: "En cours", value: String(model.runningCount) },
    { label: "Exclusions protégées", value: String(model.protectedExclusionsCount) },
    { label: "Préflight", value: view.canEnable ? "PRÊT" : "NON PRÊT", tone: view.canEnable ? "normal" : "critical" },
  ];

  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">RÉSOLVEUR · CONTRÔLE OPÉRATEUR</span>
          <h3>Plan de contrôle</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <div className="resolver-state-row">
        <span className={`resolver-state-pill is-${toneForStatus(view.status)}`}>
          {RESOLVER_STATUS_LABELS[view.status]}
        </span>
        <span className="resolver-state-meta">
          lot {model.maxBatch ?? "—"} · concurrence {model.maxConcurrency ?? "—"} · cadence{" "}
          {model.cadenceSeconds ?? "—"}s
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
          Activation bloquée :{" "}
          {view.blockers.map((b) => RESOLVER_BLOCKER_LABELS[b] ?? b).join(" · ")}
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
              "Resolver activé.",
              "Activer le résolveur sémantique ? Il commencera à traiter les demandes en file.",
            )
          }
        >
          <PlayCircle size={14} strokeWidth={2} /> Activer
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canDisable || pending}
          onClick={() => run(resolverDisableAction, "Resolver désactivé.")}
        >
          <PowerOff size={14} strokeWidth={2} /> Désactiver
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canResetCircuit || pending}
          onClick={() =>
            run(
              resolverResetCircuitAction,
              "Circuit réarmé (resolver reste désactivé).",
            )
          }
        >
          <CircuitBoard size={14} strokeWidth={2} /> Réarmer circuit
        </button>
        <button
          type="button"
          className="resolver-btn"
          disabled={!view.canReap || pending}
          onClick={() =>
            run(
              resolverReapAction,
              "Reaper exécuté (borné).",
              "Lancer un reap borné des dead-letters du résolveur ?",
            )
          }
        >
          <Trash2 size={14} strokeWidth={2} /> Reaper
        </button>
        <button
          type="button"
          className="resolver-btn is-ghost"
          disabled={pending}
          onClick={refresh}
          aria-label="Rafraîchir"
        >
          <RefreshCw size={14} strokeWidth={2} />
        </button>
      </div>

      {msg ? <p className="resolver-note">{msg}</p> : null}
      <p className="resolver-note">
        Réarmer le circuit ne réactive jamais le résolveur : l’activation reste un
        geste opérateur explicite, validé côté serveur (préflight fail-closed).
      </p>
    </section>
  );
}
