// GW Consumer — Hermes Semantic Resolver (n8n Workflow SDK source).
//
// Deployed to n8n as workflow IS1I8g0K8VXbm4oH, INACTIVE (manual trigger only —
// no Schedule Trigger). It claims queued `hermes.intent.resolve` gateway
// requests (action-scoped claim), runs a cheap OpenAI model (gpt-5.4-nano) with
// STRUCTURED output against the allowlisted capabilities carried in the request
// payload, and writes the model's PROPOSAL back via complete_agent_action.
//
// The model only PROPOSES {outcome, action_key, confidence, parameters, reason}.
// It never executes, never sees a service_role secret, and never decides
// permissions/tenant/SW15. The backend `apply_hermes_resolution()` re-validates
// the proposal against the registry and executes via the gateway (fail-closed).
//
// Execution-safety hardening (PR #21):
//  - LEASE-TOKEN FENCING: the claim returns a per-claim `lease_token`; it is
//    carried through the run and passed to `complete_agent_action(...,lease_token)`
//    (6-arg fenced form). A worker whose lease was stolen (reclaimed by another
//    worker after lease expiry) can no longer overwrite the fresh result — its
//    completion is ignored. This consumer no longer uses the legacy 5-arg form.
//  - SW23 COST GOVERNANCE: before the model call the run RESERVES budget via the
//    canonical SW23 engine (set_session_tenant → reserve_budget); on success it
//    COMMITS the actual cost, on failure-before-billable it RELEASES the
//    reservation. No second ledger, no parallel budget math. NOTE: the resolver
//    model must exist in `sw23_model_catalog` with real pricing for a *priced*
//    actual; until then the workflow reserves/commits a conservative fixed
//    estimate (RESERVE_USD) so spend is governed by the real ledger — precise
//    per-request pricing is a catalog follow-up.
//  - BOUNDED RECLAIM / DEAD-LETTER is enforced DB-side (claim stops past
//    max_attempts; a driver calls `reap_dead_letter_agent_actions()` before
//    claim). See db/migrations/20260813_hermes_resolver_execution_safety_1.sql.
//
// On agent error/timeout the request is marked FAILED (Complete Failed branch),
// which apply() turns into a fail-closed ERROR — no execution.
import { workflow, trigger, node, languageModel, outputParser, ifElse, expr } from '@n8n/workflow-sdk';

// Conservative per-call reservation (USD) until the resolver model is catalogued
// with real pricing. Governs spend via the real SW23 ledger without inventing a
// second cost engine.
const RESERVE_USD = '0.001';

const PG = { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } };

const manual = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Run' } });

const claim = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Resolve',
    parameters: { operation: 'executeQuery', query: "select hermes_os.claim_agent_action('hermes.intent.resolve', 300) as claim" },
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

// SW23 — reserve budget for this request BEFORE the model call (set the SW23
// session tenant + reserve in the SAME connection). request_id = the gateway
// request_id, so the reservation is idempotent per request.
const reserve = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'SW23 Reserve',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.sw23_set_session_tenant($1); select hermes_os.sw23_reserve_budget($1,$2,'hermes.intent.resolve',$3::numeric,'day') as reserve",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.tenant_id, $('Claim Resolve').item.json.claim.request_id, " + JSON.stringify(RESERVE_USD) + " ] }}") },
    },
    credentials: PG,
  },
});

// Proceed to the model only if the reservation was accepted (ok/replayed). A
// hard-stop budget rejection routes to a FAILED completion with no model spend.
const reserved = ifElse({
  version: 2.2,
  config: {
    name: 'Reserved?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr("{{ ['ok','replayed'].includes($json.reserve.status) }}"), rightValue: true, operator: { type: 'boolean', operation: 'true' } }],
        combinator: 'and',
      },
    },
  },
});

const model = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Cheap Router Model',
    parameters: { model: { __rl: true, mode: 'id', value: 'gpt-5.4-nano' }, options: { timeout: 30000, maxRetries: 2, reasoningEffort: 'low' } },
    credentials: { openAiApi: { id: 'sP4v0oZytx8qq0w0', name: 'OpenAI account' } },
  },
});

