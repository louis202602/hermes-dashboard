-- Migration: hermes_resolver_runtime_safety (project smubxqorirlfldatzmym)
-- =====================================================================
-- E2.1 — SAFETY PRIMITIVES for a future, controlled go-live of the Hermès
-- Semantic Resolver. This migration is DORMANT: it activates NOTHING. It only
-- provisions the guards a bounded driver will later honour.
--
--   1. hermes_os.resolver_runtime_config — a canonical per-action runtime
--      registry with a first-class DB kill-switch (`enabled`), bounded batch and
--      concurrency, and cadence. Seeded for `hermes.intent.resolve` with SAFE,
--      NON-PERMISSIVE defaults (enabled = FALSE).
--   2. hermes_os.claim_semantic_resolver_batch(...) — a fail-closed wrapper that
--      REUSES the existing `claim_agent_action` (never a second queue engine).
--      It refuses to claim anything while the kill-switch is off, and otherwise
--      claims at most `max_batch`, bounded by `max_concurrency` against the
--      currently-leased RUNNING set. Lease token + attempts are preserved by the
--      underlying claim.
--   3. A bounded SW23 budget for `heliosolar` (daily + monthly + hard_stop) so
--      the resolver can never run an unbounded, costly loop. Uses the canonical
--      SW23 budget table — NO second cost engine.
--
-- The n8n consumer stays INACTIVE, no Schedule is created, no row is claimed,
-- no model is called. Reversible: ..._9_rollback.sql.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Runtime config + DB kill-switch. RLS enabled with NO policy ⇒ deny-all for
--    ordinary roles; reached only by the SECURITY DEFINER wrapper (and the
--    service_role driver, which the wrapper runs under). Fail-closed defaults.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.resolver_runtime_config (
  action_key       text primary key,
  enabled          boolean not null default false,
  max_batch        integer not null default 3   check (max_batch between 1 and 100),
  max_concurrency  integer not null default 1   check (max_concurrency between 1 and 50),
  cadence_seconds  integer not null default 60  check (cadence_seconds between 10 and 3600),
  notes            text,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

alter table hermes_os.resolver_runtime_config enable row level security;

-- Canonical, SAFE, DORMANT row for the semantic resolver (kill-switch OFF).
insert into hermes_os.resolver_runtime_config
  (action_key, enabled, max_batch, max_concurrency, cadence_seconds, notes, updated_by)
values
  ('hermes.intent.resolve', false, 3, 1, 60,
   'E2.1 dormant defaults — driver honours this before any claim/model call.',
   'migration:hermes_resolver_runtime_safety')
on conflict (action_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fail-closed batch-claim wrapper. Reuses claim_agent_action (no second
--    queue). Returns the claims so a bounded driver can process them. The
--    kill-switch (enabled=false), unknown action, and concurrency saturation all
--    yield ZERO claims. Never bypasses the underlying lease/attempts machinery.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.claim_semantic_resolver_batch(
  p_action_key text default 'hermes.intent.resolve',
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cfg     hermes_os.resolver_runtime_config%rowtype;
  v_running integer;
  v_batch   integer;
  v_lease   integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
  v_claim   jsonb;
  v_claims  jsonb := '[]'::jsonb;
  v_i       integer := 0;
begin
  select * into v_cfg
    from hermes_os.resolver_runtime_config
   where action_key = p_action_key;

  -- Kill-switch / fail-closed: no config or disabled ⇒ claim nothing.
  if not found then
    return jsonb_build_object('enabled', false, 'reason', 'NO_CONFIG',
      'claimed_count', 0, 'claims', v_claims);
  end if;
  if not v_cfg.enabled then
    return jsonb_build_object('enabled', false, 'reason', 'DISABLED',
      'claimed_count', 0, 'claims', v_claims);
  end if;

  -- Concurrency bound: how many are currently leased+RUNNING for this action.
  select count(*) into v_running
    from hermes_os.agent_action_requests
   where action_key = p_action_key
     and status = 'RUNNING'
     and lease_expires_at is not null
     and lease_expires_at > now();

  v_batch := least(v_cfg.max_batch, greatest(v_cfg.max_concurrency - v_running, 0));
  if v_batch <= 0 then
    return jsonb_build_object('enabled', true, 'reason', 'CONCURRENCY_SATURATED',
      'running', v_running, 'max_concurrency', v_cfg.max_concurrency,
      'claimed_count', 0, 'claims', v_claims);
  end if;

  -- Claim up to the bounded batch through the canonical primitive.
  while v_i < v_batch loop
    v_claim := hermes_os.claim_agent_action(p_action_key, v_lease);
    exit when coalesce((v_claim->>'claimed')::boolean, false) = false;
    v_claims := v_claims || jsonb_build_array(v_claim);
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object('enabled', true, 'reason', 'OK',
    'running_before', v_running, 'batch_limit', v_batch,
    'claimed_count', v_i, 'claims', v_claims);
end;
$function$;

revoke all on function hermes_os.claim_semantic_resolver_batch(text, integer) from public;
grant execute on function hermes_os.claim_semantic_resolver_batch(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Bounded SW23 budget for heliosolar (canonical table — no second engine).
--    hard_stop = true so an over-budget reserve is DENIED before any model call.
--    Conservative: at ~$0.0011 / resolve, $1/day ≈ 900 resolves; per-request cap
--    guards a single runaway call. Idempotent — never overwrites an operator's
--    existing budget.
-- ---------------------------------------------------------------------------
insert into hermes_os.sw23_tenant_budget_config
  (tenant_id, daily_budget_usd, monthly_budget_usd, per_request_budget_usd, alert_threshold_pct, hard_stop)
values
  ('heliosolar', 1.00, 10.00, 0.05, 80, true)
on conflict (tenant_id) do nothing;

commit;
