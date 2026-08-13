# Hermès Semantic Resolver — Execution Continuity (audit + safe architecture)

> Status: **Fix A + Fix B APPLIED to production + validated by isolated real
> tests (2026-08-13). GO-LIVE STILL DISABLED — the consumer/Schedule driver was
> NOT activated and no LLM was run.** Fix C (SW23 wiring) and the real
> LLM/authenticated E2E remain BACKEND_FOLLOWUP / BLOCKED (see §8–§9).
> Migrations: `db/migrations/20260813_hermes_resolver_execution_safety_1.sql`
> (+ `_9_rollback.sql`).

## 0. Controlled run — applied + tested (2026-08-13)

Under explicit "run contrôlé en production" authorization, with all gateway
consumers INACTIVE (zero live traffic through claim/complete):

- **Applied** `hermes_resolver_execution_safety_1`: `lease_token` + `max_attempts`
  columns; `claim_agent_action` now stamps/returns a per-claim `lease_token` and
  refuses to reclaim past `max_attempts`; `complete_agent_action` gained a fenced
  6-arg form (`status='RUNNING'` **and** lease-token match; trailing token
  defaults to null so existing 5-arg callers keep working); additive
  `reap_dead_letter_agent_actions()` reaper.
- **Validated** with an isolated self-test on a dedicated test capability
  (`test.resolver.recovery`, tenant `__rr_test__`) via `service_role` — **no
  OpenAI, no auth, no real row touched**. Results (all ✅):
  - double claim → **distinct rows** (single-winner); no reclaim of a live lease.
  - lease-expiry **reclaim** works, fresh token minted.
  - **ownership fence:** a stale worker (expired lease/old token) completion is
    **IGNORED** (row stayed RUNNING, result not overwritten); the reclaiming
    worker completed with its token → SUCCEEDED.
  - invalid terminal status → raises.
  - **bounded attempts:** claim refuses to reclaim once `attempts >= max_attempts`
    (`claim_when_capped=false`); reaper parks it terminal `FAILED` /
    `error.code=DEAD_LETTER`. No infinite reclaim; request_id preserved.
  - SW12 audit emitted `{CLAIMED:5, SUCCEEDED:1, DEAD_LETTER:1, COMPLETE_IGNORED:1}`.
- **Cleanup verified:** test rows / test capability / test audit / self-test fn
  all removed; the **4 pre-existing real QUEUED `hermes.intent.resolve` rows
  remain untouched**.
- **OpenAI cost this run: €0.00** (the resolver workflow was not executed).
- **Consumer/Schedule: still INACTIVE.**

## 0bis. Consumer hardening + SW23 wiring (2026-08-13, pass 2)

- **Resolver workflow source hardened** (`n8n/hermes-semantic-resolver.workflow.js`):
  carries the claim's `lease_token` and completes via the **fenced 6-arg**
  `complete_agent_action(...,lease_token)` (no more legacy 5-arg for this
  consumer); wires SW23 `set_session_tenant → reserve_budget` before the model
  and `commit_budget`/`release_budget` after (canonical engine, no second
  ledger). **Deployment to n8n + the real OpenAI run are the remaining
  controlled step** (gated — see below); the deployed workflow stays INACTIVE
  and on the legacy 5-arg form until then.
- **Caller census** of `complete_agent_action`: 5-arg legacy today =
  btp-planning, btp-suivi, diag-echo (kept backward-compatible); the resolver
  source is now 6-arg + token.
- **Validated by real isolated tests** (service_role, test tenant/action, no
  OpenAI, no real row touched), all ✅:
  - **by-request isolation claim** (`_test_claim_agent_action_by_request`,
    test-only, dropped after) claims exactly the target test request — it can
    never touch the real `hermes.intent.resolve` rows.
  - **real-contract token fencing**: claim→token→reclaim(token B)→stale
    complete(token A) **ignored** (row stayed RUNNING, not overwritten)→
    complete(token B) SUCCEEDED.
  - **SW23 lifecycle**: `reserve=ok`, `commit=ok`, `commit` idempotent replay,
    `release` of a committed reservation rejected
    (`CANNOT_RELEASE_COMMITTED_RESERVATION`), reserve/release of a second request
    ok, cross-tenant call raises `SW23_TENANT_MISMATCH`.
  - Cleanup verified; the **4 real QUEUED rows remain untouched**.
