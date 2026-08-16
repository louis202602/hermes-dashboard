# E2E Production Validation — Hermès OS Command Center

**Phase:** E2E PRODUCTION VALIDATION (control plane + agent-action chains)
**Scope:** Prove real, complete request chains — UI → Server Action → RPC → control
plane → consumer/agent → result → dashboard read — correlated by
`request_id` / `tenant_id` / real result. No mocks.
**Method:** Real production DB functions, exercised as the authenticated tenant
member/admin (JWT claims set server-side) and as the consumer role. Every write
scenario ran inside a transaction that was **rolled back** (`RAISE EXCEPTION`
surface-and-abort) → **zero residue**.
**Safe target only:** tenant `heliosolar` (sole populated tenant, single user who
holds `tenant.admin` + `tenant.member`), action `diag.echo` (non-sensitive echo)
and the catalog `btp.qualification.create` (sensitive) for the approval path. No
other real client tenant was touched.
**Standing rules honored:** 0 LLM · 0 external paid API · 0 polling · 0 schedulers ·
0 new table/RPC/bucket · dashboard untouched · no fabricated data or provenance.
**GO_LIVE = NO.**

---

## Control-plane architecture (as verified)

```
UI / Server Action
   │  public.request_agent_action(action_key, payload, request_id)   [SECURITY DEFINER facade]
   ▼
hermes_os.request_agent_action  ── fail-closed gate ──────────────────────────────┐
   1 auth.uid() present?              → else UNAUTHENTICATED                        │
   2 resolve_active_tenant(null)=OK?  → else TENANT_UNRESOLVED (server-derived)     │
   3 request_id 1..200 chars?         → else VALIDATION_FAILED                      │
   4 action in catalog AND enabled?   → else UNKNOWN_ACTION                         │
   5 caller holds required_permission → else UNAUTHORIZED                           │
   6 payload is object, <100KB, keys  → else VALIDATION_FAILED                      │
   7 INSERT ... ON CONFLICT (tenant_id, request_id) DO NOTHING  (payload_hash)      │
        • fresh          → status QUEUED                                            │
        • same rid+hash  → IDEMPOTENT_HIT (replay=true, returns existing status)    │
        • same rid ≠hash → IDEMPOTENCY_CONFLICT                                     │
   ▼                                                                                │
[QUEUED] ──► consumer (n8n GW): claim_agent_action(action_key, lease_seconds)       │
   │            → status RUNNING, lease_token, lease_expires_at, attempts++          │
   │         record_agent_action_policy(id, decision, reason)   [SW11/SW15 gate]     │
   │            DENY            → POLICY_DENIED (terminal)                            │
   │            REQUIRE_APPROVAL→ PENDING_APPROVAL ──► human admin:                   │
   │                                approve_agent_action  → QUEUED (re-executes)      │
   │                                reject_agent_action   → REJECTED (terminal)       │
   │         complete_agent_action(id, SUCCEEDED|FAILED, result, error, exec, token)  │
   │            guarded by (status=RUNNING AND lease_token matches) → else IGNORED    │
   ▼                                                                                │
[SUCCEEDED | FAILED | POLICY_DENIED | REJECTED]                                      │
   ▲                                                                                │
   └── dashboard read: public.get_agent_action_result(request_id) ──────────────────┘
        tenant-scoped; returns status, correlation_id, policy_decision, result, error
   timeout recovery: expired-lease RUNNING rows are re-claimable (attempts<max=5);
   exhausted rows → reap_dead_letter_agent_actions(action_key, limit)
```

All control-plane functions are `SECURITY DEFINER` with a pinned
`search_path = hermes_os, pg_catalog, pg_temp`, derive the tenant server-side via
`resolve_active_tenant(null)` (never trust a client-supplied tenant), and audit
every transition into `hermes_os.agent_action_audit`.

---

## Results — 8 chains, all PASS

Each row is a real function-call chain; every write rolled back.

