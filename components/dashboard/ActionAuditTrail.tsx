import {
  CircleSlash,
  FileClock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  ActionApprovalOutcome,
  AuditAction,
  ActionAuditTrail as ActionAuditTrailData,
  ServiceResult,
} from "@/types/hermes";

type Props = {
  audit: ServiceResult<ActionAuditTrailData>;
};

const OUTCOME_LABEL: Record<ActionApprovalOutcome, string> = {
  APPROVED: "Approuvée",
  REJECTED: "Refusée",
  PENDING_APPROVAL: "En attente d’approbation",
  NOT_REQUIRED: "Sans approbation",
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
  return (
    <section className="dashboard-card system-status-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">SÉCURITÉ · AUDIT</span>
          <h3>Journal des actions &amp; approbations</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function ActionAuditTrail({ audit }: Props) {
  if (!audit.ok || audit.data.resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="system-empty">
          Le journal d’audit est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { summary, actions, unavailable } = audit.data;

  const metrics: { label: string; value: number; tone: string }[] = [
    { label: "Actions", value: summary.total, tone: "normal" },
    { label: "Sensibles", value: summary.sensitive, tone: "urgent" },
    {
      label: "Approb. en attente",
      value: summary.pendingApproval,
      tone: summary.pendingApproval > 0 ? "urgent" : "normal",
    },
    {
      label: "Refusées / denied",
      value: summary.rejected + summary.policyDenied,
      tone: summary.rejected + summary.policyDenied > 0 ? "critical" : "normal",
    },
    {
      label: "Échecs",
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
          <span>Historique récent (tenant)</span>
          <ProvenanceBadge provenance="REAL" />
        </div>
        {actions.length === 0 ? (
          <p className="system-line-empty">
            Aucune action enregistrée pour votre tenant.
          </p>
        ) : (
          <ul className="system-line-list">
            {actions.map((a: AuditAction, idx: number) => (
              <li
                key={`aud-${idx}`}
                className={`system-line is-${statusTone(a.status)}`}
              >
                <strong>
                  {a.actionKey}
                  {a.isSensitive ? " · sensible" : ""}
                </strong>
                <span>
                  {(a.status ?? "—") +
                    " · " +
                    OUTCOME_LABEL[a.approvalOutcome] +
                    (a.attempts > 0 ? ` · ${a.attempts} tentative(s)` : "") +
                    (a.errorCode ? " · " + a.errorCode : "") +
                    " · " +
                    fmtDate(a.createdAt)}
                </span>
                <span className={`audit-outcome is-${outcomeTone(a.approvalOutcome)}`}>
                  {OUTCOME_LABEL[a.approvalOutcome]}
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
            <span>Sources d’audit non disponibles</span>
            <ProvenanceBadge provenance="UNAVAILABLE" />
          </div>
          <ul className="system-line-list">
            {unavailable.map((u) => (
              <li key={u} className="system-line is-unavailable">
                <strong>{u}</strong>
                <span>Journal dédié non alimenté</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Frame>
  );
}
