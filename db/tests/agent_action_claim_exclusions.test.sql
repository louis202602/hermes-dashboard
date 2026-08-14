-- Reproducible assertions for the claim-exclusion (head-of-line quarantine) capability.
-- The EXACT checks ran live against project smubxqorirlfldatzmym on ISOLATED synthetic
-- action_key ('e2e.claimtest') / tenants ('e2e_claim_a','e2e_claim_b'); the real
-- protected hermes.intent.resolve rows are NEVER referenced here. All fixtures are
-- created and then deleted (explicit cleanup) — no residue, no real row mutated.
--
-- Run (psql): \i db/tests/agent_action_claim_exclusions.test.sql
--
-- Proven:
--   A  two excluded head-of-line rows are skipped -> claim returns the fresh row
--   B  excluded rows stay QUEUED, same created_at / attempts (bit-for-bit unchanged)
--   C  FIFO preserved among non-excluded rows (oldest wins)
--   D  no double-claim: sequential claims return distinct rows (FOR UPDATE SKIP LOCKED)
--   E  tenant behaviour unchanged: a different-tenant row is claimed normally despite
--      exclusions on the first tenant's rows (exclusions are per-row, not per-tenant)
--   F  idempotence: empty queue -> claimed:false; re-exclude same id -> still one row
--   G  a non-existent exclusion (random uuid) impacts nothing

begin;
create function pg_temp.claimtest() returns jsonb language plpgsql as $$
declare
  out jsonb := '{}'::jsonb;
  ak text := 'e2e.claimtest'; T text := 'e2e_claim_a'; T2 text := 'e2e_claim_b';
  id_old1 uuid; id_old2 uuid; id_fresh uuid; id_n1 uuid; id_n2 uuid; id_t2 uuid; id_g uuid;
  o1 record; o1b record; c jsonb; c2 jsonb; c3 jsonb; c4 jsonb; c5 jsonb; cg jsonb;
begin
  insert into hermes_os.agent_action_catalog(action_key,display_name) values (ak,'claim test')
    on conflict (action_key) do nothing;

  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'old1','{}'::jsonb,'o1','QUEUED',now()-interval '10 min',0,5) returning id into id_old1;
  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'old2','{}'::jsonb,'o2','QUEUED',now()-interval '9 min',0,5) returning id into id_old2;
  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'fresh','{}'::jsonb,'fr','QUEUED',now()-interval '1 min',0,5) returning id into id_fresh;

  select status,created_at,attempts into o1 from hermes_os.agent_action_requests where id=id_old1;

  perform hermes_os.exclude_agent_action_from_claim(id_old1,'protected head-of-line test');
  perform hermes_os.exclude_agent_action_from_claim(id_old2,'protected head-of-line test');
  c := hermes_os.claim_agent_action(ak,300);
  out := out || jsonb_build_object('A_claimed_is_fresh', ((c->>'id')::uuid = id_fresh));

  select status,created_at,attempts into o1b from hermes_os.agent_action_requests where id=id_old1;
  out := out || jsonb_build_object('B_old1_unchanged',
    (o1b.status=o1.status and o1b.created_at=o1.created_at and o1b.attempts=o1.attempts),
    'B_old2_status',(select status from hermes_os.agent_action_requests where id=id_old2));

  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'n1','{}'::jsonb,'n1','QUEUED',now()-interval '8 min',0,5) returning id into id_n1;
  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'n2','{}'::jsonb,'n2','QUEUED',now()-interval '7 min',0,5) returning id into id_n2;
  c2 := hermes_os.claim_agent_action(ak,300);
  out := out || jsonb_build_object('C_fifo_oldest_first', ((c2->>'id')::uuid = id_n1));

  c3 := hermes_os.claim_agent_action(ak,300);
  out := out || jsonb_build_object('D_second_is_n2', ((c3->>'id')::uuid = id_n2),
    'D_distinct', ((c2->>'id') is distinct from (c3->>'id')));

  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T2,gen_random_uuid(),ak,'t2row','{}'::jsonb,'t2','QUEUED',now()-interval '30 sec',0,5) returning id into id_t2;
  c4 := hermes_os.claim_agent_action(ak,300);
  out := out || jsonb_build_object('E_is_t2', ((c4->>'id')::uuid = id_t2));

  c5 := hermes_os.claim_agent_action(ak,300);
  perform hermes_os.exclude_agent_action_from_claim(id_old1,'re-quarantine idempotent');
  out := out || jsonb_build_object('F_empty_claim', c5->>'claimed',
    'F_exclusion_rows_for_old1', (select count(*) from hermes_os.agent_action_claim_exclusions where action_request_id=id_old1));

  perform hermes_os.exclude_agent_action_from_claim(gen_random_uuid(),'points to nothing');
  insert into hermes_os.agent_action_requests(tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts,max_attempts)
    values (T,gen_random_uuid(),ak,'gtest','{}'::jsonb,'g','QUEUED',now(),0,5) returning id into id_g;
  cg := hermes_os.claim_agent_action(ak,300);
  out := out || jsonb_build_object('G_claims_gtest', ((cg->>'id')::uuid = id_g));

  delete from hermes_os.agent_action_claim_exclusions x using hermes_os.agent_action_requests r
    where x.action_request_id=r.id and r.action_key=ak;
  delete from hermes_os.agent_action_claim_exclusions where reason='points to nothing';
  delete from hermes_os.agent_action_requests where action_key=ak;
  delete from hermes_os.agent_action_catalog where action_key=ak;
  return out;
end $$;
select jsonb_pretty(pg_temp.claimtest()) as result;
rollback;