- **SW23 pricing prerequisite:** `openai/gpt-5.4-nano` is **absent from
  `sw23_model_catalog`** (only Anthropic `claude-*` are `cost_status='real'`), so
  `sw23_route_and_reserve` cannot select/price the resolver model as-is. The
  workflow therefore reserves/commits a fixed `RESERVE_USD` estimate (governed by
  the real ledger). **USER DECISION needed** for precise per-request pricing:
  add gpt-5.4-nano to the catalog with real pricing, or switch the resolver to a
  catalogued model (e.g. `claude-haiku-4-5`) via `route_and_reserve`.

## 0ter. Pricing catalogued + workflow redeployed (2026-08-13, pass 3)

- **`openai/gpt-5.4-nano` catalogued** in `sw23_model_catalog` with **real
  pricing** (`db/migrations/20260813_sw23_catalog_gpt_5_4_nano_1.sql`): input
  0.20 / output 1.25 USD per 1M tokens (`per_1M_tokens`, `cost_status='real'`,
  `availability='available'`); cached-input 0.02 in `metadata`. Source: OpenAI
  official API pricing as designated by the operator (not independently
  re-derivable in this environment — provenance recorded in the row `metadata`).
- **Validated (no OpenAI):** `get_active_price` returns the real price;
  reservation computed from real price (`est 0.0011`, actual `0.001265`);
  `reserve/commit ok`, `commit` idempotent replay, release-of-committed rejected;
  **`route_and_reserve` selects+prices `openai/gpt-5.4-nano`** (`route_success:
  true`). Test fixtures cleaned across `sw23_budget_ledger`/`_audit_log`/
  `_idempotency_lock`.
- **Resolver switched to the canonical `route_and_reserve` path** (SW23 computes
  the reservation from the real price — no fixed estimate).
- **Workflow `IS1I8g0K8VXbm4oH` REDEPLOYED** (n8n MCP `update_workflow`, 17 ops):
  now `Claimed? → SW23 Route+Reserve → Reserved? → model → SW23 Commit →
  Complete Success` and `agent error → SW23 Release → Complete Failed`, both
  completions **6-arg with `lease_token`**. **Still INACTIVE** (`active:false`,
  manual trigger only); the workflow was **not run** (no OpenAI call, €0), so the
  4 real QUEUED rows were not drained.
- **Remaining follow-up:** commit currently uses the routed estimate; switch to
  actual provider token usage × price once the exact n8n usage field is confirmed
  during the controlled OpenAI run.

## 0quater. Controlled real E2E of the resolver (2026-08-13, pass 4)

Authorized controlled run on the isolated test request only (a test-only
by-request claim; the 4 real QUEUED rows were provably never touched).

- **Bug caught + fixed by the run:** the SW23 nodes ran two statements
  (`set_session_tenant; sw23_*`), returning two items and breaking n8n item
  pairing (empty agent prompt; invalid release params → the first run errored).
  Fixed to a **single result set** — set the SW23 tenant via `set_config` in a
  `FROM` subquery — in both the deployed workflow and this source.
- **Second run = SUCCESS, real end-to-end:**
  claim → real `lease_token` → `SW23 Route+Reserve` (real catalog price, selected
  `openai/gpt-5.4-nano`, reserved 0.0011 USD) → **real OpenAI call** (gpt-5.4-nano,
  ~2.9 s) → real structured proposal `{outcome: ACTION, action_key:
  btp.qualification.create, confidence: 0.78, parameters:{chantier_name:"Toiture
  Atelier Nord"}}` → `SW23 Commit` (`committed`, 0.0011 USD) → **fenced 6-arg**
  `complete_agent_action(..., lease_token)` → row **SUCCEEDED**; SW12 audit
  `CLAIMED:1, SUCCEEDED:1`.
- **Cost:** the reservation/commit used the routed real-priced estimate (0.0011
  USD). The n8n agent node exposes only a prompt-token estimate
  (`tokenUsageEstimate.promptTokens≈553`, completion not captured) for this
  structured/tool-calling flow, so a precise provider-actual commit is an n8n
  limitation (follow-up). Total OpenAI test cost: **< $0.01** (one nano call).
