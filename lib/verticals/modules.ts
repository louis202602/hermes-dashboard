/**
 * HERMÈS — MODULE_REGISTRY : l'unité d'activation d'une application unique.
 *
 * Un module est la plus petite chose qu'un tenant peut avoir ou ne pas avoir. Il
 * possède ses routes, ses widgets et ses préfixes d'action. Tout le reste
 * (menu, dashboard, garde serveur) se DÉDUIT de la liste des modules accordés —
 * il n'y a donc jamais deux vérités à synchroniser.
 *
 * RÉUTILISATION, PAS DUPLICATION. Un module n'invente aucun vocabulaire : il
 * s'ouvre sur les `CapabilityToken` déjà définis par le moteur de profils
 * (`lib/dashboard/profiles.ts`) et ne cite que des widgets déjà présents au
 * registre (`lib/dashboard/widgets.ts`). Il n'existe donc pas de « deuxième
 * système de droits » : les capacités restent la vérité, les modules ne font que
 * les regrouper en unités lisibles par un humain.
 *
 * Pur, sans I/O, testable. Aucun `if` métier : c'est une table de données.
 */

import type { CapabilityToken } from "@/lib/dashboard/profiles";
import type { MessageKey } from "@/lib/i18n/languages";

/**
 * Identifiants de modules. Ce sont des clés PERSISTABLES (elles finiront dans
 * `tenant_module_activation`), donc cette liste ne fait que croître.
 */
