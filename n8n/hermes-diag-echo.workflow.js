// GW Consumer — Diag Echo (n8n Workflow SDK source).
//
// Deployed to n8n as workflow 6687hzOPQ27an2J6, INACTIVE (manual trigger only —
// no Schedule Trigger). It claims queued `diag.echo` gateway requests
// (action-scoped claim), echoes the request payload, and completes the request
// SUCCEEDED. This is the SAFE diagnostic capability: no business effect, no
// external calls, no secrets — it only proves the gateway can execute a second
// distinct capability end-to-end. All auth/tenant/permission/idempotency are
// enforced upstream by request_agent_action; diag.echo is is_sensitive=false so
// SW15 permits by default.
import { workflow, trigger, node, ifElse, expr } from '@n8n/workflow-sdk';

const manual = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Run' } });

const claim = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Diag',
    parameters: { operation: 'executeQuery', query: "select hermes_os.claim_agent_action('diag.echo', 120) as claim" },
    credentials: { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } },
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

const echo = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Echo Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'r', name: 'result', type: 'object', value: expr("{{ { code: 'ECHO', echo: $('Claim Diag').item.json.claim.payload } }}") },
      ] },
    },
  },
});

const complete = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Success',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'SUCCEEDED',$2::jsonb,null,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Diag').item.json.claim.id, JSON.stringify($json.result), $execution.id ] }}") },
    },
    credentials: { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } },
  },
});

const noWork = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'No Work' } });

export default workflow('hermes-diag-echo', 'GW Consumer — Diag Echo')
  .add(manual)
  .to(claim)
  .to(claimed.onTrue(echo.to(complete)).onFalse(noWork));
