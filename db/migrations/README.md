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
