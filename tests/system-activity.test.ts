import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  buildActivityFeed,
  classifyPlatformHealth,
  describeResolver,
  extractCostSummary,
  formatActivityTime,
  normalizeActivityStatus,
  parseAgentActionStats,
  parseCommercial,
  type ActivityStatus,
} from "../lib/dashboard/systemActivity.ts";
import type {
  CostGovernanceSnapshot,
  ObsExecution,
  ObsGateway,
  PlatformHealth,
  ResolverObservability,
  ServiceResult,
} from "../types/hermes.ts";

function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, provenance: "REAL", data };
}
function unavail<T>(): ServiceResult<T> {
  return { ok: false, provenance: "UNAVAILABLE", error: "x" };
}

// --- PLATFORM_HEALTH_OK / _DEGRADED / _UNAVAILABLE --------------------------
test("PLATFORM_HEALTH_OK: active components ⇒ OPERATIONAL, coverage PARTIAL", () => {
  const h = classifyPlatformHealth(
    ok<PlatformHealth>({
      resolutionStatus: "OK",
      componentsRegistered: 95,
      componentsActive: 64,
      lastExecutionAt: "2026-08-07T08:39:02Z",
    }),
  );
  assert.equal(h.status, "OPERATIONAL");
  assert.equal(h.coverage, "PARTIAL"); // never a bold "everything works"
  assert.equal(h.componentsActive, 64);
});

test("PLATFORM_HEALTH_DEGRADED: zero active components ⇒ DEGRADED", () => {
  const h = classifyPlatformHealth(
    ok<PlatformHealth>({
      resolutionStatus: "OK",
      componentsRegistered: 95,
      componentsActive: 0,
      lastExecutionAt: null,
    }),
  );
  assert.equal(h.status, "DEGRADED");
  assert.equal(h.coverage, "PARTIAL");
});

test("PLATFORM_HEALTH_UNAVAILABLE: read failed ⇒ UNAVAILABLE", () => {
  const h = classifyPlatformHealth(unavail<PlatformHealth>());
  assert.equal(h.status, "UNAVAILABLE");
  assert.equal(h.coverage, "UNAVAILABLE");
});

// --- STATUS normalisation ---------------------------------------------------
test("STATUS_SUCCEEDED/RUNNING/FAILED/DEAD_LETTER normalise deterministically", () => {
  assert.equal(normalizeActivityStatus("SUCCEEDED"), "SUCCEEDED");
  assert.equal(normalizeActivityStatus("success"), "SUCCEEDED");
  assert.equal(normalizeActivityStatus("RUNNING"), "RUNNING");
  assert.equal(normalizeActivityStatus("FAILED"), "FAILED");
  assert.equal(normalizeActivityStatus("error"), "FAILED");
  assert.equal(normalizeActivityStatus("DEAD_LETTER"), "DEAD_LETTER");
  assert.equal(normalizeActivityStatus("QUEUED"), "QUEUED");
  assert.equal(normalizeActivityStatus("weird"), "UNKNOWN");
  assert.equal(normalizeActivityStatus(null), "UNKNOWN");
});

// --- AGENT_ACTIVITY_EMPTY / _RECENT / SORT / LIMIT --------------------------
const gw = (actionKey: string, status: string, createdAt: string): ObsGateway => ({
  actionKey,
  status,
  policyDecision: null,
  errorCode: null,
  createdAt,
});
const ex = (
  domain: string,
  status: string,
  latencyMs: number | null,
  finishedAt: string,
  degraded = false,
): ObsExecution => ({ domain, status, latencyMs, degraded, finishedAt });

test("AGENT_ACTIVITY_EMPTY: no data ⇒ empty feed", () => {
  assert.deepEqual(buildActivityFeed([], []), []);
});

