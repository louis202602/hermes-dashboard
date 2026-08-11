/**
 * Common UI-state block — the single presentational primitive for the mandatory
 * states every data surface must handle: LOADING / EMPTY / SUCCESS / WARNING /
 * ERROR / OFFLINE / UNAVAILABLE / PERMISSION_DENIED. No data, no fabrication —
 * the caller supplies the title/detail.
 */
import {
  CircleSlash,
  Inbox,
  Loader,
  LockKeyhole,
  TriangleAlert,
  WifiOff,
} from "lucide-react";

export type UiState =
  | "LOADING"
  | "EMPTY"
  | "SUCCESS"
  | "WARNING"
  | "ERROR"
  | "OFFLINE"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED";

const DEFAULT_TITLE: Record<UiState, string> = {
  LOADING: "Chargement…",
  EMPTY: "Rien à afficher",
  SUCCESS: "C’est fait",
  WARNING: "Attention",
  ERROR: "Une erreur est survenue",
  OFFLINE: "Hors ligne",
  UNAVAILABLE: "Indisponible",
  PERMISSION_DENIED: "Accès non autorisé",
};

function iconFor(state: UiState) {
  switch (state) {
    case "LOADING":
      return <Loader size={20} strokeWidth={1.8} className="ds-spin" />;
    case "EMPTY":
      return <Inbox size={20} strokeWidth={1.8} />;
    case "OFFLINE":
      return <WifiOff size={20} strokeWidth={1.8} />;
    case "PERMISSION_DENIED":
      return <LockKeyhole size={20} strokeWidth={1.8} />;
    case "UNAVAILABLE":
      return <CircleSlash size={20} strokeWidth={1.8} />;
    default:
      return <TriangleAlert size={20} strokeWidth={1.8} />;
  }
}

export default function StateBlock({
  state,
  title,
  detail,
  action,
}: {
  state: UiState;
  title?: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`ds-state is-${state.toLowerCase()}`} role="status" aria-live="polite">
      <span className="ds-state-icon">{iconFor(state)}</span>
      <span className="ds-state-title">{title ?? DEFAULT_TITLE[state]}</span>
      {detail ? <span className="ds-state-detail">{detail}</span> : null}
      {action}
    </div>
  );
}
