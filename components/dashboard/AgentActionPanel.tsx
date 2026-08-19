"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  pollAgentActionResultAction,
  submitBtpQualificationAction,
  type SubmitState,
} from "@/app/actions/agent-actions";
import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import {
  POLL_BUDGET_MS,
  attemptsWithinBudget,
  pollDelayMs,
} from "@/lib/dashboard/pollSchedule";
import {
  TERMINAL_RESULT_STATUSES,
  type ResultOutcome,
} from "@/types/agent-actions";

const INITIAL: SubmitState = { phase: "idle" };

const KNOWN_STATUSES = new Set<string>([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "POLICY_DENIED",
  "PENDING_APPROVAL",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "NO_TENANT",
  "RPC_ERROR",
]);

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
  const { t } = useI18n();
  const statusLabel = (status: string | undefined): string | undefined =>
    status && KNOWN_STATUSES.has(status)
      ? t(`aap.status.${status}` as MessageKey)
      : undefined;
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
    // PHASE 2 — fenêtre inchangée (~60 s), recul exponentiel : ~7 requêtes au
    // lieu de 40. Voir lib/dashboard/pollSchedule.ts.
    const maxAttempts = attemptsWithinBudget(POLL_BUDGET_MS.form);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const r = await pollAgentActionResultAction(requestId);
      if (stopped) return;
      setResult(r);
      attempts += 1;
      if (TERMINAL_RESULT_STATUSES.has(r.status) || attempts >= maxAttempts) {
        setPolling(false);
        return;
      }
      timer = setTimeout(tick, pollDelayMs(attempts));
    };
    timer = setTimeout(tick, pollDelayMs(0));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [requestId]);

  const liveStatus = result?.status ?? submitState.status;

  return (
    <section className="dashboard-card agent-action-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("aap.eyebrow")}</span>
          <h3>{t("aap.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>

      <form action={formAction} className="agent-action-form">
        <label className="agent-field">
          <span>{t("aap.field.chantierName")}</span>
          <input type="text" name="chantier_name" required placeholder={t("aap.field.chantierNamePlaceholder")} />
        </label>
        <div className="agent-field-row">
          <label className="agent-field">
            <span>{t("aap.field.client")}</span>
            <input type="text" name="client" placeholder={t("aap.field.clientPlaceholder")} />
          </label>
          <label className="agent-field">
            <span>{t("aap.field.type")}</span>
            <select name="type" defaultValue="installation">
              <option value="installation">{t("aap.type.installation")}</option>
              <option value="renovation">{t("aap.type.renovation")}</option>
              <option value="maintenance">{t("aap.type.maintenance")}</option>
              <option value="autre">{t("aap.type.autre")}</option>
            </select>
          </label>
        </div>
        <label className="agent-field">
          <span>{t("aap.field.adresse")}</span>
          <input type="text" name="adresse" placeholder={t("aap.field.adressePlaceholder")} />
        </label>

        <button type="submit" className="agent-submit" disabled={pending || polling}>
          {pending ? t("aap.submitting") : t("aap.submit")}
        </button>
      </form>

      {submitState.phase === "error" ? (
        <div className="agent-status is-bad" role="alert">
          <strong>{statusLabel(submitState.status) ?? t("aap.error")}</strong>
          <span>{submitState.message}</span>
        </div>
      ) : null}

      {requestId ? (
        <div className={`agent-status is-${toneFor(liveStatus ?? "QUEUED")}`} aria-live="polite">
          <div className="agent-status-head">
            <strong>{statusLabel(liveStatus ?? "QUEUED") ?? liveStatus}</strong>
            {polling ? <span className="agent-spinner" aria-hidden /> : null}
          </div>
          <span className="agent-req">{t("aap.requestRef", { id: requestId })}</span>

          {result?.status === "SUCCEEDED" ? (
            <span className="agent-detail">
              {resultChantierId(result.result)
                ? t("aap.chantierCreatedId", {
                    id: resultChantierId(result.result) ?? "",
                  })
                : t("aap.chantierCreated")}
            </span>
          ) : null}

          {result?.status === "FAILED" ? (
            <span className="agent-detail">
              {result.error?.message ?? t("aap.actionFailed")}
              {result.error?.code ? ` (${result.error.code})` : ""}
            </span>
          ) : null}

          {result?.status === "POLICY_DENIED" ? (
            <span className="agent-detail">
              {result.policyReason ?? t("aap.policyDenied")}
            </span>
          ) : null}

          {result?.status === "PENDING_APPROVAL" ? (
            <span className="agent-detail">
              {t("aap.pendingApproval")}
            </span>
          ) : null}

          {result?.status === "NOT_FOUND" ? (
            <span className="agent-detail">{t("aap.notFound")}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
