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
  "photo",
  "solaire",
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
  /**
   * DASH-4I — optional capability-DOMAIN gate (action-key prefix, e.g. "btp."). The
   * widget is available when the tenant holds ANY capability starting with it — so
   * vertical-specific widgets vanish for tenants of another vertical. Absent ⇒ no gate.
   */
  requiredCapabilityPrefix?: string;
  /**
   * PV-3 — portillon par MODULE (moteur de verticales), et non par capacité.
   *
   * Pourquoi ce champ existe alors que `requiredCapabilityPrefix` existait déjà :
   * un préfixe de capacité exige une capacité ACTIVE au catalogue. Les trois
   * capacités `pv.*` sont volontairement `enabled = false` — un widget gardé par
   * `"pv."` ne serait donc JAMAIS visible, y compris chez un tenant solaire.
   * Le bon portillon est le MODULE : `solar.studies` est accordé par la
   * conjonction `quotes + worksites`, indépendamment de toute activation d'IA.
   *
   * FAIL-CLOSED : quand ce champ est renseigné, le widget est indisponible tant
   * que l'appelant n'a pas fourni la liste des modules accordés. Un appelant qui
   * l'ignore ferme donc le widget, il ne l'ouvre pas.
   */
  requiredModule?: string;
  /** Shared snapshots this widget reads (doc + no-extra-fetch contract). */
  snapshotKeys: string[];
  /** Hidden by default (opt-in via the gallery) — e.g. heavy/self-fetching widgets. */
  defaultHidden?: boolean;
};

/**
 * The catalogue. IDs are STABLE and must never change (they are persisted in user
 * preferences). Adding a business widget later = append one entry here + bind a
 * component in the shell; no architecture change.
 */
export const WIDGET_REGISTRY: WidgetDef[] = [
  { id: "kpis", label: "KPI exécutifs", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["kpis"] },
  // DASH-4G — deterministic daily intelligence (synthesis + recommendations). Both are
  // pure client derivations of already-loaded snapshots (+ enriched worksite weather).
  { id: "daily-summary", label: "Résumé du jour", category: "general", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["agenda", "priorities", "projects", "alerts", "commercial", "worksiteWeather"] },
  { id: "recommended-actions", label: "Actions recommandées", category: "general", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["agenda", "priorities", "alerts", "cost", "commercial", "worksiteWeather"] },
  { id: "system-health", label: "État global Hermès", category: "system", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["kpis", "observability", "platformHealth", "actionStats", "resolver", "cost"] },
  { id: "agent-activity", label: "Activité des agents", category: "agents", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["observability"] },
  { id: "agenda", label: "Agenda du jour", category: "agenda", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["agenda"] },
  { id: "alerts", label: "Alertes & priorités", category: "alerts", supportedSizes: ["medium", "large"], defaultSize: "medium", span: "half", snapshotKeys: ["alerts"] },
  { id: "approvals", label: "Approbations à traiter", category: "alerts", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: [] },
  { id: "tasks", label: "Priorités opérationnelles", category: "alerts", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: ["priorities"] },
  { id: "conversations", label: "Activité récente", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["conversations"] },
  { id: "projects", label: "Portefeuille projets", category: "btp", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["projects"], requiredCapabilityPrefix: "btp." },
  { id: "commercial", label: "Activité commerciale", category: "commercial", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["commercial"] },
  { id: "quick-actions", label: "Actions disponibles", category: "general", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["capabilities"] },
  { id: "system-status", label: "Observabilité", category: "system", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["observability"] },
  { id: "audit", label: "Journal d’audit", category: "system", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["audit"] },
  { id: "resolver-status", label: "État du résolveur", category: "system", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["resolver"] },
  { id: "resolver-control", label: "Contrôle opérateur du résolveur", category: "system", supportedSizes: ["large"], defaultSize: "large", span: "full", snapshotKeys: ["resolverControl"] },
  { id: "cost", label: "Coûts & gouvernance", category: "finance", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["cost"] },
  // CARTE-1: opt-in (default hidden) — it lazy-loads MapLibre + self-fetches its data,
  // so it costs nothing on the dashboard until a user adds it from the gallery.
  { id: "chantiers-map", label: "Carte des chantiers", category: "chantiers", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["chantiersMap"], defaultHidden: true, requiredCapabilityPrefix: "btp." },
  // PHOTO-P0 — verticale Hermès Studio. Le préfixe `photo.` n'est satisfait que
  // lorsque la verticale est ACTIVÉE pour le tenant (clé synthétique `photo.studio`
  // dérivée de `photo_studio_activation`, cf. lib/dashboard/photoAccess.ts). Tant
  // qu'elle ne l'est pas — c'est-à-dire par défaut — ces widgets n'existent pas.
  { id: "photo-today", label: "Studio — aujourd’hui", category: "photo", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["photoToday"], requiredCapabilityPrefix: "photo." },
  { id: "photo-sessions", label: "Studio — séances", category: "photo", supportedSizes: ["medium", "large"], defaultSize: "large", span: "full", snapshotKeys: ["photoToday"], requiredCapabilityPrefix: "photo." },
  { id: "photo-culling-queue", label: "Studio — photos à trier", category: "photo", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: ["photoToday"], requiredCapabilityPrefix: "photo." },

  // --- verticale solaire (PV-3) : 3 widgets de PILOTAGE, gardés par le MODULE.
  // Ils lisent UN seul instantané partagé (`pvPilot`) : trois widgets ne font
  // jamais trois lectures — même contrat COST-FIRST que la verticale photo.
  { id: "pv-studies-to-validate", label: "Études à valider", category: "solaire", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: ["pvPilot"], requiredModule: "solar.studies" },
  { id: "pv-bills-to-verify", label: "Factures énergie à vérifier", category: "solaire", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: ["pvPilot"], requiredModule: "solar.studies" },
  { id: "pv-prospects-without-site", label: "Prospects sans site", category: "solaire", supportedSizes: ["small", "medium"], defaultSize: "medium", span: "half", snapshotKeys: ["pvPilot"], requiredModule: "solar.studies" },
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
  /** Per-widget size override (clamped to the widget's supportedSizes on resolve). */
  sizes: Record<string, WidgetSize>;
  context: Partial<Record<ContextSegment, boolean>>;
  schemaVersion: number;
};

