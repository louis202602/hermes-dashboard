"use client";

import {
  Activity,
  Bot,
  CalendarPlus,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import ProvenanceBadge from "@/components/common/ProvenanceBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import type {
  AvailableCapabilities,
  AvailableCapability,
  ServiceResult,
} from "@/types/hermes";

type QuickActionsProps = {
  capabilities: ServiceResult<AvailableCapabilities>;
};

function iconFor(actionKey: string): LucideIcon {
  if (actionKey.includes("qualification")) return ScanSearch;
  if (actionKey.includes("planning")) return CalendarPlus;
  if (actionKey.includes("suivi")) return Activity;
  if (actionKey.includes("diag")) return Bot;
  return Sparkles;
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="dashboard-card quick-actions-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">{t("qa.eyebrow")}</span>
          <h3>{t("qa.title")}</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function QuickActions({ capabilities }: QuickActionsProps) {
  const { t } = useI18n();

  if (!capabilities.ok) {
    return (
      <Frame>
        <p className="quick-actions-empty">{t("qa.cardUnavailable")}</p>
      </Frame>
    );
  }

  const { resolutionStatus, capabilities: rows } = capabilities.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="quick-actions-empty">
          {t(`qa.resolution.${resolutionStatus}` as MessageKey)}
        </p>
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="quick-actions-empty">{t("qa.emptyNoActions")}</p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="quick-actions-grid">
        {rows.map((capability: AvailableCapability) => {
          const Icon = iconFor(capability.actionKey);

          return (
            // Routes to the Hermès command center (the existing secure path:
            // orchestrator → gateway → permissions → SW15). Never a direct mutation.
            <a
              className="quick-action-item"
              href="#hermes-command"
              key={capability.actionKey}
            >
              <span className="quick-action-icon">
                <Icon size={19} strokeWidth={1.8} />
              </span>

              <span className="quick-action-copy">
                <strong>{capability.displayName}</strong>
                <span>{capability.description ?? capability.actionKey}</span>
              </span>

              {capability.isSensitive ? (
                <span className="quick-action-flag" title={t("qa.sensitiveTitle")}>
                  <ShieldAlert size={14} strokeWidth={1.9} />
                  <span>{t("qa.sensitive")}</span>
                </span>
              ) : null}
            </a>
          );
        })}
      </div>

      <p className="quick-actions-note">{t("qa.note")}</p>
    </Frame>
  );
}
