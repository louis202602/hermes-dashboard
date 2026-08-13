/**
 * Real unit tests for the pure tenant-identity display helpers
 * (`lib/tenant/identity.ts`). Run with the Node built-in test runner:
 *
 *   node --test tests/
 *
 * The identity is resolved server-side (multi-tenant safe); these cover only the
 * label preference (display_name → name → slug) and the initials fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { tenantLabel, tenantInitials } from "../lib/tenant/identity.ts";

test("tenantLabel prefers display_name, then name, then slug", () => {
  assert.equal(
    tenantLabel({ displayName: "HelioSolar", name: "helio", tenantId: "heliosolar" }),
    "HelioSolar",
  );
  assert.equal(tenantLabel({ displayName: null, name: "Agence Dupont", tenantId: "dupont" }), "Agence Dupont");
  assert.equal(tenantLabel({ displayName: "  ", name: null, tenantId: "acme-immo" }), "acme-immo");
  assert.equal(tenantLabel({ displayName: null, name: null, tenantId: null }), null);
});

test("tenantInitials: single word → first two chars, two words → initials", () => {
  assert.equal(tenantInitials("HelioSolar"), "HE");
  assert.equal(tenantInitials("Agence Dupont"), "AD");
  assert.equal(tenantInitials("Dupont Immobilier Conseil"), "DI");
  assert.equal(tenantInitials("acme"), "AC");
  assert.equal(tenantInitials(""), "—");
});
