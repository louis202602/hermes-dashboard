/**
 * HERMÈS — VERTICAL_MANIFEST : une application, plusieurs métiers.
 *
 * Une verticale ne donne AUCUN droit. Elle répond à une seule question, que les
 * capacités seules ne savent pas exprimer : « dans quel ORDRE et sous quels MOTS
 * présenter ce que ce tenant possède déjà ? ». Un photographe et un agent
 * immobilier peuvent tenir exactement les mêmes tokens (`leads`, `appointments`)
 * et devoir lire « Séances » d'un côté, « Visites » de l'autre.
 *
 * La conséquence est structurelle, et c'est le point important :
 *
 *   les MODULES décident de ce qui est ACCESSIBLE  (sécurité)
 *   la VERTICALE décide de ce qui est PRÉSENTÉ     (ergonomie)
 *
 * Une verticale ne peut donc jamais élargir un accès : `resolveNavigation` ne
 * fait qu'ORDONNER et FILTRER une liste de modules déjà accordée ailleurs. Citer
 * un module qu'un tenant n'a pas ne le lui donne pas — le module disparaît.
 *
 * Pur, sans I/O. Ajouter un métier = ajouter une ligne ici. Jamais une app.
 */

import type { ProfileId } from "@/lib/dashboard/profiles";
import type { ModuleId } from "@/lib/verticals/modules";

export const VERTICAL_IDS = [
  "photography",
  "real_estate",
  "solar",
  "construction",
  "generic",
] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

const VERTICAL_SET = new Set<string>(VERTICAL_IDS);
export function isVerticalId(v: unknown): v is VerticalId {
  return typeof v === "string" && VERTICAL_SET.has(v);
}

/** Repli quand rien ne permet de trancher. Jamais une verticale métier. */
export const DEFAULT_VERTICAL: VerticalId = "generic";

export type VerticalDef = {
  id: VerticalId;
  /** Nom lisible (interne / support). Le menu, lui, est traduit par module. */
  label: string;
  /**
   * ORDRE de présentation des modules. C'est de la mise en page, pas du droit :
   * un module cité mais non accordé n'apparaît pas, et un module accordé mais
   * non cité est ajouté à la fin (jamais perdu silencieusement).
   */
  moduleOrder: ModuleId[];
  /** Profil de dashboard ouvert par défaut — réutilise le registre existant. */
  defaultProfile: ProfileId;
  /**
   * Tokens qui SIGNALENT ce métier quand aucune verticale n'est déclarée. Ce
   * sont des indices d'affichage, pas des droits.
   */
  signals: string[];
  /**
   * Fournisseurs d'intégration pertinents pour ce métier. Sert à ne PAS proposer
   * une connexion simplement parce qu'elle existe globalement (cf. audit §8) :
   * l'offre est l'INTERSECTION de ce catalogue et du catalogue global activé.
   */
  integrationProviders: string[];
};

