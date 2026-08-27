/**
 * HERMÈS — navigation calculée depuis les modules accordés.
 * La verticale ne donne aucun droit : elle ne fait qu'ordonner/filtrer la présentation.
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
  href: string | null;
  comingSoon: boolean;
};

/** Pages réellement livrées avant nettoyage du registre historique. */
const LIVE_ROUTE_OVERRIDES: Partial<Record<ModuleId, string>> = {
  "crm.prospects": "/prospects",
  agenda: "/agenda",
};

/**
 * Présentation solaire : la carte BTP historique n'est pas un écran du cockpit PV.
 * On masque uniquement son entrée dans la verticale solaire ; le module `worksites`
 * et sa garde restent intacts pour les autres métiers et pour une future vraie vue
 * Chantiers PV. C'est donc réversible et ne détruit pas le moteur multi-métier.
 */
const SOLAR_HIDDEN_PRESENTATION_MODULES = new Set<ModuleId>(["worksites"]);

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
    if (vertical === "solar" && SOLAR_HIDDEN_PRESENTATION_MODULES.has(id)) continue;
    const def = moduleDef(id);
    if (!def) continue;
    const href = def.route ?? LIVE_ROUTE_OVERRIDES[def.id] ?? null;
    out.push({
      moduleId: def.id,
      labelKey: def.labelKey,
      href,
      comingSoon: href === null,
    });
  }
  return out;
}

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

export function isRouteAllowed(pathname: string, granted: Iterable<ModuleId>): boolean {
  const grantedSet = granted instanceof Set ? granted : new Set(granted);
  const owner = routeModule(pathname);
  if (owner === null) return false;
  return grantedSet.has(owner);
}

function normalize(pathname: string): string {
  const raw = String(pathname ?? "");
  const cut = raw.split(/[?#]/)[0] ?? "";
  if (cut.length === 0) return "/";
  const trimmed = cut.length > 1 && cut.endsWith("/") ? cut.slice(0, -1) : cut;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function claimedRoutePrefixes(): string[] {
  const out = new Set<string>();
  for (const m of MODULE_REGISTRY) for (const r of m.ownedRoutes) out.add(r);
  return [...out].sort();
}
