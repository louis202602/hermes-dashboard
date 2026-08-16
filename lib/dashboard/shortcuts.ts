/**
 * DASH-4H — personal shortcuts (pure, DOM-free, no I/O, no LLM):
 *   A. customizable Quick Actions   B. Favorites   C. default opening screen.
 *
 * Everything resolves to REAL destinations only (honest, no dead buttons): the real
 * app routes, the in-page chat anchor, visible-widget anchors, and capability actions
 * that the backend actually granted. All lists are BOUNDED. Stored in the existing
 * preferences `behavior` JSONB — no new table / RPC.
 */

import {
  PROFILE_IDS,
  resolveActiveProfile,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import type { LayoutPreferences } from "@/lib/dashboard/widgets";

// --- Built-in navigation shortcuts (REAL destinations only) -----------------

export type NavShortcut = {
  id: string;
  /** "route" = a real Next route; "anchor" = an in-page anchor that always exists. */
  kind: "route" | "anchor";
  target: string;
  labelKey: string;
};

export const NAV_SHORTCUTS: NavShortcut[] = [
  { id: "map", kind: "route", target: "/chantiers/carte", labelKey: "shortcut.map" },
  { id: "chat", kind: "anchor", target: "#hermes-command", labelKey: "shortcut.chat" },
  { id: "settings", kind: "route", target: "/parametres/dashboard", labelKey: "shortcut.settings" },
];

const NAV_BY_ID = new Map(NAV_SHORTCUTS.map((n) => [n.id, n]));

export const MAX_FAVORITES = 8;
export const MAX_QUICK_ACTIONS = 12;

// --- C. Default opening screen ----------------------------------------------
//
// The opening screen is one of the 5 dashboard PROFILES, or "resume the last-used mode"
// (`openLastMode`). We deliberately do NOT offer a forced redirect to the full map route
// as a default: the map page's back-link returns to "/", which would re-trigger the
// redirect and TRAP the user. The map stays one tap away as a first-class quick-action
// and favorite instead — honest and non-trapping.

export function isProfileHome(v: string | null | undefined): v is ProfileId {
  return typeof v === "string" && (PROFILE_IDS as readonly string[]).includes(v);
}

/** Valid values for the "default home" preference: one of the dashboard profiles. */
export function isValidDefaultHome(v: string | null | undefined): boolean {
  return isProfileHome(v);
}

/**
 * Resolve the opening profile. `openLastMode` wins (resume the last-active profile);
 * otherwise the fixed default profile; otherwise the last-active/default fallback.
 */
export function resolveHomeProfile(
  behavior: { openLastMode: boolean; defaultHome: string | null },
  profiles: ProfilesState,
  globalLayout: LayoutPreferences | null,
): ProfileId {
  if (!behavior.openLastMode && isProfileHome(behavior.defaultHome)) {
    return behavior.defaultHome;
  }
  return resolveActiveProfile(profiles, globalLayout);
}

// --- A. Quick Actions --------------------------------------------------------

export type ResolvedQuickAction =
  | { kind: "nav"; id: string; target: string; isRoute: boolean; labelKey: string }
  | { kind: "capability"; id: string };

/**
 * Resolve the user's selected quick actions against reality: keep nav shortcuts that
 * exist and capability keys the backend ACTUALLY granted (capability-gated), drop the
 * rest (never a dead button), de-dup, bound. An EMPTY selection means "not customized"
 * — the caller then shows the default (all available capabilities).
 */
export function resolveQuickActions(
  selected: string[],
  availableCapabilityKeys: string[],
): ResolvedQuickAction[] {
  const caps = new Set(availableCapabilityKeys);
  const seen = new Set<string>();
  const out: ResolvedQuickAction[] = [];
  for (const id of selected) {
    if (seen.has(id)) continue;
    seen.add(id);
    const nav = NAV_BY_ID.get(id);
    if (nav) {
      out.push({ kind: "nav", id, target: nav.target, isRoute: nav.kind === "route", labelKey: nav.labelKey });
    } else if (caps.has(id)) {
      out.push({ kind: "capability", id });
    }
    if (out.length >= MAX_QUICK_ACTIONS) break;
  }
  return out;
}

/** Ids the Quick-Actions selector may offer: nav shortcuts + granted capabilities. */
export function quickActionOptionIds(availableCapabilityKeys: string[]): string[] {
  return [...NAV_SHORTCUTS.map((n) => n.id), ...availableCapabilityKeys];
}

// --- B. Favorites ------------------------------------------------------------

export type ResolvedFavorite =
  | { kind: "widget"; id: string; visible: boolean }
  | { kind: "nav"; id: string; target: string; isRoute: boolean; labelKey: string };

export function favoriteWidgetRef(widgetId: string): string {
  return `widget:${widgetId}`;
}
export function favoriteNavRef(navId: string): string {
  return `nav:${navId}`;
}

/**
 * Resolve favorite refs to REAL targets: a widget favorite must be a registry widget
 * (flagged visible when it's on screen so the caller can render an anchor only then);
 * a nav favorite must be a known shortcut. Unknown refs are dropped. Bounded.
 */
export function resolveFavorites(
  favRefs: string[],
  registryWidgetIds: string[],
  visibleWidgetIds: string[],
): ResolvedFavorite[] {
  const reg = new Set(registryWidgetIds);
  const vis = new Set(visibleWidgetIds);
  const seen = new Set<string>();
  const out: ResolvedFavorite[] = [];
  for (const raw of favRefs) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (raw.startsWith("widget:")) {
      const id = raw.slice("widget:".length);
      if (reg.has(id)) out.push({ kind: "widget", id, visible: vis.has(id) });
    } else if (raw.startsWith("nav:")) {
      const nav = NAV_BY_ID.get(raw.slice("nav:".length));
      if (nav) out.push({ kind: "nav", id: nav.id, target: nav.target, isRoute: nav.kind === "route", labelKey: nav.labelKey });
    }
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** Toggle a ref in a bounded favorites list (add if absent, remove if present). */
export function toggleFavorite(favRefs: string[], ref: string): string[] {
  if (favRefs.includes(ref)) return favRefs.filter((r) => r !== ref);
  if (favRefs.length >= MAX_FAVORITES) return favRefs; // bounded — silently ignore overflow
  return [...favRefs, ref];
}
