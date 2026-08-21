/**
 * HERMÈS — NAVIGATION_POLICY et garde de routes.
 *
 * Le menu n'est plus une liste écrite à la main : il se CALCULE à partir des
 * modules accordés, ordonnés par la verticale. Deux propriétés en découlent, et
 * ce sont les deux que l'audit demandait :
 *
 *   1. Un tenant photo ne peut pas voir « Chantiers », parce que le module
 *      `worksites` ne lui est pas accordé — pas parce qu'un `if` le cache.
 *   2. Cacher l'entrée NE SUFFIT PAS, et le moteur ne prétend pas le contraire :
 *      `isRouteAllowed` répond à la même question pour une URL tapée à la main,
 *      à partir de la MÊME table de modules. Menu et garde ne peuvent pas
 *      diverger : il n'y a qu'une source.
 *
 * Pur, sans I/O, sans React. La sidebar n'aura qu'à rendre le résultat.
 */

import type { MessageKey } from "@/lib/i18n/languages";
import {
  MODULE_REGISTRY,
  moduleDef,
  type ModuleId,
} from "@/lib/verticals/modules";
import { verticalDef, type VerticalId } from "@/lib/verticals/manifest";

export type NavEntry = {
  moduleId: ModuleId;
  labelKey: MessageKey;
  /** `null` ⇒ page prévue, non construite : rendue désactivée, jamais en lien mort. */
  href: string | null;
  /** `true` quand la page n'existe pas encore (libellé « bientôt disponible »). */
  comingSoon: boolean;
};

/**
 * Le menu d'un tenant.
 *
 * Ordre = celui de la verticale, puis les modules accordés qu'elle ne cite pas
 * (dans l'ordre du registre). Rien n'est perdu silencieusement : un module
 * accordé apparaît toujours, même si la verticale a oublié de le mentionner.
 *
 * FILTRAGE, jamais octroi : citer un module non accordé ne l'ajoute pas.
 */
export function resolveNavigation(
  vertical: VerticalId,
  granted: Iterable<ModuleId>,
): NavEntry[] {
  const grantedSet = granted instanceof Set ? granted : new Set(granted);
  const ordered: ModuleId[] = [];
  const seen = new Set<ModuleId>();

  for (const id of verticalDef(vertical).moduleOrder) {
    if (grantedSet.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  for (const m of MODULE_REGISTRY) {
    if (grantedSet.has(m.id) && !seen.has(m.id)) {
      seen.add(m.id);
      ordered.push(m.id);
    }
  }

  const out: NavEntry[] = [];
  for (const id of ordered) {
    const def = moduleDef(id);
    if (!def) continue; // id inconnu (préférence obsolète) ⇒ ignoré, pas de crash
    out.push({
      moduleId: def.id,
      labelKey: def.labelKey,
      href: def.route,
      comingSoon: def.route === null,
    });
  }
  return out;
}

/**
 * À quel module appartient une route ? `null` ⇒ route non revendiquée.
 *
 * Le plus LONG préfixe gagne, pour qu'un module spécifique puisse posséder une
 * sous-route d'un module plus large sans ambiguïté. `/` est traité en égalité
 * stricte : sans cela, la racine posséderait tout le site.
 */
export function routeModule(pathname: string): ModuleId | null {
  const path = normalize(pathname);
  if (path === "/") return "core.home";

  let best: { id: ModuleId; length: number } | null = null;
  for (const m of MODULE_REGISTRY) {
    for (const owned of m.ownedRoutes) {
      if (owned === "/") continue;
      if (path === owned || path.startsWith(`${owned}/`)) {
        if (best === null || owned.length > best.length) {
          best = { id: m.id, length: owned.length };
        }
      }
    }
  }
  return best?.id ?? null;
}

/**
 * LA GARDE SERVEUR. Une route est autorisée si — et seulement si — le module qui
 * la possède est accordé.
 *
 * FAIL-CLOSED sur deux fronts, volontairement :
 *   * module non accordé          ⇒ refus (c'est l'objet de la garde) ;
 *   * route qu'AUCUN module ne revendique ⇒ refus également.
 *
 * Le second point est le plus important : une page ajoutée demain sans être
 * rattachée à un module est refusée par défaut. On ne peut donc pas introduire
 * une route non gardée par simple oubli — l'oubli ferme, il n'ouvre pas.
 */
export function isRouteAllowed(pathname: string, granted: Iterable<ModuleId>): boolean {
  const grantedSet = granted instanceof Set ? granted : new Set(granted);
  const owner = routeModule(pathname);
  if (owner === null) return false;
  return grantedSet.has(owner);
}

/** Normalise : sans query/hash, sans slash final superflu, jamais vide. */
function normalize(pathname: string): string {
  const raw = String(pathname ?? "");
  const cut = raw.split(/[?#]/)[0] ?? "";
  if (cut.length === 0) return "/";
  const trimmed = cut.length > 1 && cut.endsWith("/") ? cut.slice(0, -1) : cut;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Routes revendiquées par le registre — utile aux tests de couverture. */
export function claimedRoutePrefixes(): string[] {
  const out = new Set<string>();
  for (const m of MODULE_REGISTRY) for (const r of m.ownedRoutes) out.add(r);
  return [...out].sort();
}
