/**
 * Hermès action-lifecycle status pill. Presentational only — it renders one of
 * the canonical action states with the official colour language. Data comes from
 * the caller (never fabricated here).
 */

export type ActionLifecycle =
  | "QUEUED"
  | "RUNNING"
  | "PENDING_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "RECOVERED";

const LABEL: Record<ActionLifecycle, string> = {
  QUEUED: "En file",
  RUNNING: "En cours",
  PENDING_APPROVAL: "À approuver",
  SUCCEEDED: "Réussie",
  FAILED: "Échec",
  REJECTED: "Refusée",
  RECOVERED: "Reprise",
};

export default function StatusPill({
  status,
  label,
}: {
  status: ActionLifecycle;
  label?: string;
}) {
  return (
    <span className={`ds-status is-${status.toLowerCase()}`} data-status={status}>
      <span className="ds-status-dot" />
      {label ?? LABEL[status]}
    </span>
  );
}
