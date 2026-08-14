-- Reproducible assertions for E2.2 (resolver observability + circuit + reaper).
-- The EXACT checks run live against project smubxqorirlfldatzmym, inside a
-- ROLLED-BACK transaction: real rows are READ (tenant metrics) but never mutated,
-- and all writes use SYNTHETIC action_keys / tenants that never persist. The 5
-- real QUEUED gateway rows are never claimed, reaped or cancelled.
--
-- Substitute a real tenant.member uuid for :member before running.
-- Run (psql): \i db/tests/hermes_resolver_observability.test.sql

\set member '00000000-0000-0000-0000-000000000000'

begin;
create function pg_temp.e22() returns jsonb language plpgsql as $$
declare out jsonb:='{}'::jsonb; r jsonb; m text:=current_setting('hermes.test_member', true);
  real_q_before int; real_q_after int; n int;
begin
  select count(*) into real_q_before from hermes_os.agent_action_requests where action_key='hermes.intent.resolve' and status='QUEUED';

  -- METRICS (tenant-scoped) — synthetic heliosolar outcomes + a cross-tenant row.
  perform set_config('request.jwt.claims', json_build_object('sub',m,'role','authenticated')::text, true);
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,started_at,finished_at,error,updated_at) values
   (gen_random_uuid(),'heliosolar',m::uuid,'hermes.intent.resolve','mf1','{}'::jsonb,'h1','FAILED',gen_random_uuid(),2,5,now()-interval '1 hour',now()-interval '59 min',now()-interval '58 min','{"code":"RESOLVER_ERROR"}'::jsonb,now()),
   (gen_random_uuid(),'heliosolar',m::uuid,'hermes.intent.resolve','mf3','{}'::jsonb,'h3','FAILED',gen_random_uuid(),5,5,now()-interval '3 hour',now()-interval '179 min',now()-interval '178 min','{"code":"DEAD_LETTER"}'::jsonb,now()),
   (gen_random_uuid(),'heliosolar',m::uuid,'hermes.intent.resolve','ms1','{}'::jsonb,'s1','SUCCEEDED',gen_random_uuid(),1,5,now()-interval '90 min',now()-interval '89 min',now()-interval '88 min',null,now());
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,finished_at,error,updated_at)
   values (gen_random_uuid(),'ghostco',m::uuid,'hermes.intent.resolve','gf1','{}'::jsonb,'g1','FAILED',gen_random_uuid(),5,5,now()-interval '1 hour',now()-interval '30 min','{"code":"DEAD_LETTER"}'::jsonb,now());
  r:=public.get_resolver_observability();
  out:=out||jsonb_build_object('M_state', r->>'resolver_state', 'M_queue', r->'queue'->>'queue_depth',
    'M_failed', r->'outcomes'->>'failed_count', 'M_dead', r->'outcomes'->>'dead_letter_count',   -- cross-tenant excluded
    'M_error_rate', r->'outcomes'->>'error_rate', 'M_daily_budget', r->'cost'->>'daily_budget_usd');

  -- REAPER (synthetic action): batch limit + dead-letter + idempotent.
  insert into hermes_os.agent_action_catalog(action_key,display_name) values ('e2e.dead','dead');
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,lease_expires_at,updated_at)
    select gen_random_uuid(),'heliosolar',m::uuid,'e2e.dead','d-'||g,'{}'::jsonb,'d'||g,'RUNNING',gen_random_uuid(),5,5,now()-interval '10 min',now()-interval '5 min',now() from generate_series(1,3) g;
  out:=out||jsonb_build_object('R_batch2', hermes_os.reap_dead_letter_agent_actions('e2e.dead',2));   -- expect 2
  out:=out||jsonb_build_object('R_rest',   hermes_os.reap_dead_letter_agent_actions('e2e.dead',50));  -- expect 1
  out:=out||jsonb_build_object('R_idem',   hermes_os.reap_dead_letter_agent_actions('e2e.dead',50));  -- expect 0

  -- CIRCUIT: closed→no trip; over threshold→OPEN + enabled false; claim blocked; reset keeps enabled false.
  insert into hermes_os.agent_action_catalog(action_key,display_name) values ('e2e.cb','cb'),('e2e.cb2','cb2');
  insert into hermes_os.resolver_runtime_config(action_key,enabled,max_batch,max_concurrency,cadence_seconds,circuit_error_threshold,circuit_deadletter_threshold,circuit_window_minutes)
    values ('e2e.cb',true,3,2,60,2,3,60),('e2e.cb2',true,3,2,60,5,5,60);
  insert into hermes_os.agent_action_requests(id,tenant_id,user_id,action_key,request_id,payload,payload_hash,status,correlation_id,attempts,max_attempts,created_at,finished_at,error,updated_at)
    select gen_random_uuid(),'heliosolar',m::uuid,'e2e.cb','cbf-'||g,'{}'::jsonb,'cf'||g,'FAILED',gen_random_uuid(),5,5,now()-interval '5 min',now()-interval '4 min','{"code":"RESOLVER_ERROR"}'::jsonb,now() from generate_series(1,2) g;
  out:=out||jsonb_build_object('C_closed', (hermes_os.resolver_circuit_evaluate('e2e.cb2'))->>'tripped');   -- expect false
  r:=hermes_os.resolver_circuit_evaluate('e2e.cb');
  out:=out||jsonb_build_object('C_trip', r->>'tripped', 'C_state', r->>'circuit_state', 'C_enabled', r->>'enabled');  -- true/OPEN/false
  out:=out||jsonb_build_object('C_open_claim', (hermes_os.claim_semantic_resolver_batch('e2e.cb',300))->>'reason');    -- expect DISABLED
  r:=hermes_os.resolver_circuit_reset('e2e.cb');
  out:=out||jsonb_build_object('C_reset_circuit', r->>'circuit_state', 'C_reset_enabled', r->>'enabled');   -- CLOSED / false

  -- 5 real QUEUED untouched
  select count(*) into real_q_after from hermes_os.agent_action_requests where action_key='hermes.intent.resolve' and status='QUEUED';
  out:=out||jsonb_build_object('Q_before', real_q_before, 'Q_after', real_q_after);
  return out;
end $$;
select set_config('hermes.test_member', :'member', false);
select jsonb_pretty(pg_temp.e22()) as result;
rollback;
