import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveResolverControl,
  parseResolverControl,
} from "../lib/resolver/controlState.ts";

const base = {
  authorized: true,
  enabled: false,
  circuit_state: "CLOSED",
  circuit_reason: null,
  max_batch: 3,
  max_concurrency: 1,
  cadence_seconds: 60,
  queue_depth: 4,
  running_count: 0,
  protected_exclusions_count: 4,
  preflight: { ready: true, denied_reasons: [], protected_exclusions_count: 4 },
};

test("parse: unauthorized/missing → safe defaults, never throws", () => {
  const c = parseResolverControl(null);
  assert.equal(c.authorized, false);
  assert.equal(c.enabled, false);
  assert.equal(c.circuitState, "CLOSED");
  assert.equal(c.preflightReady, false);
});

test("derive: disabled + preflight ready → DISABLED, canEnable true (authorized)", () => {
  const v = deriveResolverControl(parseResolverControl(base));
  assert.equal(v.status, "DISABLED");
  assert.equal(v.canEnable, true);
  assert.equal(v.canDisable, false);
  assert.equal(v.canResetCircuit, false);
});

test("derive: NOT authorized → canEnable false even if preflight ready", () => {
  const v = deriveResolverControl(parseResolverControl({ ...base, authorized: false }));
  assert.equal(v.canEnable, false);
  assert.equal(v.canDisable, false);
  assert.equal(v.canReap, false);
});

test("derive: circuit OPEN → CIRCUIT_OPEN, canReset true, canEnable false", () => {
  const v = deriveResolverControl(
    parseResolverControl({
      ...base,
      circuit_state: "OPEN",
      preflight: { ready: false, denied_reasons: ["CIRCUIT_NOT_CLOSED"] },
    }),
  );
  assert.equal(v.status, "CIRCUIT_OPEN");
  assert.equal(v.canResetCircuit, true);
  assert.equal(v.canEnable, false);
});

test("derive: budget blocker → BLOCKED_BUDGET, canEnable false", () => {
  const v = deriveResolverControl(
    parseResolverControl({
      ...base,
      preflight: { ready: false, denied_reasons: ["BUDGET_NOT_READY"] },
    }),
  );
  assert.equal(v.status, "BLOCKED_BUDGET");
  assert.equal(v.canEnable, false);
  assert.ok(v.blockers.includes("BUDGET_NOT_READY"));
});

test("derive: enabled + running → RUNNING; enabled idle → READY", () => {
  const running = deriveResolverControl(
    parseResolverControl({ ...base, enabled: true, running_count: 2 }),
  );
  assert.equal(running.status, "RUNNING");
  const ready = deriveResolverControl(
    parseResolverControl({ ...base, enabled: true, running_count: 0 }),
  );
  assert.equal(ready.status, "READY");
  assert.equal(ready.canDisable, true);
});

test("derive: preflight not ready → canEnable false (fail-closed at UI too)", () => {
  const v = deriveResolverControl(
    parseResolverControl({
      ...base,
      preflight: { ready: false, denied_reasons: ["RUNNING_PRESENT"] },
    }),
  );
  assert.equal(v.canEnable, false);
});