- **Cleanup:** test request, SW23 ledger/audit/idempotency, and the by-request
  test function all removed; the workflow's claim reverted to the global
  action-scoped claim; **workflow INACTIVE**. The 4 real QUEUED rows: intact.
- **NOT covered (needs a real authenticated session — no bypass):** the
  authenticated UI path `orchestrate_hermes_message` (enqueue) and
  `apply_hermes_resolution → gateway → SW15`. Those require a confirmed test auth
  user + GoTrue session; the resolver-execution core is proven real, that leg is
  the remaining item.

---


This document diagnoses why a Hermès message that takes the *semantic* path
times out, audits the existing execution machinery against 20 safety criteria,
and proposes a mission-/safety-critical execution architecture that reuses the
existing gateway (no second orchestrator, no second resolver, no naive global
Schedule Trigger).

---

## 1. Root cause (demonstrated, with live evidence)

Pipeline for a message that needs semantic resolution:

```
UI (HermesPanel.send)
 → submitHermesMessageAction (server action)
 → orchestrateHermesMessage
 → RPC hermes_os.orchestrate_hermes_message
 → SEMANTIC PATH: request_agent_action('hermes.intent.resolve', …)  → QUEUED
 → [executor: n8n "GW Consumer — Hermes Semantic Resolver" IS1I8g0K8VXbm4oH]
 → *** consumer INACTIVE by design (manual trigger, no Schedule Trigger) ***
 → nothing claims the QUEUED row → it never reaches a terminal status
 → UI polls get_agent_action_result for ~60 s → honest TIMEOUT
 → apply_hermes_resolution is never reached (only runs on SUCCEEDED)
```

**Failed/delayed step:** the asynchronous execution of `hermes.intent.resolve`.
The request is enqueued correctly; there is simply **no active executor**
draining the queue.

**Live evidence (read-only, this project `smubxqorirlfldatzmym`):**

- `hermes_os.agent_action_requests` holds **4 `hermes.intent.resolve` rows in
  `QUEUED`**, oldest `2026-08-10`, newest `2026-08-12 15:03` (the operator's own
  test). None have been claimed.
- No `pg_cron`, no `pg_net`, no `http` extension installed → there is **no
  in-database scheduler / outbound-HTTP mechanism**; any driver must be n8n-side
  or external.

This is category **F** (an executor never returns a terminal state because the
async consumer is inactive). It is **not** a frontend defect, **not** a false
timeout of a completing backend, **not** a correlation bug. The frontend is
already honest — it never fakes success.

---

## 2. Audit (ÉTAPE 1) — 20 criteria, evidence-classified

Legend: `VERIFIED_EXISTING` / `PARTIAL` / `MISSING` / `UNSAFE` / `DUPLICATED` /
`UNAVAILABLE`.

