"use client";

import {
  Bot,
  ChevronRight,
  MessageSquareText,
  Sparkles,
  UserRound,
} from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey, TranslateFn } from "@/lib/i18n/languages";
import type {
  RecentConversation,
  RecentConversations as RecentConversationsData,
  ServiceResult,
} from "@/types/hermes";

type RecentConversationsProps = {
  conversations: ServiceResult<RecentConversationsData>;
};

function relativeTime(iso: string | null, t: TranslateFn): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return t("conv.time.now");
  if (diffMin < 60) return t("conv.time.minutes", { count: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t("conv.time.hours", { count: diffH });
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return t("conv.time.yesterday");
  return t("conv.time.days", { count: diffD });
}

// Business outcome → avatar style. Never exposes internal ids.
function outcomeTone(outcome: string | null): string {
  const o = (outcome ?? "").toUpperCase();
  if (o === "ACTION" || o === "PENDING_APPROVAL") return "agent";
  if (o === "ANSWER_ONLY") return "project";
  return "system";
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card conversations-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("conv.eyebrow")}</span>
          <h3>{t("conv.title")}</h3>
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
  const { t } = useI18n();

  if (!conversations.ok) {
    return (
      <Frame>
        <p className="conversations-empty">{t("conv.unavailable")}</p>
      </Frame>
    );
  }

  const { resolutionStatus, conversations: rows } = conversations.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="conversations-empty">
          {t(`conv.resolution.${resolutionStatus}` as MessageKey)}
        </p>
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="conversations-empty">{t("conv.empty")}</p>
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
                <span>{conversation.preview || t("common.none")}</span>
              </span>

              <span className="conversation-time">
                {relativeTime(conversation.lastMessageAt, t)}
              </span>

              <ChevronRight size={16} strokeWidth={1.8} />
            </div>
          );
        })}
      </div>

      <div className="conversations-footer-note">
        <MessageSquareText size={16} strokeWidth={1.8} />
        <span>{t("conv.footerNote")}</span>
      </div>
    </Frame>
  );
}
