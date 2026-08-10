// Agent BTP-Suivi (n8n Workflow SDK source) — CONVERGED onto the canonical service.
//
// This is the pre-existing PRODUCTION agent (n8n id O9BLGvhAGjd8oiv3) called by
// SW4 - Agent Execution (lFopccFfaudvNHZi). It is tracked here only to record the
// architectural convergence done during the PR #12 review: its two inline write
// nodes (the suivi INSERT and the optional incident INSERT) were replaced by a
// single call to the canonical business service
// `hermes_os.record_btp_suivi_progress(...)`. Every other node — the
// `workflowTrigger` (UNCHANGED so SW4 keeps calling it exactly as before),
// Validate Tenant, Reject - Invalid, and both Return nodes — is preserved, and
// the `callerPolicy` stays `workflowsFromAList` (SW4 only). Behaviour is
// identical to the previous inline logic (same idempotent write + same
// incident-on-new-row side-effect), verified E2E.
//
// The gateway consumer (hermes-btp-suivi.workflow.js) calls the SAME function,
// so there is exactly ONE business implementation of the suivi write.
import { workflow, trigger, node, ifElse, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } };

// UNCHANGED legacy sub-workflow trigger — SW4 invokes the agent through this.
const trig = trigger({
  type: 'n8n-nodes-base.workflowTrigger',
  version: 1,
  config: { name: 'Execute Workflow Trigger', parameters: { events: '[]' } },
});

const validateTenant = ifElse({
  version: 2.2,
  config: {
    name: 'Validate Tenant',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.tenant_id }}'), operator: { type: 'string', operation: 'notEmpty' } }],
        combinator: 'and',
      },
    },
  },
});

// Single canonical business service — shared with the gateway consumer. SW4
// passes the incident object through, exercising the function's incident path.
const recordSuivi = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Record Suivi (canonical)',
    parameters: {
      operation: 'executeQuery',
      alwaysOutputData: true,
      query: 'select hermes_os.record_btp_suivi_progress($1,$2::uuid,$3::date,$4,$5,$6,$7,$8::jsonb) as res',
      options: { queryReplacement: expr("{{ [ $json.tenant_id, $json.chantier_id, $json.suivi.date, $json.suivi.phase, ($json.suivi.pct || 0), ($json.suivi.notes || ''), ($json.request_id || null), ($json.incident ? JSON.stringify($json.incident) : null) ] }}") },
    },
    credentials: PG,
  },
});

const isIdempotent = ifElse({
  version: 2.2,
  config: {
    name: 'Is Idempotent?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.res.code }}'), rightValue: 'IDEMPOTENT', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
    },
  },
});

const returnIdempotent = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: { name: 'Return Idempotent', parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [
    { id: 'status', name: 'status', type: 'string', value: 'success' },
    { id: 'code', name: 'code', type: 'string', value: 'IDEMPOTENT' },
  ] } } },
});

const returnSuccess = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: { name: 'Return Success', parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [
    { id: 'status', name: 'status', type: 'string', value: 'success' },
    { id: 'code', name: 'code', type: 'string', value: 'SUIVI_RECORDED' },
  ] } } },
});

const rejectInvalid = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: { name: 'Reject - Invalid', parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [
    { id: 'status', name: 'status', type: 'string', value: 'error' },
  ] } } },
});

export default workflow('agent-btp-suivi', 'Agent BTP-Suivi')
  .add(trig)
  .to(validateTenant
    .onTrue(recordSuivi.to(isIdempotent
      .onTrue(returnIdempotent)
      .onFalse(returnSuccess)))
    .onFalse(rejectInvalid));
