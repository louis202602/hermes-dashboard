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
import type {
  AvailableCapabilities,
  AvailableCapability,
  ServiceResult,
  TenantResolutionStatus,
} from "@/types/hermes";

type QuickActionsProps = {
  capabilities: ServiceResult<AvailableCapabilities>;
};

const RESOLUTION_MESSAGES: Record<TenantResolutionStatus, string> = {
  OK: "",
  UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
  NO_TENANT: "Aucun tenant n’est associé à votre compte.",
  ACCESS_DENIED: "Accès refusé pour le tenant demandé.",
  AMBIGUOUS_TENANT_REQUIRE_SELECTION:
    "Plusieurs tenants disponibles : sélection requise.",
};

function iconFor(actionKey: string): LucideIcon {
  if (actionKey.includes("qualification")) return ScanSearch;
  if (actionKey.includes("planning")) return CalendarPlus;
  if (actionKey.includes("suivi")) return Activity;
  if (actionKey.includes("diag")) return Bot;
  return Sparkles;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-card quick-actions-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">EXÉCUTION</span>
          <h3>Actions disponibles</h3>
        </div>
        <ProvenanceBadge provenance="REAL" />
      </div>
      {children}
    </section>
  );
}

export default function QuickActions({ capabilities }: QuickActionsProps) {
  if (!capabilities.ok) {
    return (
      <Frame>
        <p className="quick-actions-empty">
          Les actions disponibles sont indisponibles pour le moment.
        </p>
      </Frame>
    );
  }

  const { resolutionStatus, capabilities: rows } = capabilities.data;

  if (resolutionStatus !== "OK") {
    return (
      <Frame>
        <p className="quick-actions-empty">
          {RESOLUTION_MESSAGES[resolutionStatus]}
        </p>
      </Frame>
    );
  }

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="quick-actions-empty">
          Aucune action n’est autorisée pour votre profil sur ce tenant.
        </p>
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
                <span className="quick-action-flag" title="Action sensible : approbation SW15 requise">
                  <ShieldAlert size={14} strokeWidth={1.9} />
                  <span>Sensible</span>
                </span>
              ) : null}
            </a>
          );
        })}
      </div>

      <p className="quick-actions-note">
        Ces actions passent par Hermès : permissions, tenant et politique SW15
        appliqués. Décrivez votre demande dans le poste de commande ci-dessus.
      </p>
    </Frame>
  );
}
