# Database migrations (hermes_os)

The dashboard's data lives in Supabase Postgres. `hermes_os` is the private
business schema; PostgREST exposes only `public`, so every capability is reached
through thin `SECURITY DEFINER` wrappers in `public` that call `hermes_os`.

These files are the **source-of-truth record** of the schema changes made for
each vertical slice. They were applied to the project via migrations (Supabase
MCP `apply_migration`) using the same SQL captured here. Each `up` file is
idempotent (`if not exists` / `or replace`); the matching `*_9_rollback.sql`
reverses it.

## Natural Language Orchestration (2026-08-09)

Turns the "Demandez à Hermès…" zone into a real conversational entry.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_nl_orchestration_1_schema.sql` | `hermes_nl_orchestration_schema` | NL routing metadata on `agent_action_catalog` (source of truth) + `hermes_conversations` / `hermes_messages` (audit trail, RLS deny-by-default) |
| `20260809_hermes_nl_orchestration_2_functions.sql` | `hermes_nl_orchestration_functions` | `_nl_extract_slot`, `orchestrate_hermes_message`, `get_hermes_conversation` |
| `20260809_hermes_nl_orchestration_3_facades_grants.sql` | `hermes_nl_orchestration_facades_grants` | `public.*` façades, `execute` granted to `authenticated` only |
| `20260809_hermes_nl_orchestration_9_rollback.sql` | — | Full reversible teardown |

### Security invariants

- The orchestrator **never** executes actions itself: it resolves intent
  against the capability registry, then **delegates to the existing gateway**
  `request_agent_action`, which enforces authentication, server-side tenant
  resolution, per-action permission and idempotency. There is a single gateway.
- **SW15** human-approval authority stays with the poller's
  `gateway_policy_gate` — the orchestrator only enqueues.
- Intent resolution is **deterministic** (keyword/slot matching driven by the
  registry). It is a suggestion, never the authorization authority, so no LLM
  key is required or exposed. The design is LLM-ready: a cheap router could
  later propose `(action_key, payload)` and still flow through the unchanged
  gateway without weakening any security property.
- Outcomes are honest and distinct: `ANSWER_ONLY`, `ACTION`,
  `NEEDS_CLARIFICATION`, `ERROR` (plus `PENDING_APPROVAL` surfaced by polling
  the gateway result). Unknown / ambiguous / unauthorized / cross-tenant all
  fail closed with **no execution**.

## Semantic Intelligence (2026-08-09)

Adds a **semantic model path** behind the deterministic fast path, so free
formulations that don't match a keyword still resolve. The model runs inside
n8n (`n8n/hermes-semantic-resolver.workflow.js`) and is reached through the
**same async gateway** — Next never calls a model or n8n, and no LLM key exists
in the app.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_semantic_1_capability_and_scoped_claim.sql` | `hermes_semantic_resolve_capability_and_scoped_claim` | `hermes.intent.resolve` capability + action-scoped `claim_agent_action(text,int)` |
| `20260809_hermes_semantic_2_orchestrator_and_apply.sql` | `hermes_semantic_orchestrator_and_apply` | orchestrator semantic fallback (`RESOLVING`) with multi-turn context + `apply_hermes_resolution()` |
| `20260809_hermes_semantic_9_rollback.sql` | — | Reversible teardown |

Pipeline: message → validation/auth/tenant → **fast path** (deterministic, high
confidence, no LLM) → else **semantic path**: enqueue `hermes.intent.resolve`
(gateway) → `RESOLVING`; the resolver consumer proposes; `apply_hermes_resolution`
**re-validates the proposal against the registry** and executes via the gateway
→ SW15 → agent → result.

Fail-closed guarantees (proven E2E): the model is never the authority; an
unknown / non-allowlisted `action_key`, confidence below `0.60`, missing
required params, malformed model output, resolver timeout/failure, cross-tenant
access, or a prompt-injection all result in **no execution** (`NEEDS_CLARIFICATION`
/ `ANSWER_ONLY` / fail-closed `ERROR`). A stable `request_id` keeps the whole
chain idempotent. Model routing uses the cheap tier (`gpt-5.4-nano`); telemetry
(provider/model) is carried on the proposal and stored on the assistant message.
