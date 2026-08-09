"use client";

import dynamic from "next/dynamic";
import { ArrowUp, ShieldCheck, Sparkles } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import {
  pollAgentActionResultAction,
  submitHermesCommandAction,
  type CommandState,
} from "@/app/actions/agent-actions";
import {
  TERMINAL_RESULT_STATUSES,
  type ResultOutcome,
} from "@/types/agent-actions";

const HermesHologram = dynamic(
  () => import("@/components/hermes/HermesHologram"),
  {
    ssr: false,
    loading: () => (
      <div className="hermes-hologram-loading">
        <Sparkles size={28} strokeWidth={1.7} />
        <span>Initialisation d’Hermès…</span>
      </div>
    ),
  },
);

type HoloState =
  | "idle"
  | "listening"
  | "thinking"
  | "success"
  | "warning"
  | "error"
  | "offline";

const INITIAL: CommandState = { phase: "idle" };

const STATE_LABEL: Record<string, string> = {
  IDLE: "Au repos",
  SUBMITTING: "Envoi…",
  QUEUED: "En file",
  RUNNING: "En cours",
  PENDING_APPROVAL: "Approbation requise",
  SUCCEEDED: "Succès",
  FAILED: "Échec",
  REJECTED: "Refusée",
  POLICY_DENIED: "Refusée (SW15)",
  TIMEOUT: "Délai dépassé",
  RPC_ERROR: "Service indisponible",
  NOT_FOUND: "Introuvable",
  COMMAND_NOT_RECOGNIZED: "Commande non reconnue",
  VALIDATION_FAILED: "À préciser",
  UNAUTHENTICATED: "Session expirée",
  NO_TENANT: "Aucun tenant",
};

function holoFor(ux: string): HoloState {
  switch (ux) {
    case "IDLE":
      return "idle";
    case "SUBMITTING":
      return "listening";
    case "QUEUED":
    case "RUNNING":
      return "thinking";
    case "PENDING_APPROVAL":
    case "TIMEOUT":
    case "VALIDATION_FAILED":
    case "COMMAND_NOT_RECOGNIZED":
      return "warning";
    case "SUCCEEDED":
      return "success";
    case "RPC_ERROR":
      return "offline";
    default:
      return "error";
  }
}

function toneFor(ux: string): "ok" | "bad" | "warn" | "pending" {
  if (ux === "SUCCEEDED") return "ok";
  if (["FAILED", "REJECTED", "POLICY_DENIED", "RPC_ERROR", "NOT_FOUND", "UNAUTHENTICATED", "NO_TENANT"].includes(ux))
    return "bad";
  if (["PENDING_APPROVAL", "TIMEOUT", "VALIDATION_FAILED", "COMMAND_NOT_RECOGNIZED"].includes(ux))
    return "warn";
  if (ux === "IDLE") return "pending";
  return "pending";
}

function chantierId(result: unknown): string | null {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.chantier_id === "string") return r.chantier_id;
  }
  return null;
}

