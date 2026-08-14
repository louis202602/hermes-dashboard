// Hermès OS — GW Reaper: Semantic Resolver dead-letters (BOUNDED, DORMANT)
// ============================================================================
// E2.2 control-plane source for reclaiming stuck resolver requests. REPO SOURCE
// ARTIFACT ONLY — NOT deployed and NOT activated in E2.2. Activation + a real
// Schedule are wired in E2.3, under explicit operator authorization.
//
// Reuses the canonical, bounded, skip-locked, idempotent dead-letter primitive
// (hermes_os.reap_resolver_dead_letters → reap_dead_letter_agent_actions for
// 'hermes.intent.resolve'). It moves requests that are RUNNING with an EXPIRED
// lease AND attempts >= max_attempts to FAILED / error_code=DEAD_LETTER (with an
// audit event) — it NEVER silently re-queues. No second dead-letter system.
//
// A companion "circuit evaluate" step (hermes_os.resolver_circuit_evaluate) can
// trip the canonical kill-switch (enabled=false, circuit_state=OPEN) when recent
// failure/dead-letter thresholds are crossed — it acts on the SAME control as
// the kill-switch, never a contradictory second switch.
//
// Fail-closed order (nothing runs live in E2.2):
//   Schedule tick (INACTIVE)
//     → Reap dead letters (bounded batch)
//     → Evaluate circuit (may set enabled=false / OPEN)
//   No claim, no model call — this driver only reclaims + protects.

import { workflow, trigger, node } from '@n8n/workflow-sdk';

// INACTIVE in E2.2. E2.3 replaces this with a real Schedule Trigger.
const tick = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Tick (Manual — Schedule wired in E2.3)' },
});

// Bounded reap of resolver dead-letters (idempotent; skip-locked; batch ≤ 200).
const reap = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Reap resolver dead-letters',
    parameters: {
      operation: 'executeQuery',
      query: 'select hermes_os.reap_resolver_dead_letters(200) as reaped',
    },
  },
});

// Evaluate the circuit breaker: trips the kill-switch off if recent failures /
// dead-letters cross the configured thresholds (platform-level, action-scoped).
const circuit = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Evaluate circuit breaker',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.resolver_circuit_evaluate('hermes.intent.resolve') as circuit",
    },
  },
});

export default workflow({
  name: 'GW Reaper — Hermes Semantic Resolver (bounded)',
  active: false, // DORMANT — never activated in E2.2.
  meta: {
    description:
      'Bounded, dormant reaper + circuit evaluator for the semantic resolver. ' +
      'Reuses reap_dead_letter_agent_actions + resolver_circuit_evaluate. Not ' +
      'deployed / not activated in E2.2; real Schedule wired in E2.3.',
  },
  nodes: [tick, reap, circuit],
  connections: [
    [tick, reap],
    [reap, circuit],
  ],
});