export const MODULE_IDS = [
  // — noyau : présent pour tout tenant, quelle que soit la verticale —
  "core.home",
  "core.chat",
  "core.activity",
  "core.company",
  "core.agents",
  "core.approvals",
  "core.security",
  "core.integrations",
  "core.notifications",
  "core.billing",
  "core.settings",
  "core.help",
  // — transversaux : accordés par capacité, partagés par plusieurs verticales —
  "crm.prospects",
  "crm.clients",
  "agenda",
  "phone",
  "campaigns",
  "documents",
  // — verticale photographie —
  "photo.sessions",
  "photo.gallery",
  // — P2 : commerce, portail et fidélisation du studio —
  "photo.quotes",
  "photo.payments",
  "photo.portal",
  "photo.upsell",
  "photo.lifecycle",
  // — verticale immobilier —
  "immo.properties",
  "immo.sellers",
  "immo.buyers",
  "immo.viewings",
  // — verticale solaire / BTP —
  "solar.studies",
  "worksites",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

const MODULE_ID_SET = new Set<string>(MODULE_IDS);
export function isModuleId(v: unknown): v is ModuleId {
  return typeof v === "string" && MODULE_ID_SET.has(v);
}

export type ModuleDef = {
  id: ModuleId;
  /** Libellé de menu. Clé i18n typée : un libellé inexistant ne compile pas. */
  labelKey: MessageKey;
  /**
   * `true` ⇒ le module fait partie du noyau Hermès et n'est jamais retiré à un
   * tenant : sans lui, l'application n'a plus de sens (accueil, paramètres,
   * sécurité…). Ce n'est PAS une échappatoire de droits — un module noyau ne
   * donne accès à aucune donnée métier d'une autre verticale.
   */
  core: boolean;
  /**
   * Capacités qui ACCORDENT le module. Un tenant obtient le module dès qu'il
   * détient l'un de ces tokens. Vide + `core:false` ⇒ module jamais accordé
   * automatiquement (réservé à une activation explicite).
   */
  capabilityTokens: CapabilityToken[];
  /**
   * Capacités exigées CONJOINTEMENT, en plus de `capabilityTokens`.
   *
   * Nécessaire parce que certains tokens sont trop généraux pour identifier un
   * métier à eux seuls. `quotes` en est l'exemple : une photographe qui émet des
   * devis le détient, et se voyait attribuer « Études » — un module solaire.
   * Trou trouvé par un test d'isolation, pas par relecture.
   *
   * Vide = aucune exigence supplémentaire (le cas de presque tous les modules).
   */
  requiresAllTokens?: CapabilityToken[];
  /**
   * Route principale, si la page EXISTE aujourd'hui. `null` ⇒ destination
   * prévue mais non construite : le menu l'affiche désactivée (« bientôt »),
   * jamais comme un lien mort. Même convention que la sidebar actuelle.
   */
  route: string | null;
  /**
   * Toutes les routes possédées par le module, préfixes compris. Sert à la
   * garde serveur : une URL saisie à la main tombe sur cette table, pas sur le
   * menu. Une route absente du menu reste donc refusée.
   */
  ownedRoutes: string[];
  /** Widgets du registre existant que ce module rend disponibles. */
  widgets: string[];
  /** Préfixes d'`action_key` possédés (gouvernance d'exécution, SW15/gateway). */
  actionPrefixes: string[];
};

/**
 * LE REGISTRE. Ajouter un module = ajouter une ligne ici (+ sa clé i18n).
 * Aucun code par client, aucune application par métier.
 */
export const MODULE_REGISTRY: ModuleDef[] = [
  // --- noyau ---------------------------------------------------------------
  {
    id: "core.home",
    labelKey: "nav.commandCenter",
    core: true,
    capabilityTokens: [],
    route: "/",
    ownedRoutes: ["/"],
    widgets: ["kpis", "alerts", "daily-summary", "recommended-actions", "system-health"],
    actionPrefixes: [],
  },
  {
    id: "core.chat",
    labelKey: "nav.chat",
    core: true,
    capabilityTokens: [],
    route: "/chat",
    ownedRoutes: ["/chat"],
    widgets: ["conversations"],
    actionPrefixes: ["hermes.intent."],
  },
  {
    id: "core.activity",
    labelKey: "nav.activity",
    core: true,
    capabilityTokens: [],
    route: "/activite",
    ownedRoutes: ["/activite"],
    widgets: ["agent-activity", "system-status", "audit"],
    // `diag.*` — l'écho de diagnostic appartient au noyau d'observabilité : sans
    // ce rattachement il serait refusé par `isActionAllowed`, qui est fail-closed.
    actionPrefixes: ["diag."],
  },
  {
    id: "core.company",
    labelKey: "nav.company",
    core: true,
    capabilityTokens: [],
    route: "/entreprise",
    ownedRoutes: ["/entreprise"],
    widgets: [],
    actionPrefixes: [],
  },
  {
    id: "core.agents",
    labelKey: "nav.agents",
    core: true,
    capabilityTokens: [],
    route: "/agents",
    ownedRoutes: ["/agents"],
    widgets: ["resolver-status", "resolver-control"],
    actionPrefixes: [],
  },
  {
    id: "core.approvals",
    labelKey: "nav.approvals",
    core: true,
    capabilityTokens: [],
    route: "/approbations",
    ownedRoutes: ["/approbations"],
    widgets: ["approvals"],
    actionPrefixes: [],
  },
  {
    id: "core.security",
    labelKey: "nav.security",
    core: true,
    capabilityTokens: [],
    route: "/securite",
    ownedRoutes: ["/securite"],
    widgets: [],
    actionPrefixes: [],
  },
  {
    id: "core.integrations",
    labelKey: "nav.integrations",
    core: true,
    capabilityTokens: [],
    route: "/integrations",
    ownedRoutes: ["/integrations"],
    widgets: [],
    actionPrefixes: [],
  },
  {
    id: "core.notifications",
    labelKey: "header.notifications",
    core: true,
    capabilityTokens: [],
    route: "/notifications",
    ownedRoutes: ["/notifications"],
    widgets: [],
    actionPrefixes: [],
  },
  {
    id: "core.billing",
    labelKey: "nav.billing",
    core: true,
    capabilityTokens: [],
    route: "/facturation",
    ownedRoutes: ["/facturation"],
    widgets: ["cost"],
    actionPrefixes: [],
  },
  {
    id: "core.settings",
    labelKey: "nav.settings",
    core: true,
    capabilityTokens: [],
    route: "/parametres/dashboard",
    ownedRoutes: ["/parametres"],
    widgets: [],
    actionPrefixes: [],
  },
  {
    id: "core.help",
    labelKey: "sidebar.help",
    core: true,
    capabilityTokens: [],
    route: "/aide",
    ownedRoutes: ["/aide"],
    widgets: [],
    actionPrefixes: [],
  },

  // --- transversaux --------------------------------------------------------
  {
    id: "crm.prospects",
    labelKey: "nav.prospects",
    core: false,
    capabilityTokens: ["leads", "crm", "pipeline"],
    route: null, // page non construite — affichée « bientôt », jamais en lien mort
    ownedRoutes: ["/prospects"],
    widgets: ["commercial"],
    actionPrefixes: ["crm.", "photo.lead.", "immo.lead."],
  },
  {
    id: "crm.clients",
    labelKey: "nav.photoClients",
    core: false,
    capabilityTokens: ["crm", "sales"],
    route: "/clients",
    ownedRoutes: ["/clients"],
    widgets: [],
    actionPrefixes: ["photo.client."],
  },
  {
    id: "agenda",
    labelKey: "nav.agenda",
    core: false,
    capabilityTokens: ["appointments", "bookings", "planning"],
    route: null,
    ownedRoutes: ["/agenda"],
    widgets: ["agenda"],
    actionPrefixes: [],
  },
  {
    id: "phone",
    labelKey: "nav.phone",
    core: false,
    capabilityTokens: ["appointments", "support"],
    route: null,
    ownedRoutes: ["/telephone"],
    widgets: [],
    actionPrefixes: ["phone."],
  },
  {
    id: "campaigns",
    labelKey: "nav.campaigns",
    core: false,
    capabilityTokens: ["marketing", "campaigns", "social"],
    route: null,
    ownedRoutes: ["/campagnes"],
    widgets: [],
    actionPrefixes: ["photo.marketing.", "marketing."],
  },
  {
    id: "documents",
    labelKey: "nav.documents",
    core: false,
    capabilityTokens: ["documents"],
    route: null,
    ownedRoutes: ["/documents"],
    widgets: [],
    actionPrefixes: [],
  },

  // --- verticale photographie ---------------------------------------------
  {
    id: "photo.sessions",
    labelKey: "nav.photoSessions",
    core: false,
    capabilityTokens: ["photo_studio"],
    requiresAllTokens: ["photo_studio"],
    route: "/seances",
    ownedRoutes: ["/seances"],
    widgets: ["photo-today", "photo-sessions", "photo-culling-queue"],
    actionPrefixes: ["photo.culling.", "photo.edit.", "photo.export."],
  },
  {
    id: "photo.gallery",
    labelKey: "nav.galleries",
    core: false,
    capabilityTokens: ["photo_studio"],
    requiresAllTokens: ["photo_studio"],
    route: null,
    ownedRoutes: ["/galeries"],
    widgets: [],
    actionPrefixes: ["photo.gallery."],
  },
  {
    // Devis, contrat et signature vivent ensemble : c'est une seule démarche
    // pour la photographe, même si la base en fait trois tables.
    id: "photo.quotes",
    labelKey: "nav.quotesContracts",
    core: false,
    capabilityTokens: ["quotes"],
    requiresAllTokens: ["photo_studio", "quotes"],
    route: null,
    ownedRoutes: ["/devis"],
    widgets: [],
    actionPrefixes: ["photo.quote.", "photo.contract."],
  },
  {
    id: "photo.payments",
    labelKey: "nav.payments",
    core: false,
    capabilityTokens: ["payments", "invoicing"],
    requiresAllTokens: ["photo_studio"],
    route: null,
    ownedRoutes: ["/paiements"],
    widgets: [],
    actionPrefixes: ["photo.payment."],
  },
  {
    // Le portail est un MODULE, pas une seconde application : mêmes tables,
    // même tenant. Ses routes sont publiques côté client mais portées par un
    // jeton de portée, jamais par une session Hermès.
    id: "photo.portal",
    labelKey: "nav.clientPortal",
    core: false,
    capabilityTokens: ["photo_studio"],
    requiresAllTokens: ["photo_studio"],
    route: null,
    ownedRoutes: ["/portail"],
    widgets: [],
    actionPrefixes: ["photo.portal."],
  },
  {
    id: "photo.upsell",
    labelKey: "nav.upsell",
    core: false,
    capabilityTokens: ["photo_studio", "sales"],
    requiresAllTokens: ["photo_studio"],
    route: null,
    ownedRoutes: ["/upsell"],
    widgets: [],
    actionPrefixes: ["photo.upsell."],
  },
  {
    id: "photo.lifecycle",
    labelKey: "nav.loyalty",
    core: false,
    capabilityTokens: ["photo_studio", "marketing"],
    requiresAllTokens: ["photo_studio"],
    route: null,
    ownedRoutes: ["/fidelisation"],
    widgets: [],
    actionPrefixes: ["photo.lifecycle.", "photo.referral."],
  },

  // --- verticale immobilier ------------------------------------------------
  {
    id: "immo.properties",
    labelKey: "nav.properties",
    core: false,
    capabilityTokens: ["properties"],
    requiresAllTokens: ["properties"],
    route: null,
    ownedRoutes: ["/biens"],
    widgets: [],
    actionPrefixes: ["immo.property."],
  },
  {
    id: "immo.sellers",
    labelKey: "nav.sellers",
    core: false,
    capabilityTokens: ["properties"],
    requiresAllTokens: ["properties"],
    route: null,
    ownedRoutes: ["/vendeurs"],
    widgets: [],
    actionPrefixes: ["immo.seller."],
  },
  {
    id: "immo.buyers",
    labelKey: "nav.buyers",
    core: false,
    capabilityTokens: ["properties"],
    requiresAllTokens: ["properties"],
    route: null,
    ownedRoutes: ["/acquereurs"],
    widgets: [],
    actionPrefixes: ["immo.buyer."],
  },
  {
    id: "immo.viewings",
    labelKey: "nav.viewings",
    core: false,
    capabilityTokens: ["properties"],
    requiresAllTokens: ["properties"],
    route: null,
    ownedRoutes: ["/visites"],
    widgets: [],
    actionPrefixes: ["immo.viewing."],
  },

  // --- verticale solaire / BTP --------------------------------------------
  {
    id: "solar.studies",
    labelKey: "nav.studies",
    core: false,
    // `quotes` seul désignerait n'importe quel métier qui devise. Une étude
    // n'existe que là où elle débouche sur un chantier.
    capabilityTokens: ["quotes"],
    requiresAllTokens: ["quotes", "worksites"],
    // PV-2 : la page existe désormais. `/etudes` est la RACINE de la verticale
    // photovoltaïque — prospects PV, sites, énergie, études, chiffrage vivent
    // sous ce préfixe, donc sous CE module. Aucune entrée de menu parallèle
    // n'est créée : le menu, la garde serveur et le filtre de widgets
    // continuent de lire la même table de modules.
    route: "/etudes",
    ownedRoutes: ["/etudes"],
    widgets: [],
    // `pv.*` — les trois capacités PV (`pv.bill.extract`, `pv.study.prepare`,
    // `pv.economics.compute`) sont rattachées ici. Sans ce rattachement,
    // `isActionAllowed` les refuserait (elle est fail-closed) ; avec lui, elles
    // restent malgré tout INEXÉCUTABLES tant que le catalogue les garde
    // `enabled = false`. Le rattachement dit à QUI l'action appartiendrait,
    // il n'active rien.
    actionPrefixes: ["btp.qualification.", "pv."],
  },
  {
    id: "worksites",
    labelKey: "nav.worksites",
    core: false,
    capabilityTokens: ["worksites", "field_operations"],
    route: "/chantiers/carte",
    ownedRoutes: ["/chantiers"],
    widgets: ["chantiers-map", "projects"],
    actionPrefixes: ["btp.planning.", "btp.suivi."],
  },
];

const MODULE_BY_ID = new Map<ModuleId, ModuleDef>(MODULE_REGISTRY.map((m) => [m.id, m]));

export function moduleDef(id: ModuleId): ModuleDef | undefined {
  return MODULE_BY_ID.get(id);
}

/** Les modules du noyau, toujours accordés. */
export const CORE_MODULE_IDS: ModuleId[] = MODULE_REGISTRY.filter((m) => m.core).map(
  (m) => m.id,
);

/**
 * Modules accordés à un tenant, à partir de ses TOKENS de capacité (les mêmes que
 * ceux du moteur de profils — `deriveCapabilityTokens`).
 *
 * FAIL-CLOSED : un module non-noyau exige un token. Aucun token ⇒ noyau seul.
 * Il n'y a pas de « fail-open » ici : contrairement au switcher de profils, où
 * masquer une vue par erreur est une gêne, accorder un module par erreur ouvre
 * des routes et des widgets. Le doute ferme.
 */
export function grantedModules(capabilityTokens: Iterable<string>): Set<ModuleId> {
  const tokens = capabilityTokens instanceof Set ? capabilityTokens : new Set(capabilityTokens);
  const out = new Set<ModuleId>(CORE_MODULE_IDS);
  for (const m of MODULE_REGISTRY) {
    if (m.core) continue;
    if (!m.capabilityTokens.some((t) => tokens.has(t))) continue;
    // Conjonction, quand elle est déclarée : TOUS les tokens sont exigés.
    if (m.requiresAllTokens && !m.requiresAllTokens.every((t) => tokens.has(t))) continue;
    out.add(m.id);
  }
  return out;
}

/** Widgets rendus disponibles par un ensemble de modules (dédupliqués, ordonnés). */
export function moduleWidgets(modules: Iterable<ModuleId>): string[] {
  const ids = modules instanceof Set ? modules : new Set(modules);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of MODULE_REGISTRY) {
    if (!ids.has(m.id)) continue;
    for (const w of m.widgets) {
      if (!seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
    }
  }
  return out;
}

/** Préfixes d'action possédés par un ensemble de modules. */
export function moduleActionPrefixes(modules: Iterable<ModuleId>): string[] {
  const ids = modules instanceof Set ? modules : new Set(modules);
  const out = new Set<string>();
  for (const m of MODULE_REGISTRY) {
    if (!ids.has(m.id)) continue;
    for (const p of m.actionPrefixes) out.add(p);
  }
  return [...out].sort();
}

/**
 * Une `action_key` est-elle exécutable pour cet ensemble de modules ?
 *
 * FAIL-CLOSED et volontairement RESTRICTIF : une action dont le préfixe
 * n'appartient à AUCUN module du registre est refusée. Une action nouvelle doit
 * donc être rattachée à un module pour devenir appelable — on ne peut pas
 * l'introduire en douce.
 */
export function isActionAllowed(actionKey: string, modules: Iterable<ModuleId>): boolean {
  const allowed = moduleActionPrefixes(modules);
  return allowed.some((p) => actionKey.startsWith(p));
}
