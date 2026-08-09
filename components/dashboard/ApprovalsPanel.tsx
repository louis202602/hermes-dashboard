"use client";

import { useCallback, useEffect, useState } from "react";

import {
  approveAgentActionAction,
  listPendingApprovalsAction,
  pollAgentActionResultAction,
  rejectAgentActionAction,
} from "@/app/actions/agent-actions";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { TERMINAL_RESULT_STATUSES, type PendingApproval } from "@/types/agent-actions";

type Banner = { tone: "ok" | "bad"; text: string } | null;
type ResumptionLog = { requestId: string; summary: string; status: string };

const RESULT_LABELS: Record<string, string> = {
  QUEUED: "En file",
  RUNNING: "En cours",
  SUCCEEDED: "Terminé",
  FAILED: "Échec",
  POLICY_DENIED: "Refusé (SW15)",
  REJECTED: "Refusé",
};

function decisionMessage(status: string, currentStatus?: string | null, msg?: string): Banner {
  switch (status) {
    case "APPROVED":
      return { tone: "ok", text: "Demande approuvée — reprise de l’exécution." };
    case "REJECTED":
      return { tone: "ok", text: "Demande refusée." };
    case "UNAUTHORIZED":
      return { tone: "bad", text: "Droit d’approbation requis (tenant.admin)." };
    case "ALREADY_DECIDED":
      return { tone: "bad", text: `Demande déjà traitée (${currentStatus ?? "?"}).` };
    case "EXPIRED":
      return { tone: "bad", text: "Demande expirée — refusée automatiquement." };
    case "NOT_FOUND":
      return { tone: "bad", text: "Demande introuvable pour votre tenant." };
    case "VALIDATION_FAILED":
      return { tone: "bad", text: msg ?? "Motif de refus requis." };
    default:
      return { tone: "bad", text: "Action impossible pour le moment." };
  }
}

export default function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [resumptions, setResumptions] = useState<ResumptionLog[]>([]);

  // Re-fetch the pending list (used after a decision). Keeps the list visible
  // while refreshing (no synchronous loading flip).
  const refresh = useCallback(async () => {
    const r = await listPendingApprovalsAction();
    if (r.ok) {
      setApprovals(r.approvals);
    } else {
      setBanner({ tone: "bad", text: `Liste indisponible (${r.status}).` });
    }
  }, []);

  // Initial load. State is only set after the await, so nothing runs
  // synchronously inside the effect body.
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await listPendingApprovalsAction();
      if (!active) return;
      if (r.ok) setApprovals(r.approvals);
      else setBanner({ tone: "bad", text: `Liste indisponible (${r.status}).` });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const trackResumption = useCallback((requestId: string, summary: string) => {
    setResumptions((prev) => [
      { requestId, summary, status: "QUEUED" },
      ...prev.filter((x) => x.requestId !== requestId),
    ]);
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const r = await pollAgentActionResultAction(requestId);
      setResumptions((prev) =>
        prev.map((x) => (x.requestId === requestId ? { ...x, status: r.status } : x)),
      );
      if (TERMINAL_RESULT_STATUSES.has(r.status) || attempts >= 40) clearInterval(timer);
    }, 1500);
  }, []);

  async function onApprove(a: PendingApproval) {
    setBusyId(a.requestId);
    const r = await approveAgentActionAction(a.requestId);
    setBanner(decisionMessage(r.status, r.currentStatus, r.error?.message));
    if (r.status === "APPROVED") trackResumption(a.requestId, a.summary);
    setBusyId(null);
    await refresh();
  }

  async function onReject(a: PendingApproval) {
    setBusyId(a.requestId);
    const r = await rejectAgentActionAction(a.requestId, reason);
    setBanner(decisionMessage(r.status, r.currentStatus, r.error?.message));
    setBusyId(null);
    if (r.status === "REJECTED" || r.ok) {
      setRejectFor(null);
      setReason("");
    }
    await refresh();
  }

  return (
    <section className="dashboard-card approvals-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">GOUVERNANCE</span>
          <h3>Approbations en attente</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      {banner ? (
        <div className={`agent-status is-${banner.tone === "ok" ? "ok" : "bad"}`} role="status">
          <span>{banner.text}</span>
        </div>
      ) : null}

      {loading ? (
        <p className="projects-empty">Chargement…</p>
      ) : approvals.length === 0 ? (
        <p className="projects-empty">Aucune approbation en attente.</p>
      ) : (
        <ul className="approvals-list">
          {approvals.map((a) => (
            <li key={a.requestId} className="approval-item">
              <div className="approval-info">
                <strong>{a.summary}</strong>
                <span className="approval-meta">
                  {a.actionKey}
                  {a.policyReason ? ` · ${a.policyReason}` : ""}
                </span>
                <span className="agent-req">Réf. {a.requestId}</span>
              </div>

              {rejectFor === a.requestId ? (
                <div className="approval-reject-box">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motif du refus (requis)"
                    aria-label="Motif du refus"
                  />
                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-btn is-reject"
                      disabled={busyId === a.requestId || reason.trim().length === 0}
                      onClick={() => onReject(a)}
                    >
                      Confirmer le refus
                    </button>
                    <button
                      type="button"
                      className="approval-btn"
                      onClick={() => {
                        setRejectFor(null);
                        setReason("");
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <div className="approval-actions">
                  <button
                    type="button"
                    className="approval-btn is-approve"
                    disabled={busyId === a.requestId}
                    onClick={() => onApprove(a)}
                  >
                    Approuver
                  </button>
                  <button
                    type="button"
                    className="approval-btn is-reject"
                    disabled={busyId === a.requestId}
                    onClick={() => {
                      setRejectFor(a.requestId);
                      setReason("");
                    }}
                  >
                    Refuser
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {resumptions.length > 0 ? (
        <div className="approval-resumptions">
          <span className="kpi-subtle">Reprise après approbation</span>
          <ul>
            {resumptions.map((r) => (
              <li key={r.requestId}>
                {r.summary} — <strong>{RESULT_LABELS[r.status] ?? r.status}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