test("AGENT_ACTIVITY_RECENT + ACTIVITY_SORT_ORDER: most recent first", () => {
  const feed = buildActivityFeed(
    [
      gw("btp.planning.phase.add", "SUCCEEDED", "2026-08-15T08:00:00Z"),
      gw("btp.suivi.progress.report", "FAILED", "2026-08-15T10:00:00Z"),
    ],
    [ex("resolver", "SUCCEEDED", 1200, "2026-08-15T09:00:00Z")],
  );
  assert.equal(feed.length, 3);
  assert.deepEqual(
    feed.map((f) => f.at),
    ["2026-08-15T10:00:00Z", "2026-08-15T09:00:00Z", "2026-08-15T08:00:00Z"],
  );
  assert.equal(feed[0].status, "FAILED");
  assert.equal(feed[1].latencyMs, 1200);
});

test("ACTIVITY_LIMIT: feed is bounded", () => {
  const many: ObsGateway[] = Array.from({ length: 40 }, (_, i) =>
    gw(`a${i}`, "SUCCEEDED", `2026-08-15T${String(i % 24).padStart(2, "0")}:00:00Z`),
  );
  assert.equal(buildActivityFeed(many, [], 12).length, 12);
  assert.equal(buildActivityFeed(many, [], 5).length, 5);
});

test("execution degraded flag wins over raw status", () => {
  const feed = buildActivityFeed([], [ex("x", "SUCCEEDED", 10, "2026-08-15T09:00:00Z", true)]);
  assert.equal(feed[0].status, "DEGRADED");
});

// --- RESOLVER_DISABLED / RESOLVER_CIRCUIT_OPEN -----------------------------
function resolver(partial: {
  enabled: boolean;
  circuit: "CLOSED" | "OPEN";
  state: string;
}): ServiceResult<ResolverObservability> {
  return ok({
    resolutionStatus: "OK",
    control: { enabled: partial.enabled, circuitState: partial.circuit },
    queue: { queueDepth: 4, runningCount: 0 },
    outcomes: { deadLetterCount: 2 },
    resolverState: partial.state,
  } as unknown as ResolverObservability);
}

test("RESOLVER_DISABLED: reads disabled + CLOSED", () => {
  const r = describeResolver(resolver({ enabled: false, circuit: "CLOSED", state: "DISABLED" }));
  assert.equal(r.available, true);
  assert.equal(r.enabled, false);
  assert.equal(r.circuit, "CLOSED");
  assert.equal(r.deadLetter, 2);
});

test("RESOLVER_CIRCUIT_OPEN: surfaces OPEN circuit", () => {
  const r = describeResolver(resolver({ enabled: false, circuit: "OPEN", state: "CIRCUIT_OPEN" }));
  assert.equal(r.circuit, "OPEN");
  assert.equal(r.state, "CIRCUIT_OPEN");
});

test("resolver unavailable ⇒ all null, no crash", () => {
  const r = describeResolver(unavail<ResolverObservability>());
  assert.equal(r.available, false);
  assert.equal(r.enabled, null);
});

// --- COST_REAL / COST_UNAVAILABLE ------------------------------------------
function costSnap(day: number, month: number, remaining: number | null): ServiceResult<CostGovernanceSnapshot> {
  return ok({
    resolutionStatus: "OK",
    period: {
      day: { exposureUsd: day },
      month: { exposureUsd: month, remainingUsd: remaining },
    },
  } as unknown as CostGovernanceSnapshot);
}

test("COST_REAL: exposes today/month/remaining in USD source currency", () => {
  const c = extractCostSummary(costSnap(0.02, 1.27, 98.73));
  assert.equal(c.provenance, "REAL");
  assert.equal(c.todayUsd, 0.02);
  assert.equal(c.monthUsd, 1.27);
  assert.equal(c.remainingUsd, 98.73);
  assert.equal(c.currency, "USD");
});

