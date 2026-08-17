# Pilot Activation Runbook — Event-Driven Agent-Action Execution (OVH self-hosted)

**Status:** `READY_FOR_PILOT = BLOCKED_EXTERNAL_N8N` · `GO_LIVE = NO`
**Reason blocked:** n8n **Cloud** production/trigger executions are `BLOCKED_BY_PLAN`
(execution quota reached — manual/editor runs still work, trigger runs are refused with
"Execution limit reached"). Decision: **do not upgrade n8n Cloud**; target platform is
**n8n self-hosted on OVH** (no Cloud execution quota).

Everything below is **validated and ready to activate** the moment n8n OVH is operational.
Until then, **no active event infrastructure is installed** (an active gateway on the Cloud plan
would fire on every QUEUED event and every production run would fail, accumulating broken
executions without draining the queue).

Standing rules preserved: **0 polling · 0 scheduler · 0 new LLM · 0 permanent idle cost ·
event is never an authority (claim/policy/tenant re-verified in DB).**

---

## Readiness snapshot (already PASS)

| Gate | State | Evidence |
|---|---|---|
| Event design (LISTEN/NOTIFY) | PASS | probe workflow received a real `pg_notify` (execution mode=trigger, payload delivered), then deactivated + archived |
| `lease_token` propagation | PASS (applied) | Diag Echo consumer proven live (worker A stale token ignored, worker B `SUCCEEDED`); BTP Suivi consumer patched (all 3 completion nodes) |
| Stale-completion rejected | PASS | old-token `complete_agent_action` ignored; result not overwritten |
| No double execution | PASS | claim `FOR UPDATE SKIP LOCKED` + `UNIQUE(tenant_id, request_id)` |
| Policy / approval (SW15) | PASS | `gateway_policy_gate` → `REQUIRE_APPROVAL` → `PENDING_APPROVAL` → admin approve → `PERMIT` (rolled-back test) |
| Cross-tenant isolation | PASS | server-derived tenant; no result leak |
| Polling / DB reads at rest | 0 / 0 | no poller; LISTEN connection is idle until NOTIFY |
| Product-code / control-plane ready | YES | 8/8 control-plane chains PASS (see `docs/e2e-production-validation.md`) |

---

## Target architecture (validated)

```
UI / Server Action  →  request_agent_action()  →  agent_action_requests.status = QUEUED
                                                        │  (INSERT, or UPDATE after approval)
                                                        ▼
                                    DB trigger  →  pg_notify('hermes_agent_action_queued', {action_key,...})
                                                        │   (event = wake signal + routing hint ONLY)
                                                        ▼
                        n8n gateway  (postgresTrigger, listen mode — idle until NOTIFY)
                                                        │  Switch on payload.action_key
                                                        ▼
                        consumer sub-workflow  →  claim_agent_action  (authority: FOR UPDATE SKIP LOCKED)
                                                  →  gateway_policy_gate  (SW15: PERMIT / DENY / REQUIRE_APPROVAL)
                                                  →  business execution (only if PERMIT)
                                                  →  complete_agent_action(..., lease_token)  (anti-stale guard)
                                                  →  audit
```

**Why LISTEN/NOTIFY (not webhook / not pg_net):** no public HTTP endpoint to secure, no
`pg_net` extension, no polling. The n8n `postgresTrigger` holds one idle LISTEN connection
(0 queries at rest) and wakes only on a real QUEUED transition.

---

## Activation steps at OVH cutover (in order)

### Step 1 — DB notify function + triggers (INSERT and UPDATE→QUEUED)

Covers both paths: direct enqueue (`INSERT ... status=QUEUED`) **and** post-approval resumption
(`PENDING_APPROVAL → APPROVED → QUEUED`, an UPDATE). Ship as a versioned migration
`db/migrations/YYYYMMDD_agent_action_queued_notify_1.sql`.

```sql
-- Fire a NOTIFY whenever a request enters QUEUED. Payload is a routing hint only —
-- never an authority. The consumer always re-runs claim → policy → execute → complete.
create or replace function hermes_os.notify_agent_action_queued()
returns trigger
language plpgsql
security definer
set search_path = 'hermes_os', 'pg_catalog', 'pg_temp'
as $fn$
begin
  perform pg_notify(
    'hermes_agent_action_queued',
    json_build_object(
      'id',         new.id,
      'request_id', new.request_id,
      'tenant_id',  new.tenant_id,
      'action_key', new.action_key
    )::text
  );
  return new;
end;
$fn$;

-- INSERT that lands directly in QUEUED
create trigger trg_agent_action_queued_insert
  after insert on hermes_os.agent_action_requests
  for each row when (new.status = 'QUEUED')
  execute function hermes_os.notify_agent_action_queued();

-- UPDATE transitioning INTO QUEUED (e.g. after human approval)
create trigger trg_agent_action_queued_update
  after update on hermes_os.agent_action_requests
  for each row when (new.status = 'QUEUED' and old.status is distinct from 'QUEUED')
  execute function hermes_os.notify_agent_action_queued();
```

Rollback (`..._9_rollback.sql`):

```sql
drop trigger if exists trg_agent_action_queued_update  on hermes_os.agent_action_requests;
drop trigger if exists trg_agent_action_queued_insert  on hermes_os.agent_action_requests;
drop function if exists hermes_os.notify_agent_action_queued();
```

**NOTIFY channel:** `hermes_agent_action_queued`
**Cost:** fires only on the QUEUED transition (a genuine event); negligible per-row overhead; 0 at rest.

### Step 2 — n8n gateway workflow (single shared dispatcher)

Create one workflow (self-hosted n8n):