export const DEFAULT_LAYOUT: LayoutPreferences = {
  order: [],
  hidden: [],
  sizes: {},
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

const SIZE_SET = new Set<string>(WIDGET_SIZES);

/** Fail-safe parse of the persisted `layout` JSONB into a typed LayoutPreferences. */
export function clampLayout(input: unknown): LayoutPreferences {
  const l = (input ?? {}) as Record<string, unknown>;
  const context: Partial<Record<ContextSegment, boolean>> = {};
  const rawCtx = (l.context ?? {}) as Record<string, unknown>;
  for (const seg of CONTEXT_SEGMENTS) {
    if (typeof rawCtx[seg] === "boolean") context[seg] = rawCtx[seg] as boolean;
  }
  const sizes: Record<string, WidgetSize> = {};
  const rawSizes = (l.sizes ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rawSizes)) {
    // keep only known widget ids with a valid size token (clamped to supported at resolve).
    if (REGISTRY_IDS.has(k) && typeof v === "string" && SIZE_SET.has(v)) {
      sizes[k] = v as WidgetSize;
    }
  }
  return {
    order: strArray(l.order),
    hidden: strArray(l.hidden),
    sizes,
    context,
    schemaVersion: Number(l.schemaVersion ?? LAYOUT_SCHEMA_VERSION) || LAYOUT_SCHEMA_VERSION,
  };
}

/** Clamp a requested size to what the widget actually supports (else its default). */
export function clampWidgetSize(def: WidgetDef, size: unknown): WidgetSize {
  return typeof size === "string" && def.supportedSizes.includes(size as WidgetSize)
    ? (size as WidgetSize)
    : def.defaultSize;
}

/** Ids available to this tenant = capability satisfied (or no capability required). */
export function availableWidgetIds(
  capabilityKeys: Set<string>,
  grantedModules?: Iterable<string>,
): Set<string> {
  const keys = [...capabilityKeys];
  // FAIL-CLOSED : appelant sans liste de modules ⇒ ensemble VIDE, donc tout
  // widget gardé par un module reste fermé. L'oubli ferme, il n'ouvre pas.
  const modules =
    grantedModules === undefined
      ? new Set<string>()
      : grantedModules instanceof Set
        ? (grantedModules as Set<string>)
        : new Set<string>(grantedModules);
  const out = new Set<string>();
  for (const w of WIDGET_REGISTRY) {
    const exactOk = !w.requiredCapability || capabilityKeys.has(w.requiredCapability);
    const prefixOk =
      !w.requiredCapabilityPrefix ||
      keys.some((k) => k.startsWith(w.requiredCapabilityPrefix as string));
    const moduleOk = !w.requiredModule || modules.has(w.requiredModule);
    if (exactOk && prefixOk && moduleOk) out.add(w.id);
  }
  return out;
}

export type ResolvedWidgetItem = {
  id: string;
  label: string;
  category: WidgetCategory;
  span: "half" | "full";
  size: WidgetSize;
  supportedSizes: WidgetSize[];
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
  // Opt-in widgets (defaultHidden) stay hidden until the user explicitly adds them
  // (their id appears in the persisted order) — so heavy widgets never load by default.
  for (const w of WIDGET_REGISTRY) {
    if (w.defaultHidden && !seen.has(w.id)) hidden.add(w.id);
  }

  const sizes = (userLayout?.sizes ?? {}) as Record<string, unknown>;
  const items: ResolvedWidgetItem[] = order.map((id) => {
    const def = widgetById(id)!;
    const isAvailable = available.has(id);
    return {
      id,
      label: def.label,
      category: def.category,
      span: def.span,
      size: clampWidgetSize(def, sizes[id]),
      supportedSizes: def.supportedSizes,
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

/** Set a widget's size — ignored if the widget doesn't support that size (fail-safe). */
export function setWidgetSize(
  sizes: Record<string, WidgetSize>,
  id: string,
  size: WidgetSize,
): Record<string, WidgetSize> {
  const def = widgetById(id);
  if (!def || !def.supportedSizes.includes(size)) return sizes;
  return { ...sizes, [id]: size };
}

/** Cycle to the next size the widget supports (for a single S/M/L toggle button). */
export function cycleWidgetSize(id: string, current: WidgetSize): WidgetSize {
  const def = widgetById(id);
  if (!def) return current;
  const i = def.supportedSizes.indexOf(current);
  return def.supportedSizes[(i + 1) % def.supportedSizes.length];
}