export default function HermesPanel() {
  const [cmd, formAction, pending] = useActionState(
    submitHermesCommandAction,
    INITIAL,
  );
  const [result, setResult] = useState<ResultOutcome | null>(null);

  const requestId = cmd.phase === "queued" ? cmd.requestId : undefined;
  const activeResult =
    result && result.requestId === requestId ? result : null;

  useEffect(() => {
    if (!requestId) return;
    let attempts = 0;
    const max = 40; // ~60s
    const timer = setInterval(async () => {
      attempts += 1;
      const r = await pollAgentActionResultAction(requestId);
      if (TERMINAL_RESULT_STATUSES.has(r.status) || r.status === "PENDING_APPROVAL") {
        setResult(r);
        clearInterval(timer);
      } else if (attempts >= max) {
        setResult({ ok: false, status: "TIMEOUT", requestId });
        clearInterval(timer);
      } else {
        setResult(r);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [requestId]);

  // Derive the current UX state.
  let ux = "IDLE";
  if (pending) ux = "SUBMITTING";
  else if (cmd.phase === "error") ux = cmd.status ?? "FAILED";
  else if (requestId) ux = activeResult?.status ?? "QUEUED";

  const holo = holoFor(ux);
  const tone = toneFor(ux);
  const terminalOrWaiting =
    !!activeResult &&
    (TERMINAL_RESULT_STATUSES.has(activeResult.status) ||
      ["PENDING_APPROVAL", "TIMEOUT"].includes(activeResult.status));
  const inFlight = pending || (!!requestId && !terminalOrWaiting);

  return (
    <section className="hermes-panel">
      <div className="hermes-panel-glow" />

      <div className="hermes-panel-header">
        <div>
          <span className="panel-eyebrow">DIRECTEUR GÉNÉRAL IA</span>
          <h2>Hermès</h2>
          <p>
            Poste de commande : confiez une action réelle à Hermès et suivez son
            exécution de bout en bout.
          </p>
        </div>

        <div className={`hermes-status-badge is-${tone}`}>
          <span className="status-pulse" />
          <span>{STATE_LABEL[ux] ?? ux}</span>
        </div>
      </div>

      <div className="hermes-panel-content">
        <div className="hermes-visual-zone">
          <div className="hermes-orbit hermes-orbit-one" />
          <div className="hermes-orbit hermes-orbit-two" />
          <div className="hermes-orbit hermes-orbit-three" />

          <div className="hermes-hologram-frame">
            <HermesHologram state={holo} />
          </div>

          <div className="hermes-core-label">
            <Sparkles size={14} strokeWidth={1.8} />
            <span>HERMÈS CORE</span>
          </div>
        </div>

        <div className="hermes-insight-panel">
          <div className="hermes-insight-top">
            <div className={`hermes-insight-icon is-${tone}`}>
              <ShieldCheck size={18} strokeWidth={1.8} />
            </div>
            <div>
              <span>État Hermès</span>
              <strong>{STATE_LABEL[ux] ?? ux}</strong>
            </div>
          </div>

          {ux === "IDLE" ? (
            <p>
              Prêt à recevoir une commande. Exemple : « qualifier chantier:
              Toiture Nord ».
            </p>
          ) : null}

          {ux === "SUCCEEDED" ? (
            <p>
              Action terminée avec succès.
              {chantierId(activeResult?.result)
                ? ` Chantier créé — id ${chantierId(activeResult?.result)}.`
                : ""}
            </p>
          ) : null}

          {ux === "PENDING_APPROVAL" ? (
            <p>
              Approbation humaine requise (SW15). Traitez la demande dans «
              Approbations en attente » ci-dessous ; l’action reprendra
              automatiquement après approbation.
            </p>
          ) : null}

          {ux === "REJECTED" || ux === "POLICY_DENIED" ? (
            <p>{activeResult?.policyReason ?? "Action refusée."}</p>
          ) : null}

          {ux === "FAILED" ? (
            <p>{activeResult?.error?.message ?? "L’action a échoué."}</p>
          ) : null}

          {ux === "TIMEOUT" ? (
            <p>
              Délai d’attente dépassé côté interface. L’action peut continuer
              côté serveur ; réessayez le suivi plus tard.
            </p>
          ) : null}

          {cmd.phase === "error" && cmd.message ? <p>{cmd.message}</p> : null}

          {requestId ? (
            <span className="agent-req">
              Réf. {requestId}
              {activeResult?.actionKey ? ` · ${activeResult.actionKey}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <form action={formAction} className="hermes-command-zone">
        <div className="hermes-command-header">
          <div>
            <span className="panel-eyebrow">COMMANDE</span>
            <strong>Demandez à Hermès ou lancez une action…</strong>
          </div>
        </div>

        <div className="hermes-command-box">
          <textarea
            name="command"
            aria-label="Commande pour Hermès"
            placeholder="Exemple : qualifier chantier: Toiture Atelier Nord"
            rows={3}
          />

          <div className="hermes-command-actions">
            <span className="hermes-command-hint">
              Action réelle disponible : qualification de chantier.
            </span>

            <button type="submit" className="hermes-send-button" disabled={inFlight}>
              <span>{pending ? "Envoi…" : "Envoyer à Hermès"}</span>
              <ArrowUp size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
