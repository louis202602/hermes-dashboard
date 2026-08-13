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
//    (6-arg fenced form). A worker whose lease was stolen (reclaimed after lease
//    expiry) can no longer overwrite the fresh result. This consumer no longer
//    uses the legacy 5-arg form.
//  - SW23 COST GOVERNANCE (canonical path): before the model call the run calls
//    `sw23_route_and_reserve` (set_session_tenant first) — SW23 selects the
//    catalogued model (openai/gpt-5.4-nano, cost_status='real') and RESERVES the
//    budget computed from the REAL catalog price and the token estimate (no
//    arbitrary fixed amount). On success it COMMITS the routed cost via
//    `sw23_commit_budget`; on model failure it RELEASES via `sw23_release_budget`.
//    No second ledger, no parallel budget math. FOLLOW-UP (controlled run): the
//    commit currently uses the routed estimate; switch to actual provider token
//    usage × price once the exact n8n usage field is confirmed at run time.
//  - BOUNDED RECLAIM / DEAD-LETTER is enforced DB-side (claim stops past
//    max_attempts; a driver calls `reap_dead_letter_agent_actions()` before
//    claim). See db/migrations/20260813_hermes_resolver_execution_safety_1.sql.
//
// On agent error/timeout the request is marked FAILED (Complete Failed branch),
// which apply() turns into a fail-closed ERROR — no execution.
import { workflow, trigger, node, languageModel, outputParser, ifElse, expr } from '@n8n/workflow-sdk';

// Conservative token estimate for the intent-routing call. The reservation USD is
// computed BY SW23 from the real catalog price (get_active_price inside
// route_and_reserve) — never a hardcoded amount.
const EST_INPUT_TOKENS = '3000';
const EST_OUTPUT_TOKENS = '400';

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

// SW23 canonical route + reserve BEFORE the model call (set the SW23 session
// tenant + route_and_reserve in the SAME connection). request_id = the gateway
// request_id → idempotent reservation; SW23 prices the real catalog model.
const routeReserve = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'SW23 Route+Reserve',
    parameters: {
      operation: 'executeQuery',
      // Single result set: set the SW23 session tenant via set_config in a FROM
      // subquery so route_and_reserve sees the GUC. (A two-statement query returns
      // two items and breaks n8n item pairing — caught by the controlled E2E run.)
      query: "select hermes_os.sw23_route_and_reserve($1,$2,'hermes.intent.resolve','intent_routing','simple','normal','[]'::jsonb,'[\"text\"]'::jsonb,$3::numeric,$4::numeric,'openai','gpt-5.4-nano','[]'::jsonb,'day',now(),true) as route from (select set_config('app.sw23_tenant_id',$1,true)) _t",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.tenant_id, $('Claim Resolve').item.json.claim.request_id, " + JSON.stringify(EST_INPUT_TOKENS) + ", " + JSON.stringify(EST_OUTPUT_TOKENS) + " ] }}") },
    },
    credentials: PG,
  },
});

// Proceed to the model only if SW23 routed+reserved successfully. A no-eligible-
// model / budget rejection routes to a FAILED completion with no model spend.
const reserved = ifElse({
  version: 2.2,
  config: {
    name: 'Reserved?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr("{{ $json.route.success === true || $json.route.success === 'true' }}"), rightValue: true, operator: { type: 'boolean', operation: 'true' } }],
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

// SW23 — commit the reserved (real-priced) cost on success, same connection.
// FOLLOW-UP: replace route.estimated_cost with price × actual provider tokens
// once the exact usage field is confirmed during the controlled run.
const commit = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'SW23 Commit',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.sw23_commit_budget($1,$2,'day',$3::numeric) as commit from (select set_config('app.sw23_tenant_id',$1,true)) _t",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.tenant_id, $('Claim Resolve').item.json.claim.request_id, $('SW23 Route+Reserve').item.json.route.estimated_cost ] }}") },
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
      query: "select hermes_os.sw23_release_budget($1,$2,'day') as release from (select set_config('app.sw23_tenant_id',$1,true)) _t",
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
    .onTrue(routeReserve.to(reserved
      .onTrue(agent.to(mapResult.to(commit.to(completeSuccess))))
      .onFalse(completeFailed)))
    .onFalse(noWork))
  // Model error → release the reservation, then fail-closed completion.
  .add(agent.onError(release.to(completeFailed)));
