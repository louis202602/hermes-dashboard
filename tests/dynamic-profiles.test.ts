import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CAPABILITY_TOKENS,
  PROFILE_REGISTRY,
  availableProfiles,
  clampProfiles,
  deriveCapabilityTokens,
  fallbackProfile,
  isProfileAvailable,
  presetLayoutFor,
  profileDef,
  type ProfileId,
} from "../lib/dashboard/profiles.ts";
import { resolveHomeProfile } from "../lib/dashboard/shortcuts.ts";

// Real granted action keys for the BTP/solar tenant (as in the live catalog).
const BTP_KEYS = [
  "btp.planning.phase.add",
  "btp.qualification.create",
  "btp.suivi.progress.report",
  "diag.echo",
];

// --- capability derivation (real action keys → functional tokens) ------------
test("deriveCapabilityTokens: BTP action keys map to functional tokens", () => {
  const tokens = deriveCapabilityTokens(BTP_KEYS);
  for (const t of ["worksites", "projects", "planning", "operations", "sales", "leads", "quotes"]) {
    assert.ok(tokens.has(t), `expected token ${t}`);
  }
  // no vertical bleed: a BTP tenant is not e-commerce/restaurant/property
  for (const t of ["ecommerce", "restaurant", "properties", "logistics", "marketing", "support"]) {
    assert.ok(!tokens.has(t), `unexpected token ${t}`);
  }
  // unknown namespaces contribute nothing (safe)
  assert.equal(deriveCapabilityTokens(["xyz.foo.bar"]).size, 0);
  assert.equal(deriveCapabilityTokens([]).size, 0);
  // a bare token passed directly is kept as-is
  assert.ok(deriveCapabilityTokens(["sales"]).has("sales"));
});

// --- CAPABILITY-FIRST: no vertical dependency --------------------------------
test("CAPABILITY_FIRST / NO_VERTICAL_DEPENDENCY: no `tenant.vertical` branch in source", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/profiles.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /tenant\.vertical/);
  assert.doesNotMatch(src, /vertical\s*===/);
  // every capability-gated profile references only known functional tokens
  const vocab = new Set<string>(CAPABILITY_TOKENS);
  for (const p of PROFILE_REGISTRY) {
    for (const t of [...p.requiredCapabilities, ...p.optionalCapabilities]) {
      assert.ok(vocab.has(t), `${p.id} uses unknown token ${t}`);
    }
  }
});

// --- generic vs specialized + custom always ---------------------------------
test("CUSTOM_ALWAYS_AVAILABLE + DIRECTION transversal", () => {
  // custom offered even with zero capabilities
  assert.deepEqual(availableProfiles([]), ["custom"]);
  // direction appears as soon as there is any exploitable capability
  assert.ok(availableProfiles(["sales"]).includes("direction"));
  assert.ok(!availableProfiles([]).includes("direction"));
  assert.equal(profileDef("custom")!.availability, "always");
  assert.equal(profileDef("direction")!.availability, "transversal");
});

// === TENANT CONFIGURATION CASES (A–E) =======================================

test("CASE A — SOLAIRE / BTP", () => {
  const ids = availableProfiles(["crm", "sales", "worksites", "planning", "finance", "marketing"]);
  for (const p of ["direction", "commercial", "operations", "chantier", "finance", "marketing", "custom"]) {
    assert.ok(ids.includes(p as ProfileId), `A expects ${p}`);
  }
  for (const p of ["immobilier", "restaurant", "ecommerce", "logistique", "support"]) {
    assert.ok(!ids.includes(p as ProfileId), `A must not offer ${p}`);
  }
});

test("CASE B — IMMOBILIER: no useless Chantier", () => {
  const ids = availableProfiles(["crm", "leads", "properties", "appointments", "sales", "marketing"]);
  for (const p of ["direction", "commercial", "immobilier", "marketing", "support", "custom"]) {
    assert.ok(ids.includes(p as ProfileId), `B expects ${p}`);
  }
  assert.ok(!ids.includes("chantier"), "B must NOT force a Chantier profile");
  assert.ok(!ids.includes("operations"), "B has no ops capability");
  assert.ok(!ids.includes("restaurant") && !ids.includes("ecommerce"));
});

test("CASE C — RESTAURANT: no forced CRM/BTP", () => {
  const ids = availableProfiles(["bookings", "operations", "inventory", "purchasing", "marketing", "finance"]);
  for (const p of ["direction", "operations", "restaurant", "finance", "marketing", "custom"]) {
    assert.ok(ids.includes(p as ProfileId), `C expects ${p}`);
  }
  assert.ok(!ids.includes("commercial"), "C must NOT force a CRM/Commercial profile");
  assert.ok(!ids.includes("chantier"), "C must NOT force a BTP/Chantier profile");
});

test("CASE D — E-COMMERCE", () => {
  const ids = availableProfiles(["ecommerce", "sales", "inventory", "support", "marketing", "analytics", "finance"]);
  for (const p of ["direction", "commercial", "operations", "ecommerce", "finance", "marketing", "support", "custom"]) {
    assert.ok(ids.includes(p as ProfileId), `D expects ${p}`);
  }
  assert.ok(!ids.includes("chantier") && !ids.includes("immobilier") && !ids.includes("restaurant"));
});

