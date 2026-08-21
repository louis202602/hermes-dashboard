-- Assertions REPRODUCTIBLES pour la PHASE 2 — hygiène du socle.
--
-- Transaction ROLLED BACK : rien n'est persisté. Fixtures sur un tenant et une
-- action SYNTHÉTIQUES ; les 11 requêtes réelles ne sont ni lues en écriture, ni
-- expirées, ni mutées — c'est d'ailleurs l'une des assertions (DATA1).
--
-- Substituer un uuid de `tenant.member` réel pour :member avant exécution.
-- Exécution (psql) : \i db/tests/phase2_hygiene.test.sql
--
-- Couverture :
--   TTL1..8  expiration des requêtes orphelines : ciblage, préservation, audit, idempotence
--   FK1      intégrité tenant_id sur la file du gateway
--   LEG1..2  agents legacy non sélectionnables et absents des KPI
--   P1a..c   les protections de la Phase 1 restent intactes
--   DATA1..2 aucune donnée réelle perdue

\set member '00000000-0000-0000-0000-000000000000'

begin;
set local phase2.member = :'member';

create temp table p2 (id serial primary key, test text, expected text, actual text, status text) on commit drop;

insert into hermes_os.tenants (tenant_id, name, display_name) values ('__p2_test__', 'P2', 'P2');
insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id, target_agent,
   required_permission, required_payload_keys, enabled, is_sensitive, nl_enabled)
values ('e2e.p2.fixture', 'fx', 'fx', 'N8N_WORKFLOW', null, null, 'tenant.member', '{}', true, true, false);

do $$
declare
  v_uid uuid := current_setting('phase2.member')::uuid;
  v_old uuid; v_recent uuid; v_claimed uuid; v_pending uuid; v_n int; v_payload jsonb;
begin
  -- Quatre requêtes : vieille+vierge · récente · vieille mais déjà tentée ·
  -- vieille mais en attente d'approbation. Une seule doit expirer.
  insert into hermes_os.agent_action_requests (tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at)
  values ('__p2_test__',v_uid,'e2e.p2.fixture','p2-old','{"garder":"ceci"}'::jsonb,'h','QUEUED', now()-interval '60 days') returning id into v_old;
  insert into hermes_os.agent_action_requests (tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at)
  values ('__p2_test__',v_uid,'e2e.p2.fixture','p2-recent','{}'::jsonb,'h','QUEUED', now()-interval '1 day') returning id into v_recent;
  insert into hermes_os.agent_action_requests (tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,attempts)
  values ('__p2_test__',v_uid,'e2e.p2.fixture','p2-claimed','{}'::jsonb,'h','QUEUED', now()-interval '60 days',2) returning id into v_claimed;
  insert into hermes_os.agent_action_requests (tenant_id,user_id,action_key,request_id,payload,payload_hash,status,created_at,approval_request_id)
  values ('__p2_test__',v_uid,'e2e.p2.fixture','p2-pending','{}'::jsonb,'h','PENDING_APPROVAL', now()-interval '60 days', gen_random_uuid()) returning id into v_pending;

  select count(*) into v_n from hermes_os.expire_stale_queued_agent_actions(interval '30 days','e2e.p2.fixture',100);
  insert into p2 (test,expected,actual,status) values
    ('TTL1: seule la requête vieille ET vierge expire','1',v_n::text, case when v_n=1 then 'PASS' else 'FAIL' end);

  insert into p2 (test,expected,actual,status)
  select 'TTL2: la vieille est FAILED/STALE_NO_CONSUMER','FAILED/STALE_NO_CONSUMER', status||'/'||coalesce(error->>'code','-'),
         case when status='FAILED' and error->>'code'='STALE_NO_CONSUMER' then 'PASS' else 'FAIL' end
    from hermes_os.agent_action_requests where id=v_old;

  select payload into v_payload from hermes_os.agent_action_requests where id=v_old;
  insert into p2 (test,expected,actual,status) values
    ('TTL3: le payload est PRÉSERVÉ (aucune perte)','{"garder": "ceci"}',v_payload::text,
     case when v_payload = '{"garder":"ceci"}'::jsonb then 'PASS' else 'FAIL' end);

  insert into p2 (test,expected,actual,status)
  select 'TTL4: la récente reste QUEUED','QUEUED',status, case when status='QUEUED' then 'PASS' else 'FAIL' end
    from hermes_os.agent_action_requests where id=v_recent
  union all
  select 'TTL5: la déjà-tentée reste QUEUED','QUEUED',status, case when status='QUEUED' then 'PASS' else 'FAIL' end
    from hermes_os.agent_action_requests where id=v_claimed
  union all
  select 'TTL6: celle en attente d''approbation est intacte','PENDING_APPROVAL',status, case when status='PENDING_APPROVAL' then 'PASS' else 'FAIL' end
    from hermes_os.agent_action_requests where id=v_pending;

  select count(*) into v_n from hermes_os.expire_stale_queued_agent_actions(interval '30 days','e2e.p2.fixture',100);
  insert into p2 (test,expected,actual,status) values
    ('TTL7: rejeu idempotent (rien de plus)','0',v_n::text, case when v_n=0 then 'PASS' else 'FAIL' end);

  insert into p2 (test,expected,actual,status)
  select 'TTL8: trace d''audit EXPIRED_STALE écrite','>=1',count(*)::text, case when count(*)>=1 then 'PASS' else 'FAIL' end
    from hermes_os.agent_action_audit where event='EXPIRED_STALE' and request_id='p2-old';
