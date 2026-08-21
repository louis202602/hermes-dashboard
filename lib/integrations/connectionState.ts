import type {
  IntegrationProvider,
  IntegrationStatus,
  TenantIntegration,
} from "@/types/integrations";

/**
 * HERMÈS — Machine à états des connexions, FAIL-CLOSED.
 *
 * Une seule règle gouverne tout ce fichier : **on n'autorise que ce qu'on peut
 * prouver**. Un état inconnu, une date illisible, un jeton expiré, une
 * révocation — tout cela refuse. Le doute n'autorise jamais.
 *
 * Ce module est le MIROIR applicatif de
 * `hermes_os.integration_is_usable(tenant, provider)`. La base reste
 * l'autorité : elle décide pour les consommateurs métier (le standard
 * téléphonique lit la fonction SQL, pas ce fichier). Ici, c'est le rendu et
 * les tests.
 */

/** Le SEUL état qui puisse ouvrir un usage. Tous les autres refusent. */
const USABLE_STATUS: IntegrationStatus = "CONNECTED";

/**
 * Un jeton expiré ne vaut pas mieux qu'une absence de jeton.
 *
 * `expiresAt` nul = pas d'expiration connue (jeton longue durée) : accepté.
 * `expiresAt` illisible = refusé — on ne devine pas une date de validité.
 */
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

/** Motif de refus, pour l'afficher honnêtement plutôt qu'un « indisponible ». */
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

/**
 * Transitions autorisées. Ce n'est pas de la décoration : elle interdit
 * qu'un `REVOKED` redevienne `CONNECTED` sans repasser par un vrai flux OAuth.
 */
const ALLOWED_TRANSITIONS: Record<IntegrationStatus, readonly IntegrationStatus[]> = {
  NOT_CONNECTED: ["CONNECTING"],
  CONNECTING: ["CONNECTED", "ERROR", "NOT_CONNECTED"],
  CONNECTED: ["REAUTH_REQUIRED", "REVOKED", "ERROR"],
  ERROR: ["CONNECTING", "NOT_CONNECTED"],
  // Une ré-authentification repasse par le flux : jamais un retour direct.
  REAUTH_REQUIRED: ["CONNECTING", "REVOKED"],
  // Une connexion révoquée ne « revient » pas : elle est reconnectée.
  REVOKED: ["CONNECTING"],
};

export function canTransition(from: IntegrationStatus, to: IntegrationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Ce que le tenant peut faire depuis l'écran, selon l'état courant.
 * `CONNECTING` n'offre rien : un second clic pendant la redirection créerait
 * un `state` concurrent pour rien.
 */
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

/**
 * Capacités d'agenda déduites de l'état réel.
 *
 * Le standard téléphonique reste UTILE sans agenda : il décroche, qualifie,
 * crée le lead, propose un rappel. Ce qu'il perd, c'est uniquement le droit
 * d'annoncer une disponibilité ou de confirmer un créneau.
 */
export type CalendarCapabilities = {
  canReadAvailability: boolean;
  canProposeSlot: boolean;
  canConfirmBooking: boolean;
  /** Ce qui reste possible quoi qu'il arrive — jamais dégradé. */
  canAnswerCall: true;
  canQualify: true;
  canCreateLead: true;
  canOfferCallback: true;
};

export function calendarCapabilities(input: {
  connection: Pick<TenantIntegration, "status" | "expiresAt"> | null;
  /** La photographe a-t-elle autorisé la lecture d'agenda ? */
  lookupAllowed: boolean;
  now: Date;
}): CalendarCapabilities {
  const usable =
    input.connection !== null && isIntegrationUsable(input.connection, input.now);
  // Il faut LES DEUX : une connexion utilisable ET l'autorisation explicite.
  const allowed = usable && input.lookupAllowed;
  return {
    canReadAvailability: allowed,
    canProposeSlot: allowed,
    // La réservation ferme reste soumise aux approbations (SW15) même avec
    // agenda : ce n'est jamais l'agent qui engage seul le studio.
    canConfirmBooking: false,
    canAnswerCall: true,
    canQualify: true,
    canCreateLead: true,
    canOfferCallback: true,
  };
}

/** Fournisseurs implémentés aujourd'hui. Les autres sont déclarés, pas prêts. */
export const IMPLEMENTED_PROVIDERS: readonly IntegrationProvider[] = ["google_calendar"];

export function isProviderImplemented(provider: IntegrationProvider): boolean {
  return IMPLEMENTED_PROVIDERS.includes(provider);
}
