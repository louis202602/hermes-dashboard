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
  contextVisibleSegments,
  moveWidget,
  normalizeOrder,
  registryIds,
  resolveContextConfig,
  resolveWidgetLayout,
  setWidgetHidden,
  type LayoutPreferences,
} from "../lib/dashboard/widgets.ts";

const ALL = new Set(registryIds());

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
test("DEFAULT_LAYOUT: no user prefs ⇒ full Hermès order, all visible", () => {
  const r = resolveWidgetLayout(null, ALL);
  assert.deepEqual(r.visible, DEFAULT_WIDGET_ORDER);
  const empty = resolveWidgetLayout(clampLayout({}), ALL);
  assert.deepEqual(empty.visible, DEFAULT_WIDGET_ORDER);
});

// --- USER_LAYOUT ------------------------------------------------------------
test("USER_LAYOUT: custom order honoured, new widgets appended", () => {
  const layout: Partial<LayoutPreferences> = { order: ["cost", "kpis"], hidden: [] };
  const r = resolveWidgetLayout(layout, ALL);
  assert.equal(r.visible[0], "cost");
  assert.equal(r.visible[1], "kpis");
  // widgets absent from user order still appear (appended, canonical order).
  assert.ok(r.visible.includes("agenda"));
  assert.equal(r.visible.length, DEFAULT_WIDGET_ORDER.length);
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
  // availableWidgetIds: a required capability gates the id; none required ⇒ all in.
  const ids = availableWidgetIds(new Set());
  assert.equal(ids.size, WIDGET_REGISTRY.filter((w) => !w.requiredCapability).length);
});

// --- UNKNOWN_WIDGET_IGNORED -------------------------------------------------
test("UNKNOWN_WIDGET_IGNORED: stale ids in prefs never crash", () => {
  const layout = { order: ["ghost", "kpis", "removed-widget"], hidden: ["also-gone"] };
  const r = resolveWidgetLayout(layout, ALL);
  assert.ok(!r.visible.includes("ghost"));
  assert.equal(r.visible[0], "kpis");
  assert.equal(r.visible.length, DEFAULT_WIDGET_ORDER.length);
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

// --- RESET_WIDGETS_SCOPED ---------------------------------------------------
test("RESET_WIDGETS_SCOPED: cleared layout ⇒ default order + all segments", () => {
  const cleared = clampLayout({});
  assert.deepEqual(cleared.order, []);
  assert.deepEqual(cleared.hidden, []);
  assert.deepEqual(resolveWidgetLayout(cleared, ALL).visible, DEFAULT_WIDGET_ORDER);
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
  assert.match(css, /\.dash-widget\.span-full/);
  assert.match(css, /\.widget-gallery/);
  assert.match(css, /@media \(max-width: 1024px\)[^@]*\.dashboard-widgets/s);
});
