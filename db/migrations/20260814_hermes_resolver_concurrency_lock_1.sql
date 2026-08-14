-- Migration: hermes_resolver_concurrency_lock (project smubxqorirlfldatzmym)
-- =====================================================================
-- E2.1 HARDENING — make max_concurrency atomic across CONCURRENT calls of
-- claim_semantic_resolver_batch. The E2.1 wrapper read the RUNNING count and
-- then claimed; two concurrent invocations could each observe free capacity
-- before their respective claims and transiently exceed the concurrency ceiling
-- (no double-claim — claim_agent_action uses FOR UPDATE SKIP LOCKED — but the
-- ceiling could be momentarily exceeded).
--
-- Fix: take a per-action, TRANSACTION-scoped advisory lock BEFORE the
-- "count RUNNING → compute remaining capacity → claim" section, so that section
-- is mutually exclusive between concurrent calls for the same action_key. The
-- lock is:
--   · transaction-scoped  → auto-released at commit/rollback (never leaks),
--   · acquired exactly once → no deadlock,
--   · per action_key       → distinct actions never block each other,
--   · taken AFTER the kill-switch check → a disabled resolver never contends.
--
-- Still reuses claim_agent_action (no second queue), preserves lease_token /
-- attempts / max_attempts / SKIP LOCKED, and stays fail-closed. Dormant: nothing
-- is activated. Reversible: ..._9_rollback.sql restores the E2.1 (pre-lock) body.
-- =====================================================================

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

  -- Kill-switch / fail-closed (BEFORE taking any lock).
  if not found then
    return jsonb_build_object('enabled', false, 'reason', 'NO_CONFIG',
      'claimed_count', 0, 'claims', v_claims);
  end if;
  if not v_cfg.enabled then
    return jsonb_build_object('enabled', false, 'reason', 'DISABLED',
      'claimed_count', 0, 'claims', v_claims);
  end if;

  -- Serialize the capacity decision across concurrent calls for THIS action.
  -- Transaction-scoped: released automatically at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('hermes_os.resolver_claim'), hashtext(p_action_key));

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
