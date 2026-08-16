"use client";

import {
  CircleSlash,
  FileClock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type {
  ActionApprovalOutcome,
  AuditAction,
  ActionAuditTrail as ActionAuditTrailData,
  ServiceResult,
} from "@/types/hermes";

type Props = {
  audit: ServiceResult<ActionAuditTrailData>;
};

function outcomeTone(o: ActionApprovalOutcome): string {
  if (o === "REJECTED") return "critical";
  if (o === "PENDING_APPROVAL") return "urgent";
  if (o === "APPROVED") return "normal";
  return "unavailable";
}

function statusTone(status: string | null): string {
  const s = (status ?? "").toUpperCase();
  if (s.includes("FAIL") || s.includes("DENIED") || s.includes("REJECT"))
    return "critical";
  if (s.includes("QUEUED") || s.includes("PENDING") || s.includes("RUNNING"))
    return "urgent";
  if (s.includes("SUCCEED") || s.includes("SUCCESS") || s.includes("DONE"))
    return "normal";
  return "normal";
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

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("audit.eyebrow")}</span>
          <h3>{t("audit.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ActionAuditTrail({ audit }: Props) {
  const { t } = useI18n();

  if (!audit.ok || audit.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">{t("audit.unavailable")}</p>
      </Frame>
    );
  }

  const { summary, actions, unavailable } = audit.data;

  const metrics: { label: string; value: number; tone: string }[] = [
    { label: t("audit.metric.actions"), value: summary.total, tone: "normal" },
    { label: t("audit.metric.sensitive"), value: summary.sensitive, tone: "urgent" },
    {
      label: t("audit.metric.pending"),
      value: summary.pendingApproval,
      tone: summary.pendingApproval > 0 ? "urgent" : "normal",
    },
    {
      label: t("audit.metric.rejected"),
      value: summary.rejected + summary.policyDenied,
      tone: summary.rejected + summary.policyDenied > 0 ? "critical" : "normal",
    },
    {
      label: t("audit.metric.failed"),
      value: summary.failed,
      tone: summary.failed > 0 ? "critical" : "normal",
    },
  ];

  return (
    <Frame>
      <div className="system-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="system-metric">
            {m.tone === "critical" ? (
              <ShieldAlert size={17} strokeWidth={1.8} />
            ) : (
              <ShieldCheck size={17} strokeWidth={1.8} />
            )}
            <div>
              <span>{m.label}</span>
              <strong>{m.value}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="system-subsection">
        <div className="system-subsection-head">
          <FileClock size={15} strokeWidth={1.9} />
          <span>{t("audit.recent")}</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {actions.length === 0 ? (
          <p className="system-line-empty">{t("audit.emptyActions")}</p>
        ) : (
          <ul className="system-line-list">
            {actions.map((a: AuditAction, idx: number) => (
              <li
                key={`aud-${idx}`}
                className={`system-line is-${statusTone(a.status)}`}
              >
                <strong>
                  {a.actionKey}
                  {a.isSensitive ? ` · ${t("audit.sensitiveTag")}` : ""}
                </strong>
                <span>
                  {(a.status ?? "—") +
                    " · " +
                    t(`audit.outcome.${a.approvalOutcome}` as MessageKey) +
                    (a.attempts > 0
                      ? ` · ${t("audit.attempts", { count: a.attempts })}`
                      : "") +
                    (a.errorCode ? " · " + a.errorCode : "") +
                    " · " +
                    fmtDate(a.createdAt)}
                </span>
                <span className={`audit-outcome is-${outcomeTone(a.approvalOutcome)}`}>
                  {t(`audit.outcome.${a.approvalOutcome}` as MessageKey)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {unavailable.length > 0 ? (
        <div className="system-subsection">
          <div className="system-subsection-head">
            <CircleSlash size={15} strokeWidth={1.9} />
            <span>{t("audit.unavailableSources")}</span>
            <ProvenanceBadge provenance="UNAVAILABLE" />
          </div>
          <ul className="system-line-list">
            {unavailable.map((u) => (
              <li key={u} className="system-line is-unavailable">
                <strong>{u}</strong>
                <span>{t("audit.notFed")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Frame>
  );
}
