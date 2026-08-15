/**
 * DASH-4B — Dashboard widget registry + layout resolution (pure, DOM-free).
 *
 * Single source of truth for: the catalogue of dashboard widgets (stable ids,
 * category, sizes, capability + snapshot metadata), the default Hermès layout, the
 * user layout resolution (order + show/hide + capability filter, unknown-id safe),
 * and the configurable context-bar segments. No I/O, no React, no component imports
 * here — so it is fully unit-testable and shared by the server (resolve visible
 * order) and the client (settings UI). Components are bound to ids in the shell.
 *
 * COST-FIRST: `snapshotKeys` documents which ALREADY-loaded server snapshot each
 * widget consumes — N widgets never mean N DB reads; they read shared snapshots.
 */

export const WIDGET_SIZES = ["small", "medium", "large"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const WIDGET_CATEGORIES = [
  "general",
  "agenda",
  "weather",
  "alerts",
  "commercial",
  "finance",
  "agents",
  "system",
  "chantiers",
  "btp",
  "immobilier",
] as const;
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

export type WidgetDef = {
  id: string;
  label: string;
  category: WidgetCategory;
  supportedSizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** Responsive column hint (not a user pref in 4B; SMALL/MEDIUM/LARGE = DASH-4C). */
  span: "half" | "full";
  /** Optional capability (canonical action key). Absent ⇒ always available. */
  requiredCapability?: string;
  /** Shared snapshots this widget reads (doc + no-extra-fetch contract). */
  snapshotKeys: string[];
};

/**
 * The catalogue. IDs are STABLE and must never change (they are persisted in user
 * preferences). Adding a business widget later = append one entry here + bind a
 * component in the shell; no architecture change.
 */
export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: "kpis", label: "KPI exécutifs", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["kpis"] },
  { id: "system-health", label: "État global Hermès", category: "system", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["kpis", "observability", "platformHealth", "actionStats", "resolver", "cost"] },
  { id: "agent-activity", label: "Activité des agents", category: "agents", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["observability"] },
  { id: "agenda", label: "Agenda du jour", category: "agenda", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["agenda"] },
  { id: "alerts", label: "Alertes & priorités", category: "alerts", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["alerts"] },
  { id: "approvals", label: "Approbations à traiter", category: "alerts", supportedSizes: ["medium"], defaultSize: "medium", span: "half", snapshotKeys: [] },
  { id: "tasks", label: "Priorités opérationnelles", category: "alerts", supportedSizes: ["medium"], defaultSize: "medium", span: "half", snapshotKeys: ["priorities"] },
  { id: "conversations", label: "Activité récente", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["conversations"] },
  { id: "projects", label: "Portefeuille projets", category: "btp", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["projects"] },
  { id: "commercial", label: "Activité commerciale", category: "commercial", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["commercial"] },
  { id: "quick-actions", label: "Actions disponibles", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["capabilities"] },
  { id: "system-status", label: "Observabilité", category: "system", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["observability"] },
  { id: "audit", label: "Journal d’audit", category: "system", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["audit"] },
  { id: "resolver-status", label: "État du résolveur", category: "system", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["resolver"] },
  { id: "resolver-control", label: "Contrôle opérateur du résolveur", category: "system", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["resolverControl"] },
  { id: "cost", label: "Coûts & gouvernance", category: "finance", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["cost"] },
];

export const LAYOUT_SCHEMA_VERSION = 1;

/** Default Hermès order = the registry order (the curated fixed dashboard). */
export const DEFAULT_WIDGET_ORDER: string[] = WIDGET_REGISTRY.map((w) => w.id);

export const CONTEXT_SEGMENTS = [
  "time",
  "date",
  "weather",
  "temperature",
  "rain",
  "wind",
  "location",
  "cost",
  "alerts",
  "nextEvent",
] as const;
export type ContextSegment = (typeof CONTEXT_SEGMENTS)[number];

export type ContextConfig = Record<ContextSegment, boolean>;

export type LayoutPreferences = {
  order: string[];
  hidden: string[];
  context: Partial<Record<ContextSegment, boolean>>;
  schemaVersion: number;
};

export const DEFAULT_LAYOUT: LayoutPreferences = {
  order: [],
  hidden: [],
  context: {},
  schemaVersion: LAYOUT_SCHEMA_VERSION,
};

const REGISTRY_IDS = new Set(WIDGET_REGISTRY.map((w) => w.id));

