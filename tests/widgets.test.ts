import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CONTEXT_SEGMENTS,
  DEFAULT_WIDGET_ORDER,
  WIDGET_REGISTRY,
  availableWidgetIds,
  clampLayout,
  clampWidgetSize,
  contextVisibleSegments,
  cycleWidgetSize,
  moveWidget,
  needsWeather,
  normalizeOrder,
  registryIds,
  resolveContextConfig,
  resolveWidgetLayout,
  setWidgetHidden,
  setWidgetSize,
  widgetById,
  type LayoutPreferences,
} from "../lib/dashboard/widgets.ts";

const ALL = new Set(registryIds());
// Widgets visible in a fresh layout = everything except opt-in (defaultHidden) ones.
const DEFAULT_VISIBLE = DEFAULT_WIDGET_ORDER.filter(
  (id) => !widgetById(id)!.defaultHidden,
);

// --- REGISTRY_IDS_UNIQUE ----------------------------------------------------
test("REGISTRY_IDS_UNIQUE: every widget id is unique + non-empty", () => {
  const ids = WIDGET_REGISTRY.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  // Each widget carries the required metadata.
  for (const w of WIDGET_REGISTRY) {
    assert.ok(w.label.length > 0, `${w.id} label`);
    assert.ok(w.supportedSizes.includes(w.defaultSize), `${w.id} defaultSize`);
    assert.ok(["half", "full"].includes(w.span));
  }
});

// --- DEFAULT_LAYOUT ---------------------------------------------------------
test("DEFAULT_LAYOUT: no user prefs ⇒ default-visible widgets (opt-in ones hidden)", () => {
  const r = resolveWidgetLayout(null, ALL);
  assert.deepEqual(r.visible, DEFAULT_VISIBLE);
  const empty = resolveWidgetLayout(clampLayout({}), ALL);
  assert.deepEqual(empty.visible, DEFAULT_VISIBLE);
  // the opt-in map widget exists but is hidden by default
  assert.ok(!r.visible.includes("chantiers-map"));
  assert.ok(r.items.find((i) => i.id === "chantiers-map")?.hidden);
});

test("DEFAULT_HIDDEN: opt-in widget shows only once added to the order", () => {
  const added = resolveWidgetLayout({ order: ["chantiers-map"] }, ALL);
  assert.ok(added.visible.includes("chantiers-map"));
});

// --- USER_LAYOUT ------------------------------------------------------------
test("USER_LAYOUT: custom order honoured, new widgets appended", () => {
  const layout: Partial<LayoutPreferences> = { order: ["cost", "kpis"], hidden: [] };
  const r = resolveWidgetLayout(layout, ALL);
  assert.equal(r.visible[0], "cost");
  assert.equal(r.visible[1], "kpis");
  // widgets absent from user order still appear (appended, canonical order).
  assert.ok(r.visible.includes("agenda"));
  assert.equal(r.visible.length, DEFAULT_VISIBLE.length);
});

// --- SHOW_WIDGET / HIDE_WIDGET ----------------------------------------------
test("HIDE_WIDGET / SHOW_WIDGET: hidden set removes from visible", () => {
  const hidden = setWidgetHidden([], "cost", true);
  assert.deepEqual(hidden, ["cost"]);
  const r = resolveWidgetLayout({ order: [], hidden }, ALL);
  assert.ok(!r.visible.includes("cost"));
  assert.ok(r.items.find((i) => i.id === "cost")?.hidden);
  // Un-hide restores it.
  const shown = setWidgetHidden(hidden, "cost", false);
  assert.deepEqual(shown, []);
  assert.ok(resolveWidgetLayout({ hidden: shown }, ALL).visible.includes("cost"));
});

// --- MOVE_UP / MOVE_DOWN ----------------------------------------------------
test("MOVE_UP / MOVE_DOWN: reorders within bounds, no-op at edges", () => {
  const base = [...DEFAULT_WIDGET_ORDER];
  const up = moveWidget(base, base[2], -1);
  assert.equal(up[1], base[2]);
  assert.equal(up[2], base[1]);
  // top can't move up; bottom can't move down.
  assert.deepEqual(moveWidget(base, base[0], -1), base);
  assert.deepEqual(moveWidget(base, base[base.length - 1], 1), base);
  // unknown id is a no-op.
  assert.deepEqual(moveWidget(base, "nope", 1).length, base.length);
});