end $$;

-- --- FK d'intégrité tenant sur la file du gateway ----------------------------
do $$
declare v_state text;
begin
  begin
    insert into hermes_os.agent_action_requests (tenant_id,user_id,action_key,request_id,payload,payload_hash,status)
    values ('__tenant_inexistant__', current_setting('phase2.member')::uuid,'e2e.p2.fixture','p2-fk','{}'::jsonb,'h','QUEUED');
    v_state := 'ACCEPTE';
  exception when foreign_key_violation then v_state := 'REFUSE_FK';
  when others then v_state := 'AUTRE:'||sqlstate;
  end;
  insert into p2 (test,expected,actual,status) values
    ('FK1: tenant inexistant refusé dans la file','REFUSE_FK',v_state, case when v_state='REFUSE_FK' then 'PASS' else 'FAIL' end);
end $$;

-- --- Agents legacy : non sélectionnables -------------------------------------
insert into p2 (test,expected,actual,status)
select 'LEG1: aucune action ne cible un composant non-courant','0',count(*)::text, case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog c
  join hermes_os.component_registry r on r.workflow_id = c.target_workflow_id
 where coalesce(r.is_current_in_group,true) = false
union all
select 'LEG2: aucun agent legacy dans la vue KPI du dashboard','0',count(*)::text, case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.v_dashboard_components where status = 'legacy_superseded';

-- --- Les protections de la Phase 1 restent intactes ---------------------------
insert into p2 (test,expected,actual,status)
select 'P1a: gate toujours fail-closed','present',
       case when prosrc like '%FAIL-CLOSED%' then 'present' else 'ABSENT' end,
       case when prosrc like '%FAIL-CLOSED%' and prosrc like '%is_sensitive%' then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='hermes_os' and p.proname='gateway_policy_gate'
union all
select 'P1b: 3 politiques BTP toujours ACTIVE/REQUIRE_APPROVAL','3',count(*)::text, case when count(*)=3 then 'PASS' else 'FAIL' end
  from hermes_os.sw15_policies where tenant_id='heliosolar' and status='ACTIVE' and effect='REQUIRE_APPROVAL'
union all
select 'P1c: RLS toujours active sur dashboard_context_settings','true',relrowsecurity::text, case when relrowsecurity then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='hermes_os' and c.relname='dashboard_context_settings';

-- --- Aucune donnée réelle perdue ---------------------------------------------
insert into p2 (test,expected,actual,status)
select 'DATA1: les 11 requêtes réelles heliosolar sont intactes','11 QUEUED',count(*)::text||' QUEUED',
       case when count(*)=11 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where tenant_id='heliosolar' and status='QUEUED'
union all
select 'DATA2: aucune ligne execution_logs perdue','69',count(*)::text, case when count(*)=69 then 'PASS' else 'FAIL' end
  from hermes_os.execution_logs;

select id, test, expected, actual, status from p2 order by id;

rollback;