test("CASE E — TENANT MINIMAL: never a broken UI, custom + valid fallback", () => {
  const ids = availableProfiles([]);
  assert.deepEqual(ids, ["custom"], "only custom for an empty tenant");
  // fallback from any stored/default profile lands on a valid available id
  assert.equal(fallbackProfile("chantier", ids), "custom");
  assert.equal(fallbackProfile("direction", ids), "custom");
  // one thin capability already unlocks direction + the matching profile
  assert.deepEqual(availableProfiles(["sales"]), ["direction", "commercial", "custom"]);
});

// --- real BTP tenant preserves the legacy profile set ------------------------
test("LEGACY_PROFILE_IDS_PRESERVED: real BTP keys still offer the legacy profiles", () => {
  const ids = availableProfiles(deriveCapabilityTokens(BTP_KEYS));
  for (const legacy of ["direction", "commercial", "chantier", "finance", "custom"]) {
    assert.ok(ids.includes(legacy as ProfileId), `legacy ${legacy} preserved`);
  }
});

// --- TENANT-SAFE: a profile is never offered without a matching capability ---
test("TENANT_SAFE: capability-gated profiles require a real matching token", () => {
  for (const p of PROFILE_REGISTRY) {
    if (p.availability !== "capability") continue;
    // with empty tokens no capability-gated profile is available
    assert.ok(!isProfileAvailable(p, new Set()), `${p.id} hidden with no caps`);
    // present only when one of its required tokens is held
    const one = new Set([p.requiredCapabilities[0]]);
    assert.ok(isProfileAvailable(p, one), `${p.id} shown with its token`);
  }
});

// --- fail-open when the capability snapshot is unavailable --------------------
test("CAPABILITIES_UNKNOWN_FAIL_OPEN: snapshot unavailable ⇒ offer ALL (never hide)", () => {
  const all = availableProfiles([], false);
  assert.equal(all.length, PROFILE_REGISTRY.length);
  assert.ok(all.includes("chantier") && all.includes("restaurant") && all.includes("custom"));
});

// --- legacy preferences preserved across capability toggles ------------------
test("LEGACY_PREFERENCES_PRESERVED + INVALID_PROFILE_FALLBACK", () => {
  const stored = clampProfiles({ active: "chantier", byId: { chantier: { name: "Mon chantier" } }, schemaVersion: 1 });
  assert.equal(stored.active, "chantier", "stored active preserved even if later unavailable");
  assert.equal(stored.byId.chantier?.name, "Mon chantier", "profile config preserved");
  // capability removed ⇒ chantier not offered ⇒ deterministic fallback
  assert.ok(!availableProfiles([]).includes("chantier"));
  assert.equal(fallbackProfile("chantier", ["direction", "commercial", "custom"]), "direction");
  // capability restored ⇒ chantier offered again, stored config intact
  assert.ok(availableProfiles(deriveCapabilityTokens(BTP_KEYS)).includes("chantier"));
});

test("DEFAULT_HOME_FALLBACK: a fixed default-home of an unavailable profile falls back", () => {
  const state = { active: null, byId: {}, wallpaper: {} as never, schemaVersion: 1 };
  const home = resolveHomeProfile({ openLastMode: false, defaultHome: "chantier" }, state, null);
  assert.equal(home, "chantier");
  assert.equal(fallbackProfile(home, ["direction", "commercial", "finance", "custom"]), "direction");
});

// --- preset layout is built from recommendedWidgets (registry-filtered) ------
test("WIDGET_FILTER_STILL_APPLIED: every specialized/generic preset builds from real widget ids", () => {
  for (const p of PROFILE_REGISTRY) {
    const layout = presetLayoutFor(p.id);
    if (p.id === "custom") {
      // custom = the full dashboard; it uses the global/default layout (empty preset).
      assert.equal(layout.order.length, 0);
      continue;
    }
    assert.ok(layout.order.length > 0, `${p.id} builds a focused layout`);
    // recommended widgets come first and every id is a real registry widget.
    const known = new Set(layout.order);
    for (const w of profileDef(p.id)!.recommendedWidgets) {
      assert.ok(known.has(w), `${p.id} recommends real widget ${w}`);
    }
  }
});

// --- i18n: every registry profile has a label + description key --------------
test("I18N_KEYS_MATCH: every profile labelKey + descriptionKey exists in fr", async () => {
  const { fr } = await import("../lib/i18n/locales/fr.ts");
  for (const p of PROFILE_REGISTRY) {
    assert.ok(p.labelKey in fr, `missing ${p.labelKey}`);
    assert.ok(p.descriptionKey in fr, `missing ${p.descriptionKey}`);
  }
});

// --- purity / cost-first -----------------------------------------------------
test("NO_LLM / NO_API / NO_POLLING / NO_SCHEDULE: pure derivation", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/profiles.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /setInterval|setTimeout/);
  assert.doesNotMatch(src, /openai|anthropic|supabase/i);
});
