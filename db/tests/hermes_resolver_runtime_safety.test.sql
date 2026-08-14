-- Reproducible safety assertions for E2.1 (resolver runtime config + kill-switch
-- + batch wrapper + SW23 budget). These are the EXACT checks run live against
-- project smubxqorirlfldatzmym, all inside a ROLLED-BACK transaction so nothing
-- persists and the real QUEUED gateway rows are never claimed or mutated.
--
-- The ENABLED-path assertions use SYNTHETIC action_keys ('e2e.batch','e2e.conc')
-- with their own catalog + config + fixture rows, so the real
-- 'hermes.intent.resolve' queue is only ever exercised on the DISABLED (fail-
-- closed) path. Substitute a real tenant.member uuid for :member before running.
--
-- Run (psql): \i db/tests/hermes_resolver_runtime_safety.test.sql

\set member '00000000-0000-0000-0000-000000000000'

begin;

create function pg_temp.e21() returns jsonb language plpgsql as $$
declare out jsonb:='{}'::jsonb; r jsonb; m text:=current_setting('hermes.test_member', true);
  real_before int; real_after int; n int;
begin
  -- A) kill-switch OFF by default for the real resolver
  out:=out||jsonb_build_object('A_disabled_default',
    (select not enabled from hermes_os.resolver_runtime_config where action_key='hermes.intent.resolve'));  -- expect true

  select count(*) into real_before
    from hermes_os.agent_action_requests where action_key='hermes.intent.resolve' and status='QUEUED';

  -- B) DISABLED ⇒ claim DENIED on the real action_key (fail-closed)
  r:=hermes_os.claim_semantic_resolver_batch('hermes.intent.resolve', 300);
  out:=out||jsonb_build_object('B_reason', r->>'reason', 'B_count', r->>'claimed_count');  -- expect DISABLED / 0

  -- fixtures (catalog FK + config + queued rows)
  insert into hermes_os.agent_action_catalog(action_key,display_name)
    values ('e2e.batch','E2E batch'),('e2e.conc','E2E conc');

  -- C) MAX_BATCH: batch=2, concurrency=5, 3 fixtures ⇒ claim 2, leave 1
  insert into hermes_os.resolver_runtime_config(action_key,enabled,max_batch,max_concurrency,cadence_seconds)
    values ('e2e.batch',true,2,5,60);
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,updated_at)
    select gen_random_uuid(),'heliosolar',m::uuid,'e2e.batch','rb-'||g,'{"message":"x"}'::jsonb,'h'||g,'QUEUED',gen_random_uuid(),0,5,now()-(g||' seconds')::interval,now() from generate_series(1,3) g;
  r:=hermes_os.claim_semantic_resolver_batch('e2e.batch', 300);
  out:=out||jsonb_build_object('C_claimed', r->>'claimed_count',                              -- expect 2
    'C_lease_present', (r->'claims'->0->>'lease_token') is not null,                           -- expect true
    'C_attempts', r->'claims'->0->>'attempts',                                                -- expect 1
    'C_tenant', r->'claims'->0->>'tenant_id');                                                -- expect heliosolar
  select count(*) into n from hermes_os.agent_action_requests where action_key='e2e.batch' and status='QUEUED';
  out:=out||jsonb_build_object('C_remaining', n);                                             -- expect 1

  -- D) MAX_CONCURRENCY: batch=5, concurrency=1, 3 fixtures ⇒ claim 1
  insert into hermes_os.resolver_runtime_config(action_key,enabled,max_batch,max_concurrency,cadence_seconds)
    values ('e2e.conc',true,5,1,60);
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,updated_at)
    select gen_random_uuid(),'heliosolar',m::uuid,'e2e.conc','rc-'||g,'{"message":"x"}'::jsonb,'hc'||g,'QUEUED',gen_random_uuid(),0,5,now()-(g||' seconds')::interval,now() from generate_series(1,3) g;
  r:=hermes_os.claim_semantic_resolver_batch('e2e.conc', 300);
  out:=out||jsonb_build_object('D_claimed', r->>'claimed_count');                             -- expect 1

  -- F) BUDGET hard-stop (heliosolar day budget = $1.00, hard_stop). The daily
  --    period cap is the enforced runaway guard; per_request_budget_usd is
  --    advisory (NOT enforced by the canonical SW23 reserve).
  perform set_config('app.sw23_tenant_id','heliosolar',true);
  r:=hermes_os.sw23_reserve_budget('heliosolar','e2e-under','resolver',0.02,'day');
  out:=out||jsonb_build_object('F_under', r->>'status');                                      -- expect ok
  r:=hermes_os.sw23_reserve_budget('heliosolar','e2e-daily','resolver',2.00,'day');
  out:=out||jsonb_build_object('F_over_daily', r->>'status');                                 -- expect rejected

  -- H) the real resolver queue is UNTOUCHED
  select count(*), coalesce(sum(attempts),0) into real_after, n
    from hermes_os.agent_action_requests where action_key='hermes.intent.resolve' and status='QUEUED';
  out:=out||jsonb_build_object('H_real_before',real_before,'H_real_after',real_after,'H_real_attempts',n);  -- unchanged, attempts 0

  return out;
end $$;

select set_config('hermes.test_member', :'member', false);
select jsonb_pretty(pg_temp.e21()) as result;

rollback;
