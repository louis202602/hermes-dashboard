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

## Observability — mission-critical (2026-08-10)

Turns SystemStatus into a real supervision layer. No fictional metric — every
value is REAL, DERIVED, or explicitly UNAVAILABLE.

| File | Applied migration | Purpose |
|------|-------------------|---------|
| `20260810_hermes_observability_snapshot_1.sql` | `hermes_observability_snapshot` | `get_observability_snapshot(p_limit)` — platform aggregates + execution telemetry + tenant gateway activity + incidents |
| `20260810_hermes_observability_snapshot_9_rollback.sql` | — | Reversible teardown |

**Audit (sources).** `execution_logs` (VERIFIED_EXISTING — real `latency_ms`,
`degraded`, statuses), `component_registry` (VERIFIED_EXISTING — active/registered),
`btp_incidents_qualite` (VERIFIED_EXISTING — tenant incidents), `agent_action_requests`
(VERIFIED_EXISTING — gateway activity/errors), SW22 recovery tables
(VERIFIED_EXISTING). Heartbeats: **MISSING**. Infra SLA / latency-SLA / uptime:
**MISSING** (not instrumented).

**Model.**
- **Platform (REAL, non-identifying):** components registered / active,
  executions total / degraded / with-latency, **median** latency (robust — the
  raw mean is skewed by multi-hour outliers so it is deliberately not shown),
  last execution, status distribution.
- **Executions (REAL platform telemetry):** recent rows with domain / status /
  latency / degraded / finished — **no** tenant / user / payload / cost exposed.
- **Gateway (REAL, tenant-scoped):** the caller's recent gateway requests with
  action, status, policy decision and error **code** (no free-text payloads).
- **Incidents (REAL, tenant-scoped):** `btp_incidents_qualite` open / resolved.
- **Heartbeat / SLA / uptime → UNAVAILABLE** ("Non mesuré") — never fabricated;
  the old `99,99 %` / `24 ms` / `99,8/100` stay gone.

