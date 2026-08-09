// GW Consumer — BTP Suivi (n8n Workflow SDK source).
//
// Deployed to n8n as workflow 1xCiexp3oVj0R8Tk, INACTIVE (manual trigger only —
// no Schedule Trigger). It is the WRITE runner behind the gateway capability
// `btp.suivi.progress.report`: it claims queued requests (action-scoped claim),
// records + gates the SW15 policy, resolves the chantier by name (tenant-scoped),
// then applies the REAL Agent BTP-Suivi CANONICAL idempotent progress write —
// INSERT INTO btp_suivi_avancement … ON CONFLICT (tenant_id, chantier_id,
// date_rapport) DO NOTHING — and writes the result back with complete_agent_action.
//
// Why the write is applied directly rather than by invoking the agent workflow:
// Agent BTP-Suivi (O9BLGvhAGjd8oiv3) uses the legacy `workflowTrigger` node,
// which is NOT invokable as an Execute Sub-workflow — a call fails with
// "Missing node to start execution". Changing that production agent's trigger
// would risk its SW4 caller, so the consumer reproduces the agent's exact
// idempotent contract instead. The production agent is left completely untouched
// (SW4 `lFopccFfaudvNHZi` remains its sole caller).
//
// All auth/tenant/permission/idempotency are enforced upstream by
// request_agent_action; `btp.suivi.progress.report` is is_sensitive=true, so the
// Policy Gate (SW15) short-circuits: it proceeds only on PERMIT (which includes
// an admin-approved PENDING request). A missing chantier fails closed
// (NO_CHANTIER) and a write error fails closed (WRITE_ERROR). Multi-param routing
// (chantier_name + pct) is handled by the semantic resolver; the catalog entry
// carries empty nl_keywords so the deterministic single-slot path never matches.
import { workflow, trigger, node, ifElse, expr } from '@n8n/workflow-sdk';

const PG = { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } };

const manual = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Run' } });

const claim = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Suivi',
    parameters: { operation: 'executeQuery', query: "select hermes_os.claim_agent_action('btp.suivi.progress.report', 300) as claim" },
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

// Scalar subquery → always exactly one row (id null when the chantier is absent),
// so Has Chantier? can branch instead of hanging on 0 rows. Tenant-scoped: a
// caller can never resolve another tenant's chantier.
const resolveChantier = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Resolve Chantier',
    parameters: {
      operation: 'executeQuery',
      alwaysOutputData: true,
      query: "select (select id from hermes_os.btp_chantiers where tenant_id=$1 and chantier_name=$2 order by created_at desc limit 1) as id",
      options: { queryReplacement: expr("{{ [ $('Claim Suivi').item.json.claim.tenant_id, $('Claim Suivi').item.json.claim.payload.chantier_name ] }}") },
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
        { id: 't', name: 'tenant_id', type: 'string', value: expr("{{ $('Claim Suivi').item.json.claim.tenant_id }}") },
        { id: 'c', name: 'chantier_id', type: 'string', value: expr("{{ $('Resolve Chantier').item.json.id }}") },
        { id: 'd', name: 'date', type: 'string', value: expr("{{ $now.toFormat('yyyy-LL-dd') }}") },
        { id: 'p', name: 'phase', type: 'string', value: expr("{{ $('Claim Suivi').item.json.claim.payload.phase_name || $('Claim Suivi').item.json.claim.payload.phase || 'Avancement' }}") },
        { id: 'pc', name: 'pct', type: 'number', value: expr("{{ Number($('Claim Suivi').item.json.claim.payload.pct) || 0 }}") },
        { id: 'n', name: 'notes', type: 'string', value: expr("{{ $('Claim Suivi').item.json.claim.payload.notes || '' }}") },
      ] },
    },
  },
});

// Agent BTP-Suivi canonical idempotent write (same contract as the agent's
// "Check Idempotent" node): idempotent by (tenant_id, chantier_id, date_rapport).
const recordSuivi = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Record Suivi',
    onError: 'continueErrorOutput',
    parameters: {
      operation: 'executeQuery',
      alwaysOutputData: true,
      query: 'insert into hermes_os.btp_suivi_avancement (tenant_id, chantier_id, date_rapport, phase_en_cours, pct_global, observations) values ($1,$2::uuid,$3::date,$4,$5,$6) on conflict (tenant_id, chantier_id, date_rapport) do nothing returning id',
      options: { queryReplacement: expr("{{ [ $json.tenant_id, $json.chantier_id, $json.date, $json.phase, $json.pct, $json.notes ] }}") },
    },
    credentials: PG,
  },
});

const mapResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Map Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: { assignments: [
        { id: 'code', name: 'code', type: 'string', value: expr("{{ $json.id ? 'SUIVI_RECORDED' : 'IDEMPOTENT' }}") },
        { id: 'sid', name: 'suivi_id', type: 'string', value: expr("{{ $json.id || '' }}") },
      ] },
    },
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
      options: { queryReplacement: expr("{{ [ $('Claim Suivi').item.json.claim.id, JSON.stringify({ code: $json.code, phase: $('Map Agent Input').item.json.phase, pct: $('Map Agent Input').item.json.pct, suivi_id: $json.suivi_id }), $execution.id ] }}") },
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
      options: { queryReplacement: expr("{{ [ $('Claim Suivi').item.json.claim.id, JSON.stringify({ code: 'NO_CHANTIER', message: 'chantier introuvable' }), $execution.id ] }}") },
    },
    credentials: PG,
  },
});

const completeFailedWrite = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Failed - Write',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'FAILED',null,$2::jsonb,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Suivi').item.json.claim.id, JSON.stringify({ code: 'WRITE_ERROR', message: 'suivi write failed' }), $execution.id ] }}") },
    },
    credentials: PG,
  },
});

const gatedNoOp = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'Gated (No Op)' } });
const noWork = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'No Work' } });

export default workflow('hermes-btp-suivi', 'GW Consumer — BTP Suivi')
  .add(manual)
  .to(claim)
  .to(claimed
    .onTrue(policyGate.to(isPermit
      .onTrue(resolveChantier.to(hasChantier
        .onTrue(mapAgentInput.to(recordSuivi.to(mapResult.to(completeSuccess)).onError(completeFailedWrite)))
        .onFalse(completeFailedNoChantier)))
      .onFalse(gatedNoOp)))
    .onFalse(noWork));