// --- CAPABILITY_FILTER ------------------------------------------------------
test("CAPABILITY_FILTER: unavailable widgets are excluded + marked", () => {
  // Simulate a tenant missing 'cost' (e.g. no capability/source).
  const available = new Set(registryIds().filter((id) => id !== "cost"));
  const r = resolveWidgetLayout(null, available);
  assert.ok(!r.visible.includes("cost"));
  const item = r.items.find((i) => i.id === "cost");
  assert.equal(item?.available, false);
  // availableWidgetIds: a required capability, a capability-prefix OR a required
  // MODULE gates the id. Le troisième portillon vient de PV-3 : sans lui, la
  // formule ci-dessous compterait des widgets que la fonction ferme à raison.
  const ids = availableWidgetIds(new Set());
  assert.equal(
    ids.size,
    WIDGET_REGISTRY.filter(
      (w) => !w.requiredCapability && !w.requiredCapabilityPrefix && !w.requiredModule,
    ).length,
  );
  // DASH-4I: BTP-gated widgets appear only when the tenant holds a btp.* capability.
  assert.ok(!availableWidgetIds(new Set()).has("projects"), "no btp ⇒ no projects");
  assert.ok(!availableWidgetIds(new Set()).has("chantiers-map"), "no btp ⇒ no chantiers-map");
  const btp = availableWidgetIds(new Set(["btp.suivi.progress.report"]));
  assert.ok(btp.has("projects") && btp.has("chantiers-map"), "btp.* ⇒ BTP widgets available");

  // PV-3 : portillon par MODULE. FAIL-CLOSED — un appelant qui ne fournit pas la
  // liste des modules ferme le widget, il ne l'ouvre pas. Et une capacité `pv.*`
  // ne suffirait PAS : les capacités PV sont volontairement désactivées, c'est
  // bien le module qui décide.
  const moduleGated = WIDGET_REGISTRY.filter((w) => w.requiredModule).map((w) => w.id);
  assert.ok(moduleGated.length >= 3, "PV-3 déclare au moins 3 widgets gardés par module");
  for (const id of moduleGated) {
    assert.ok(!availableWidgetIds(new Set()).has(id), `${id} fermé sans modules`);
    assert.ok(
      !availableWidgetIds(new Set(["pv.study.prepare"])).has(id),
      `${id} ne s'ouvre pas sur une capacité pv.*`,
    );
    assert.ok(
      !availableWidgetIds(new Set(), ["core.home"]).has(id),
      `${id} fermé pour un module étranger`,
    );
    assert.ok(
      availableWidgetIds(new Set(), ["solar.studies"]).has(id),
      `${id} ouvert avec solar.studies`,
    );
  }
});

// --- UNKNOWN_WIDGET_IGNORED -------------------------------------------------
test("UNKNOWN_WIDGET_IGNORED: stale ids in prefs never crash", () => {
  const layout = { order: ["ghost", "kpis", "removed-widget"], hidden: ["also-gone"] };
  const r = resolveWidgetLayout(layout, ALL);
  assert.ok(!r.visible.includes("ghost"));
  assert.equal(r.visible[0], "kpis");
  assert.equal(r.visible.length, DEFAULT_VISIBLE.length);
  // normalizeOrder drops unknowns and completes with the rest.
  assert.deepEqual(
    new Set(normalizeOrder(["ghost", "kpis"])),
    new Set(DEFAULT_WIDGET_ORDER),
  );
});

// --- CONTEXT bar segment show/hide ------------------------------------------
test("CONTEXT show/hide: default all on; overrides drop segments", () => {
  const cfg = resolveContextConfig({});
  for (const seg of CONTEXT_SEGMENTS) assert.equal(cfg[seg], true);
  const off = resolveContextConfig({ weather: false, cost: false, time: false, alerts: false });
  assert.equal(off.weather, false);
  assert.equal(off.cost, false);
  assert.equal(off.time, false);
  assert.equal(off.alerts, false);
  assert.equal(off.date, true);
  const visible = contextVisibleSegments(off);
  assert.ok(!visible.includes("weather"));
  assert.ok(!visible.includes("cost"));
  assert.ok(visible.includes("date"));
});

// --- WIDGET SIZES (DASH-4C) -------------------------------------------------
test("SIZE_SMALL/MEDIUM/LARGE + UNSUPPORTED_SIZE_CLAMP", () => {
  // a widget that supports [small, medium] (approvals)
  const appr = widgetById("approvals")!;
  assert.deepEqual(appr.supportedSizes, ["small", "medium"]);
  assert.equal(clampWidgetSize(appr, "small"), "small");
  assert.equal(clampWidgetSize(appr, "medium"), "medium");
  // unsupported size ⇒ clamped to the widget's default (never an illegal size)
  assert.equal(clampWidgetSize(appr, "large"), appr.defaultSize);
  assert.equal(clampWidgetSize(appr, "garbage"), appr.defaultSize);
  // resolution applies the clamp: request large on approvals ⇒ default
  const r = resolveWidgetLayout({ sizes: { approvals: "large" } }, new Set(registryIds()));
  const item = r.items.find((i) => i.id === "approvals")!;
  assert.equal(item.size, appr.defaultSize);
  // a valid override is kept
  const r2 = resolveWidgetLayout({ sizes: { approvals: "small" } }, new Set(registryIds()));
  assert.equal(r2.items.find((i) => i.id === "approvals")!.size, "small");
});