export const VERTICAL_MANIFEST: VerticalDef[] = [
  {
    id: "photography",
    label: "Studio photographe",
    // Ordre EXACT du brief Studio : Accueil · Prospects · Clients · Séances ·
    // Agenda · Devis & Contrats · Paiements · Téléphone · Campagnes ·
    // Galeries · Portail Client · Upsell · Fidélisation · Intégrations ·
    // Paramètres. C'est de la mise en page — chaque entrée reste soumise à
    // l'activation réelle du module chez le tenant.
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "crm.clients",
      "photo.sessions",
      "agenda",
      "photo.quotes",
      "photo.payments",
      "phone",
      "campaigns",
      "photo.gallery",
      "photo.portal",
      "photo.upsell",
      "photo.lifecycle",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "photographe",
    signals: ["photo_studio"],
    integrationProviders: ["google_calendar", "gmail", "instagram", "meta"],
  },
  {
    id: "real_estate",
    label: "Immobilier",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "immo.properties",
      "immo.sellers",
      "immo.buyers",
      "immo.viewings",
      "agenda",
      "phone",
      "campaigns",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "immobilier",
    signals: ["properties"],
    integrationProviders: ["google_calendar", "gmail", "meta"],
  },
  {
    id: "solar",
    label: "Solaire",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "solar.studies",
      "crm.clients",
      "worksites",
      "agenda",
      "phone",
      "documents",
      "core.billing",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "direction",
    // `worksites` + `quotes` ensemble : une étude photovoltaïque devient un
    // chantier. Un pur BTP n'a pas `quotes` par la qualification solaire.
    signals: ["worksites", "quotes"],
    integrationProviders: ["google_calendar", "gmail"],
  },
  {
    id: "construction",
    label: "BTP / chantiers",
    moduleOrder: [
      "core.home",
      "crm.prospects",
      "worksites",
      "agenda",
      "documents",
      "core.billing",
      "core.integrations",
      "core.settings",
    ],
    defaultProfile: "chantier",
    signals: ["field_operations"],
    integrationProviders: ["google_calendar", "gmail"],
  },
  {
    id: "generic",
    label: "Générique",
    moduleOrder: ["core.home", "crm.prospects", "crm.clients", "agenda", "core.settings"],
    defaultProfile: "direction",
    signals: [],
    integrationProviders: ["google_calendar", "gmail"],
  },
];

const VERTICAL_BY_ID = new Map<VerticalId, VerticalDef>(
  VERTICAL_MANIFEST.map((v) => [v.id, v]),
);

export function verticalDef(id: VerticalId): VerticalDef {
  return VERTICAL_BY_ID.get(id) ?? VERTICAL_BY_ID.get(DEFAULT_VERTICAL)!;
}

/**
 * Résolution de la verticale d'un tenant.
 *
 * 1. Une verticale DÉCLARÉE l'emporte toujours (colonne `tenants.vertical`, qui
 *    n'existe pas encore : le paramètre est donc optionnel et le moteur
 *    fonctionne sans elle — aucune migration n'est requise pour démarrer).
 * 2. Sinon on DÉDUIT du signal le plus spécifique. « Le plus spécifique » se
 *    mesure : la verticale gagnante est celle dont TOUS les signaux sont
 *    présents et qui en compte le plus. Le solaire (`worksites` + `quotes`)
 *    l'emporte donc sur le BTP nu, sans arbitrage manuel.
 * 3. Sinon `generic`. Jamais de devinette.
 *
 * Déterministe : mêmes tokens ⇒ même verticale, quel que soit l'ordre d'entrée.
 */
export function resolveVertical(
  capabilityTokens: Iterable<string>,
  declared?: string | null,
): { vertical: VerticalId; source: "DECLARED" | "DERIVED" | "DEFAULT" } {
  if (isVerticalId(declared)) return { vertical: declared, source: "DECLARED" };

  const tokens = capabilityTokens instanceof Set ? capabilityTokens : new Set(capabilityTokens);
  let best: VerticalDef | null = null;
  for (const v of VERTICAL_MANIFEST) {
    if (v.signals.length === 0) continue;
    if (!v.signals.every((s) => tokens.has(s))) continue;
    if (best === null || v.signals.length > best.signals.length) best = v;
  }
  return best
    ? { vertical: best.id, source: "DERIVED" }
    : { vertical: DEFAULT_VERTICAL, source: "DEFAULT" };
}

/**
 * Fournisseurs d'intégration RÉELLEMENT proposables à ce tenant :
 * intersection de ce que la verticale justifie et de ce que le catalogue global
 * a activé. Une intégration n'apparaît donc jamais « parce qu'elle existe ».
 *
 * FAIL-CLOSED : catalogue global vide ⇒ aucune proposition.
 */
export function verticalIntegrationProviders(
  vertical: VerticalId,
  globallyEnabled: Iterable<string>,
): string[] {
  const enabled = globallyEnabled instanceof Set ? globallyEnabled : new Set(globallyEnabled);
  return verticalDef(vertical).integrationProviders.filter((p) => enabled.has(p));
}
