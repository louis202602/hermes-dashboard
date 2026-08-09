"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  pollAgentActionResultAction,
  submitBtpQualificationAction,
  type SubmitState,
} from "@/app/actions/agent-actions";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import {
  TERMINAL_RESULT_STATUSES,
  type ResultOutcome,
} from "@/types/agent-actions";

const INITIAL: SubmitState = { phase: "idle" };

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "En file d’attente",
  RUNNING: "En cours d’exécution",
  SUCCEEDED: "Terminé avec succès",
  FAILED: "Échec",
  POLICY_DENIED: "Refusé par la politique (SW15)",
  PENDING_APPROVAL: "En attente d’approbation",
  NOT_FOUND: "Introuvable",
  UNAUTHENTICATED: "Session expirée",
  NO_TENANT: "Aucun tenant",
  RPC_ERROR: "Service indisponible",
};

function toneFor(status: string): string {
  if (status === "SUCCEEDED") return "ok";
  if (["FAILED", "POLICY_DENIED", "NOT_FOUND", "RPC_ERROR", "UNAUTHENTICATED", "NO_TENANT"].includes(status))
    return "bad";
  if (status === "PENDING_APPROVAL") return "warn";
  return "pending";
}

function resultChantierId(result: unknown): string | null {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.chantier_id === "string") return r.chantier_id;
  }
  return null;
}

export default function AgentActionPanel() {
  const [submitState, formAction, pending] = useActionState(
    submitBtpQualificationAction,
    INITIAL,
  );
  const [result, setResult] = useState<ResultOutcome | null>(null);
  const [polling, setPolling] = useState(false);
  const requestId = submitState.phase === "queued" ? submitState.requestId : undefined;
  const lastPolled = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!requestId || lastPolled.current === requestId) return;
    lastPolled.current = requestId;
    setResult({ ok: true, status: "QUEUED", requestId });
    setPolling(true);

    let attempts = 0;
    const maxAttempts = 40; // ~60s at 1.5s
    const timer = setInterval(async () => {
      attempts += 1;
      const r = await pollAgentActionResultAction(requestId);
      setResult(r);
      if (TERMINAL_RESULT_STATUSES.has(r.status) || attempts >= maxAttempts) {
        clearInterval(timer);
        setPolling(false);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [requestId]);

  const liveStatus = result?.status ?? submitState.status;

  return (
    <section className="dashboard-card agent-action-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">ACTION AGENT</span>
          <h3>Qualifier un chantier</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <form action={formAction} className="agent-action-form">
        <label className="agent-field">
          <span>Nom du chantier *</span>
          <input type="text" name="chantier_name" required placeholder="Ex. Toiture Atelier Nord" />
        </label>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>Client</span>
            <input type="text" name="client" placeholder="Nom du client" />
          </label>
          <label className="agent-field">
            <span>Type</span>
            <select name="type" defaultValue="installation">
              <option value="installation">Installation</option>
              <option value="renovation">Rénovation</option>
              <option value="maintenance">Maintenance</option>
              <option value="autre">Autre</option>
            </select>
          </label>
        </div>
        <label className="agent-field">
          <span>Adresse</span>
          <input type="text" name="adresse" placeholder="Adresse du chantier" />
        </label>

        <button type="submit" className="agent-submit" disabled={pending || polling}>
          {pending ? "Envoi…" : "Déclencher la qualification"}
        </button>
      </form>

      {submitState.phase === "error" ? (
        <div className="agent-status is-bad" role="alert">
          <strong>{STATUS_LABELS[submitState.status ?? ""] ?? "Erreur"}</strong>
          <span>{submitState.message}</span>
        </div>
      ) : null}

      {requestId ? (
        <div className={`agent-status is-${toneFor(liveStatus ?? "QUEUED")}`} aria-live="polite">
          <div className="agent-status-head">
            <strong>{STATUS_LABELS[liveStatus ?? "QUEUED"] ?? liveStatus}</strong>
            {polling ? <span className="agent-spinner" aria-hidden /> : null}
          </div>
          <span className="agent-req">Réf. demande : {requestId}</span>

          {result?.status === "SUCCEEDED" ? (
            <span className="agent-detail">
              Chantier créé
              {resultChantierId(result.result)
                ? ` — id ${resultChantierId(result.result)}`
                : ""}
              .
            </span>
          ) : null}

          {result?.status === "FAILED" ? (
            <span className="agent-detail">
              {result.error?.message ?? "L’action a échoué."}
              {result.error?.code ? ` (${result.error.code})` : ""}
            </span>
          ) : null}

          {result?.status === "POLICY_DENIED" ? (
            <span className="agent-detail">
              {result.policyReason ?? "Action refusée par la politique de sécurité."}
            </span>
          ) : null}

          {result?.status === "PENDING_APPROVAL" ? (
            <span className="agent-detail">
              Une approbation humaine est requise avant exécution.
            </span>
          ) : null}

          {result?.status === "NOT_FOUND" ? (
            <span className="agent-detail">Demande introuvable pour votre tenant.</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