| # | Chain | Correlation proof | Result | Verdict |
|---|-------|-------------------|--------|---------|
| **A** | Authorized `diag.echo`: submit → claim → complete SUCCEEDED → read | `correlation_id` identical from submit through result; payload echoed (`hello-A`) | `QUEUED → RUNNING → SUCCEEDED` | ✅ PASS |
| **B** | Denied inputs | — | `UNKNOWN_ACTION` (not allowlisted), `UNAUTHENTICATED` (no uid), `UNAUTHORIZED` (missing admin on approve) | ✅ PASS |
| **C** | Approval approve **and** reject | `PENDING_APPROVAL` listed by `list_pending_agent_approvals`; decisions audited | member submit `QUEUED` → policy `REQUIRE_APPROVAL` → `PENDING_APPROVAL`; member-only approve → `UNAUTHORIZED`; admin approve → `QUEUED`; reject w/o reason → `VALIDATION_FAILED`; admin reject → `REJECTED` | ✅ PASS |
| **D** | Idempotence / replay | same `request_id` | same rid+payload → `replay=true`, same status; same rid + different payload → `IDEMPOTENCY_CONFLICT` | ✅ PASS |
| **E** | Cross-tenant isolation | non-owner subject | `resolve_active_tenant` returns no tenant → `NO_TENANT`; **no result content leaked** across tenants | ✅ PASS |
| **F** | Failure | `request_id` | worker `FAILED` with `error.code=WORKER_ERROR` surfaced to reader; consumer `DENY` → `POLICY_DENIED` (fail-closed terminal) | ✅ PASS |
| **G** | Timeout / recovery + anti-double-execution | `lease_token` | A claims (attempts 1) → lease expires → B re-claims same row (attempts 2, distinct token); **A's stale-token completion IGNORED** (row stays `RUNNING`); B completes → `SUCCEEDED`, winner=B → `no_double_exec=true` | ✅ PASS |
| **H** | Refresh / reprise | same `request_id` | a re-submitted `request_id` returns the existing row (`replay=true`) instead of re-enqueuing — a page refresh cannot double-execute (covered by D's idempotency contract) | ✅ PASS |

### Zero residue (verified after every scenario)
`total agent_action_requests = 5` (unchanged — only the pre-existing live QUEUED
rows), `request_id LIKE 'e2e-%'` count = **0**, audit rows for `e2e-%` = **0**,
admin grant intact, no synthetic permission rows left.

---

## Execution-layer status (honest)

- The only agent-action **consumer** present is **`GW Consumer — BTP Planning`**
  (n8n id `2MMvwJ8zb3jBftDi`), which is **INACTIVE** (`active:false`,
  `triggerCount:0`) and scoped to `btp.planning.phase.add` only.
- Consequently, in the **live** environment nothing drains the queue automatically:
  the 5 real requests remain `QUEUED` and no request advances to `SUCCEEDED` on its
  own.
- The full execution lifecycle above (claim → policy → complete → reap, incl.
  success/failure/timeout) was therefore exercised by **driving the real
  consumer-side DB functions directly** — the exact functions the n8n consumer
  calls. **No `SUCCEEDED` state was fabricated through a fake path**, and every
  such write was rolled back. Live automated execution requires an **active
  consumer** for the piloted action(s) — an operational step, not a code change.

---

## Bugs found during E2E

**None (no correctness defect in the control plane).** The state machine is
fail-closed, idempotent, tenant-scoped, lease-guarded, and admin-gated for
approvals. Nothing required a code fix, so no code change was produced by this
phase (per the mandate: *fix only real bugs encountered*).

Two **non-defect observations** (documented, no action taken):

1. **`is_sensitive` is enforced by the consumer, not at request time.**
   `request_agent_action` enqueues every allowlisted action as `QUEUED`; the
   approval gate (`PENDING_APPROVAL`) is produced by the consumer via
   `record_agent_action_policy(..., 'REQUIRE_APPROVAL')` during SW11/SW15
   evaluation. This is by design (policy evaluation belongs to the consumer/SW15
   decision point, which is also the sole execution path). It does mean the
   approval gate depends on the consumer correctly invoking the policy function —
   relevant to consumer configuration review at pilot activation.
2. **Operational, not code:** the n8n gateway consumer is inactive (see above).

---

## Security advisors (post backend-hardening)

Supabase security advisor after the `20260816_backend_hardening_secfn` migration:

- `anon_security_definer_function_executable` (was MEDIUM) — **CLEARED**
  (anon EXECUTE revoked on `_resolver_operator_audit`).
- `function_search_path_mutable` (was LOW) — **CLEARED**
  (`search_path=''` pinned on the two `sw_*` helpers).
- Remaining are by-design or manual:
  - `rls_enabled_no_policy` ×121 (INFO) — deny-all facade tables (RLS on, access
    only via SECURITY DEFINER RPCs). Expected.
  - `authenticated_security_definer_function_executable` ×46 (WARN) — the RPC
    facades themselves; each self-gates on `auth.uid()` + tenant. Expected pattern.
  - `auth_leaked_password_protection` (WARN) — **MANUAL_PENDING**: enable
    HaveIBeenPwned leaked-password protection in Supabase → Auth → Providers /
    Password settings (a dashboard toggle; cannot be set via SQL/migration).
  - `extension_in_public` (WARN) — pre-existing, minor.

---

## Cost

0 LLM calls · 0 external paid API · 0 new tables / RPCs / buckets / schedulers ·
0 polling added. Validation was read/probe + rolled-back transactions only. No new
migration was required for this phase.

---

## READY_FOR_PILOT decision

**CONDITIONAL — GREEN on correctness, gated on two operational steps.**

The control-plane guarantees a pilot depends on are proven:
authentication & server-side tenant derivation, action allowlist, per-tenant
authorization, idempotency/replay, cross-tenant isolation, human approval
(approve+reject, admin-gated), failure/deny terminality, and timeout recovery with
anti-double-execution.

Before a live pilot, complete (operational, not code):

1. **Activate + monitor the n8n gateway consumer(s)** for each action the pilot
   will exercise (today only `btp.planning.phase.add` has a consumer, and it is
   inactive). Verify the consumer calls `record_agent_action_policy` so the SW15
   approval gate is live.
2. **Enable leaked-password protection** in Supabase Auth (dashboard toggle).

**GO_LIVE = NO** until the above are done and a live green run is observed for the
piloted action.
