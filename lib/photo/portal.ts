/**
 * HERMÈS STUDIO — PORTAIL CLIENT.
 *
 * Un client du studio n'est PAS un utilisateur d'Hermès : il n'a pas de compte
 * Supabase, pas de tenant, pas de permission. Lui donner un accès pose donc une
 * question qu'aucun autre écran ne pose — comment laisser entrer quelqu'un qui
 * n'existe pas dans le modèle de droits, sans ouvrir une porte dérobée ?
 *
 * La réponse tenue ici : **un jeton de portée**. Il ne désigne pas une identité,
 * il désigne exactement une paire `(tenant_id, client_id)`. Tout ce que le
 * portail rend doit appartenir à cette paire — vérifié ressource par ressource,
 * jamais « déduit » du fait que le jeton est valide.
 *
 * Deux règles qui font tout le travail :
 *
 *   1. **Double appartenance.** Une ressource n'est lisible que si SON tenant et
 *      SON client correspondent. Un seul des deux ne suffit pas : c'est la
 *      différence entre « les clients de Vanessa » et « ce client-ci ».
 *   2. **Liste blanche de champs.** Le portail ne masque pas des champs
 *      sensibles, il n'en connaît qu'une liste finie. Une colonne ajoutée demain
 *      à `photo_clients` n'apparaît pas au portail par accident.
 *
 * Ce module est un MODULE de la verticale photographie, pas une seconde
 * application : mêmes tables, même tenant, même isolation.
 *
 * Pur, sans I/O.
 */

// --- Portée du jeton -----------------------------------------------------------

export type PortalScope = {
  tenantId: string;
  clientId: string;
  /** Fin de validité. Un jeton sans expiration est refusé. */
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export const PORTAL_DENY_CODES = [
  "NO_SCOPE",
  "MALFORMED_SCOPE",
  "EXPIRED",
  "REVOKED",
  "TENANT_MISMATCH",
  "CLIENT_MISMATCH",
  "SECTION_NOT_GRANTED",
  "RESOURCE_UNIDENTIFIED",
] as const;
export type PortalDenyCode = (typeof PORTAL_DENY_CODES)[number];

export type PortalCheck = { allowed: true } | { allowed: false; code: PortalDenyCode };

/**
 * Le jeton est-il utilisable maintenant ?
 *
 * FAIL-CLOSED sur l'absence : un jeton sans expiration n'est pas « éternel »,
 * il est invalide. Un lien de portail qui ne périme jamais finit par circuler.
 */
export function isScopeUsable(scope: PortalScope | null | undefined, now: Date): PortalCheck {
  if (!scope) return { allowed: false, code: "NO_SCOPE" };
  if (!nonEmpty(scope.tenantId) || !nonEmpty(scope.clientId)) {
    return { allowed: false, code: "MALFORMED_SCOPE" };
  }
  if (scope.revokedAt instanceof Date && !Number.isNaN(scope.revokedAt.getTime())) {
    return { allowed: false, code: "REVOKED" };
  }
  if (!(scope.expiresAt instanceof Date) || Number.isNaN(scope.expiresAt.getTime())) {
    return { allowed: false, code: "EXPIRED" };
  }
  if (scope.expiresAt.getTime() <= now.getTime()) return { allowed: false, code: "EXPIRED" };
  return { allowed: true };
}

// --- Appartenance d'une ressource ----------------------------------------------

/** Toute ressource servie au portail DOIT porter ces deux champs. */
export type OwnedResource = {
  tenantId: string | null;
  clientId: string | null;
};

/**
 * LA vérification d'isolation. Les deux appartenances, dans cet ordre.
 *
 * Une ressource dont le `clientId` est `null` est REFUSÉE, même si son tenant
 * correspond : une ressource non rattachée à un client n'appartient à personne
 * en particulier, donc à aucun client en particulier.
 */
export function canReadResource(
  scope: PortalScope,
  resource: OwnedResource | null | undefined,
  now: Date,
): PortalCheck {
  const usable = isScopeUsable(scope, now);
  if (!usable.allowed) return usable;
  if (!resource) return { allowed: false, code: "RESOURCE_UNIDENTIFIED" };
  if (!nonEmpty(resource.tenantId) || !nonEmpty(resource.clientId)) {
    return { allowed: false, code: "RESOURCE_UNIDENTIFIED" };
  }
  if (resource.tenantId !== scope.tenantId) return { allowed: false, code: "TENANT_MISMATCH" };
  if (resource.clientId !== scope.clientId) return { allowed: false, code: "CLIENT_MISMATCH" };
  return { allowed: true };
}

/** Filtre une collection. Ce qui ne passe pas n'est pas masqué : il n'est pas rendu. */
export function filterOwned<T extends OwnedResource>(
  scope: PortalScope,
  rows: readonly T[],
  now: Date,
): T[] {
  if (!isScopeUsable(scope, now).allowed) return [];
  return rows.filter((r) => canReadResource(scope, r, now).allowed);
}

// --- Sections et champs --------------------------------------------------------

export const PORTAL_SECTIONS = [
  "session",
  "booking",
  "quote",
  "contract",
  "signature",
  "payments",
  "questionnaire",
  "messages",
  "gallery",
  "documents",
  "invoices",
  "next_steps",
] as const;
export type PortalSection = (typeof PORTAL_SECTIONS)[number];

/**
 * LISTE BLANCHE des champs par section. Le portail ne projette QUE ceci.
 *
 * Ce qui n'y figure pas ne peut pas fuir : `lead_score`, `score_factors`,
 * `notes` internes, `lifetime_value_eur`, marges, coûts, `crm_external_id`,
 * ou les données d'un autre client. L'absence est structurelle, pas défensive.
 */
export const PORTAL_FIELDS: Record<PortalSection, string[]> = {
  session: ["sessionType", "title", "scheduledAt", "locationLabel", "status"],
  booking: ["bookingState", "confirmedAt", "nextAction"],
  quote: ["quoteNumber", "issuedAt", "expiresAt", "totalEur", "lines", "status"],
  contract: ["contractNumber", "issuedAt", "status", "documentUrl"],
  signature: ["signedAt", "signerName", "method"],
  payments: ["depositExpectedEur", "depositPaidEur", "balanceDueEur", "paidAt", "status"],
  questionnaire: ["questions", "answers", "submittedAt"],
  messages: ["direction", "body", "sentAt", "channel"],
  gallery: ["url", "status", "publishedAt", "photoCount"],
  documents: ["label", "kind", "url", "issuedAt"],
  invoices: ["invoiceNumber", "amountTtcEur", "issuedAt", "dueAt", "status"],
  next_steps: ["label", "dueAt", "actionRequired"],
};

/**
 * Réduit un objet à la liste blanche de sa section. Tout champ non listé
 * DISPARAÎT — y compris s'il a été ajouté en amont par erreur.
 */
export function projectSection<T extends Record<string, unknown>>(
  section: PortalSection,
  row: T,
): Record<string, unknown> {
  const allowed = PORTAL_FIELDS[section] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * Sections réellement affichées. Une section n'apparaît que si le studio a
 * activé le module correspondant ET qu'il y a quelque chose à montrer : un
 * onglet « Galerie » vide devant un client qui attend ses photos est une
 * promesse non tenue.
 */
export function visibleSections(
  granted: Iterable<PortalSection>,
  withContent: Iterable<PortalSection>,
): PortalSection[] {
  const g = granted instanceof Set ? granted : new Set(granted);
  const n = withContent instanceof Set ? withContent : new Set(withContent);
  return PORTAL_SECTIONS.filter((s) => g.has(s) && n.has(s));
}

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}
