import type {
  IntegrationProvider,
  IntegrationStatus,
  TenantIntegration,
} from "@/types/integrations";

const USABLE_STATUS: IntegrationStatus = "CONNECTED";

export function isIntegrationUsable(
  integration: Pick<TenantIntegration, "status" | "expiresAt">,
  now: Date,
): boolean {
  if (integration.status !== USABLE_STATUS) return false;
  if (integration.expiresAt === null) return true;
  const expiry = new Date(integration.expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

export type UnusableReason =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "ERROR"
  | "REAUTH_REQUIRED"
  | "REVOKED"
  | "EXPIRED"
  | "NONE";

export function unusableReason(
  integration: Pick<TenantIntegration, "status" | "expiresAt">,
  now: Date,
): UnusableReason {
  if (isIntegrationUsable(integration, now)) return "NONE";
  if (integration.status === "CONNECTED") return "EXPIRED";
  return integration.status as UnusableReason;
}

const ALLOWED_TRANSITIONS: Record<IntegrationStatus, readonly IntegrationStatus[]> = {
  NOT_CONNECTED: ["CONNECTING"],
  CONNECTING: ["CONNECTED", "ERROR", "NOT_CONNECTED"],
  CONNECTED: ["REAUTH_REQUIRED", "REVOKED", "ERROR"],
  ERROR: ["CONNECTING", "NOT_CONNECTED"],
  REAUTH_REQUIRED: ["CONNECTING", "REVOKED"],
  REVOKED: ["CONNECTING"],
};

export function canTransition(from: IntegrationStatus, to: IntegrationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type IntegrationAction = "CONNECT" | "RECONNECT" | "REVOKE" | "WAIT";

export function availableActions(status: IntegrationStatus): IntegrationAction[] {
  switch (status) {
    case "NOT_CONNECTED":
      return ["CONNECT"];
    case "CONNECTING":
      return ["WAIT"];
    case "CONNECTED":
      return ["REVOKE"];
    case "REAUTH_REQUIRED":
    case "ERROR":
    case "REVOKED":
      return ["RECONNECT"];
    default:
      return [];
  }
}

export type CalendarCapabilities = {
  canReadAvailability: boolean;
  canProposeSlot: boolean;
  canConfirmBooking: boolean;
  canAnswerCall: true;
  canQualify: true;
  canCreateLead: true;
  canOfferCallback: true;
};

export function calendarCapabilities(input: {
  connection: Pick<TenantIntegration, "status" | "expiresAt"> | null;
  lookupAllowed: boolean;
  now: Date;
}): CalendarCapabilities {
  const usable =
    input.connection !== null && isIntegrationUsable(input.connection, input.now);
  const allowed = usable && input.lookupAllowed;
  return {
    canReadAvailability: allowed,
    canProposeSlot: allowed,
    canConfirmBooking: false,
    canAnswerCall: true,
    canQualify: true,
    canCreateLead: true,
    canOfferCallback: true,
  };
}

/** Fournisseurs dont le flux de connexion est réellement implémenté. */
export const IMPLEMENTED_PROVIDERS: readonly IntegrationProvider[] = ["google_calendar", "qonto"];

export function isProviderImplemented(provider: IntegrationProvider): boolean {
  return IMPLEMENTED_PROVIDERS.includes(provider);
}
