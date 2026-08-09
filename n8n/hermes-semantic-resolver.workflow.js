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
// On agent error/timeout the request is marked FAILED (Complete Failed branch),
// which apply() turns into a fail-closed ERROR — no execution.
import { workflow, trigger, node, languageModel, outputParser, ifElse, expr } from '@n8n/workflow-sdk';

const manual = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Manual Run' } });

const claim = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Claim Resolve',
    parameters: { operation: 'executeQuery', query: "select hermes_os.claim_agent_action('hermes.intent.resolve', 300) as claim" },
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
    parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "outcome": "ACTION", "action_key": "btp.qualification.create", "confidence": 0.92, "parameters": { "chantier_name": "Dupont" }, "reason": "short justification" }' },
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
      options: { systemMessage: expr("{{ \"Tu es le routeur d'intention d'Hermes (assistant BTP). Mappe le message utilisateur vers EXACTEMENT une capacite autorisee de la liste, sinon action_key=null. Tu ne fais que PROPOSER, tu n'executes rien et tu ne decides ni permissions ni tenant. Regles: (1) action_key EXACTEMENT depuis la liste sinon null; (2) intention correspond + parametres requis presents -> outcome=ACTION; (3) parametre requis manquant -> outcome=NEEDS_CLARIFICATION; (4) simple question/aide -> outcome=ANSWER_ONLY; (5) doute ou aucune capacite -> outcome=NEEDS_CLARIFICATION action_key=null; (6) n'invente jamais d'action_key; (7) confidence 0..1; extrais parameters depuis le message et le contexte. Capacites autorisees (JSON): \" + JSON.stringify($('Claim Resolve').item.json.claim.payload.capabilities) + \" . Contexte recent de la conversation (JSON): \" + JSON.stringify($('Claim Resolve').item.json.claim.payload.context) }}") },
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

const completeSuccess = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Success',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'SUCCEEDED',$2::jsonb,null,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.id, JSON.stringify($json.result), $execution.id ] }}") },
    },
    credentials: { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } },
  },
});

const completeFailed = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Complete Failed',
    parameters: {
      operation: 'executeQuery',
      query: "select hermes_os.complete_agent_action($1::uuid,'FAILED',null,$2::jsonb,$3) as done",
      options: { queryReplacement: expr("{{ [ $('Claim Resolve').item.json.claim.id, JSON.stringify({ code: 'RESOLVER_ERROR', message: 'semantic resolver failed' }), $execution.id ] }}") },
    },
    credentials: { postgres: { id: '2XmDD5ePn3toIJmF', name: 'Postgres account 2' } },
  },
});

const noWork = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'No Work' } });

export default workflow('hermes-semantic-resolver', 'GW Consumer — Hermes Semantic Resolver')
  .add(manual)
  .to(claim)
  .to(claimed.onTrue(agent.to(mapResult.to(completeSuccess))).onFalse(noWork))
  .add(agent.onError(completeFailed));
