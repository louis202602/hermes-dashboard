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

## Conversational Control Plane (2026-08-09)

Adds a deterministic, read-only **informational layer** so Hermès can answer
control-plane questions without executing anything, all derived from REAL data
and scoped to the caller's tenant/user:

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_control_plane_1_informational.sql` | `hermes_conversational_informational_layer` | `_hermes_informational()` — capability discovery (permission-aware), pending approvals, last-action status |
| `20260809_hermes_control_plane_2_orchestrator_informational.sql` | `hermes_orchestrator_informational_and_permission_help` | wires the informational branch into the orchestrator (before capability matching); replaces the old non-permission-aware help |
| `20260809_hermes_control_plane_9_rollback.sql` | — | Reversible teardown |

The informational branch runs first (after persisting the user message) and
returns `ANSWER_ONLY` when it matches; otherwise the message flows to the
unchanged fast/semantic paths. Capability discovery only lists actions the caller
is **actually permitted** to run (`agent_action_catalog` ⋈ `user_tenant_permissions`).
Pending approvals reuse the tenant-scoped `list_pending_agent_approvals()`;
last-action reads the caller's own most recent request. No parallel gateway; no
hardcoded lists in React. Tokens/cost per model call are **UNAVAILABLE** from the
n8n LangChain node and are not fabricated — provider/model/confidence and the
`conversation_id` / `request_id` / `correlation_id` are the recorded observability
fields; per-call latency lives in the n8n execution log.

## Capability Expansion — first lot (2026-08-09)

Audited `agent_action_catalog` against the real n8n/Supabase surface, then
expanded the usable capabilities while keeping every security invariant.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_capability_expansion_1_consultation_and_diag.sql` | `hermes_capability_expansion_consultation_and_diag` | links `diag.echo` to its real runner; adds read-only chantiers/projets + platform-KPIs **consultation** to the informational layer |
| `20260809_hermes_capability_expansion_9_rollback.sql` | — | Reversible teardown |