`SECURITY DEFINER`, `search_path` locked, granted to `authenticated` only,
fail-closed (unauthenticated → `UNAUTHENTICATED`; platform aggregates are
non-identifying; gateway/incidents are the caller's tenant only).

**Failure tests (SQL impersonation):** unauthenticated → `UNAUTHENTICATED`;
heliosolar member → platform facts + 1 open incident + real executions (incl.
`degraded` / `blocked`) + empty gateway; **cross-tenant** → a member on another
tenant sees only its own incident, never heliosolar's, while platform aggregates
remain non-identifying; source-unavailable → the service returns `UNAVAILABLE`
and the panel degrades gracefully. Fixtures cleaned; baseline restored.

## Cost governance — tenant budgets, quotas & consumption (read model)

`20260810_hermes_cost_governance_snapshot_1.sql` adds a **read-only** canonical
snapshot over the **existing** SW23/SW9 cost engine — it does **not** create a
second engine. The write side already exists and is untouched:
`sw23_route_and_reserve`, `sw23_reserve_budget` / `sw23_commit_budget` /
`sw23_release_budget`, `sw9_quota_check_and_increment`.

**`public.get_cost_governance_snapshot(p_limit)`** — SECURITY DEFINER,
`search_path` locked, granted to `authenticated` only, fail-closed
(unauthenticated → `UNAUTHENTICATED`; tenant resolved via
`resolve_active_tenant`, caller's tenant only). Plus a pure immutable helper
`public.sw_cost_limit_state(exposure, budget, alert_pct, hard_stop)`.

**Provenance (never fabricated):**

| Field | Source / class |
|-------|----------------|
| `budget` | `sw23_tenant_budget_config` → REAL, or `NOT_CONFIGURED` (no invented budget) |
| `period.day/month` exposure | `sw23_budget_ledger` reserved+committed (same basis the reserve fn enforces) |
| `committed_actual_usd` | committed `actual_usd` (null until committed) |
| `cost_events` | `sw19_cost_events` → REAL, or `UNAVAILABLE` when none emitted |
| `quota` | `sw9_quota_counters` (REAL recorded counters) + `sw9_quota_block_log` (REAL blocks) |
| `models` | `sw23_model_catalog` carrying each row's own `cost_status` (real/unknown) |
| phone minutes / Voice Web Speech cost | `UNAVAILABLE` (not stored / browser vendor emits no usable metric) |

**Limit states** (`sw_cost_limit_state`, using the tenant's own
`alert_threshold_pct` — not hard-coded 80/90/100): `NORMAL` → `WARNING` (≥ alert
threshold) → `SOFT_LIMIT` (≥ budget, `hard_stop=false`) → `HARD_LIMIT` (≥ budget,
`hard_stop=true`); the top-level `governance_state` escalates to `BLOCKED` when
the tenant has real quota blocks today. **Rule:** a financial quota may block
**non-critical** actions at `HARD_LIMIT`; **critical/safety** actions must not be
broken by a budget quota alone (they surface `SOFT_LIMIT`). Enforcement stays in
the write engine; this reader only reports.

**Real E2E (SQL impersonation, all rolled back — zero fixtures persisted):**
unauthenticated → `UNAUTHENTICATED`; heliosolar → REAL quota (67 recorded calls,
real `QUOTA_EXCEEDED`/`RATE_LIMITED` blocks) + REAL model catalog + budget
`NOT_CONFIGURED` + cost_events `UNAVAILABLE`; **reserve→WARNING at threshold →
commit → over-budget reserve rejected (HARD_LIMIT) → idempotent replay (no double
counting) → release frees budget (WARNING→NORMAL)**, snapshot tracking each step;
**cross-tenant** → `SW23_TENANT_MISMATCH` on the engine and caller-tenant-only in
the reader.

## Chat attachments — private, tenant-isolated transmission (2026-08-13)

**Migration:** `20260813_hermes_chat_attachments_1.sql` (rollback `…_9_rollback.sql`).

Phase B of the Hermès composer: the `+` button really uploads files. Transport
only — there is **no** content understanding (no LLM / OCR / transcription; that
is the forbidden Phase C). Video is recognised but **NOT_SUPPORTED_YET** in V1.

**What it creates**

- A **PRIVATE** Storage bucket `hermes-chat-attachments` (`public=false`; reads
  only via short-TTL signed URLs — never `getPublicUrl`). 25 MiB hard ceiling +
  a declared-mime allowlist as coarse secondary guards.
- `storage.objects` RLS scoped to this bucket only. Object key is
  `<tenant_id>/<user_id>/<attachment_id>/<safe_filename>`; the policies
  re-derive `foldername[1]=tenant` (must be a `tenant.member`, via SECURITY
  DEFINER `hermes_os.is_active_tenant_member`) and `foldername[2]=auth.uid()`.
  A client can never widen its scope by supplying a different path.
- `hermes_os.hermes_message_attachments` — one row per object; `message_id` is
  filled by the post-message link step (nullable → `UPLOADED_PENDING_LINK`).
  RLS enabled with **no policy** ⇒ deny-all; reached only via the facades.
- Facades (SECURITY DEFINER, `search_path` locked, `authenticated` only,
  fail-closed): `finalize_hermes_attachment` (records after upload; re-checks
  path prefix / category / size cap / checksum), `link_hermes_attachments`
  (attaches to a message the caller **owns**; honest linked/requested counts),
  `get_hermes_message_attachments` (owner-scoped read → storage_path for signing),
  plus bounded, callable orphan helpers `list_orphan_hermes_attachments` /
  `mark_hermes_attachment_deleted` (TTL-based, **no** auto worker / no schedule).

**Untouched:** the orchestrator (`orchestrate_hermes_message`) is NOT modified —
linking is a separate step. No n8n / business workflow / branding change.

**Per-category caps:** image 10 MiB · document 20 MiB · audio 25 MiB; max 10
files & 50 MiB per message (enforced client-side + server-side). Fail-closed
validation (magic-byte sniff + allowlist + filename sanitisation + checksum)
lives in `lib/attachments/serverValidate.ts` (unit-tested).

**Real security assertions (SQL impersonation, all rolled back — zero fixtures
persisted; see `db/tests/hermes_chat_attachments_rls.test.sql`):** member happy
path OK; out-of-scope path → `PATH_OUT_OF_SCOPE`; bad checksum → `BAD_CHECKSUM`;
link to owned message OK, read-back = 1; **non-member** finalize/link/read →
`TENANT_NO_TENANT` / empty; **unauthenticated** → `UNAUTHENTICATED`. Storage RLS
(as the `authenticated` role): insert-own **ALLOWED**; cross-tenant, cross-user
and unauthenticated inserts **DENIED**; cross-user read filtered to 0.

## Action & approval audit trail (safety-critical accountability)

`20260810_hermes_action_audit_trail_1.sql` adds a **read-only** tenant-scoped
audit trail of agent actions and their SW15 approval decisions. The dashboard
already lists **pending** approvals (`list_pending_agent_approvals`) but had no
view of the **decided** history — a mission-critical / safety-critical
autonomous system must expose who/what was requested, the policy decision,
whether approval was required and its outcome, retries, terminal status, and
error code. **No write path, no second orchestrator, no consumer activation** —
it only reads the real gateway table `agent_action_requests`.

- **`public.get_action_audit_trail(p_limit)`** — SECURITY DEFINER, `search_path`
  locked, granted to `authenticated` only, fail-closed (unauthenticated →
  `UNAUTHENTICATED`; tenant via `resolve_active_tenant`, caller's tenant only;
  non-member → `NO_TENANT`, no rows). **Non-identifying**: no payload, no
  requester/approver user id, error **code** only.
- **`public.sw_action_approval_outcome(...)`** — pure/immutable mapping to
  `APPROVED` / `REJECTED` / `PENDING_APPROVAL` / `NOT_REQUIRED`. Paired rollback.
- Provenance: `actions[]` + `summary` are **REAL** (`agent_action_requests`).
  The dedicated SW23 audit logs (`sw23_audit_log`, `sw23_policy_audit`) are empty
  in this project and reported **UNAVAILABLE**, never fabricated.

**Real E2E (SQL impersonation, rolled back — zero fixtures):** unauthenticated →
`UNAUTHENTICATED`; heliosolar → real trail (actions still `QUEUED` because the
runner is intentionally **INACTIVE**, shown honestly) + real counts + no PII;
non-member uid → `NO_TENANT` with **no actions leaked**; helper outcomes verified.

## Resolver runtime safety — kill-switch, bounded driver, budget guard (E2.1)

`20260814_hermes_resolver_runtime_safety_1.sql` provisions the **dormant** safety
primitives for a future controlled go-live of the Semantic Resolver. It
**activates nothing** — the n8n consumer stays INACTIVE, no Schedule is created,
no row is claimed, no model is called.

- **`hermes_os.resolver_runtime_config`** — per-action runtime registry with a
  first-class **DB kill-switch** (`enabled`), bounded `max_batch`,
  `max_concurrency`, `cadence_seconds`. RLS deny-all (facade-only). Seeded for
  `hermes.intent.resolve` with SAFE defaults: **enabled = false**, max_batch 3,
  max_concurrency 1, cadence 60s. The n8n workflow-active toggle remains a second,
  independent stop.
- **`hermes_os.claim_semantic_resolver_batch(action_key, lease)`** — SECURITY
  DEFINER, `search_path` locked, `service_role` only, **fail-closed**: no config
  or `enabled=false` ⇒ zero claims. Otherwise claims at most `max_batch`, bounded
  by `max_concurrency` against the currently-leased RUNNING set, by **reusing the
  canonical `claim_agent_action`** (lease token + attempts preserved) — no second
  queue engine.
- **SW23 budget for `heliosolar`** (canonical `sw23_tenant_budget_config`): daily
  **$1.00** / monthly **$10.00**, `hard_stop = true` (idempotent — never
  overwrites an operator budget). At ≈$0.0011/resolve the daily cap bounds any
  runaway loop. Note: `per_request_budget_usd` is stored but **advisory** — the
  canonical SW23 reserve enforces the **period (daily/monthly) hard-stop**, which
  is the effective guard.

**n8n driver source** `n8n/hermes-semantic-resolver-driver.workflow.js` — a
repo-only control-plane spec (Schedule tick → Runtime Guard → bounded fan-out),
`active:false`, per-item resolution + real Schedule wired in **E2.3**.

**Real assertions (SQL impersonation, rolled back — zero fixtures persisted; see
`db/tests/hermes_resolver_runtime_safety.test.sql`):** kill-switch off by
default; DISABLED ⇒ claim denied on the real action_key (0 claims); ENABLED on
synthetic fixtures ⇒ max_batch and max_concurrency respected, lease_token +
attempts preserved, tenant carried; budget under → ok, over-daily $2 > $1 →
**rejected**; the real `hermes.intent.resolve` queue **untouched**.

### Concurrency hardening (`20260814_hermes_resolver_concurrency_lock_1.sql`)

Follow-up to E2.1: `claim_semantic_resolver_batch` read the RUNNING count and then
claimed, so two **concurrent** calls could each observe free capacity before their
claims and transiently exceed the concurrency ceiling (no double-claim — the
underlying `claim_agent_action` uses `FOR UPDATE SKIP LOCKED` — but the ceiling
could be momentarily exceeded). The fix takes a **per-action, transaction-scoped
advisory lock** (`pg_advisory_xact_lock(hashtext('hermes_os.resolver_claim'),
hashtext(action_key))`) around the *count RUNNING → compute capacity → claim*
section, **after** the kill-switch check (a disabled resolver never contends).
Auto-released at commit/rollback; single lock ⇒ no deadlock; per action_key ⇒
distinct actions don't block each other. Paired rollback restores the pre-lock body.

**Proof:** the ceiling section is verified deterministically — with one claim
RUNNING under lease, a further `claim_semantic_resolver_batch` returns
`CONCURRENCY_SATURATED` / 0 (max_running stays 1). Two truly-parallel backends
could not be forced through the tooling (dblink self-connect needs a DB password;
the SQL tool serializes calls), so the cross-call guarantee rests on the standard
`pg_advisory_xact_lock` mutual-exclusion semantics + the deterministic ceiling
test. All fixtures synthetic + isolated; the 5 real QUEUED rows never touched.

## Resolver observability + recovery + circuit breaker (E2.2)

`20260814_hermes_resolver_observability_1.sql` (+ rollback) adds operational
safety for the still-INACTIVE Semantic Resolver. **Dormant**: no activation, no
Schedule, kill-switch stays OFF, circuit stays CLOSED, no real QUEUED row touched.

- **`public.get_resolver_observability()`** — SECURITY DEFINER, `search_path`
  locked, `authenticated`, TENANT-SCOPED (via `resolve_active_tenant`). Read-only
  metrics: queue depth / oldest age / running; 24h outcomes (success / failed /
  dead-letter / error-rate); median queue / execution / e2e latency; SW23 cost
  (day/month spend + budget remaining); plus the platform control block
  (kill-switch + circuit). Honest provenance — latency & error-rate are
  **UNAVAILABLE** (not fabricated) when there is no completed data.
- **`hermes_os.resolver_circuit_evaluate(action_key)`** — PLATFORM-level breaker,
  `service_role`. When recent FAILED (`circuit_error_threshold`, default 5) or
  DEAD_LETTER (`circuit_deadletter_threshold`, default 3) counts within
  `circuit_window_minutes` (default 15) are crossed, it **trips the canonical
  kill-switch** (`enabled=false`, `circuit_state='OPEN'`, reason recorded) — the
  same control as the kill-switch, never a contradictory second switch. So a
  subsequent `claim_semantic_resolver_batch` returns `DISABLED` / 0 (cut BEFORE
  any model call).
- **`hermes_os.resolver_circuit_reset(action_key)`** — MANUAL re-arm,
  `service_role`. Sets `CLOSED` but **leaves `enabled=false`** — re-arming ≠
  re-activating (activation stays an explicit, separate operator step).
- **`hermes_os.reap_resolver_dead_letters(limit)`** — thin, action-scoped wrapper
  over the existing bounded/skip-locked/idempotent `reap_dead_letter_agent_actions`
  (no second dead-letter system). `service_role`.
- New `resolver_runtime_config` circuit columns (state + thresholds + window).

**Dashboard:** a discreet, tenant-scoped `ResolverStatus` panel (state pill +
queue / oldest / running / failed / dead-letter / error-rate / cost today /
budget remaining), placed between the audit trail and cost governance.

**n8n:** `n8n/hermes-resolver-reaper.workflow.js` — repo-only reaper + circuit
driver, `active:false`; real Schedule wired in E2.3.

**Real assertions (impersonation, rolled back; synthetic fixtures; 5 real QUEUED
untouched — see `db/tests/hermes_resolver_observability.test.sql`):** tenant
metrics correct with **cross-tenant rows excluded**; reaper batch limit +
dead-letter + idempotent; circuit closed→no trip, over-threshold→OPEN + enabled
false, OPEN→claim `DISABLED`/0, manual reset→CLOSED with enabled still false.

## Agent-action claim exclusions — head-of-line quarantine (final validation)

`20260814_agent_action_claim_exclusions_1.sql` (+ rollback) fixes **HEAD_OF_LINE_BLOCKING**
in the agent-action queue. `claim_agent_action` is FIFO (oldest `created_at`, `FOR UPDATE
SKIP LOCKED`); some protected legacy `hermes.intent.resolve` QUEUED rows are the oldest
and must never be drained/processed/mutated, so the canonical consumer could not claim a
newer request without first attempting to claim a protected head-of-line row.

- **`hermes_os.agent_action_claim_exclusions`** — canonical, EXPLICIT quarantine list keyed
  on `agent_action_requests.id`. A row here makes that action NON-CLAIMABLE **without
  modifying the original request row** (no status/created_at/lease/attempts change, no
  delete). `expires_at NULL` = permanent. RLS enabled (no policy), internal.
- **`claim_agent_action`** (both the 2-arg action-scoped and 1-arg legacy variants) now
  selects the **OLDEST ELIGIBLE NON-EXCLUDED** action — only an `and not exists (...)`
  clause was added; with zero exclusions the behaviour is byte-identical to before.
- **`hermes_os.exclude_agent_action_from_claim(id, reason, expires_at)`** /
  **`release_agent_action_claim_exclusion(id)`** — service_role helpers to register/lift
  exclusions (idempotent). Explicit only — never an age-based silent skip, never auto-delete,
  never an auto FAILED/CANCELLED.

**Live use:** the 4 protected `hermes.intent.resolve` QUEUED rows are registered as
permanent exclusions, so the real GW Consumer — Semantic Resolver can claim a fresh request
(verified end-to-end: real gpt-5.4-nano call, SW23 route/reserve/commit, 6-arg
`complete_agent_action` with propagated lease_token) while the 4 protected rows stay
bit-for-bit unchanged. Tests: `db/tests/agent_action_claim_exclusions.test.sql` (A–G).

## Resolver operator control plane (E2.3)

`20260814_hermes_resolver_control_plane_1.sql` (+ rollback) adds the fail-closed
operator control plane for the semantic resolver. **DORMANT**: activates nothing;
resolver stays `enabled=false`, circuit `CLOSED`.

- **`resolver_enable_preflight(action_key)`** — FAIL-CLOSED readiness gate.
  `ready=true` only when ALL hold: config present, circuit CLOSED, sane
  batch/concurrency/cadence, no parasite RUNNING lease, the **protected quarantine
  is intact** (the count of intact claim-excluded QUEUED rows is still ≥ the
  `protected_exclusions_expected` size stored on the config, derived canonically
  from the exclusion registry — **not** hardcoded ids), and a hard-stop budget
  exists and is not exceeded today. Otherwise `ready=false` + `denied_reasons[]`.
  **Fresh, non-excluded QUEUED requests are legitimate work and never block
  activation** — only a *missing protected exclusion* (count dropping below
  expected) trips `PROTECTED_EXCLUSIONS_MISSING`.
- **`resolver_apply_set_enabled / _circuit_reset / _reap`** (service_role) — enable
  runs the preflight and REFUSES (`ACTIVATION_DENIED`) if not ready; circuit reset
  sets CLOSED but leaves `enabled=false` (reset ≠ activation); reap is bounded,
  action-scoped, never touches protected rows.
- **`public.resolver_operator_{get_control,enable,disable,reset_circuit,reap}`** —
  authenticated + `resolver.operate` permission (fail-closed: no permission ⇒
  UNAUTHORIZED). REVOKE PUBLIC; GRANT authenticated. Every action audited in
  `resolver_operator_audit`.

Tested (real, isolated fixtures, rolled-back/self-restoring; the 4 protected rows
never touched): prereq-OK enable (fixture), and DENIED on circuit-open /
budget-missing / budget-exceeded / running-present / exclusions-missing; circuit
reset keeps enabled=false; disable; bounded reaper; unauthenticated + no-permission
denied; protected fingerprints unchanged; real resolver stays enabled=false.

## DASH-1 — Command Center context bar (2026-08-14)

Adds the per-tenant **international context** the compact dashboard bar reads
(city · date · local time · timezone · weather · alerts · today's AI cost).

| File | Purpose |
|------|---------|
| `20260814_hermes_dashboard_context_settings_1.sql` | `hermes_os.dashboard_context_settings` (tenant_id PK) — the **five i18n axes kept separate**: `iana_timezone`, `locale`, `country`, `currency`, plus optional `city`/`latitude`/`longitude`. Seeds France-consistent defaults (Europe/Paris · fr-FR · FR · EUR) for existing tenants; city/coords left NULL. `public.get_dashboard_context_settings()` — SECURITY DEFINER read facade, caller's tenant only (`resolve_active_tenant`), REVOKE PUBLIC / GRANT authenticated. |
| `20260814_hermes_dashboard_context_settings_9_rollback.sql` | Drops the facade + table. No business data touched. |

### Invariants

- **COST-FIRST / no LLM.** Time, date and timezone are computed client-side from
  `iana_timezone` via `Intl` (0 external call, DST-safe). Weather is fetched by the
  app from **Open-Meteo** (free, no API key, no browser secret — the call is
  server-side) **only when `latitude`/`longitude` are configured**, and cached
  server-side for 15 min. `city`/coords are never fabricated: with no location the
  bar honestly shows "à configurer" / UNAVAILABLE.
- **Fail-closed read.** Unauthenticated ⇒ `UNAUTHENTICATED`; no tenant ⇒ neutral
  defaults, never cross-tenant data. Additive, read-only-by-app configuration —
  no business logic, no go-live.
- **Units follow locale/country, not hardcoded France.** The bar derives °C/°F,
  km/h/mph and 12h/24h from `locale`/`country` (`resolveUnitPreferences`,
  override-ready for a future per-user preference). Cost shows today + this month
  + monthly budget remaining, all from the real SW23 read model in its SOURCE
  currency (USD) — a display-currency conversion needs a real FX rate (later).

## DASH-2 — Agenda du jour + alertes/priorités unifiées (2026-08-15)

Two read-only aggregation facades over signals **already present** in `hermes_os`
(no new business system, no LLM, no external API). They power the "Agenda du jour"
and "Alertes & priorités" panels and back-fill the DASH-1 context bar's NEXT_EVENT
and ALERT_COUNT.

| File | Purpose |
|------|---------|
| `20260815_hermes_dashboard_agenda_alerts_1.sql` | `public.get_dashboard_agenda()` — dated events (BTP phases, project start/end, approval expiries) bucketed today/upcoming/overdue **in the tenant timezone** (DASH-1 `dashboard_context_settings.iana_timezone`, DST-safe). `public.get_unified_alerts()` — actionable signals (pending approvals, open incidents, resolver circuit OPEN, monthly budget threshold, quota blocks today, late chantiers, dead-letters) normalised to INFO/WARNING/HIGH/CRITICAL. |
| `20260815_hermes_dashboard_agenda_alerts_9_rollback.sql` | Drops both facades. No business data touched. |

### Invariants

- **Tenant-scoped, fail-closed.** Caller's tenant only via `resolve_active_tenant`
  (never a client id); unauthenticated ⇒ `UNAUTHENTICATED`; no tenant ⇒ empty,
  never cross-tenant data. REVOKE PUBLIC / GRANT authenticated, `search_path` locked.
- **Fail-soft per source.** Each source is aggregated in its own exception block;
  a broken source is listed in `unavailable[]` and the others still render.
- **Deterministic, COST-FIRST.** No LLM, no external API. Severity and next-event
  selection follow documented rules (`lib/dashboard/agenda.ts`). ALERT_COUNT counts
  only actionable severities (WARNING/HIGH/CRITICAL), never neutral INFO.
- **No fabrication.** Every entry carries a canonical `source`/`source_id` and
  `provenance:REAL`; absent data yields an empty list, never an invented event.

## DASH-3 — État global Hermès + Activité + Commercial (2026-08-15)

Two small read-only tenant-scoped facades; the "system health" panel is composed
on the server from already-fetched snapshots (KPIs, observability, resolver, cost)
plus the pre-existing `public.get_platform_health()` (now wired). No new business
system, no LLM, no external API.

| File | Purpose |
|------|---------|
| `20260815_hermes_dashboard_system_activity_1.sql` | `public.get_agent_action_stats()` — caller-tenant `agent_action_requests` counts by status (queued/running/succeeded/failed/dead_letter/pending_approval). `public.get_dashboard_commercial()` — real `btp_devis` aggregates (EUR): sent / to-follow-up / accepted + TTC amounts. |
| `20260815_hermes_dashboard_system_activity_9_rollback.sql` | Drops the two DASH-3 facades. `get_platform_health` is PRE-EXISTING and intentionally kept. No business data touched. |

### Invariants

- **Tenant-scoped, fail-closed.** Caller's tenant only via `resolve_active_tenant`
  (never a client id); unauthenticated ⇒ `UNAUTHENTICATED`. Bounded **aggregate**
  results (counts/sums) — no row dumps, no PII (no user_id, token, or payload).
- **`get_platform_health` is PARTIAL by nature** — it only measures the component
  registry + last execution, so the UI shows coverage `PARTIAL` and status
  OPERATIONAL / DEGRADED / UNAVAILABLE, never a bold "everything works".
- **Recent activity** reuses `get_observability_snapshot` (already fetched) — the
  feed is bounded (default 12) and non-identifying (action keys / domains only).
- **Currencies kept honest.** AI cost stays USD (SW23); devis stay **EUR**
  (`btp_devis`). No implicit FX conversion. Invoices / prospects / contracts are
  absent and never fabricated.
- **COST-FIRST.** Deterministic, no LLM, no external API, no polling; the three
  reads join the existing `Promise.all`.

## DASH-4A — Dashboard user preferences (2026-08-15)

Foundation of the **Paramètres > Dashboard** centre: one user-scoped preferences
row + optimistic-concurrency facades. Powers appearance (theme/accent/contrast/
transparency/blur/radius/shadow), typography (font/size/weight/density),
accessibility, behavior, and the regional override — all applied via `<html>`
`data-*` tokens (live preview) and an anti-FOUC cookie. No LLM, no external API.

| File | Purpose |
|------|---------|
| `20260815_hermes_dashboard_user_preferences_1.sql` | `hermes_os.dashboard_user_preferences` (PK `user_id, tenant_id`; appearance/behavior/regional/layout/profiles JSONB; `schema_version`, `version`, `updated_at`). RLS deny-all. `public.get_dashboard_user_preferences()` (own row only) + `public.upsert_dashboard_user_preferences(p_patch, p_expected_version)` (optimistic version — stale ⇒ `VERSION_CONFLICT`, never last-write-wins). Both SECURITY DEFINER, `auth.uid` + `resolve_active_tenant`, REVOKE PUBLIC / GRANT authenticated. |
| `20260815_hermes_dashboard_user_preferences_2.sql` | Hardening (CREATE OR REPLACE, same signature): server-side JSONB guards on the upsert — payload ≤ `MAX_PREFS_PAYLOAD_BYTES` = **16384** (else `PAYLOAD_TOO_LARGE`), and every present sub-object must be a JSON object (else `BAD_PAYLOAD`). Defense-in-depth: the DB never trusts the client's clamps. |
| `20260815_hermes_dashboard_user_preferences_9_rollback.sql` | Drops both facades + the table. Nothing else touched. |

### Invariants

- **User-scoped, fail-closed.** A user reads/writes only their own row (`auth.uid`);
  tenant resolved server-side. Unauthenticated ⇒ `UNAUTHENTICATED`; verified live
  (cross-user + cross-tenant see nothing; version conflict rejects).
- **Resolution user → tenant → Hermès default** (app-side, `resolvePreferences`);
  regional overrides layer on the DASH-1 tenant defaults, kept SEPARATE from appearance.
- **COST-FIRST.** 1 preferences read in the existing `Promise.all`; writes ONLY on an
  explicit user change (debounced). No LLM, no external API, no scheduler, no polling;
  the clock tick stays 0 network/DB/LLM.
- **Anti-FOUC (server-first, zero new-device flash).** The **layout resolves the
  canonical appearance server-side** (`resolveInitialAppearance`) and stamps the
  `data-*` tokens onto `<html>` in the SSR response, so a brand-new device (server
  prefs exist, no cookie yet) paints correctly on the FIRST frame. The read is
  `React.cache()`-shared with the page, so it costs **no** extra DB round-trip. The
  tiny pre-paint init script now only does what the server cannot: resolve
  `theme:auto` against the OS, and bridge a legacy `hermes-theme` localStorage value
  for users who predate the cookie. Precedence: **server DB (canonical) → appearance
  cookie (cache) → localStorage (legacy/cache only)**.
- **Payload hardening.** `MAX_PREFS_PAYLOAD_BYTES = 16384`; sub-objects type-checked
  server-side. The `hermes-appearance` cookie carries ONLY the appearance dataset
  (no layout/profiles/sensitive data), `SameSite=Lax`, `Secure` on HTTPS,
  non-HttpOnly by necessity (the pre-paint script reads it from JS).

### DASH-4B / DASH-4C — widget registry + edit mode (no schema change)

The widget registry / gallery / show-hide / order + configurable context bar
(DASH-4B) **and** the edit mode (drag/drop reorder + per-widget sizes, DASH-4C)
persist entirely in the **existing** `layout` JSONB sub-object of
`dashboard_user_preferences` (`{ order, hidden, sizes, context, schemaVersion }`),
through the **same** `upsert_dashboard_user_preferences` facade — no new table, no
new migration. Optimistic version, tenant scoping, and the payload guards all apply
unchanged.

Layout schema evolution (`schemaVersion`, currently 1): `clampLayout` reads only
known keys/ids and clamps sizes to each widget's `supportedSizes`, so it is
**forward- and backward-compatible** by construction — a renamed/removed widget id
is ignored, a new size or a new layout field is additive, and no data migration is
required. Only bump `schemaVersion` if a future change needs an active transform.

## CARTE-1 — Worksite map geo source (2026-08-15)

Canonical geographic source for the free (MapLibre + OpenStreetMap) worksite map.

| File | Purpose |
|------|---------|
| `20260815_hermes_chantier_geo_1.sql` | `hermes_os.btp_chantier_geo` (PK `chantier_id`; `tenant_id`, `latitude`, `longitude`, `formatted_address`, `country_code`, `iana_timezone`, `geocoded_at`, `geocode_provider`, `geocode_status`). **Separate** from `btp_chantiers` (which the BTP agent writes) to avoid write collisions. RLS deny-all. `public.get_chantiers_map()` (active tenant's geocoded worksites, bounded 500) + `public.upsert_chantier_geocode(...)` (persist a one-shot geocode for a worksite the tenant owns; validates coord range + tenant ownership). Both SECURITY DEFINER, `auth.uid` + `resolve_active_tenant`, `search_path` locked, REVOKE PUBLIC / GRANT authenticated. |
| `20260815_hermes_chantier_geo_9_rollback.sql` | Drops both facades + the geo table. Nothing else touched. |

### Invariants

- **Geocoding is one-shot** (address → lat/lon persisted); never geocoded at render.
  The initial seed used **Nominatim (OSM)** at ≤ 1 req/s with a proper User-Agent.
- **Same lat/lon feed the map AND the worksite weather** (Open-Meteo, `timezone:auto`)
  — no second geographic system, no second geocoding.
- **Tenant-scoped, fail-closed**: verified live — member sees only their geocoded
  worksites; unauthenticated ⇒ `UNAUTHENTICATED`; no client `tenant_id`.
- **COST-FIRST**: `MAP_COST = GEOCODING_COST = ROUTING_COST = 0 €`, `LLM = 0`. Free
  keyless OSM vector tiles (OpenFreeMap by default, `NEXT_PUBLIC_MAP_STYLE_URL`
  overridable for self-hosted PMTiles/tileserver). MapLibre + the map data load ONLY
  when the opt-in `chantiers-map` widget is added or the `/chantiers/carte` page is
  opened. External routing = an "Ouvrir l'itinéraire" link (no paid API).

## PHOTO-P0 — Verticale Hermès Studio (2026-08-18) — **NON APPLIQUÉE**

Construction préparatoire de la verticale photographe décrite dans
`docs/hermes-studio-photographe-architecture.md`. **`GO_LIVE = NO` :** ces six
fichiers ne sont **pas** appliqués — ils constituent le diff à examiner avant
toute migration réelle.

| Fichier | Contenu |
|------|---------|
| `20260818_photo_studio_1_schema.sql` | 14 tables `photo_*` (activation, clients, membres, séances, assets, signaux, verdicts, consignes, profils de style, jobs d'édition, galeries, opportunités, consentement, brouillons marketing). RLS **enabled sans policy** ⇒ deny-all ; accès par façade uniquement. Aucune colonne ne stocke un RAW ni un gabarit biométrique. |
| `20260818_photo_studio_2_services.sql` | Services métier canoniques : `photo_session_status_rank`, `compute_photo_session_state` (**le « Studio Director » = une projection SQL, pas un second orchestrateur**), `verifier_consentement_photo` (gate fail-closed), `detect_photo_upsell_opportunities` (SQL pur, lecture seule), `derive_photo_culling_verdicts` (**unique implémentation** des seuils de tri). |
| `20260818_photo_studio_3_facades.sql` | 1 garde partagée + 14 façades `public.*` (8 lectures, 6 écritures). SECURITY DEFINER, `search_path` verrouillé, REVOKE PUBLIC / GRANT `authenticated`, tenant résolu par `resolve_active_tenant` — **aucune n'accepte de `tenant_id` du client**. |
| `20260818_photo_studio_4_storage_proxies.sql` | Bucket **privé** `hermes-photo-proxies` (6 MiB, jpeg/webp) + RLS `storage.objects` dérivant le tenant de la clé d'objet, **sans policy DELETE**. Façades finalize / failed / purge, bornées et appelables — aucun worker, aucun scheduler. Réutilise `hermes_os.is_active_tenant_member` (ardoise pièces jointes) sans la redéfinir. |
| `20260818_photo_studio_5_dormant_registry.sql` | 11 actions catalogue **`enabled = false`**, 6 configurations d'exécution `enabled = false`, 11 politiques SW15 `DISABLED`, 5 abonnés SW20 `DISABLED`, 4 définitions de métriques SW19 additives, 1 budget SW23 conditionnel (`on conflict do nothing`). |
| `20260818_photo_studio_9_rollback.sql` | Teardown intégral, ordre inverse des dépendances. Ne touche PAS aux briques partagées d'une autre ardoise. |

### Invariants (vérifiés mécaniquement par `tests/photo-migrations.test.ts`)

- **Dormance prouvée.** `hermes_os.request_agent_action` filtre
  `where action_key = … and enabled = true` : une action photo répond donc
  `UNKNOWN_ACTION` même à un appelant authentifié, membre et autorisé. Par
  conséquent `get_available_capabilities()` ne la renvoie pas, et **aucun widget,
  profil, menu ou route photo n'apparaît** tant qu'un opérateur n'a pas activé.
- **Aucune suppression de photo.** Il n'existe aucun `DELETE` sur
  `photo_session_assets` ni sur les verdicts. « Écarter » écrit
  `human_decision = 'DISCARD'` ; la purge de proxy passe le statut à `PURGED` et
  oublie les chemins, en conservant la ligne d'inventaire. Le fichier d'origine
  n'a jamais quitté le poste de la photographe.
- **Protection prioritaire.** Dans `derive_photo_culling_verdicts`, la branche
  « couverte par une consigne PROTECT » est évaluée **avant** toute branche de
  rejet, et une décision humaine déjà prise n'est jamais écrasée.
- **RGPD.** Contrainte de table `photo_consent_minors_need_guardian` (mineurs ⇒
  consentement du représentant légal obligatoire), `identity_scope` par défaut
  `NONE`, aucune reconnaissance faciale, aucune lecture GPS des EXIF, minimisation
  sur `photo_client_members` (prénom + mois/année seulement).
- **Non-régression assumée.** `component_registry` n'est **pas** alimenté :
  `get_platform_health()` compte toutes ses lignes sans filtre de visibilité, et y
  déclarer des agents encore inexistants changerait un chiffre affiché.

### Écarts assumés par rapport au rapport d'architecture

1. **Les écritures déterministes ne passent pas par `request_agent_action`.**
   `agent_action_catalog` porte `CHECK (target_kind = 'N8N_WORKFLOW')` : une action
   dont le runner est une fonction Postgres n'y est pas représentable sans modifier
   une contrainte existante. Ces écritures suivent donc le patron déjà en place
   (`upsert_dashboard_user_preferences`, `upsert_chantier_geocode`,
   `finalize_hermes_attachment`) : façade fail-closed pilotée par l'utilisateur. Les
   actions pilotées par un AGENT restent réservées à la passerelle unique.
2. **Table d'activation dédiée** plutôt que `tenant_module_activation`, dont la FK
   vers `component_registry` imposerait précisément l'inflation de KPI écartée
   ci-dessus.
3. **Lectures galeries / revenus / marketing non livrées.** Leurs tables ne peuvent
   être alimentées que par un consumer n8n : livrer des lecteurs sur des tables
   toujours vides produirait des panneaux décoratifs.

### Ce qui a réellement été vérifié

Le SQL n'a **pas** été appliqué à la production. Il a en revanche été exécuté sur
un **PostgreSQL 16 local et jetable** (schémas Hermès stubés), ce qui a validé :
application des 5 lots · **ré-application** des 5 lots (idempotence) · rollback
complet · seconde application/rollback. Deux défauts réels ont été trouvés par
cette exécution et corrigés :

1. `derive_photo_culling_verdicts` imbriquait `lag()` dans `sum() over` — interdit
   par Postgres ; le décalage est désormais matérialisé dans un CTE `base`.
2. `sw15_policies` / `sw20_subscribers` n'ont aucune contrainte d'unicité :
   `on conflict do nothing` n'y protégeait de rien et les lignes se dupliquaient à
   la ré-application ; remplacé par une anti-jointure `where not exists`.
   `create policy` n'acceptant pas `if not exists`, le lot 4 retire désormais ses
   policies avant de les recréer.

Les deux régressions sont verrouillées par `tests/photo-migrations.test.ts`.

Comportement vérifié sur ce banc d'essai : portillon d'activation (toutes les
façades répondent `MODULE_DISABLED` avant activation) · idempotence de la création
de séance et de l'import · **consigne PROTECT** (contre-épreuve : sans la consigne
la photo est `REJECTED_SUGGESTION`, avec elle `KEEP_SUGGESTION`) · **aucune
suppression** (4 assets avant / 4 après avoir tout écarté ; purge de proxy sans
perte de la ligne) · décision humaine non écrasée par une ré-exécution du tri ·
verrou mineurs · gate de consentement fail-closed · **isolation cross-tenant avec
les deux tenants activés** (0 séance, 0 client, `found=false`, écriture croisée
`NOT_FOUND`) · non authentifié et sans tenant refusés · chemin de stockage forgé
refusé (`PATH_OUT_OF_SCOPE`).

### Protocole de vérification

`db/tests/photo_studio_isolation.test.sql` — assertions d'isolation, de
fail-closed, de consentement et de non-suppression, à jouer **au moment** de la
première migration. Elles n'ont pas encore été exécutées et rien n'est présenté
ici comme constaté.

### Audit final avant migration (2026-08-18)

Confrontation des migrations au **vrai schéma Supabase en lecture seule**
(`information_schema`, `pg_proc`, `pg_constraint`, `pg_policies`) puis nouveau cycle
complet sur PostgreSQL local jetable. **Compatibilité : 12/12 dépendances OK, aucune
collision de nom, aucune colonne NOT NULL sans défaut non fournie.**

Trois défauts réels ont été trouvés et corrigés :

1. **Moindre privilège (HAUT).** `authenticated` détient `USAGE` sur le schéma
   `hermes_os` en production, et toutes les fonctions internes existantes y sont
   explicitement restreintes (`postgres=X`, parfois `service_role=X`). Les 6 nouvelles
   fonctions internes n'avaient pas de `REVOKE` : `PUBLIC` conservait `EXECUTE` sur des
   fonctions qui **prennent un tenant en paramètre**, donc sans contrôle d'appelant.
   `REVOKE ALL … FROM public` ajouté sur les 6 ; ACL vérifiées `postgres=X/postgres`.
2. **Verrou de publication marketing (MOYEN).** La contrainte de table n'exigeait qu'un
   `consent_id` NON NUL — un consentement **révoqué ou expiré** la satisfaisait. Un
   déclencheur `BEFORE INSERT OR UPDATE` revalide désormais **le** consentement référencé
   au moment du passage à `PUBLISHED` (client, statut, révocation, expiration, usage,
   mineurs, portée d'identité). Il s'applique à tout écrivain, y compris un `INSERT` SQL
   direct qui n'appellerait pas la façade — vérifié en contournant délibérément celle-ci.
3. **Course sur la création de client (MOYEN).** Deux créations simultanées pour un client
   nouveau pouvaient toutes deux franchir le `SELECT` et provoquer une violation
   d'unicité. `on conflict do nothing` + relecture + refus fail-closed résiduel.

Deux clarifications d'honnêteté ont aussi été ajoutées : les seuils de tri
(0.35 / 0.55 / rafale 2 s / `SHARPNESS_REFERENCE`) sont désormais marqués **NON CALIBRÉS**
dans le SQL **et** affichés comme tels dans l'interface de revue ; l'ordre obligatoire de
purge (lister → supprimer l'objet → marquer purgé) est documenté, ainsi que le fait que le
TTL de 90 jours n'est **pas** appliqué automatiquement en Phase 1.

### Décision — passerelle des actions déterministes

`DETERMINISTIC_ACTION_GATEWAY_DECISION = KEEP_DIRECT_SQL` pour la Phase 1.

Fait déterminant relevé en base : **`request_agent_action` ne lit pas `target_kind`**, et
`claim_agent_action` ne fait que le **recopier** dans son JSONB de retour — aucune fonction
ne branche dessus. Étendre la contrainte à `POSTGRES_FUNCTION` serait donc un `ALTER` isolé
et sans effet sur les actions existantes. Mais **aucun dispatcher ne saurait exécuter** une
action `POSTGRES_FUNCTION` : une requête resterait `QUEUED` indéfiniment tant qu'un runner
(n8n, indisponible) ou un nouveau composant ne la réclame pas. Faire transiter une écriture
CRUD synchrone par une file asynchrone transformerait par ailleurs « créer une séance » en
attente de résultat. La convergence reste possible et documentée ; elle n'a pas sa place
dans une phase qui doit rester dormante.

---

## 2026-08-19 — PHASE 1 : sécurisation du socle (BLOCKER B2)

Lots `20260819_phase1_security_1..4` + `_9_rollback`. Appliqués au projet
`smubxqorirlfldatzmym`. **Aucune capacité rendue autonome, aucun runner réveillé,
aucune table `pv_*`.**

### Le défaut corrigé

`hermes_os.gateway_policy_gate(uuid)` était **FAIL-OPEN** : lorsqu'aucune politique
SW15 `ACTIVE` ne correspondait, elle appliquait `v_effect := 'PERMIT'`. Or les
13 politiques en base sont toutes `DISABLED`, et `agent_action_catalog.is_sensitive`
n'intervenait **pas** dans la décision. Conséquence mesurée avant migration, sur une
action de fixture `is_sensitive = true` sans politique :

```
gate_result = PERMIT        -- attendu après correctif : REQUIRE_APPROVAL
```

Les trois capacités d'écriture métier réellement actives
(`btp.qualification.create`, `btp.planning.phase.add`, `btp.suivi.progress.report`),
toutes marquées `is_sensitive = true`, étaient donc exécutables **sans aucune
approbation humaine**.

### Comportement après

| `is_sensitive` | politique ACTIVE correspondante | décision |
|---|---|---|
| `true`  | `DENY`             | `DENY` |
| `true`  | `REQUIRE_APPROVAL` | `REQUIRE_APPROVAL` |
| `true`  | `PERMIT`           | `PERMIT`, motif d'audit dédié « PERMIT EXPLICITE » |
| `true`  | **aucune**         | **`REQUIRE_APPROVAL`** ← le correctif |
| `false` | selon la politique | effet de la politique |
| `false` | **aucune**         | `PERMIT` (défaut conservé, décision documentée) |

Le défaut `PERMIT` sur action **non sensible** est assumé : `is_sensitive = false` est
une déclaration explicite du catalogue, et le catalogue n'est modifiable que par
migration. Les deux seules actions concernées sont `diag.echo` (aucun effet) et
`hermes.intent.resolve` (proposition seule — l'action cible repasse par la même
passerelle avec **sa** sensibilité).

Action absente du catalogue ⇒ traitée comme sensible (`coalesce(is_sensitive, true)`).
En pratique la FK `agent_action_requests_action_key_fkey` rend le cas impossible : le
`coalesce` est une ceinture de sécurité, la contrainte est la garantie.

### Limite connue, volontairement non modifiée

La sélection de politique reste scopée `p.tenant_id = v_req.tenant_id`. Les politiques
à `tenant_id IS NULL` (les 12 lignes photo, toutes `DISABLED`) ne correspondent donc
jamais. Élargir le matching aux politiques globales **augmenterait** la surface
d'autonomie — l'inverse de l'objectif de cette phase. À traiter séparément quand les
verticales concernées sortiront de dormance.

### Autres lots

* **Lot 2** — 3 politiques SW15 `ACTIVE` / `REQUIRE_APPROVAL` pour les capacités BTP,
  tenant `heliosolar`, marquées `updated_by = 'phase1_security_2'` (le rollback ne
  supprime que celles-là). Les 13 politiques préexistantes restent `DISABLED`.
* **Lot 3** — `dashboard_context_settings` : RLS activée (deny-all, 0 politique).
  C'était la seule table de `hermes_os` sans RLS (1/178). Comportement applicatif
  inchangé : l'accès passe par `public.get_dashboard_context_settings()`
  (SECURITY DEFINER). `REVOKE ALL` réaffirmé sur `anon` et `authenticated`.
* **Lot 4** — `photo_session_status_rank(text)` : `search_path` épinglé. Advisor
  `function_search_path_mutable` : **1 → 0**.

### `btree_gist` — déplacement REPORTÉ (décision documentée)

L'advisor `extension_in_public` reste ouvert. Évaluation menée en transaction annulée :

1. `alter extension btree_gist set schema extensions` **réussit** techniquement ;
2. la seule dépendance en base est la contrainte d'exclusion
   `sw23_model_catalog_no_overlap` (garde-fou anti-chevauchement des prix SW23) ;
   après déplacement simulé, une insertion chevauchante est **toujours rejetée**
   (`exclusion_violation`) — l'invariant survit.

Le déplacement est donc *possible*. Il est néanmoins **reporté** : le bénéfice de
sécurité est nul (les fonctions `gbt_*` exposées prennent des arguments `internal` et
ne sont pas appelables ; `anon` n'a aucun privilège sur `hermes_os`), tandis que les
consommateurs n8n — **non inspectables**, instance injoignable — pourraient utiliser
des opérateurs résolus via `search_path`. Un risque non nul contre un gain nul ne se
prend pas dans une phase dont la contrainte est « aucune régression ». À reprendre
quand n8n sera de nouveau auditable, avec en préalable l'ajout de `extensions` au
`search_path` de toute future migration créant une contrainte d'exclusion GiST.

### Preuves

`db/tests/phase1_gateway_fail_closed.test.sql` — 23 assertions, transaction annulée,
**23 PASS** (A/B/C/D + PERMIT explicite tracé, défaut non sensible, FK anti-orphelin,
court-circuit d'approbation humaine, `NOT_FOUND`, politiques BTP, doctrine
« aucun PERMIT actif sur action sensible », permission insuffisante, isolation tenant,
`dashboard_context_settings` inaccessible en direct).

`tests/phase1-security-migrations.test.ts` — 18 assertions de contrat sur le diff SQL.
Vérifiées par mutation : remettre le défaut fail-open fait échouer 2 tests.

Les 11 requêtes réelles en file (`10 × hermes.intent.resolve`,
`1 × btp.qualification.create`) n'ont été ni lues en écriture, ni claim ées, ni mutées.

---

## 2026-08-19 — PHASE 2 : hygiène du socle

Lots `20260819_phase2_hygiene_1..2` + `_9_rollback`. Appliqués au projet
`smubxqorirlfldatzmym`. **Aucune ligne métier réelle modifiée.**

### Lot 1 — expiration des requêtes gateway orphelines

11 requêtes `QUEUED` depuis le 10 août (10 × `hermes.intent.resolve`,
1 × `btp.qualification.create`), toutes `attempts = 0`, sans décision de
politique ni demande d'approbation : aucun consumer n8n n'est actif et
`resolver_runtime_config.enabled = false` sur les 7 clés.

La cause racine est **externe** (quota n8n Cloud bloqué) et hors périmètre. Ce
lot fournit ce qui manquait : une **porte de sortie** pour une file sans
consumer. `expire_stale_queued_agent_actions(p_older_than, p_action_key,
p_limit)` marque `FAILED` / `STALE_NO_CONSUMER` les seules requêtes **jamais
réclamées** et plus vieilles que la limite d'âge. Ligne, `payload`,
`payload_hash`, `created_at`, `correlation_id` et piste d'audit **conservés** :
aucune suppression. `service_role` uniquement.

> **La migration n'exécute pas la fonction.** Les 11 requêtes réelles ne sont pas
> touchées : l'expiration est une décision d'exploitation explicite.

### Lot 2 — intégrité `tenant_id` sur la file du gateway

FK `agent_action_requests.tenant_id → tenants(tenant_id)`, `ON DELETE RESTRICT`.
Seul écrivain : `request_agent_action`, qui obtient le tenant via
`resolve_active_tenant` — jamais du client. L'invariant applicatif devient un
invariant de schéma.

**`execution_logs` n'est délibérément PAS contraint** : il porte 30 lignes sur
10 tenants inexistants (`tenant-iso-A` ×11, `tenant-hb-test` ×5,
`tenant-loop-test` ×3, `tenant-monitoring-relapse` ×3, `tenant-execute-test` ×2,
`tenant-sw12-test-A` ×2, plus 4 unitaires), résidus de campagnes SW12/SW17. Ses
écrivains sont les modules SW côté n8n, **inspectables par personne** aujourd'hui.
Poser une FK sur une table écrite par du code non auditable risquerait de faire
échouer un écrivain légitime. Les 30 lignes ne sont pas supprimées non plus :
ce serait destructif, et c'est une décision d'exploitation.

### Deux constats de l'audit initial CORRIGÉS après mesure

* **`sw13_event_outbox` — aucun index manquant.** La table porte déjà 3 index
  (`pkey`, `idx_sw13_outbox_tenant_status`, `uq_sw13_outbox_request_type`) et
  affiche `idx_scan = 15295` contre `seq_scan = 12073` : les index **sont**
  utilisés. Sur 43 lignes vivantes, PostgreSQL préfère légitimement un parcours
  séquentiel — c'est moins cher. Le chiffre relevé par l'audit était un artefact
  de la petitesse de la table, pas un défaut. **Aucune action.**
* **Agents 1 et « Agent Commercial IA » — pas de doublon.** Capacités
  **disjointes** (`pilotage_commercial` · `qualification_prospects`+`handoff_crm`
  · `suivi_affaires_commercial` pour l'Agent 3), workflows distincts, aucun
  `duplicate_group` partagé. C'est une division du travail, pas un recouvrement.
  L'audit avait conclu sur les noms. **Aucune action.**

### Agents `legacy_superseded` encore `n8n_active`

7 composants (2 Immobilier-Qualification, 2 Industrie-Production,
2 Industrie-Maintenance, 1 SW17). **Non sélectionnables par Hermès** — prouvé :
aucune ligne d'`agent_action_catalog` ne cible leur `workflow_id`, et
`v_dashboard_components` les exclut déjà par `is_current_in_group = true`.

Leur désactivation **dans n8n** est `BLOCKED_EXTERNAL`. Basculer
`component_registry.n8n_active = false` sans toucher n8n ferait **mentir le
registre**, qui est un miroir de l'état n8n — un faux sentiment de sécurité pire
que le constat. Les deux invariants vérifiables sont donc verrouillés par test
(`LEG1`, `LEG2`).

### Preuves

`db/tests/phase2_hygiene.test.sql` — 16 assertions, transaction annulée,
**16 PASS**, dont `DATA1`/`DATA2` (aucune donnée réelle perdue) et
`P1a`/`P1b`/`P1c` (les protections de la Phase 1 restent intactes).

---

## 2026-08-19 — PACK PHOTOVOLTAÏQUE, LOT PV-1 : modèle de données métier

Lots `20260819_pv1_1_schema` + `_2_functions` + `_9_rollback`. Appliqués au projet
`smubxqorirlfldatzmym`. **0 ligne métier écrite en production.**

### Ce que le lot ferme

L'audit du 2026-08-19 avait établi que le schéma ne contenait **aucune** colonne
photovoltaïque, et que les Agents 4 (Facture EDF) et 5 (Bureau d'Études PV), pourtant
actifs dans n8n, étaient **orphelins** — aucune table ne pouvait recevoir leur sortie.

**9 tables** : `pv_prospects` · `pv_prospect_transitions` · `pv_sites` ·
`pv_consumption_profiles` · `pv_energy_bills` · `pv_energy_bill_extractions` ·
`pv_studies` · `pv_study_assumptions` · `pv_economics`.

### L'invariant central — l'IA ne s'auto-valide jamais

Déclencheur `pv_human_validation_guard`, opposable à tout écrivain :

* `auth.uid()` NULL ⇒ **refus** — un runner en `service_role` n'a pas d'identité
  authentifiée, il ne peut donc structurellement pas valider ;
* `verified_by` / `validated_by` doit être **l'appelant authentifié lui-même** — on ne
  valide pas au nom d'autrui ;
* `CHECK` complémentaire (acteur **et** horodatage) + FK vers `auth.users(id)`.

Conséquence : une étude `prepared_by = 'AGENT_5'` en `CALCULATED` ne peut pas atteindre
`VALIDATED`, et une extraction ne peut pas rendre une facture `VERIFIED`.
`pv_promote_bill_extraction()` — seul chemin sanctionné — aboutit à **`NEEDS_REVIEW`**,
jamais `VERIFIED` : promouvoir et certifier sont deux gestes distincts.

### Isolation — la FK composite

Une FK enfant sur `id` seul aurait laissé un site pointer le prospect d'un **autre
tenant**. Les 7 FK du lot sont donc **composites** `(tenant_id, parent_id)`, adossées à
une clé candidate `unique (tenant_id, id)` sur chaque parent. Plus `tenant_id` immuable
par déclencheur, RLS deny-all sur les 9 tables, et `REVOKE ALL FROM anon, authenticated`.

### Décisions de modélisation

* **Azimut et inclinaison numériques** (`numeric`), pas des chaînes : « plein sud » n'est
  pas calculable par PVGIS.
* **Hypothèses d'étude en colonnes typées** (prix énergie, inflation, horizon,
  actualisation, dégradation, pertes, rachat surplus, aides, TVA). `extra_assumptions`
  (jsonb) est un **complément**, jamais la source d'un chiffre montré au client.
* **Documents = (bucket privé, chemin)**, jamais une URL — un `CHECK` refuse `http(s)://`.
  Le bucket `hermes-pv-documents` et sa RLS `storage` sont au lot PV-2 : PV-1 ne pose que
  le contrat de colonnes.
* **Audit : brique EXISTANTE réutilisée** (`entity_audit_log`). Aucun second système.
* **`ON DELETE RESTRICT`** sur les chaînes porteuses de données ; `CASCADE` uniquement
  là où l'enfant n'a aucun sens seul et ne porte rien de validé (extractions, hypothèses).

### Preuves

`db/tests/pv1_schema.test.sql` — **30 assertions, 30 PASS**, transaction annulée,
couvrant les 12 tests exigés + audit + promotion + RLS, dont le rollback réel du lot
(9 tables retirées, et **seulement** elles) et la non-régression des Phases 1 et 2.

`tests/pv1-schema-migrations.test.ts` — 22 assertions de contrat sur le diff SQL.
Vérifié par mutation : remplacer une FK composite par une FK simple fait échouer un test.

## 2026-08-20 — GOUVERNANCE DES MIGRATIONS PRODUCTION — **NON APPLIQUÉE**

Le 2026-08-19, deux sessions Claude ont écrit sur la même base à quelques minutes
d'intervalle (PV-1 à 13:22, PV-2 à 16:10–16:14) pendant qu'une troisième mission
auditait cette même base. Aucune n'a mal agi ; aucune ne pouvait savoir. Ce lot
supprime cette cécité mutuelle.

| Fichier | Migration à appliquer | Objet |
|------|-------------------|---------|
| `20260820_hermes_migration_governance_1_lock.sql` | `hermes_migration_governance_1_lock` | `production_migration_lock` (singleton structurel) + `…_lock_history` |
| `20260820_hermes_migration_governance_2_functions.sql` | `hermes_migration_governance_2_functions` | `acquire_…` / `release_…` / `…_status` |
| `20260820_hermes_migration_governance_3_baseline.sql` | `hermes_migration_governance_3_baseline` | photo de la dette + `migrations_since_baseline()` |
| `20260820_hermes_migration_governance_9_rollback.sql` | — | démontage complet |

**Mode = COOPÉRATIF.** Pas d'`event trigger` DDL : le verrou rend l'occupation
visible et opposable, il ne peut pas l'empêcher. C'est un choix assumé, documenté
dans `docs/hermes-migrations-production.md`.

### Garanties structurelles

* `ONE_ACTIVE_LOCK_MAX` — `primary key (lock_id)` + `check (lock_id = 'PRODUCTION')`.
  La table **ne peut pas** contenir deux lignes ; ce n'est pas une convention.
* `TTL_REQUIRED` — borné des deux côtés en base (`> acquired_at`, `<= +2 heures`),
  et en fonction (1 à 120 minutes). Un verrou éternel est un interblocage différé.
* `EXPIRED_LOCK_CAN_BE_RECLAIMED` — la reprise archive le détenteur périmé
  **avant** de supprimer sa ligne, et renvoie un avertissement : un verrou expiré
  signale une migration qui n'a jamais dit qu'elle était finie.
* `base_sha ~ '^[0-9a-f]{40}$'` — on ne verrouille pas en déclarant « main ».
* RLS deny-all, `revoke all … from public, anon, authenticated`, aucune façade
  `public` : ce n'est pas une capacité métier.

### Dette historique

Sur ~203 migrations appliquées, la grande majorité n'a aucun fichier ici. Une règle
« toute migration sans fichier = STOP » bloquerait Hermès et serait désactivée le
lendemain. `migration_baseline` photographie donc l'existant : **`LEGACY_BASELINE`**
ne bloque rien, **`NEW_UNVERSIONED_DRIFT`** (appliqué après la frontière, sans
fichier) rend `STOP_UNVERSIONED_DB_DRIFT`.

### Preuves

* **25 assertions sur PostgreSQL réel** — acquisition, contention, réentrance,
  refus de libération par un tiers, TTL invalides, SHA invalide, identité vide,
  reprise après expiration, singleton (deux `insert` refusés par la base),
  `update` direct au-delà de 2 h refusé, non-reprise de la photo de base.
* `tests/migration-drift-guard.test.ts` — 26 assertions de contrat.
  Vérifié par mutation (7 mutations) : neutraliser le singleton, exposer une
  fonction à `authenticated`, rendre le rapprochement de noms approximatif dans un
  sens **ou dans l'autre**, oublier une table dans le rollback, faire diverger le
  script du module, ou neutraliser son contrôle de ligne de base — chacune fait
  échouer au moins un test.
