# n8n workflows (source of record)

The dashboard reaches n8n only through the **async Agent Action gateway** in
Postgres — the Next.js app never calls n8n directly and holds no n8n/model
secret. Consumer workflows claim queued `hermes_os.agent_action_requests`, do
their work, and write the result back.

## `hermes-semantic-resolver.workflow.js`

Source for **GW Consumer — Hermes Semantic Resolver** (n8n id `IS1I8g0K8VXbm4oH`).

- **Trigger:** Manual only. **INACTIVE** — no Schedule Trigger (matching the BTP
  poller's controlled-testing posture). Run it on demand to drain queued
  `hermes.intent.resolve` requests.
- **Model:** OpenAI `gpt-5.4-nano` (cheap routing tier) via the existing n8n
  OpenAI credential, structured output parser.
- **Contract:** input is the request payload `{ message, capabilities, context }`;
  output is a proposal `{ outcome, action_key, confidence, parameters, reason }`
  plus telemetry. **Proposal only** — the model never executes and is never the
  authorization authority. `apply_hermes_resolution()` re-validates every
  proposal against `agent_action_catalog` and runs it through the gateway (which
  enforces permission / tenant / idempotency / SW15).
- **Failure:** agent error/timeout → the request is completed `FAILED` → apply()
  returns a fail-closed `ERROR` with no execution.

To redeploy from source, validate + create via the n8n Workflow SDK MCP tools
(`validate_workflow`, `create_workflow_from_code`) and keep the workflow
inactive.

## `hermes-diag-echo.workflow.js`

Source for **GW Consumer — Diag Echo** (n8n id `6687hzOPQ27an2J6`).

- **Trigger:** Manual only. **INACTIVE** — no Schedule Trigger.
- Claims queued `diag.echo` requests (action-scoped), echoes the payload, and
  completes `SUCCEEDED`. **Safe**: no business effect, no external calls, no
  secrets. It exists to prove the gateway executes a second distinct capability
  and to give `diag.echo` a real runner (previously it was catalog-only).
- All auth/tenant/permission/idempotency are enforced upstream by
  `request_agent_action`; `diag.echo` is `is_sensitive=false`.
