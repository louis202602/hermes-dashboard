// GW Consumer — BTP Planning (n8n Workflow SDK source).
//
// Deployed to n8n as workflow 2MMvwJ8zb3jBftDi, INACTIVE (manual trigger only —
// no Schedule Trigger). It is the WRITE runner behind the gateway capability
// `btp.planning.phase.add`: it claims queued requests (action-scoped claim),
// records + gates the SW15 policy, resolves the chantier by name (tenant-scoped,
// production only), then runs the REAL Agent BTP-Planning (Dih5iny9QD3iQ9qQ) —
// reusing that agent's own validation and idempotence rather than duplicating
// planning logic — and writes the result back through complete_agent_action.
//
// All auth/tenant/permission/idempotency are enforced upstream by
// request_agent_action; `btp.planning.phase.add` is is_sensitive=true, so the
// Policy Gate (SW15) short-circuits: it proceeds only on PERMIT (which includes
// an admin-approved PENDING request). A missing chantier fails closed
// (NO_CHANTIER) and an agent error fails closed (AGENT_ERROR) — neither leaves
// the request stuck. Multi-param routing (chantier_name + phase_name) is handled
// by the semantic resolver; the catalog entry carries empty nl_keywords so the
// deterministic single-slot path never matches it.
import { workflow, trigger, node, ifElse, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } };

const manual = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Run' } });

const claim = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Planning',
    parameters: { operation: 'executeQuery', query: "select hermes_os.claim_agent_action('btp.planning.phase.add', 300) as claim" },
    credentials: PG,
  },
});

const claimed = ifElse({
  version: 2.2,
  config: {
    name: 'Claimed?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.claim.claimed }}'), rightValue: true, operator: { type: 'boolean', operation: 'true' } }],
        combinator: 'and',
      },
    },
  },
});

const policyGate = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Policy Gate (SW15)',
    parameters: {
      operation: 'executeQuery',
      query: 'select hermes_os.gateway_policy_gate($1::uuid) as effect',
      options: { queryReplacement: expr('{{ $json.claim.id }}') },
    },
    credentials: PG,
  },
});

const isPermit = ifElse({
  version: 2.2,
  config: {
    name: 'Is PERMIT?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.effect }}'), rightValue: 'PERMIT', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
    },
  },
});

// Scalar subquery → always exactly one row (id null when the chantier is
// absent), so Has Chantier? can branch instead of the request hanging on 0 rows.
const resolveChantier = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Resolve Chantier',
    parameters: {
      operation: 'executeQuery',
      alwaysOutputData: true,
      query: "select (select id from hermes_os.btp_chantiers where tenant_id=$1 and chantier_name=$2 and data_environment='production' order by created_at desc limit 1) as id",
      options: { queryReplacement: expr("{{ [ $('Claim Planning').item.json.claim.tenant_id, $('Claim Planning').item.json.claim.payload.chantier_name ] }}") },
    },
    credentials: PG,
  },
});

const hasChantier = ifElse({
  version: 2.2,
  config: {
    name: 'Has Chantier?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.id }}'), operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and',
      },
    },
  },
});

const mapAgentInput = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Map Agent Input',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 't', name: 'tenant_id', type: 'string', value: expr("{{ $('Claim Planning').item.json.claim.tenant_id }}") },
        { id: 'c', name: 'chantier_id', type: 'string', value: expr("{{ $('Resolve Chantier').item.json.id }}") },
        { id: 'p', name: 'planning', type: 'object', value: expr("{{ { phase_name: $('Claim Planning').item.json.claim.payload.phase_name, description: ($('Claim Planning').item.json.claim.payload.description || null), order: ($('Claim Planning').item.json.claim.payload.order || 1) } }}") },
      ] },
    },
  },
});

const runAgent = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Run Planning Agent',
    parameters: {
      mode: 'once',
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'Dih5iny9QD3iQ9qQ' },
      options: { waitForSubWorkflow: true },
    },
    onError: 'continueErrorOutput',
  },
});

const completeSuccess = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Success',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'SUCCEEDED',$2::jsonb,null,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Planning').item.json.claim.id, JSON.stringify({ planning_id: $json.planning_id, code: $json.code }), $execution.id ] }}") },
    },
    credentials: PG,
  },
});

const completeFailedNoChantier = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Failed - No Chantier',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'FAILED',null,$2::jsonb,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Planning').item.json.claim.id, JSON.stringify({ code: 'NO_CHANTIER', message: 'chantier introuvable' }), $execution.id ] }}") },
    },
    credentials: PG,
  },
});

const completeFailedAgent = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Failed - Agent',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'FAILED',null,$2::jsonb,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Planning').item.json.claim.id, JSON.stringify({ code: 'AGENT_ERROR', message: 'planning agent failed' }), $execution.id ] }}") },
    },
    credentials: PG,
  },
});

const gatedNoOp = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'Gated (No Op)' } });
const noWork = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'No Work' } });

export default workflow('hermes-btp-planning', 'GW Consumer — BTP Planning')
  .add(manual)
  .to(claim)
  .to(claimed
    .onTrue(policyGate.to(isPermit
      .onTrue(resolveChantier.to(hasChantier
        .onTrue(mapAgentInput.to(runAgent.to(completeSuccess).onError(completeFailedAgent)))
        .onFalse(completeFailedNoChantier)))
      .onFalse(gatedNoOp)))
    .onFalse(noWork));