- **Trigger:** `n8n-nodes-base.postgresTrigger`, `triggerMode: listenTrigger`,
  `channelName: hermes_agent_action_queued`, Postgres credential = the Hermès DB
  (session-mode connection — LISTEN confirmed working).
- **Route:** `Switch` on `{{ $json.payload.action_key }}` (the trigger delivers
  `{ channel, payload: { action_key, request_id, tenant_id, id }, ... }`).
- **Per case:** `Execute Sub-workflow` → the matching consumer (table below).
- Consumers keep their existing `claim → (policy) → execute → complete(lease_token)` chain.
  At cutover, give each consumer an `executeWorkflowTrigger` entry node so the gateway can call it.

**Safety:** the payload's `action_key` only *routes*. If it is wrong/duplicated/spoofed, the
targeted consumer's `claim_agent_action('<its own action>')` finds no matching QUEUED row →
`claimed=false` → No Work → no effect. The DB `claim` is the single source of truth.

**Alternative (even simpler, if a Switch is undesirable):** on any NOTIFY, call each pilot
consumer once; each claims only its own action. Slightly more executions per event but zero
trust in the payload. Prefer the Switch for efficiency during the pilot.

### Step 3 — action_key → consumer mapping (pilot scope)

| action_key | consumer workflow | n8n id | lease_token | pilot |
|---|---|---|---|---|
| `diag.echo` | GW Consumer — Diag Echo | `6687hzOPQ27an2J6` | ✅ fixed + proven | ✅ include (no business effect) |
| `btp.suivi.progress.report` | GW Consumer — BTP Suivi | `1xCiexp3oVj0R8Tk` | ✅ fixed (patched) | ✅ include (sensitive, lowest risk) |
| `btp.planning.phase.add` | GW Consumer — BTP Planning | `2MMvwJ8zb3jBftDi` | ⚠️ apply same fix before use | ⏸ later |
| `hermes.intent.resolve` | GW Consumer — Hermes Semantic Resolver | `IS1I8g0K8VXbm4oH` | n/a | ❌ out of scope (LLM cost) |
| `btp.qualification.create` | — (no consumer) | — | — | ❌ no consumer; build only if the pilot needs it |

`lease_token` fix = pass the claim's `lease_token` as the 6th arg to
`complete_agent_action($1,STATUS,$2,$3,$4,$5::uuid)` on **every** completion node, sourced from
`$('Claim <X>').item.json.claim.lease_token`. Already done on Diag Echo and BTP Suivi.

### Step 4 — SW15 REQUIRE_APPROVAL policy for the sensitive pilot action

`gateway_policy_gate` defaults to **PERMIT** when no policy matches. For a real sensitive pilot,
add an explicit policy so the action is gated to human approval. **Not yet persisted** (kept the
live tenant on default behavior until GO). Apply at cutover:

```sql
insert into hermes_os.sw15_policies
  (policy_name, tenant_id, action_pattern, effect, status, priority)
values
  ('Pilot approval gate — BTP', 'heliosolar', 'btp.*', 'REQUIRE_APPROVAL', 'ACTIVE', 500);
```

Rollback: `update hermes_os.sw15_policies set status='INACTIVE' where policy_name='Pilot approval gate — BTP' and tenant_id='heliosolar';`

Proven flow (rolled-back test): submit → `QUEUED`; gate#1 → `REQUIRE_APPROVAL` → `PENDING_APPROVAL`
(approval request created, business step skipped); admin `approve_agent_action` → `QUEUED`;
gate#2 → `PERMIT` (executes only after human approval). Reject path → `REJECTED` (admin-gated,
reason required).

---

## Post-cutover verification checklist (must all PASS before GO_LIVE)

1. **Diag auto E2E (no manual n8n run):** `request_agent_action('diag.echo', …)` → confirm the
   gateway fired automatically → `get_agent_action_result` = `SUCCEEDED`. Record
   `REQUEST_ID / N8N_EXECUTION_ID / CORRELATION_ID / FINAL_STATE`.
2. **Sensitive auto E2E:** submit `btp.suivi.progress.report` → `PENDING_APPROVAL` → admin approve
   → UPDATE→QUEUED fires the gateway automatically → policy `PERMIT` → terminal state. Prove
   `APPROVAL_REQUIRED=YES`, `MANUAL_CONSUMER_START=NO`, `LEASE_TOKEN_USED=YES`.
3. **Duplicate-event test:** replay two NOTIFYs for one request → exactly one claim, one execution,
   one completion (`NO_DOUBLE_EXECUTION=YES`).
4. **Lease recovery on the real consumer:** worker A claim → lease expire → gateway reclaim
   (worker B) → A completes with old token ⇒ rejected; B completes ⇒ `SUCCEEDED`.
5. **Cost at rest:** `POLLING_AT_REST=0`, `SCHEDULES=0`, `DB_READS_AT_REST=0`,
   `N8N_EXECUTIONS_IDLE=0` (only the idle LISTEN connection).
6. **Security:** no public endpoint; payload used for routing only; `action_key`/tenant re-verified
   in DB; retries bounded (`max_attempts=5`); logs carry no secrets.

Flip `READY_FOR_PILOT → YES` only when 1–6 pass and `BLOCKERS/HIGH/MEDIUM = 0`.
`GO_LIVE` remains a separate, explicit human decision.

---

## Do NOT (cost-first guardrails)

- No Schedule Trigger / polling of `agent_action_requests`.
- No `pg_net` / public webhook unless LISTEN/NOTIFY is proven unavailable on the OVH DB connection.
- No new LLM in the pilot path (`hermes.intent.resolve` stays out of scope).
- No always-on workflow other than the single idle-LISTEN gateway.
- No new table / RPC / bucket beyond the notify trigger above.
