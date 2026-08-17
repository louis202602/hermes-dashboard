"use client";

import { useCallback, useEffect, useState } from "react";

import {
  approveAgentActionAction,
  listPendingApprovalsAction,
  pollAgentActionResultAction,
  rejectAgentActionAction,
} from "@/app/actions/agent-actions";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslateFn } from "@/lib/i18n/languages";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import { TERMINAL_RESULT_STATUSES, type PendingApproval } from "@/types/agent-actions";

type Banner = { tone: "ok" | "bad"; text: string } | null;
type ResumptionLog = { requestId: string; summary: string; status: string };

const RESULT_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "POLICY_DENIED",
  "REJECTED",
]);

function decisionMessage(
  t: TranslateFn,
  status: string,
  currentStatus?: string | null,
  msg?: string,
): Banner {
  switch (status) {
    case "APPROVED":
      return { tone: "ok", text: t("appr.decision.approved") };
    case "REJECTED":
      return { tone: "ok", text: t("appr.decision.rejected") };
    case "UNAUTHORIZED":
      return { tone: "bad", text: t("appr.decision.unauthorized") };
    case "ALREADY_DECIDED":
      return {
        tone: "bad",
        text: t("appr.decision.alreadyDecided", { status: currentStatus ?? "?" }),
      };
    case "EXPIRED":
      return { tone: "bad", text: t("appr.decision.expired") };
    case "NOT_FOUND":
      return { tone: "bad", text: t("appr.decision.notFound") };
    case "VALIDATION_FAILED":
      return { tone: "bad", text: msg ?? t("appr.decision.reasonRequired") };
    default:
      return { tone: "bad", text: t("appr.decision.actionFailed") };
  }
}

type ApprovalsPanelProps = {
  /** Command Center Home — compact cockpit variant: a pending-count badge in the
   *  header and at most COMPACT_LIMIT rows (still fully actionable). Omitted ⇒ the
   *  full panel (unchanged for the Paramètres / detailed usage). */
  compact?: boolean;
};

const COMPACT_LIMIT = 3;

export default function ApprovalsPanel({ compact = false }: ApprovalsPanelProps) {
  const { t } = useI18n();
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
      setBanner({ tone: "bad", text: t("appr.listUnavailable", { status: r.status }) });
    }
  }, [t]);

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
  }, [t]);

  // Keep the list current WITHOUT polling (COST-FIRST: 0 idle DB reads). Approvals
  // created after mount (e.g. a Command Center action that hits REQUIRE_APPROVAL) are
  // picked up event-driven — when the tab regains focus/visibility — plus after every
  // approve/reject decision (which already call refresh()). No background timer.
  useEffect(() => {
    const onActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onActive);
    return () => {
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onActive);
    };
  }, [refresh]);

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
    setBanner(decisionMessage(t, r.status, r.currentStatus, r.error?.message));
    if (r.status === "APPROVED") trackResumption(a.requestId, a.summary);
    setBusyId(null);
    await refresh();
  }

  async function onReject(a: PendingApproval) {
    setBusyId(a.requestId);
    const r = await rejectAgentActionAction(a.requestId, reason);
    setBanner(decisionMessage(t, r.status, r.currentStatus, r.error?.message));
    setBusyId(null);
    if (r.status === "REJECTED" || r.ok) {
      setRejectFor(null);
      setReason("");
    }
    await refresh();
  }

  // Compact cockpit variant caps the visible rows; the header badge always shows the
  // full pending total so nothing is hidden silently.
  const visibleApprovals = compact ? approvals.slice(0, COMPACT_LIMIT) : approvals;
  const overflow = compact ? approvals.length - visibleApprovals.length : 0;

  return (
    <section
      className={`dashboard-card approvals-card${compact ? " approvals-card-compact" : ""}`}
    >
      <div className="dashboard-card-header">
        <div className="approvals-title">
          <span className="panel-eyebrow">{t("appr.eyebrow")}</span>
          <h3>{t("appr.title")}</h3>
        </div>
        {compact && approvals.length > 0 ? (
          <span
            className="approvals-count-badge"
            aria-label={t("appr.title")}
            title={t("appr.title")}
          >
            {approvals.length}
          </span>
        ) : (
          <ProvenanceBadge provenance="REAL" />
        )}
      </div>

      {banner ? (
        <div className={`agent-status is-${banner.tone === "ok" ? "ok" : "bad"}`} role="status">
          <span>{banner.text}</span>
        </div>
      ) : null}

      {loading ? (
        <p className="projects-empty">{t("common.loading")}</p>
      ) : approvals.length === 0 ? (
        <p className="projects-empty">{t("appr.empty")}</p>
      ) : (
        <ul className="approvals-list">
          {visibleApprovals.map((a) => (
            <li key={a.requestId} className="approval-item">
              <div className="approval-info">
                <strong>{a.summary}</strong>
                <span className="approval-meta">
                  {a.actionKey}
                  {a.policyReason ? ` · ${a.policyReason}` : ""}
                </span>
                <span className="agent-req">{t("appr.ref", { id: a.requestId })}</span>
              </div>

              {rejectFor === a.requestId ? (
                <div className="approval-reject-box">
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("appr.reasonPlaceholder")}
                    aria-label={t("appr.reasonLabel")}
                  />
                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-btn is-reject"
                      disabled={busyId === a.requestId || reason.trim().length === 0}
                      onClick={() => onReject(a)}
                    >
                      {t("appr.confirmReject")}
                    </button>
                    <button
                      type="button"
                      className="approval-btn"
                      onClick={() => {
                        setRejectFor(null);
                        setReason("");
                      }}
                    >
                      {t("common.cancel")}
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
                    {t("appr.approve")}
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
                    {t("appr.reject")}
                  </button>
                </div>
              )}
            </li>
          ))}
          {overflow > 0 ? (
            <li className="approval-more" aria-hidden>
              +{overflow}
            </li>
          ) : null}
        </ul>
      )}

      {resumptions.length > 0 ? (
        <div className="approval-resumptions">
          <span className="kpi-subtle">{t("appr.resumptionTitle")}</span>
          <ul>
            {resumptions.map((r) => (
              <li key={r.requestId}>
                {r.summary} —{" "}
                <strong>
                  {RESULT_STATUSES.has(r.status)
                    ? t(`appr.result.${r.status}` as MessageKey)
                    : r.status}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
