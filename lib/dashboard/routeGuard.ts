import { notFound } from "next/navigation";

import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { isRouteAllowed, routeModule } from "@/lib/verticals/navigation";
import type { ModuleId } from "@/lib/verticals/modules";
import type { TenantComposition } from "@/lib/verticals/composition";

/**
 * HERMÈS — LA garde de route serveur.
 *
 * Avant, trois vérités coexistaient : le menu (écrit à la main dans la sidebar),
 * la garde de page (ad hoc, présente sur les pages photo seulement) et le filtre
 * de capacité des widgets. Rien ne les obligeait à s'accorder — et de fait elles
 * ne s'accordaient pas : `/chantiers/carte` restait atteignable par URL directe
 * depuis n'importe quel tenant authentifié, y compris un studio photo.
 *
 * Ce module supprime la divergence en la rendant impossible : le menu ET la
 * garde lisent désormais la MÊME liste de modules accordés.
 *
 * `notFound()` plutôt que `redirect()` ou un 403 : un tenant qui n'a pas un
 * module ne doit pas apprendre que la page existe. C'est déjà le choix des pages
 * photo — on le généralise au lieu d'en inventer un deuxième.
 */

/**
 * Garde une page par sa ROUTE. La route est déclarée explicitement plutôt que
 * devinée depuis `headers()` : une page sait quelle route elle sert, et un
 * chemin lu dans un en-tête est une donnée d'entrée que l'on préfère ne pas
 * faire entrer dans une décision de sécurité.
 *
 * Renvoie le contexte de page complet — la page n'a donc aucune lecture
 * supplémentaire à faire, et il n'existe pas de chemin « garder sans charger »
 * qui inciterait à sauter la garde.
 */
export async function requireRoute(pathname: string) {
  const ctx = await resolvePageContext();
  if (!isRouteAllowed(pathname, ctx.composition.modules)) notFound();
  return ctx;
}

/**
 * Garde par MODULE, quand une page sert plusieurs routes ou qu'aucune route ne
 * la décrit bien. Équivalent strict de `requireRoute` sur le fond.
 */
export async function requireModule(moduleId: ModuleId) {
  const ctx = await resolvePageContext();
  if (!ctx.composition.modules.includes(moduleId)) notFound();
  return ctx;
}

/**
 * Variante SANS chargement de contexte, pour un appelant qui l'a déjà.
 * Purement une lecture — c'est la même fonction que celle qui construit le menu.
 */
export function routeAllowedFor(composition: TenantComposition, pathname: string): boolean {
  return isRouteAllowed(pathname, composition.modules);
}

/** Le module propriétaire d'une route, ou `null` si aucun ne la revendique. */
export { routeModule };
