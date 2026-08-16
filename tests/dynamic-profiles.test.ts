import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  PROFILE_REGISTRY,
  availableProfileIds,
  clampProfiles,
  deriveCapabilityDomains,
  fallbackProfile,
  presetLayoutFor,
  type ProfileId,
} from "../lib/dashboard/profiles.ts";
import { resolveHomeProfile } from "../lib/dashboard/shortcuts.ts";

const BTP = ["btp.planning.phase.add", "btp.qualification.create", "btp.suivi.progress.report", "diag.echo"];
const REAL_ESTATE = ["immo.mandat.create", "immo.bien.publish", "hermes.intent.resolve"];
const COMMERCE = ["retail.stock.adjust", "retail.sale.record"];

// --- domain derivation -------------------------------------------------------
test("deriveCapabilityDomains: first action-key segment", () => {
  assert.deepEqual([...deriveCapabilityDomains(BTP)].sort(), ["btp", "diag"]);
  assert.deepEqual([...deriveCapabilityDomains([])], []);
  assert.deepEqual([...deriveCapabilityDomains(["nodot"])], ["nodot"]);
});

// --- BTP_PROFILE_SET ---------------------------------------------------------
test("BTP_PROFILE_SET: btp tenant is offered Chantier + all generics", () => {
  const ids = availableProfileIds(BTP);
  assert.deepEqual(ids, ["direction", "commercial", "chantier", "finance", "custom"]);
});

// --- NON_BTP_NO_CHANTIER_PROFILE / REAL_ESTATE / COMMERCE / GENERIC ----------
test("NON_BTP_NO_CHANTIER_PROFILE: no btp ⇒ Chantier hidden, generics kept", () => {
  for (const caps of [REAL_ESTATE, COMMERCE, [] as string[]]) {
    const ids = availableProfileIds(caps);
    assert.ok(!ids.includes("chantier"), `chantier hidden for ${caps[0] ?? "empty"}`);
    assert.deepEqual(ids, ["direction", "commercial", "finance", "custom"]);
  }
});
test("GENERIC_TENANT_SAFE / NO_VERTICAL_SAFE: empty caps ⇒ generics + custom, no crash", () => {
  assert.deepEqual(availableProfileIds([]), ["direction", "commercial", "finance", "custom"]);
});
test("UNKNOWN_VERTICAL_SAFE: unknown domains ⇒ generics only, no crash", () => {
  assert.deepEqual(availableProfileIds(["xyz.foo.bar"]), ["direction", "commercial", "finance", "custom"]);
});

// --- capabilities-unknown fail-open -----------------------------------------
test("CAPABILITIES_UNKNOWN_FAIL_OPEN: snapshot unavailable ⇒ offer ALL (never hide)", () => {
  assert.deepEqual(availableProfileIds([], false), ["direction", "commercial", "chantier", "finance", "custom"]);
});

// --- PROFILE_CAPABILITY_FILTER ----------------------------------------------
test("PROFILE_CAPABILITY_FILTER: only 'chantier' is domain-gated (requires btp)", () => {
  const gated = PROFILE_REGISTRY.filter((p) => p.requiredDomains.length > 0);
  assert.deepEqual(gated.map((p) => p.id), ["chantier"]);
  assert.deepEqual(PROFILE_REGISTRY.find((p) => p.id === "chantier")!.requiredDomains, ["btp"]);
});

// --- CUSTOM_PROFILE_ALWAYS_AVAILABLE + DIRECTION_GENERIC ---------------------
test("CUSTOM + DIRECTION always offered (generic)", () => {
  for (const caps of [BTP, REAL_ESTATE, [] as string[]]) {
    const ids = availableProfileIds(caps);
    assert.ok(ids.includes("custom"), "custom always");
    assert.ok(ids.includes("direction"), "direction always (generic)");
  }
});

// --- ACTIVE_PROFILE_FALLBACK / DEFAULT_HOME_FALLBACK -------------------------
test("ACTIVE_PROFILE_FALLBACK: unavailable candidate ⇒ deterministic fallback", () => {
  const avail: ProfileId[] = ["direction", "commercial", "finance", "custom"];
  assert.equal(fallbackProfile("chantier", avail), "direction", "→ direction preferred");
  assert.equal(fallbackProfile("commercial", avail), "commercial", "available kept");
  assert.equal(fallbackProfile("chantier", ["custom"]), "custom", "→ custom if no direction");
});
test("DEFAULT_HOME_FALLBACK: a fixed default-home of an unavailable profile falls back", () => {
  const state = { active: null, byId: {}, wallpaper: {} as never, schemaVersion: 1 };
  const home = resolveHomeProfile({ openLastMode: false, defaultHome: "chantier" }, state, null);
  assert.equal(home, "chantier");
  // but the app applies the availability fallback on top:
  assert.equal(fallbackProfile(home, ["direction", "commercial", "finance", "custom"]), "direction");
});

// --- CAPABILITY_REMOVED_PROFILE_HIDDEN / CAPABILITY_RESTORED_SAFE ------------
test("CAPABILITY_REMOVED_PROFILE_HIDDEN + RESTORED_SAFE: prefs preserved across toggles", () => {
  // user had selected chantier
  const stored = clampProfiles({ active: "chantier", byId: { chantier: { name: "Mon chantier" } }, schemaVersion: 1 });
  assert.equal(stored.active, "chantier", "stored active preserved even if later unavailable");
  assert.equal(stored.byId.chantier?.name, "Mon chantier", "profile config preserved");
  // btp removed ⇒ chantier not offered ⇒ fallback
  assert.ok(!availableProfileIds([]).includes("chantier"));
  // btp restored ⇒ chantier offered again, and the stored config is still there
  assert.ok(availableProfileIds(BTP).includes("chantier"));
});

// --- WIDGET_FILTER_STILL_APPLIED (preset references gated widgets) -----------
test("WIDGET_FILTER_STILL_APPLIED: chantier preset still builds (widget gate is separate)", () => {
  const layout = presetLayoutFor("chantier");
  assert.ok(Array.isArray(layout.order) && layout.order.length > 0);
});

// --- i18n: every registry profile has a label key in fr -----------------------
test("I18N_KEYS_MATCH: every profile labelKey exists in the fr catalog", async () => {
  const { fr } = await import("../lib/i18n/locales/fr.ts");
  for (const p of PROFILE_REGISTRY) {
    assert.ok(p.labelKey in fr, `missing i18n ${p.labelKey}`);
  }
});

// --- purity ------------------------------------------------------------------
test("NO_LLM / NO_API / NO_POLLING / NO_SCHEDULE: pure derivation", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dashboard/profiles.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /https?:\/\//);
  assert.doesNotMatch(src, /setInterval|setTimeout/);
  assert.doesNotMatch(src, /openai|anthropic|supabase/i);
});
