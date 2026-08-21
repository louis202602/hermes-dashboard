/**
 * HERMÈS — Contrats des connexions d'outils par tenant.
 *
 * INVARIANT DE SURFACE : aucun type de ce fichier ne porte de jeton, de
 * `client_secret` ni d'identifiant de secret Vault. Ce qui n'existe pas dans le
 * type ne peut pas fuiter vers le navigateur — c'est délibéré, et testé.
 */

/** Fournisseurs prévus. Ajouter une valeur ici ET une ligne au catalogue. */
export type IntegrationProvider = "google_calendar" | "gmail" | "meta" | "instagram";

/**
 * États d'une connexion.
 *
 * Seul `CONNECTED` autorise un usage — et encore, uniquement si le jeton n'a
 * pas expiré (cf. `isIntegrationUsable`). Tous les autres états sont refusés.
 */
export type IntegrationStatus =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR"
  | "REAUTH_REQUIRED"
  | "REVOKED";

/** Ce que le navigateur reçoit — et rien de plus. */
export type TenantIntegration = {
  provider: IntegrationProvider;
  label: string;
  status: IntegrationStatus;
  /** Libellé masqué du compte connecté (ex. « v•••@gmail.com »). */
  accountLabel: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastErrorCode: string | null;
};

export type TenantIntegrations = {
  resolutionStatus: string;
  tenantId: string | null;
  integrations: TenantIntegration[];
};

/**
 * Retour du démarrage de connexion. Contient le `client_id` (public, il
 * transite de toute façon dans l'URL d'autorisation) et un `state` à usage
 * unique — jamais un `client_secret`, qui n'existe que côté n8n.
 */
export type IntegrationConnectStart = {
  ok: boolean;
  code: string;
  provider: IntegrationProvider | null;
  authorizeUrl: string | null;
  clientId: string | null;
  scopes: string[];
  state: string | null;
};

/** Provisionnement téléphonique, vu par le tenant : un statut, pas l'infra. */
export type PhoneStatus = {
  resolutionStatus: string;
  operational: boolean;
  /** La photographe a-t-elle activé et configuré son standard ? */
  tenantConfigured: boolean;
  /** Hermès a-t-il provisionné l'agent et le numéro ? */
  hermesProvisioned: boolean;
  code: string;
  incomingNumber: string | null;
  /** L'agenda est-il réellement utilisable maintenant ? */
  calendarUsable: boolean;
  costs: PhoneCosts | null;
};

/**
 * Coûts téléphoniques réels.
 *
 * Chaque montant est `null` quand le fournisseur n'a rien facturé — jamais 0.
 * `callsWithoutReportedCost` rend l'écart visible au lieu de le dissimuler
 * dans un total trop bas.
 */
export type PhoneCosts = {
  callCount: number;
  callMinutes: number;
  callsWithoutReportedCost: number;
  retellCostUsd: number | null;
  telephonyCostUsd: number | null;
  llmCostUsd: number | null;
  totalCallCostUsd: number | null;
  provenance: "REAL" | "PARTIAL" | "UNAVAILABLE";
};