test("setWidgetSize / cycleWidgetSize respect supportedSizes", () => {
  // setWidgetSize ignores an unsupported size (approvals can't be large)
  assert.deepEqual(setWidgetSize({}, "approvals", "large"), {});
  assert.deepEqual(setWidgetSize({}, "approvals", "small"), { approvals: "small" });
  // cycle wraps within supported sizes only
  assert.equal(cycleWidgetSize("approvals", "small"), "medium");
  assert.equal(cycleWidgetSize("approvals", "medium"), "small"); // wraps
  // single-size widget stays put
  const single = WIDGET_REGISTRY.find((w) => w.supportedSizes.length === 1);
  if (single) {
    assert.equal(cycleWidgetSize(single.id, single.defaultSize), single.defaultSize);
  }
});

test("clampLayout: sizes are validated (known id + valid token)", () => {
  const l = clampLayout({ sizes: { approvals: "medium", ghost: "large", kpis: 42 } });
  assert.equal(l.sizes.approvals, "medium");
  assert.equal("ghost" in l.sizes, false); // unknown widget dropped
  assert.equal("kpis" in l.sizes, false); // non-string size dropped
});

// --- WEATHER fetch logic: ANY weather-dependent segment ---------------------
test("needsWeather: fetch iff any of weather/temperature/rain/wind is shown", () => {
  assert.equal(needsWeather(resolveContextConfig({})), true); // all on by default
  // all four off ⇒ no upstream call
  assert.equal(
    needsWeather(
      resolveContextConfig({ weather: false, temperature: false, rain: false, wind: false }),
    ),
    false,
  );
  // weather off but temperature on ⇒ STILL fetch (peer, not child)
  assert.equal(
    needsWeather(resolveContextConfig({ weather: false, rain: false, wind: false })),
    true,
  );
  // only wind on ⇒ fetch
  assert.equal(
    needsWeather(
      resolveContextConfig({ weather: false, temperature: false, rain: false }),
    ),
    true,
  );
});

// --- RESET_WIDGETS_SCOPED ---------------------------------------------------
test("RESET_WIDGETS_SCOPED: cleared layout ⇒ default order + all segments", () => {
  const cleared = clampLayout({});
  assert.deepEqual(cleared.order, []);
  assert.deepEqual(cleared.hidden, []);
  assert.deepEqual(cleared.sizes, {}); // sizes reset to default too
  assert.deepEqual(resolveWidgetLayout(cleared, ALL).visible, DEFAULT_VISIBLE);
  // widgets fall back to their registry defaultSize after a reset
  const r = resolveWidgetLayout(cleared, ALL);
  for (const it of r.items) {
    assert.equal(it.size, widgetById(it.id)!.defaultSize);
  }
  const cfg = resolveContextConfig(cleared.context);
  assert.equal(contextVisibleSegments(cfg).length, CONTEXT_SEGMENTS.length);
});

// --- clampLayout defensive --------------------------------------------------
test("clampLayout: junk input collapses to a safe layout", () => {
  const l = clampLayout({ order: "nope", hidden: 42, context: { weather: "yes", cost: false }, schemaVersion: "x" });
  assert.deepEqual(l.order, []);
  assert.deepEqual(l.hidden, []);
  assert.equal(l.context.cost, false); // valid boolean kept
  assert.equal("weather" in l.context, false); // non-boolean dropped
  assert.equal(l.schemaVersion, 1);
});

// --- NO_NEW_LLM / NO_NEW_EXTERNAL_API (static guard) ------------------------
test("widgets module is pure: no fetch / network / LLM", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dashboard/widgets.ts", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /openai|anthropic|api\./i);
});

// --- CSS contract: widget grid + gallery present ----------------------------
test("CSS: widget grid + gallery classes present, responsive", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../app/globals.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /\.dashboard-widgets\s*\{/);
  assert.match(css, /\.dash-widget\.size-large/);
  assert.match(css, /\.widget-gallery/);
  assert.match(css, /\.edit-toggle-btn/); // DASH-4C edit mode
  assert.match(css, /\.widget-drag-handle/);
  assert.match(css, /@media \(max-width: 720px\)[^@]*\.dashboard-widgets/s);
});