export function registryIds(): string[] {
  return WIDGET_REGISTRY.map((w) => w.id);
}
export function widgetById(id: string): WidgetDef | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === id);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Fail-safe parse of the persisted `layout` JSONB into a typed LayoutPreferences. */
export function clampLayout(input: unknown): LayoutPreferences {
  const l = (input ?? {}) as Record<string, unknown>;
  const context: Partial<Record<ContextSegment, boolean>> = {};
  const rawCtx = (l.context ?? {}) as Record<string, unknown>;
  for (const seg of CONTEXT_SEGMENTS) {
    if (typeof rawCtx[seg] === "boolean") context[seg] = rawCtx[seg] as boolean;
  }
  return {
    order: strArray(l.order),
    hidden: strArray(l.hidden),
    context,
    schemaVersion: Number(l.schemaVersion ?? LAYOUT_SCHEMA_VERSION) || LAYOUT_SCHEMA_VERSION,
  };
}

/** Ids available to this tenant = capability satisfied (or no capability required). */
export function availableWidgetIds(capabilityKeys: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const w of WIDGET_REGISTRY) {
    if (!w.requiredCapability || capabilityKeys.has(w.requiredCapability)) out.add(w.id);
  }
  return out;
}

export type ResolvedWidgetItem = {
  id: string;
  label: string;
  category: WidgetCategory;
  span: "half" | "full";
  hidden: boolean;
  available: boolean;
};

/**
 * Resolve the effective layout: user order first (unknown ids ignored — safe across
 * schema changes), then any registry widgets the user has never seen appended in
 * their canonical order. `visible` = available AND not hidden, in order.
 */
export function resolveWidgetLayout(
  userLayout: Partial<LayoutPreferences> | null,
  available: Set<string>,
): { visible: string[]; items: ResolvedWidgetItem[] } {
  const userOrder = strArray(userLayout?.order).filter((id) => REGISTRY_IDS.has(id));
  const seen = new Set(userOrder);
  const order = [...userOrder, ...DEFAULT_WIDGET_ORDER.filter((id) => !seen.has(id))];
  const hidden = new Set(strArray(userLayout?.hidden).filter((id) => REGISTRY_IDS.has(id)));

  const items: ResolvedWidgetItem[] = order.map((id) => {
    const def = widgetById(id)!;
    const isAvailable = available.has(id);
    return {
      id,
      label: def.label,
      category: def.category,
      span: def.span,
      hidden: hidden.has(id),
      available: isAvailable,
    };
  });
  const visible = items.filter((it) => it.available && !it.hidden).map((it) => it.id);
  return { visible, items };
}

/** Context-bar config: every segment defaults to visible; user overrides applied. */
export function resolveContextConfig(
  userContext: Partial<Record<ContextSegment, boolean>> | null | undefined,
): ContextConfig {
  const out = {} as ContextConfig;
  for (const seg of CONTEXT_SEGMENTS) {
    const v = userContext?.[seg];
    out[seg] = typeof v === "boolean" ? v : true;
  }
  return out;
}

/** The list of visible segment keys (for ContextBar's `visibleSegments` prop). */
export function contextVisibleSegments(config: ContextConfig): string[] {
  return CONTEXT_SEGMENTS.filter((seg) => config[seg]);
}

/** Segments whose display needs the weather snapshot (weather is a peer of temperature). */
export const WEATHER_DEPENDENT_SEGMENTS: ContextSegment[] = [
  "weather",
  "temperature",
  "rain",
  "wind",
];

/**
 * Whether the upstream weather call is needed at all. The Open-Meteo fetch is
 * skipped (COST-FIRST) only when EVERY weather-dependent segment is hidden — so a
 * user who hides "weather" but keeps "temperature" still gets real data.
 */
export function needsWeather(config: ContextConfig): boolean {
  return WEATHER_DEPENDENT_SEGMENTS.some((seg) => config[seg]);
}

// --- Pure mutators (used by the settings UI; no DOM) -------------------------

/** Move a widget one step up (-1) or down (+1) within the given order. */
export function moveWidget(order: string[], id: string, dir: -1 | 1): string[] {
  const arr = order.filter((x) => REGISTRY_IDS.has(x));
  const i = arr.indexOf(id);
  if (i < 0) return arr;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Ensure `order` is a full, valid ordering (used before persisting a move). */
export function normalizeOrder(order: string[]): string[] {
  const known = order.filter((id) => REGISTRY_IDS.has(id));
  const seen = new Set(known);
  return [...known, ...DEFAULT_WIDGET_ORDER.filter((id) => !seen.has(id))];
}

export function setWidgetHidden(hidden: string[], id: string, hide: boolean): string[] {
  const set = new Set(hidden.filter((x) => REGISTRY_IDS.has(x)));
  if (hide) set.add(id);
  else set.delete(id);
  return [...set];
}
