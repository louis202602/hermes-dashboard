import {
  Bot,
  ChevronRight,
  MessageSquareText,
  Sparkles,
  UserRound,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import type {
  RecentConversation,
  RecentConversations as RecentConversationsData,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

type RecentConversationsProps = {
  conversations: ServiceResult<RecentConversationsData>;
};

const RESOLUTION_MESSAGES: Record<TenantResolutionStatus, string> = {
  OK: "",
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucun tenant n’est associé à votre compte.",
  ACCESS_DENIED: "Accès refusé pour le tenant demandé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION:
    "Plusieurs tenants disponibles : sélection requise.",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return "À l’instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return "Hier";
  return `Il y a ${diffD} j`;
}

// Business outcome → avatar style. Never exposes internal ids.
function outcomeTone(outcome: string | null): string {
  const o = (outcome ?? "").toUpperCase();
  if (o === "ACTION" || o === "PENDING_APPROVAL") return "agent";
  if (o === "ANSWER_ONLY") return "project";
  return "system";
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card conversations-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HISTORIQUE</span>
          <h3>Conversations récentes</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

function OutcomeIcon({ tone }: { tone: string }) {
  if (tone === "agent") return <Bot size={18} strokeWidth={1.8} />;
  if (tone === "project") return <Sparkles size={18} strokeWidth={1.8} />;
  return <UserRound size={18} strokeWidth={1.8} />;
}

export default function RecentConversations({
  conversations,
}: RecentConversationsProps) {
  if (!conversations.ok) {
    return (
      <Frame>
        <p className="conversations-empty">
          L’historique des conversations est indisponible pour le moment.
        </p>
      </Frame>
    );
  }

  const { resolutionStatus, conversations: rows } = conversations.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="conversations-empty">
          {RESOLUTION_MESSAGES[resolutionStatus]}
        </p>
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="conversations-empty">
          Aucune conversation pour le moment. Posez une question à Hermès
          ci-dessus pour démarrer.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="conversation-list">
        {rows.map((conversation: RecentConversation) => {
          const tone = outcomeTone(conversation.outcome);

          return (
            <div className="conversation-item" key={conversation.id}>
              <span className={`conversation-avatar is-${tone}`}>
                <OutcomeIcon tone={tone} />
              </span>

              <span className="conversation-copy">
                <strong>{conversation.title}</strong>
                <span>{conversation.preview || "—"}</span>
              </span>

              <span className="conversation-time">
                {relativeTime(conversation.lastMessageAt)}
              </span>

              <ChevronRight size={16} strokeWidth={1.8} />
            </div>
          );
        })}
      </div>

      <div className="conversations-footer-note">
        <MessageSquareText size={16} strokeWidth={1.8} />
        <span>Vos échanges Hermès, limités à votre tenant.</span>
      </div>
    </Frame>
  );
}