test("COST_UNAVAILABLE: missing snapshot ⇒ UNAVAILABLE, no fabricated amount", () => {
  const c = extractCostSummary(unavail<CostGovernanceSnapshot>());
  assert.equal(c.provenance, "UNAVAILABLE");
  assert.equal(c.todayUsd, null);
});

// --- TIMEZONE_PARIS / TIMEZONE_NEW_YORK ------------------------------------
test("TIMEZONE_PARIS / NEW_YORK: activity time is tenant-local", () => {
  const iso = "2026-07-15T13:30:00Z"; // 15:30 Paris (+2), 09:30 NY (-4)
  assert.match(formatActivityTime(iso, "Europe/Paris", "fr-FR"), /15:30/);
  assert.match(formatActivityTime(iso, "America/New_York", "fr-FR"), /09:30/);
  assert.equal(formatActivityTime(null, "Europe/Paris", "fr-FR"), "—");
});

// --- FAIL_SOFT_OBSERVABILITY -----------------------------------------------
test("FAIL_SOFT_OBSERVABILITY: activity independent of platform health", () => {
  // Even with platform health UNAVAILABLE, an activity feed still builds.
  assert.equal(classifyPlatformHealth(unavail<PlatformHealth>()).status, "UNAVAILABLE");
  assert.equal(
    buildActivityFeed([gw("x", "SUCCEEDED", "2026-08-15T09:00:00Z")], []).length,
    1,
  );
});

// --- COMMERCIAL_EMPTY / _REAL / _CURRENCY_PRESERVED ------------------------
test("COMMERCIAL_EMPTY: zero devis ⇒ zeros, EUR, no fabrication", () => {
  const c = parseCommercial({ resolution_status: "OK", currency: "EUR", total: 0 });
  assert.equal(c.total, 0);
  assert.equal(c.sent, 0);
  assert.equal(c.currency, "EUR");
});

test("COMMERCIAL_REAL + CURRENCY_PRESERVED: EUR kept, never converted", () => {
  const c = parseCommercial({
    resolution_status: "OK", currency: "EUR",
    total: 5, sent: 4, to_follow_up: 1, accepted: 2,
    amount_sent_ttc_eur: 42000, amount_accepted_ttc_eur: 18000,
  });
  assert.equal(c.total, 5);
  assert.equal(c.toFollowUp, 1);
  assert.equal(c.accepted, 2);
  assert.equal(c.amountAcceptedTtcEur, 18000);
  assert.equal(c.currency, "EUR"); // SW23=USD elsewhere; devis stays EUR
});

// --- CROSS_TENANT / UNAUTHENTICATED (RPC-enforced; verified live) ----------
test("UNAUTHENTICATED/NO_TENANT payloads surface empty, no leak", () => {
  const s = parseAgentActionStats({ resolution_status: "UNAUTHENTICATED" });
  assert.equal(s.resolutionStatus, "UNAUTHENTICATED");
  assert.equal(s.queued, 0);
  const c = parseCommercial({ resolution_status: "NO_TENANT" });
  assert.equal(c.resolutionStatus, "NO_TENANT");
  assert.equal(c.total, 0);
});

// --- LIGHT / DARK / TABLET / MOBILE (design-system contract) ----------------
test("LIGHT/DARK/TABLET/MOBILE: DASH-3 panels are token-driven + responsive", () => {
  const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(css, /\.sysh-card|\.sysh-grid/);
  assert.match(css, /\.activity-item/);
  assert.match(css, /\.commercial-metric/);
  assert.match(css, /\.sysh-metric[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.activity-item\.is-failed[^}]*var\(--danger\)/s);
  // Mobile breakpoint collapses the 4-col action grid.
  assert.match(css, /@media \(max-width: 560px\)[^@]*\.sysh-grid-4/s);
});

const _statuses: ActivityStatus[] = ["SUCCEEDED", "RUNNING", "QUEUED", "DEGRADED", "FAILED", "DEAD_LETTER", "UNKNOWN"];
void _statuses;
