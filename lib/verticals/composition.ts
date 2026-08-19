/**
 * HERMÈS — composition du dashboard d'un tenant, en UNE fonction pure.
 *
 * C'est le point d'entrée du moteur : à partir de ce que le serveur sait déjà
 * lire (clés de capacité + permissions), il rend TOUT ce que l'interface doit
 * afficher — verticale, modules, menu, widgets, actions, profil d'ouverture.
 *
 * Pourquoi une seule fonction : parce que le menu, la garde de route, les
 * widgets et les actions doivent être calculés à partir de la MÊME liste de
 * modules. Les faire diverger, c'est exactement le défaut que l'audit a trouvé
 * dans la sidebar actuelle (menu écrit à la main, garde ailleurs).
 *
 * Pure : aucune I/O, aucun accès réseau, aucun `Date.now()`. Le serveur fournit
 * les entrées, la fonction ne fait que composer. Entièrement testable.
 */

import { deriveCapabilityTokens, type ProfileId } from "@/lib/dashboard/profiles";
import { availableWidgetIds } from "@/lib/dashboard/widgets";
import { resolveAccessLevel, type AccessLevel } from "@/lib/verticals/access";
import {
  resolveVertical,
  verticalDef,
  verticalIntegrationProviders,
  type VerticalId,
} from "@/lib/verticals/manifest";
import {
  grantedModules,
  moduleActionPrefixes,
  moduleWidgets,
  type ModuleId,
} from "@/lib/verticals/modules";
import { resolveNavigation, type NavEntry } from "@/lib/verticals/navigation";

export type TenantComposition = {
  vertical: VerticalId;
  verticalSource: "DECLARED" | "DERIVED" | "DEFAULT";
  accessLevel: AccessLevel;
  /** Tokens fonctionnels dérivés — la vérité des droits, réutilisée telle quelle. */
  capabilityTokens: string[];
  modules: ModuleId[];
  navigation: NavEntry[];
  /**
   * Widgets réellement affichables : INTERSECTION de ceux que les modules
   * ouvrent et de ceux que le filtre de capacité existant autorise déjà
   * (`availableWidgetIds`). Une intersection ne peut qu'ôter : le moteur de
   * verticales ne peut pas rendre visible un widget que les capacités refusent.
   */
  widgets: string[];
  /** Préfixes d'action exécutables pour ces modules. */
  actionPrefixes: string[];
  /** Profil d'ouverture suggéré par la verticale (le choix utilisateur prime). */
  suggestedProfile: ProfileId;
  /** Fournisseurs d'intégration proposables (verticale ∩ catalogue global activé). */
  integrationProviders: string[];
};

export type CompositionInput = {
  /**
   * Clés de PORTILLON du tenant : les `action_key` accordées, plus les clés
   * synthétiques d'activation de verticale (ex. `photo.studio`). Exactement ce
   * que `resolvePageContext` calcule déjà — aucune lecture nouvelle.
   */
  capabilityKeys: Iterable<string>;
  /** Permissions de l'utilisateur sur ce tenant (`user_tenant_permissions`). */
  permissions?: Iterable<string>;
  /** Verticale déclarée si la colonne existe un jour. Absente aujourd'hui. */
  declaredVertical?: string | null;
  /** Fournisseurs OAuth activés globalement (`integration_providers.enabled`). */
  enabledIntegrationProviders?: Iterable<string>;
};

export function resolveTenantComposition(input: CompositionInput): TenantComposition {
  const gateKeys =
    input.capabilityKeys instanceof Set
      ? (input.capabilityKeys as Set<string>)
      : new Set<string>(input.capabilityKeys);
  const tokens = deriveCapabilityTokens(gateKeys);
  const { vertical, source } = resolveVertical(tokens, input.declaredVertical ?? null);
  const modules = grantedModules(tokens);
  const accessLevel = resolveAccessLevel(input.permissions ?? []);

  // Intersection avec le filtre de capacité DÉJÀ en place : le moteur ne peut
  // qu'être plus restrictif que l'existant, jamais plus permissif.
  const capabilityAllowed = availableWidgetIds(gateKeys);
  const widgets = moduleWidgets(modules).filter((w) => capabilityAllowed.has(w));

  return {
    vertical,
    verticalSource: source,
    accessLevel,
    capabilityTokens: [...tokens].sort(),
    modules: [...modules].sort(),
    navigation: resolveNavigation(vertical, modules),
    widgets,
    actionPrefixes: moduleActionPrefixes(modules),
    suggestedProfile: verticalDef(vertical).defaultProfile,
    integrationProviders: verticalIntegrationProviders(
      vertical,
      input.enabledIntegrationProviders ?? [],
    ),
  };
}