const parser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Proposal Parser',
    parameters: {
      schemaType: 'manual',
      inputSchema: '{"type":"object","properties":{"outcome":{"type":"string"},"action_key":{"type":["string","null"]},"confidence":{"type":"number"},"parameters":{"type":"object","additionalProperties":true},"reason":{"type":"string"}},"required":["outcome","action_key","confidence","parameters","reason"]}',
    },
  },
});

const agent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Hermes Intent Resolver',
    onError: 'continueErrorOutput',
    parameters: {
      promptType: 'define',
      text: expr("{{ $('Claim Resolve').item.json.claim.payload.message }}"),
      hasOutputParser: true,
      options: { systemMessage: expr("{{ \"Tu es le routeur d'intention d'Hermes (assistant BTP). Mappe le message utilisateur vers EXACTEMENT une capacite autorisee de la liste, sinon action_key=null. Tu ne fais que PROPOSER, tu n'executes rien et tu ne decides ni permissions ni tenant. Regles: (1) action_key EXACTEMENT depuis la liste sinon null; (2) intention correspond + parametres requis presents -> outcome=ACTION; (3) parametre requis manquant -> outcome=NEEDS_CLARIFICATION; (4) simple question/aide -> outcome=ANSWER_ONLY; (5) doute ou aucune capacite -> outcome=NEEDS_CLARIFICATION action_key=null; (6) n'invente jamais d'action_key; (7) confidence 0..1; (8) dans parameters, renseigne TOUS les required_payload_keys de la capacite choisie en extrayant leurs valeurs du message ET du contexte. Capacites autorisees (JSON): \" + JSON.stringify($('Claim Resolve').item.json.claim.payload.capabilities) + \" . Contexte recent de la conversation (JSON): \" + JSON.stringify($('Claim Resolve').item.json.claim.payload.context) }}") },
    },
    subnodes: { model, outputParser: parser },
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
      assignments: {
        assignments: [
          { id: 'r', name: 'result', type: 'object', value: expr("{{ { outcome: $('Hermes Intent Resolver').item.json.output.outcome, action_key: $('Hermes Intent Resolver').item.json.output.action_key, confidence: $('Hermes Intent Resolver').item.json.output.confidence, parameters: $('Hermes Intent Resolver').item.json.output.parameters, reason: $('Hermes Intent Resolver').item.json.output.reason, telemetry: { provider: 'openai', model: 'gpt-5.4-nano' } } }}") },
        ],
      },
    },
  },
});

// SW23 — commit the (estimated) actual cost on success, in the same connection.
const commit = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'SW23 Commit',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.sw23_set_session_tenant($1); select hermes_os.sw23_commit_budget($1,$2,'day',$3::numeric) as commit",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.tenant_id, $('Claim Resolve').item.json.claim.request_id, " + JSON.stringify(RESERVE_USD) + " ] }}") },
    },
    credentials: PG,
  },
});

// SW23 — release the reservation on model failure (no billable spend committed).
const release = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'SW23 Release',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.sw23_set_session_tenant($1); select hermes_os.sw23_release_budget($1,$2,'day') as release",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.tenant_id, $('Claim Resolve').item.json.claim.request_id ] }}") },
    },
    credentials: PG,
  },
});

// Fenced completion: pass the claim's lease_token (6-arg). A stale worker cannot
// overwrite a reclaimed request.
const completeSuccess = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Success',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'SUCCEEDED',$2::jsonb,null,$3,$4::uuid) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.id, JSON.stringify($('Map Result').item.json.result), $execution.id, $('Claim Resolve').item.json.claim.lease_token ] }}") },
    },
    credentials: PG,
  },
});

const completeFailed = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Failed',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'FAILED',null,$2::jsonb,$3,$4::uuid) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.id, JSON.stringify({ code: 'RESOLVER_ERROR', message: 'semantic resolver failed' }), $execution.id, $('Claim Resolve').item.json.claim.lease_token ] }}") },
    },
    credentials: PG,
  },
});

const noWork = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'No Work' } });

export default workflow('hermes-semantic-resolver', 'GW Consumer — Hermes Semantic Resolver')
  .add(manual)
  .to(claim)
  .to(claimed
    .onTrue(reserve.to(reserved
      .onTrue(agent.to(mapResult.to(commit.to(completeSuccess))))
      .onFalse(completeFailed)))
    .onFalse(noWork))
  // Model error → release the reservation, then fail-closed completion.
  .add(agent.onError(release.to(completeFailed)));
