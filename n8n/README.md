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
- **Multi-param (lot 2):** the structured-output parser uses `schemaType:'manual'`
  with an **open** `parameters` object (`additionalProperties:true`) and the
  system prompt instructs the model to fill **all** of the chosen capability's
  `required_payload_keys`. This lets capabilities with more than one required
  param (e.g. `btp.planning.phase.add` → `chantier_name` + `phase_name`) resolve;
  a narrower schema previously dropped the extra keys.
- **Failure:** agent error/timeout → the request is completed `FAILED` → apply()
  returns a fail-closed `ERROR` with no execution.
- **Execution-safety hardening (PR #21):** the claim now returns a per-claim
  `lease_token`; the run carries it and passes it to the **fenced 6-arg**
  `complete_agent_action(...,lease_token)`, so a lease-stolen worker can no longer
  overwrite a reclaimed request (this consumer no longer uses the legacy 5-arg
  form). Cost is governed through the canonical **SW23** engine via the routing
  path — `sw23_set_session_tenant` → `sw23_route_and_reserve` (SW23 selects the
  catalogued model `openai/gpt-5.4-nano` and reserves the budget it computes from
  the REAL catalog price) before the model, then `sw23_commit_budget` on success
  / `sw23_release_budget` on model failure (no second ledger, no arbitrary fixed
  amount). Bounded reclaim / dead-letter is enforced DB-side (`claim` stops past
  `max_attempts`; a driver calls `reap_dead_letter_agent_actions()` before
  `claim`). See `db/migrations/20260813_hermes_resolver_execution_safety_1.sql`.
  **Catalogued:** `openai/gpt-5.4-nano` is in `sw23_model_catalog` with real
  pricing (`db/migrations/20260813_sw23_catalog_gpt_5_4_nano_1.sql`: input 0.20 /
  output 1.25 USD per 1M tokens; cached-input 0.02 recorded in metadata).
  **Follow-up:** the commit currently uses the routed estimate; switch to actual
  provider token usage × price once the exact n8n usage field is confirmed at the
  controlled run.

To redeploy from source, validate + update the existing workflow
(`IS1I8g0K8VXbm4oH`) via the n8n Workflow SDK MCP tools (`validate_workflow`,
`update_workflow`) and keep the workflow **inactive** (manual trigger only).

## `hermes-diag-echo.workflow.js`

Source for **GW Consumer — Diag Echo** (n8n id `6687hzOPQ27an2J6`).

- **Trigger:** Manual only. **INACTIVE** — no Schedule Trigger.
- Claims queued `diag.echo` requests (action-scoped), echoes the payload, and
  completes `SUCCEEDED`. **Safe**: no business effect, no external calls, no
  secrets. It exists to prove the gateway executes a second distinct capability
  and to give `diag.echo` a real runner (previously it was catalog-only).
- All auth/tenant/permission/idempotency are enforced upstream by
  `request_agent_action`; `diag.echo` is `is_sensitive=false`.

## `hermes-btp-planning.workflow.js`

Source for **GW Consumer — BTP Planning** (n8n id `2MMvwJ8zb3jBftDi`).

- **Trigger:** Manual only. **INACTIVE** — no Schedule Trigger.
- The **WRITE runner** behind the gateway capability `btp.planning.phase.add`.
  Claims queued requests (action-scoped `claim_agent_action('btp.planning.phase.add', …)`),
  records + gates the **SW15** policy (proceeds only on `PERMIT`, which includes an
  admin-approved `PENDING` request), resolves the chantier by name
  (tenant-scoped, `production` only), then runs the **real Agent BTP-Planning**
  (`Dih5iny9QD3iQ9qQ`) via an Execute Workflow node — reusing that agent's own
  validation and idempotence — and writes the result back with
  `complete_agent_action`.
- **Fail-closed:** the chantier lookup is a scalar subquery (always one row, `id`
  null when absent) so a missing chantier completes `FAILED` with `NO_CHANTIER`
  instead of hanging; an agent error routes to `AGENT_ERROR`. `btp.planning.phase.add`
  is `is_sensitive=true`, so nothing runs until SW15 permits.
- All auth/tenant/permission/idempotency are enforced upstream by
  `request_agent_action`. It claims **only** its own `action_key`, so it cannot
  steal another consumer's queued request.

## `hermes-btp-suivi-agent.workflow.js`

Source for the pre-existing **production** agent **Agent BTP-Suivi** (n8n id
`O9BLGvhAGjd8oiv3`), called by **SW4 - Agent Execution** (`lFopccFfaudvNHZi`).

- **Trigger:** legacy `workflowTrigger` — **UNCHANGED** so SW4 keeps invoking it
  exactly as before. `callerPolicy` stays `workflowsFromAList` (SW4 only).
- Tracked here to record the PR #12 convergence: its inline suivi `INSERT` and
  incident `INSERT` nodes were replaced by a single call to the canonical
  `hermes_os.record_btp_suivi_progress(...)`. Validate Tenant, Reject - Invalid
  and both Return nodes are preserved, so the return contract
  (`{status, code}` with `SUIVI_RECORDED` / `IDEMPOTENT` / error) is identical.
- Behaviour verified E2E as identical to the previous inline logic (same suivi
  write + same incident-on-new-row side-effect, idempotent, no duplicates). SW4
  is unaffected.

## `hermes-btp-suivi.workflow.js`

Source for **GW Consumer — BTP Suivi** (n8n id `1xCiexp3oVj0R8Tk`).

- **Trigger:** Manual only. **INACTIVE** — no Schedule Trigger.
- The **WRITE runner** behind the gateway capability `btp.suivi.progress.report`.
  Claims queued requests (action-scoped `claim_agent_action('btp.suivi.progress.report', …)`),
  records + gates the **SW15** policy (proceeds only on `PERMIT`, incl. an
  admin-approved `PENDING` request), resolves the chantier by name
  (tenant-scoped), then calls the **single canonical business service**
  `hermes_os.record_btp_suivi_progress(...)` and writes the result back with
  `complete_agent_action`.
- **One business implementation.** The suivi write (idempotent by
  `(tenant_id, chantier_id, date_rapport)`, plus the optional quality incident)
  lives only in `hermes_os.record_btp_suivi_progress`. Both this consumer AND the
  real Agent BTP-Suivi (`O9BLGvhAGjd8oiv3`, called by SW4) invoke that same
  function — there is no divergent second engine. The consumer passes
  `incident=null` (progress-only subset); SW4 passes the incident through. The
  agent workflow object itself is not invoked here (its legacy `workflowTrigger`
  is not Execute-Sub-workflow-invokable) — only the canonical DB function is
  shared. See `hermes-btp-suivi-agent.workflow.js`.
- **Fail-closed:** the chantier lookup is a scalar subquery (always one row, `id`
  null when absent) → a missing chantier completes `FAILED` with `NO_CHANTIER`;
  a write error routes to `WRITE_ERROR`. `btp.suivi.progress.report` is
  `is_sensitive=true`, so nothing runs until SW15 permits.
- All auth/tenant/permission/idempotency are enforced upstream by
  `request_agent_action`. It claims **only** its own `action_key`, so it cannot
  steal another consumer's queued request.