**Audit result.** Before: 3 catalog entries — `btp.qualification.create` (real
runner, E2E-proven), `hermes.intent.resolve` (real runner), `diag.echo`
(registered but `target_workflow_id = NULL` → **no runner** = "action sans agent
réel"). Fixed `diag.echo` by wiring it to a new safe consumer
(`n8n/hermes-diag-echo.workflow.js`, INACTIVE) and proving it E2E.

**New capabilities (first lot):**
- **Consultation — chantiers / projets** (P0, read-only): reuses
  `get_dashboard_projects` (tenant-scoped, `production` only); summarises count,
  by-status, estimated value, recent names. Multiple NL formulations
  (montre / liste / combien / mes projets) converge.
- **Consultation — platform KPIs** (read-only): reuses `get_dashboard_public_kpis`.
- **`diag.echo`** (safe executable): fixed with a real runner; proves the
  executable catalog can grow beyond qualification.

Consultation is deterministic, tenant/user-scoped, `ANSWER_ONLY`, **no
execution**, and never swallows executable phrasings (`qualif*` excluded).
Cross-tenant and prompt-injection attempts return only the caller's own data.

## Capability Expansion — second lot (2026-08-09)

Adds one **WRITE** capability wired to a real agent, two read-only
consultations, and a routing hardening fix — all through the unchanged gateway
and informational layer.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_business_lot2_1_planning_and_reads.sql` | `hermes_business_lot2_planning_and_reads` | registers `btp.planning.phase.add` (WRITE, `is_sensitive=true`, runner = **GW Consumer — BTP Planning** `2MMvwJ8zb3jBftDi`); adds read-only **planning** and **devis** consultation to `_hermes_informational` |
| `20260809_hermes_business_lot2_2_fix_consultation_guards.sql` | `hermes_business_lot2_fix_consultation_guards` | consultation blocks now require a read verb and exclude write phrasings (`qualif`/`planifie`), so a chantier named e.g. "Planning Target" no longer hijacks a write |
| `20260809_hermes_business_lot2_3_fix_qualif_keyword_collision.sql` | `hermes_business_lot2_fix_qualif_keyword_collision` | drops the generic `chantier` noun from qualification keywords (the verb `qualifie*` triggers it); `_nl_extract_slot` now strips a leading business noun so `qualifie le chantier X` still extracts `X` |
| `20260809_hermes_business_lot2_9_rollback.sql` | — | Reversible teardown |

**New capabilities (second lot):**
- **`btp.planning.phase.add`** (P0, WRITE, sensitive): adds a planning phase to
  an existing chantier by delegating to the **real Agent BTP-Planning**
  (`Dih5iny9QD3iQ9qQ`) — reusing that agent's validation/idempotence rather than
  duplicating planning logic. Two required params (`chantier_name` +
  `phase_name`); `nl_keywords` is intentionally empty so the deterministic
  single-slot path never matches it and every phrasing routes through the
  semantic resolver (which fills both params). Flows through the standard
  gateway → SW15 policy gate → consumer → `complete_agent_action`; **no direct
  mutation from HermesPanel**. Fail-closed on a missing chantier (`NO_CHANTIER`)
  or an agent error (`AGENT_ERROR`).
- **Consultation — planning** (read-only): counts and lists the caller's recent
  planning phases (tenant-scoped), `ANSWER_ONLY`.
- **Consultation — devis** (read-only): counts and lists the caller's recent
  devis (tenant-scoped), `ANSWER_ONLY`.

**Security invariants (proven E2E, real effects — no mock as final proof):** the
WRITE only executes through the gateway; `SW15` `REQUIRE_APPROVAL` →
`PENDING_APPROVAL` → admin approve → resume → success and reject → `REJECTED` →
no effect both proven; an unauthenticated caller, a member without
`tenant.member`, a cross-tenant chantier, an invented `action_key`, an "ignore
SW15" prompt injection, and malformed params all fail closed with no execution;
a stable `request_id` keeps double-submit idempotent. Each consumer claims **only
its own `action_key`** (`claim_agent_action(p_action_key, p_lease)`), so no
consumer can steal another's queued request.

## Capability Expansion — third lot (2026-08-09)

Audited the real BTP agent / table surface for the `heliosolar` tenant, then
added one **WRITE** capability wired to a real agent's contract plus three
read-only consultations — all through the unchanged gateway and informational
layer.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260809_hermes_business_lot3_1_suivi_and_reads.sql` | `hermes_business_lot3_suivi_and_reads` (+ guard refinement) | registers `btp.suivi.progress.report` (WRITE, `is_sensitive=true`, runner = **GW Consumer — BTP Suivi** `1xCiexp3oVj0R8Tk`); adds read-only **reporting/blockers**, **fournisseurs** and **avancement** consultation to `_hermes_informational` |
| `20260809_hermes_business_lot3_2_canonical_suivi_service.sql` | `hermes_btp_suivi_canonical_service` | **single canonical business service** `hermes_os.record_btp_suivi_progress(...)` — the suivi write + optional incident, called by BOTH Agent BTP-Suivi (SW4) and the gateway consumer |
| `20260809_hermes_business_lot3_9_rollback.sql` | — | Reversible teardown |

**Audit result (heliosolar).** Real BTP tables carry data:
`btp_chantiers` (8), `btp_fournisseurs` (2), `btp_incidents_qualite` (1),
`btp_suivi_avancement` (1); `btp_devis` is empty. Devis **generation** is
`WRONG_VERTICAL` — the only devis runners are Peinture agents (Métré / Devis
Flash / Validation Devis), so devis stays READ-only (lot 2). CRM / prospection
tables belong to `immo` / `peinture`, not applicable to `heliosolar`.
Communications / relance stay out (no consent/channel infra → SEND unsafe).

**New capabilities (third lot):**
- **`btp.suivi.progress.report`** (P0, WRITE, sensitive): records a progress
  report (phase + %) on an existing chantier via the **single canonical service**
  `hermes_os.record_btp_suivi_progress(...)` (idempotent by
  `(tenant_id, chantier_id, date_rapport)`, plus an optional quality incident).
  Two required params (`chantier_name` + `pct`); `nl_keywords` empty → semantic
  routing. Flows through the standard gateway → SW15 → consumer → canonical
  service → `complete_agent_action`; **no direct mutation from HermesPanel**.
  Fail-closed on a missing chantier (`NO_CHANTIER`) or write error
  (`WRITE_ERROR`). The gateway consumer calls it with `incident=null`
  (progress-only subset).

**Architectural convergence (PR #12 review).** The suivi write previously existed
as two inline copies — one in Agent BTP-Suivi (called by SW4), one in the gateway
consumer. Both were converged onto the one `hermes_os.record_btp_suivi_progress`
function, so there is **no divergent second business engine**. Agent BTP-Suivi's
inline `INSERT` nodes were replaced by a single call to the function; its trigger,
tenant validation, reject path and return contract are unchanged and its
`callerPolicy` stays SW4-only, so **SW4 behaviour is preserved** (verified E2E:
same suivi write + same incident-on-new-row side-effect, idempotent, no
duplicates). See `n8n/hermes-btp-suivi-agent.workflow.js`.
- **Consultation — reporting / point d'activité** (read-only): summarises real
  chantiers-by-status + fournisseurs + open incidents (blockers) + last
  avancement, `ANSWER_ONLY`. Covers "fais-moi le point", "résume mes chantiers",
  "qu'est-ce qui bloque", "tâches prioritaires".
- **Consultation — fournisseurs** (read-only): lists real suppliers, `ANSWER_ONLY`.
- **Consultation — avancement** (read-only): lists real progress reports,
  `ANSWER_ONLY`.

**Security invariants (proven E2E, real effects — no mock as final proof):** the
WRITE only executes through the gateway; SW15 `REQUIRE_APPROVAL` →
`PENDING_APPROVAL` → admin approve → resume → success (real `btp_suivi_avancement`
row) and reject → `REJECTED` → no effect both proven; unauthenticated
(`UNAUTHENTICATED`), member-without-permission (`NO_TENANT`), unknown action
(`UNKNOWN_ACTION`), missing param (`MISSING_PAYLOAD_KEY`), cross-tenant chantier
(tenant-scoped resolve → `NO_CHANTIER`), and double-submit (idempotent, one row)
all fail closed. The semantic model routes free phrasings to
`btp.suivi.progress.report` with both params (confidence 0.9). Each consumer
claims **only its own `action_key`** — proven that the diag and planning
consumers cannot claim a queued suivi request. The read branches require a read
verb and exclude write phrasings (write verbs / any percentage), so they never
swallow the WRITE.

## Dashboard wiring — Recent conversations (2026-08-10)

Wires the dashboard's previously-mock **"Conversations récentes"** panel to REAL
data. No new business logic — a thin read over the orchestrator's own audit
trail.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260810_hermes_recent_conversations_reader_1.sql` | `hermes_recent_conversations_reader` | `public.get_recent_hermes_conversations(p_limit)` — the caller's own recent conversations (title, latest assistant-reply preview, outcome, timestamp), tenant/user-scoped |
| `20260810_hermes_recent_conversations_reader_9_rollback.sql` | — | Reversible teardown |

Read-only, `SECURITY DEFINER`, `search_path` locked. Scoped to `user_id =
auth.uid()` on the resolved tenant; unauthenticated / no-tenant / cross-tenant
return an empty list with a `resolution_status` (fail-closed). Exposes **no**
internal ids (request / correlation / workflow) or secrets — only the user's own
conversation id, title, preview, outcome and timestamp. Granted to
`authenticated` only (like the other dashboard readers), so it is unreachable by
`anon` / `service_role`. Consumed by `services/hermes/conversations.ts` →
`components/dashboard/RecentConversations.tsx` (server-rendered, `provenance=REAL`).

**Verified E2E (SQL impersonation):** unauthenticated → `UNAUTHENTICATED` empty;
member → sees only their own conversation with the real assistant preview +
outcome; a user on another tenant → empty (isolation). `lint` / `typecheck` /
`build` green; all test fixtures cleaned.

## Dashboard wiring — remove remaining mocks (2026-08-10)

Replaces the last three mock panels (QuickActions, Tasks, SystemStatus) with REAL
sources or an **honest UNAVAILABLE**. No fictional data is presented as real.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260810_hermes_dashboard_panel_readers_1.sql` | `hermes_dashboard_panel_readers` | `get_available_capabilities()`, `get_operational_priorities()`, `get_platform_health()` |
| `20260810_hermes_dashboard_panel_readers_9_rollback.sql` | — | Reversible teardown |

- **QuickActions → `get_available_capabilities()`** (REAL): the capabilities the
  caller is permitted to run (`agent_action_catalog` ⋈ `user_tenant_permissions`).
  Buttons route to the Hermès command center (`#hermes-command`) — the existing
  secure path (orchestrator → gateway → permissions → SW15). **No direct
  mutation, no bypass.** Sensitive capabilities are flagged.
- **TasksPanel → `get_operational_priorities()`** (DERIVED from real rows):
  pending approvals + open quality incidents + chantiers to qualify + late
  chantiers, tenant-scoped. Each item maps to a real row; the panel badges it
  `DERIVED` (rule-based prioritisation, never a fabricated task engine).
- **SystemStatus → `get_platform_health()`** (REAL + UNAVAILABLE): real component
  registry counts (registered / active) + last recorded execution. Infra SLA /
  latency / uptime are **not measured** from the dashboard and are shown as
  **« Non mesuré »** — the fabricated `99,99 %` / `24 ms` / `99,8/100` numbers are
  removed.

All three are `SECURITY DEFINER`, `search_path` locked, fail-closed
(unauthenticated / no-tenant / cross-tenant → empty + `resolution_status`),
granted to `authenticated` only, and expose **no** secrets or internal ids.

**Verified E2E (SQL impersonation):** unauthenticated → `UNAUTHENTICATED` empty
for all three; heliosolar member → 4 permitted capabilities, real priorities
(1 open incident, 5 chantiers to qualify), real platform health (95 registered /
64 active). `lint` / `typecheck` / `build` green. The `dashboard-mock-region`
"Démonstration" flags are removed — no panel remains mock.