| # | Criterion | Verdict | Evidence / notes |
|---|-----------|---------|------------------|
| 1 | n8n workflow exists | **VERIFIED_EXISTING** | `n8n/hermes-semantic-resolver.workflow.js`, deployed `IS1I8g0K8VXbm4oH`. Claim → OpenAI `gpt-5.4-nano` structured proposal → `complete_agent_action`. |
| 2 | Current trigger | **PARTIAL (by design)** | Manual trigger only, **no Schedule Trigger** → never drains the queue. This is the whole problem. |
| 3 | Claim of QUEUED requests | **VERIFIED_EXISTING** | `hermes_os.claim_agent_action(action_key, lease_seconds)` selects `QUEUED` **or** `RUNNING` with expired lease. |
| 4 | Concurrency lock | **VERIFIED_EXISTING** | `for update skip locked … limit 1` → atomic single-winner claim; two workers cannot claim the same row. |
| 5 | Idempotence (enqueue) | **VERIFIED_EXISTING** | `request_agent_action`: `insert … on conflict (tenant_id, request_id) do nothing`; `UNIQUE (tenant_id, request_id)`; payload SHA-256 → `IDEMPOTENCY_CONFLICT` on same id/different payload, `IDEMPOTENT_HIT` (replay) on same. |
| 6 | request_id correlation | **VERIFIED_EXISTING** | `request_id` non-null, 1..200 chars, unique per tenant; carried through claim/complete/audit. |
| 7 | resolve_id correlation | **VERIFIED_EXISTING** | `resolve_id = <conv>::text ':resolve:' <user_msg>::text` — deterministic per user message; `apply_hermes_resolution` re-reads by `request_id = resolve_id AND tenant AND user AND action_key = 'hermes.intent.resolve'`. |
| 8 | Tenant isolation | **VERIFIED_EXISTING** | Enqueue resolves tenant server-side (`resolve_active_tenant`), never client-supplied; apply runs as the authenticated user; consumer only proposes. |
| 9 | User isolation | **VERIFIED_EXISTING** | `user_id := auth.uid()` on enqueue & apply; resolver never elevates. |
| 10 | Permissions | **VERIFIED_EXISTING** | Enqueue checks `user_tenant_permissions` for `required_permission` (`tenant.member` for resolve). |
| 11 | Gateway reuse | **VERIFIED_EXISTING** | Single gateway (`request/claim/complete_agent_action`); resolver is one consumer among BTP planning/suivi/diag. |
| 12 | SW15 / policy | **VERIFIED_EXISTING** | Resolve is `is_sensitive=false` (proposal only). The **real** action proposed is re-validated and executed by `apply_hermes_resolution` through the gateway, which enforces SW15 on the actual (possibly sensitive) capability. Resolver cannot grant permissions. |
| 13 | Retry | **PARTIAL** | Provider-level retry only (OpenAI node `maxRetries: 2`, `timeout: 30000`). No queue-level bounded retry; a hard worker crash relies on lease-expiry reclaim (see #18). |
| 14 | Backoff | **MISSING** | No backoff column / no `next_visible_at`; reclaim is immediate once the lease expires. |
| 15 | Timeout | **PARTIAL** | Provider timeout 30 s; DB lease 300 s (claim passes `300`). Lease (300 s) > max provider work (~30 s ×3) → no premature reclaim in the normal case. UI poll window ~60 s. |
| 16 | Terminal state | **VERIFIED_EXISTING** but **UNSAFE guard** | `complete_agent_action` accepts only `SUCCEEDED`/`FAILED`. **However the update is `where id = p_id` with NO status/lease fence** — a lease-stolen or duplicate worker can overwrite an already-terminal row (double-completion / lost update). See §3, Fix A. |
| 17 | DLQ / dead-letter | **MISSING** | No `DEAD_LETTER` status, no `max_attempts`. `attempts` increments on each (re)claim but nothing caps it → a poison request that repeatedly crashes the worker mid-run would be reclaimed indefinitely. |
| 18 | Recovery after interruption | **PARTIAL** | Lease-expiry reclaim recovers orphaned `RUNNING` (claim also targets `RUNNING` with `lease_expires_at < now()`), preserving `request_id` and `attempts`. Gaps: unbounded reclaim (no #17 cap) and unfenced completion (#16). |
| 19 | Observability SW12 | **PARTIAL** | `_agent_action_audit` records `QUEUED`, `CLAIMED`, `SUCCEEDED`, `FAILED`, and validation/authz rejections. No explicit `RETRY`/`DEAD_LETTER` events (they don't exist yet). |
| 20 | Cost / SW23 | **PARTIAL / MISSING** | Resolver calls OpenAI `gpt-5.4-nano` directly from n8n. There is **no node writing that spend into the SW23 cost ledger**, so resolver LLM cost is not governed/tracked in-app. |

**Net:** the queue core (idempotent enqueue, atomic claim, lease-based reclaim,
tenant/permission enforcement, audit) is already **solid and safe**. The gaps
are: (2) no active driver, (16) unfenced completion, (17) no DLQ cap, (14)
no backoff, (20) resolver cost not recorded.

---

## 3. Proposed safe fixes (REVIEW ONLY — not applied)

These reuse the existing gateway; they add **no** second orchestrator/resolver.
All are additive and backward-compatible. They alter **shared** control-plane
functions, so they MUST be validated on staging and applied under authorization.

### Fix A — Fence `complete_agent_action` (concurrency-safe terminal write)

Prevent a stale/duplicate worker (after lease-steal) from overwriting a row that
is no longer the one it holds. Add a status **and** execution-id fence:

```sql
-- PROPOSED — do not apply without staging validation + authorization.
create or replace function hermes_os.complete_agent_action(
  p_id uuid, p_status text, p_result jsonb default null,
  p_error jsonb default null, p_execution_id text default null)
returns jsonb  -- return whether this call was the winner (was: void)
language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $fn$
declare v_row hermes_os.agent_action_requests%rowtype;
begin
  if p_status not in ('SUCCEEDED','FAILED') then
    raise exception 'complete_agent_action: invalid terminal status %', p_status;
  end if;
  update hermes_os.agent_action_requests
     set status = p_status, result = p_result, error = p_error,
         workflow_execution_id = coalesce(p_execution_id, workflow_execution_id),
         finished_at = now(), lease_expires_at = null, updated_at = now()
   where id = p_id
     and status = 'RUNNING'            -- fence: only the active runner may complete
   returning * into v_row;
  if v_row.id is null then
    -- already terminal or reclaimed by another worker: no-op, audited, not fatal
    perform hermes_os._agent_action_audit(null,null,null,null,null,
      'COMPLETE_IGNORED', jsonb_build_object('id',p_id,'attempted_status',p_status));
    return jsonb_build_object('completed', false, 'reason', 'NOT_RUNNING');
  end if;
  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id,
    v_row.action_key, v_row.request_id, v_row.correlation_id, p_status,
    jsonb_build_object('execution_id', p_execution_id));
  return jsonb_build_object('completed', true);
end;
$fn$;
```

Compatibility: existing consumers call it as `select … as done` and ignore the
return, so widening `void → jsonb` is safe. Behaviour changes only in the racy
case (late/duplicate completion becomes a no-op instead of a silent overwrite).

### Fix B — Bounded reclaim + dead-letter (poison-pill cap)

Add a max-attempts cap so a request that repeatedly crashes its worker is parked
in a dead-letter terminal state instead of being reclaimed forever.

```sql
-- PROPOSED — additive column + guarded reclaim. Not applied.
alter table hermes_os.agent_action_requests
  add column if not exists max_attempts integer not null default 5;

-- claim_agent_action: when a RUNNING+expired row has attempts >= max_attempts,
-- mark it FAILED with a DEAD_LETTER error instead of re-claiming it, and skip.
-- (Full function shown in the PR discussion; the change is a guarded branch
--  before the RUNNING re-claim, writing error = {code:'DEAD_LETTER'} and a
--  'DEAD_LETTER' audit event, so the UI reflects an honest terminal FAILED.)
```

`DEAD_LETTER` is surfaced as a terminal `FAILED` (no new UI status needed);
`apply_hermes_resolution` already turns a non-`SUCCEEDED` resolve into a
fail-closed `ERROR`.

### Fix C — Record resolver cost in SW23 (governance)

Add one node in the resolver workflow, after the model call, that writes the
token usage / cost into the existing SW23 cost-event ledger via the existing
cost-recording RPC (no second cost engine). Requires confirming the exact
SW23 ingest function name on the live project before wiring.

---

## 4. Execution driver — the actual "make it run" (choose under authorization)

No `pg_cron`/`pg_net` exists, so the driver is n8n-side or external. Ranked by
safety-with-the-existing-design:

1. **Bounded n8n Schedule Trigger on the resolver (RECOMMENDED).**
   Replace the manual trigger with a Schedule Trigger (e.g. every 15–30 s) that,
   per tick, loops `claim_agent_action('hermes.intent.resolve', 300)` up to a
   small batch cap (e.g. 5) and stops when `claimed=false`. The atomic
   `skip locked` claim already guarantees single-winner even if two ticks
   overlap. This is **not** the "naive global Schedule Trigger" — it is bounded,
   action-scoped, idempotent, lease-protected, and DLQ-capped (with Fix B).
   Guard-rails: batch cap, concurrency = 1 (n8n workflow setting), lease 300 s,
   max_attempts 5.

2. **External cron → n8n webhook.** Add a Webhook trigger; an external scheduler
   (e.g. a controlled GitHub Action) pings it on a cadence. More moving parts,
   same claim semantics. Only if n8n scheduling is undesirable.

3. **Event-driven (NOT available today).** Would need `pg_net`/`pg_cron` or a
   LISTEN/NOTIFY bridge — requires installing a privileged extension; out of
   scope and higher risk than (1).

**Do not** simply toggle a Schedule Trigger without Fix A + Fix B: without the
completion fence and the DLQ cap, an activated poller is exposed to
double-completion under lease-steal and to unbounded reclaim of a poison request.

---

## 5. Timeout — no arbitrary bump

The frontend poll window (~60 s) is **not** the bug and must not be inflated to
mask it. Once a driver produces a terminal state within the lease window, the UI
reflects it as-is. (PR #20 already makes the UI reflect the real `QUEUED`/
`RUNNING` status and an honest "queued, not yet processed" timeout message.)

---

## 6. Security invariants (must remain true after any change)

- Resolver **proposes only**; `apply_hermes_resolution` re-validates against the
  catalog and executes via the gateway → permissions, tenant, SW15 enforced on
  the real action. No path lets the resolver grant itself capability/permission.
- Tenant/user isolation preserved (server-side tenant resolution; apply as the
  authenticated user).
- No service_role secret reaches the browser; the consumer runs server-side.
- No second orchestrator, no second resolver, no direct-to-n8n button.

---

## 7. Real E2E test plan (BLOCKED until authorized — see §8)

To be run **only** on a safe target with explicit authorization; **no mock is
accepted as final proof**:

1. Real semantic message → real `hermes.intent.resolve` QUEUED.
2. Driver claims it (RUNNING, attempts=1, lease set).
3. Model proposes; `complete_agent_action(SUCCEEDED)`.
4. `apply_hermes_resolution` re-validates + executes via gateway.
5. Result surfaces in `HermesPanel` with the real request_id preserved.

Negative / resilience:
6. **Double submit** (same message) → single row (idempotent replay).
7. **Double claim** (two ticks) → single winner (`skip locked`).
8. **Wrong tenant** → apply returns NOT_FOUND (scoped read).
9. **Permission denied** → enqueue `UNAUTHORIZED` (real action requiring a
   permission the user lacks).
10. **Provider timeout** → agent `onError` → `FAILED` terminal → apply ERROR.
11. **Permanent failure / poison** → attempts reach `max_attempts` → DLQ FAILED
    (with Fix B), never infinite reclaim.
12. **Worker crash mid-run** → lease expires → reclaim → single terminal
    (with Fix A, no double-completion).

Fixtures created for tests must be cleaned up (tenant-scoped test rows).

---

## 8. BLOCKED_EXTERNAL — what is required from a human

Two independent hard blockers prevent completing the *real* E2E in this session:

1. **No authenticated session.** The true path requires an authenticated user
   (`orchestrate_hermes_message`/`apply_hermes_resolution` both use
   `auth.uid()`), and GoTrue on this project has email confirmation on with no
   self-serve path. Per standing rules there is **no auth bypass**, so the real
   UI→enqueue→apply path cannot be exercised from here.

2. **No authorized/safe target for production-mutating, real-cost, go-live
   actions.** Draining the queue means executing a production n8n workflow with
   real OpenAI spend and service_role writes to a live multi-tenant ledger, and
   applying shared control-plane migrations (Fix A/B) — with no staging project
   available. The operator explicitly required STOP-before-activation, the
   mechanism/guardrails/cost first, and `GO-LIVE ENABLED = NO`.

**USER ACTION REQUIRED (pick and authorize):**
- Provide a **staging** Supabase project + n8n instance for validation, **or**
  explicitly authorize a **controlled** run on production with: (a) permission
  to apply Fix A + Fix B first, (b) permission to activate the bounded Schedule
  driver §4-(1) at a stated cadence, (c) an accepted OpenAI cost ceiling for the
  test batch, (d) a designated **test tenant/user** whose queued rows may be
  processed (the 4 currently-QUEUED rows belong to real conversations and must
  not be drained without owner consent), and (e) confirmation of the SW23 cost
  ingest function name for Fix C.
- Also confirm whether a real authenticated test session can be provisioned
  (e.g. a confirmed test account) so the end-to-end UI path can be exercised.

Until then this remains audit + design; nothing is activated.
