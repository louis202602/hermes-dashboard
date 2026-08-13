-- Reproducible security assertions for the Phase B attachment slice.
-- These are the EXACT impersonated checks that were run live against project
-- smubxqorirlfldatzmym and all passed. Everything runs inside a single
-- transaction that is ROLLED BACK, so no data is persisted and the 4 real
-- QUEUED resolver rows are untouched.
--
-- How to run (psql, as the migration/owner role):
--   \i db/tests/hermes_chat_attachments_rls.test.sql
--
-- Impersonation is done by setting `request.jwt.claims` (drives auth.uid()) and,
-- for the storage.objects checks, by `set local role authenticated` so the RLS
-- policies actually apply (a superuser bypasses RLS and would give a false pass).
--
-- Substitute a real `tenant.member` user id for :member and any non-member uuid
-- for :other before running. In the live run:
--   member = adbb84d0-70a5-4fdd-8ef4-eb6f61697a73 (heliosolar)
--   other  = 99999999-9999-9999-9999-999999999999 (no tenant)

\set member '00000000-0000-0000-0000-000000000000'
\set other  '99999999-9999-9999-9999-999999999999'

begin;

-- Fixtures owned by :member (rolled back).
insert into hermes_os.hermes_conversations(id, tenant_id, user_id, title, created_at, updated_at, last_message_at)
values ('11111111-1111-1111-1111-111111111111','heliosolar', :'member','t',now(),now(),now());
insert into hermes_os.hermes_messages(id, conversation_id, tenant_id, user_id, role, content, metadata, created_at)
values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','heliosolar', :'member','user','hi','{}'::jsonb,now());

-- ── Facade layer (SECURITY DEFINER; auth.uid() from request.jwt.claims) ──────
create function pg_temp.facades() returns jsonb language plpgsql as $$
declare r jsonb; out jsonb := '{}'::jsonb; aid uuid := gen_random_uuid();
  member text := current_setting('hermes.test_member', true);
begin
  perform set_config('request.jwt.claims', json_build_object('sub',member,'role','authenticated')::text, true);
  -- happy path
  r := public.finalize_hermes_attachment(aid,'heliosolar/'||member||'/'||aid||'/a.png','a.png','a.png','image/png','image',1234, repeat('a',64));
  out := out || jsonb_build_object('finalize_member_ok', (r->>'ok')::bool);                          -- expect true
  -- out-of-scope path rejected
  r := public.finalize_hermes_attachment(gen_random_uuid(),'otherco/'||member||'/x/a.png','a.png','a.png','image/png','image',1234, repeat('a',64));
  out := out || jsonb_build_object('finalize_out_of_scope', r->>'code');                              -- expect PATH_OUT_OF_SCOPE
  -- bad checksum rejected
  r := public.finalize_hermes_attachment(gen_random_uuid(),'heliosolar/'||member||'/z/a.png','a.png','a.png','image/png','image',1234, 'NOTHEX');
  out := out || jsonb_build_object('finalize_bad_checksum', r->>'code');                              -- expect BAD_CHECKSUM
  -- link to owned message
  r := public.link_hermes_attachments('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', array[aid]);
  out := out || jsonb_build_object('link_owned_ok', (r->>'ok')::bool);                                -- expect true
  -- read back linked
  r := public.get_hermes_message_attachments('22222222-2222-2222-2222-222222222222');
  out := out || jsonb_build_object('get_count', jsonb_array_length(r->'attachments'));                -- expect 1
  -- non-member cannot finalize / link / read
  perform set_config('request.jwt.claims', json_build_object('sub','99999999-9999-9999-9999-999999999999','role','authenticated')::text, true);
  r := public.finalize_hermes_attachment(gen_random_uuid(),'heliosolar/x/y/a.png','a.png','a.png','image/png','image',1234, repeat('a',64));
  out := out || jsonb_build_object('finalize_nonmember', r->>'code');                                 -- expect TENANT_NO_TENANT
  r := public.link_hermes_attachments('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', array[gen_random_uuid()]);
  out := out || jsonb_build_object('link_cross_tenant', r->>'code');                                  -- expect TENANT_NO_TENANT
  r := public.get_hermes_message_attachments('22222222-2222-2222-2222-222222222222');
  out := out || jsonb_build_object('get_cross_tenant_count', jsonb_array_length(r->'attachments'));   -- expect 0
  -- unauthenticated denied
  perform set_config('request.jwt.claims', '', true);
  r := public.finalize_hermes_attachment(gen_random_uuid(),'heliosolar/x/y/a.png','a.png','a.png','image/png','image',1234, repeat('a',64));
  out := out || jsonb_build_object('finalize_unauth', r->>'code');                                    -- expect UNAUTHENTICATED
  return out;
end $$;
select set_config('hermes.test_member', :'member', false);
select jsonb_pretty(pg_temp.facades()) as facade_assertions;

-- ── Storage RLS layer (run AS the authenticated role so policies apply) ──────
create function pg_temp.storage_rls() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; n int;
  member text := current_setting('hermes.test_member', true);
  other  text := '99999999-9999-9999-9999-999999999999';
  mkey   text;
begin
  mkey := 'heliosolar/'||member||'/aa/a.png';
  perform set_config('request.jwt.claims', json_build_object('sub',member,'role','authenticated')::text, true);
  begin insert into storage.objects(id,bucket_id,name) values (gen_random_uuid(),'hermes-chat-attachments', mkey);
        out := out||jsonb_build_object('insert_own','ALLOWED');
  exception when others then out := out||jsonb_build_object('insert_own','DENIED'); end;              -- expect ALLOWED
  begin insert into storage.objects(id,bucket_id,name) values (gen_random_uuid(),'hermes-chat-attachments','otherco/'||member||'/bb/a.png');
        out := out||jsonb_build_object('insert_cross_tenant','ALLOWED_BUG');
  exception when others then out := out||jsonb_build_object('insert_cross_tenant','DENIED'); end;      -- expect DENIED
  begin insert into storage.objects(id,bucket_id,name) values (gen_random_uuid(),'hermes-chat-attachments','heliosolar/'||other||'/cc/a.png');
        out := out||jsonb_build_object('insert_other_user','ALLOWED_BUG');
  exception when others then out := out||jsonb_build_object('insert_other_user','DENIED'); end;        -- expect DENIED
  select count(*) into n from storage.objects where bucket_id='hermes-chat-attachments' and name = mkey;
  out := out||jsonb_build_object('select_own_count', n);                                              -- expect 1
  perform set_config('request.jwt.claims', json_build_object('sub',other,'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id='hermes-chat-attachments' and name = mkey;
  out := out||jsonb_build_object('select_cross_user_count', n);                                       -- expect 0
  perform set_config('request.jwt.claims', '', true);
  begin insert into storage.objects(id,bucket_id,name) values (gen_random_uuid(),'hermes-chat-attachments','heliosolar/'||member||'/ff/a.png');
        out := out||jsonb_build_object('insert_unauth','ALLOWED_BUG');
  exception when others then out := out||jsonb_build_object('insert_unauth','DENIED'); end;            -- expect DENIED
  return out;
end $$;
set local role authenticated;
select jsonb_pretty(pg_temp.storage_rls()) as storage_rls_assertions;
reset role;

rollback;
