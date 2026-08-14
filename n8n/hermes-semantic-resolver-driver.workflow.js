// Hermès OS — GW Driver: Semantic Resolver (BOUNDED, DORMANT)
// ============================================================================
// E2.1 control-plane driver for the Semantic Resolver. This is a REPO SOURCE
// ARTIFACT ONLY — it is NOT deployed and NOT activated in E2.1. Activation +
// the final per-item resolution wiring happen in E2.3, under explicit operator
// authorization.
//
// Fail-closed order (nothing costly runs until every guard passes):
//   Schedule tick  (INACTIVE — no live Schedule in E2.1)
//     → Runtime Guard: hermes_os.claim_semantic_resolver_batch('hermes.intent.resolve')
//         · DB kill-switch: resolver_runtime_config.enabled must be TRUE
//         · bounded by max_batch AND max_concurrency (vs leased RUNNING)
//         · reuses the canonical claim_agent_action (lease token + attempts) —
//           NO second queue engine
//     → If enabled && claimed_count > 0
//         → for each claimed item (SplitInBatches):
//             SW23 route+reserve (day budget; heliosolar has a hard_stop budget
//               → an over-budget reserve is DENIED before any model call)
//             → LLM proposal (gpt-5.4-nano, PROPOSAL ONLY — never executes)
//             → complete_agent_action(SUCCEEDED, proposal, …, lease_token)
//             → on failure: SW23 release + complete_agent_action(FAILED, …)
//     → else: No Work (kill-switch off, saturated, or empty queue)
//
// The DB kill-switch is the PRIMARY stop; the n8n workflow-active toggle is a
// SECOND independent level. Either one off ⇒ zero claims, zero model calls.
//
// Companion of n8n/hermes-semantic-resolver.workflow.js (the single-item
// resolver). This driver only adds the SAFE control plane on top of the same
// canonical primitives.

import { workflow, trigger, node, ifElse, expr } from '@n8n/workflow-sdk';

// INACTIVE in E2.1. E2.3 replaces this with a real Schedule Trigger whose
// interval mirrors resolver_runtime_config.cadence_seconds, and only after the
// go-live checklist (budget configured, kill-switch verified, queue triaged).
const tick = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Tick (Manual — Schedule wired in E2.3)' },
});

// Runtime Guard — the single choke point. Returns { enabled, reason,
// claimed_count, claims:[…] }. When enabled=false / DISABLED / NO_CONFIG /
// CONCURRENCY_SATURATED it returns zero claims and the run ends at "No Work".
const guard = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Runtime Guard (batch claim)',
    parameters: {
      operation: 'executeQuery',
      query:
        "select hermes_os.claim_semantic_resolver_batch('hermes.intent.resolve', 300) as guard",
    },
  },
});

const hasWork = ifElse({
  name: 'Enabled & claimed?',
  conditions: [
    // Fail-closed: proceed ONLY when the DB kill-switch let claims through.
    { left: expr("{{ $json.guard.enabled === true }}"), operator: 'true' },
    { left: expr("{{ ($json.guard.claimed_count || 0) > 0 }}"), operator: 'true' },
  ],
  combinator: 'and',
});

// Fan out over the claimed items. Each item carries id / tenant_id / request_id
// / lease_token / attempts / payload from the canonical claim. The per-item
// resolution (SW23 route+reserve → gpt-5.4-nano proposal → complete_agent_action
// with the lease_token; SW23 release + FAILED on error) is identical to
// n8n/hermes-semantic-resolver.workflow.js and is wired in E2.3 — kept out of
// E2.1 so this driver ships as a pure, dormant control plane.
const split = node({
  type: 'n8n-nodes-base.splitInBatches',
  version: 3,
  config: {
    name: 'Per claimed item',
    parameters: { options: {} },
    notes:
      'E2.3: connect each item to the canonical resolution subgraph ' +
      '(SW23 route+reserve → LLM proposal → complete_agent_action w/ lease_token).',
  },
});

const noWork = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'No Work (kill-switch off / saturated / empty)' },
});

export default workflow({
  name: 'GW Driver — Hermes Semantic Resolver (bounded)',
  active: false, // DORMANT — never activated in E2.1.
  meta: {
    description:
      'Bounded, dormant driver for the semantic resolver. DB kill-switch + ' +
      'batch/concurrency bounds enforced in hermes_os.claim_semantic_resolver_batch. ' +
      'Not deployed / not activated in E2.1; per-item wiring + Schedule in E2.3.',
  },
  nodes: [tick, guard, hasWork, split, noWork],
  connections: [
    [tick, guard],
    [guard, hasWork],
    [hasWork.true, split],
    [hasWork.false, noWork],
  ],
});
