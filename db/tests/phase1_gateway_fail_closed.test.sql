-- Assertions REPRODUCTIBLES pour la PHASE 1 — sécurisation du socle (correctif B2).
--
-- TOUT s'exécute dans UNE transaction ROLLED BACK : rien n'est persisté. Les requêtes
-- RÉELLES en file (10 × hermes.intent.resolve + 1 × btp.qualification.create) ne sont
-- jamais lues en écriture, claim ées ni mutées : les fixtures utilisent des `action_key`
-- et un `tenant_id` SYNTHÉTIQUES qui n'existent pas en production.
--
-- AUCUNE ligne de `hermes_os.user_tenant_permissions` n'est créée ni supprimée
-- (`user_id` porte une FK vers `auth.users`) : les tests réutilisent l'uuid d'un
-- membre RÉEL en lecture seule de ses permissions.
--
-- Substituer un uuid de `tenant.member` réel pour :member avant exécution.
-- Exécution (psql, en tant que rôle propriétaire/migration) :
--   \i db/tests/phase1_gateway_fail_closed.test.sql

\set member '00000000-0000-0000-0000-000000000000'

begin;

-- Expose l'uuid du membre aux blocs plpgsql (variable psql -> GUC de session).
set local phase1.member = :'member';

create temp table phase1_results (
  id serial primary key,
  test text not null,
  expected text not null,
  actual text,
  status text
) on commit drop;

-- Fixtures SYNTHÉTIQUES ------------------------------------------------------
insert into hermes_os.tenants (tenant_id, name, display_name)
values ('__phase1_test__', 'Phase1 Test', 'Phase1 Test');

insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id, target_agent,
   required_permission, required_payload_keys, enabled, is_sensitive, nl_enabled)
values
  ('e2e.phase1.sensitive',  'Fixture sensible',     'fixture', 'N8N_WORKFLOW', null, null,
   'tenant.member', '{}', true,  true,  false),
  ('e2e.phase1.plain',      'Fixture non sensible', 'fixture', 'N8N_WORKFLOW', null, null,
   'tenant.member', '{}', true,  false, false),
  ('e2e.phase1.needsright', 'Fixture droit absent', 'fixture', 'N8N_WORKFLOW', null, null,
   'phase1.permission.inexistante', '{}', true, true, false);

do $$
declare
  v_tenant constant text := '__phase1_test__';
  v_uid    uuid := current_setting('phase1.member')::uuid;
  v_id     uuid;
  v_out    text;
  v_reason text;
  v_status text;
  v_ar     uuid;
begin
  -- === A — action sensible, AUCUNE politique => REQUIRE_APPROVAL =============
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status)
  values (v_tenant, v_uid, 'e2e.phase1.sensitive', 'p1-a', '{}'::jsonb, 'h', 'QUEUED')
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  insert into phase1_results (test, expected, actual, status) values
    ('A: sensible + aucune politique', 'REQUIRE_APPROVAL', v_out,
     case when v_out = 'REQUIRE_APPROVAL' then 'PASS' else 'FAIL' end);

  -- === D5 — demande SW15 créée + statut PENDING_APPROVAL =====================
  select approval_request_id, status into v_ar, v_status
    from hermes_os.agent_action_requests where id = v_id;
  insert into phase1_results (test, expected, actual, status) values
    ('D5a: demande SW15 créée', 'not null',
     case when v_ar is null then 'null' else 'not null' end,
     case when v_ar is not null then 'PASS' else 'FAIL' end),
    ('D5b: statut de la requête', 'PENDING_APPROVAL', v_status,
     case when v_status = 'PENDING_APPROVAL' then 'PASS' else 'FAIL' end),
    ('D5c: sw15_approval_requests PENDING', 'PENDING',
     coalesce((select status from hermes_os.sw15_approval_requests
                where approval_request_id = v_ar), '(aucune)'),
     case when exists (select 1 from hermes_os.sw15_approval_requests
                        where approval_request_id = v_ar and status = 'PENDING')
          then 'PASS' else 'FAIL' end);

  -- === B — action sensible + politique REQUIRE_APPROVAL ======================
  insert into hermes_os.sw15_policies (policy_name, tenant_id, action_pattern, effect, priority, status)
  values ('p1 require', v_tenant, 'e2e.phase1.sensitive', 'REQUIRE_APPROVAL', 10, 'ACTIVE');
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status)
  values (v_tenant, v_uid, 'e2e.phase1.sensitive', 'p1-b', '{}'::jsonb, 'h', 'QUEUED')
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  insert into phase1_results (test, expected, actual, status) values
    ('B: sensible + REQUIRE_APPROVAL', 'REQUIRE_APPROVAL', v_out,
     case when v_out = 'REQUIRE_APPROVAL' then 'PASS' else 'FAIL' end);
  delete from hermes_os.sw15_policies where tenant_id = v_tenant;

  -- === C — action sensible + politique DENY ==================================
  insert into hermes_os.sw15_policies (policy_name, tenant_id, action_pattern, effect, priority, status)
  values ('p1 deny', v_tenant, 'e2e.phase1.sensitive', 'DENY', 10, 'ACTIVE');
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status)
  values (v_tenant, v_uid, 'e2e.phase1.sensitive', 'p1-c', '{}'::jsonb, 'h', 'QUEUED')
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  select status into v_status from hermes_os.agent_action_requests where id = v_id;
  insert into phase1_results (test, expected, actual, status) values
    ('C: sensible + DENY', 'DENY', v_out,
     case when v_out = 'DENY' then 'PASS' else 'FAIL' end),
    ('C2: statut après DENY', 'POLICY_DENIED', v_status,
     case when v_status = 'POLICY_DENIED' then 'PASS' else 'FAIL' end);
  delete from hermes_os.sw15_policies where tenant_id = v_tenant;

  -- === D — action sensible + politique PERMIT EXPLICITE ======================
  -- Comportement attendu ET DOCUMENTÉ : PERMIT, avec un motif d'audit distinct qui
  -- rend l'autonomie intentionnelle repérable.
  insert into hermes_os.sw15_policies (policy_name, tenant_id, action_pattern, effect, priority, status)
  values ('p1 permit explicite', v_tenant, 'e2e.phase1.sensitive', 'PERMIT', 10, 'ACTIVE');
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status)
  values (v_tenant, v_uid, 'e2e.phase1.sensitive', 'p1-d', '{}'::jsonb, 'h', 'QUEUED')
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  select policy_reason into v_reason from hermes_os.agent_action_requests where id = v_id;
  insert into phase1_results (test, expected, actual, status) values
    ('D: sensible + PERMIT explicite', 'PERMIT', v_out,
     case when v_out = 'PERMIT' then 'PASS' else 'FAIL' end),
    ('D1: motif d''audit dédié', 'contient PERMIT EXPLICITE', coalesce(v_reason, '(null)'),
     case when v_reason like '%PERMIT EXPLICITE%' then 'PASS' else 'FAIL' end);
  delete from hermes_os.sw15_policies where tenant_id = v_tenant;

  -- === D2 — action NON sensible, aucune politique => PERMIT (défaut documenté) =
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status)
  values (v_tenant, v_uid, 'e2e.phase1.plain', 'p1-d2', '{}'::jsonb, 'h', 'QUEUED')
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  select policy_reason into v_reason from hermes_os.agent_action_requests where id = v_id;
  insert into phase1_results (test, expected, actual, status) values
    ('D2: non sensible + aucune politique', 'PERMIT', v_out,
     case when v_out = 'PERMIT' then 'PASS' else 'FAIL' end),
    ('D2b: motif « non sensible »', 'contient non sensible', coalesce(v_reason, '(null)'),
     case when v_reason like '%non sensible%' then 'PASS' else 'FAIL' end);

  -- === D3 — le cas « action orpheline » est STRUCTURELLEMENT impossible ======
  -- `agent_action_requests.action_key` porte une FK vers `agent_action_catalog` :
  -- une requête ne peut pas exister sans sa ligne de catalogue. Le `coalesce(...,true)`
  -- de la gate reste une ceinture de sécurité (défense en profondeur), mais c'est la
  -- contrainte qui garantit l'invariant. On teste donc la contrainte elle-même.
  insert into phase1_results (test, expected, actual, status)
  select 'D3: FK action_key -> catalogue (anti-orphelin)', 'présente',
         coalesce((select conname from pg_constraint
                    where conrelid = 'hermes_os.agent_action_requests'::regclass
                      and contype = 'f'
                      and pg_get_constraintdef(oid) like '%agent_action_catalog%'
                    limit 1), '(absente)'),
         case when exists (select 1 from pg_constraint
                            where conrelid = 'hermes_os.agent_action_requests'::regclass
                              and contype = 'f'
                              and pg_get_constraintdef(oid) like '%agent_action_catalog%')
              then 'PASS' else 'FAIL' end;

  -- === D4 — court-circuit « approuvé par un humain » intact ==================
  insert into hermes_os.agent_action_requests
    (tenant_id, user_id, action_key, request_id, payload, payload_hash, status, approved_by)
  values (v_tenant, v_uid, 'e2e.phase1.sensitive', 'p1-d4', '{}'::jsonb, 'h', 'QUEUED', v_uid)
  returning id into v_id;
  v_out := hermes_os.gateway_policy_gate(v_id);
  insert into phase1_results (test, expected, actual, status) values
    ('D4: déjà approuvé par un humain', 'PERMIT', v_out,
     case when v_out = 'PERMIT' then 'PASS' else 'FAIL' end);

  -- === NR — non-régression : requête inexistante =============================
  v_out := hermes_os.gateway_policy_gate('00000000-0000-0000-0000-00000000dead'::uuid);
  insert into phase1_results (test, expected, actual, status) values
    ('NR: requête inexistante', 'NOT_FOUND', v_out,
     case when v_out = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
end $$;

-- === Politiques BTP réellement ACTIVE / REQUIRE_APPROVAL (lot 2) =============
insert into phase1_results (test, expected, actual, status)
select 'BTP: '||k||' -> politique explicite', 'ACTIVE/REQUIRE_APPROVAL',
       coalesce((select p.status||'/'||p.effect from hermes_os.sw15_policies p
                  where p.tenant_id = 'heliosolar' and p.action_pattern = k
                    and p.status = 'ACTIVE' limit 1), '(aucune)'),
       case when exists (select 1 from hermes_os.sw15_policies p
                          where p.tenant_id = 'heliosolar' and p.action_pattern = k
                            and p.status = 'ACTIVE' and p.effect = 'REQUIRE_APPROVAL')
            then 'PASS' else 'FAIL' end
from unnest(array['btp.qualification.create',
                  'btp.planning.phase.add',
                  'btp.suivi.progress.report']) k;

-- === DOCTRINE — aucun PERMIT actif sur une action sensible ===================
insert into phase1_results (test, expected, actual, status)
select 'DOCTRINE: PERMIT actif sur action sensible', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from hermes_os.sw15_policies p
  join hermes_os.agent_action_catalog c
    on c.action_key like replace(p.action_pattern, '*', '%')
 where p.status = 'ACTIVE' and p.effect = 'PERMIT' and c.is_sensitive
   and p.tenant_id is distinct from '__phase1_test__';

-- === E — permission requise absente => UNAUTHORIZED ==========================
do $$
declare v_res jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('phase1.member'), 'role', 'authenticated')::text, true);
  v_res := public.request_agent_action('e2e.phase1.needsright', '{}'::jsonb, 'p1-e');
  insert into phase1_results (test, expected, actual, status) values
    ('E: permission requise absente', 'UNAUTHORIZED', coalesce(v_res->>'status','(null)'),
     case when v_res->>'status' = 'UNAUTHORIZED' then 'PASS' else 'FAIL' end);
end $$;

-- === F — isolation tenant inchangée ==========================================
do $$
declare v_a text; v_b text; v_c text;
begin
  -- F1/F2 : utilisateur SANS aucune appartenance
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
  v_a := public.get_dashboard_projects(null)->>'resolution_status';
  v_b := public.get_dashboard_projects('heliosolar')->>'resolution_status';

  -- F3 : membre RÉEL d'un tenant demandant EXPLICITEMENT un tenant étranger
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('phase1.member'), 'role', 'authenticated')::text, true);
  v_c := public.get_dashboard_projects('__phase1_test__')->>'resolution_status';

  insert into phase1_results (test, expected, actual, status) values
    ('F1: sans tenant -> projets', 'NO_TENANT', v_a,
     case when v_a = 'NO_TENANT' then 'PASS' else 'FAIL' end),
    ('F2: sans tenant -> tenant demandé', 'NO_TENANT', v_b,
     case when v_b = 'NO_TENANT' then 'PASS' else 'FAIL' end),
    ('F3: membre A demandant tenant B', 'ACCESS_DENIED', v_c,
     case when v_c = 'ACCESS_DENIED' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- === G — dashboard_context_settings inaccessible en direct ===================
-- Le changement de rôle se fait au niveau SQL (et non dans plpgsql) pour que GRANT et
-- RLS s'appliquent réellement : un superuser les contournerait et donnerait un faux PASS.
-- La table temporaire n'est pas accessible en écriture au rôle `authenticated` :
-- on mesure sous ce rôle, on repasse propriétaire, puis on consigne le résultat.
set local role authenticated;
do $$
declare v_n int; v_state text;
begin
  begin
    execute 'select count(*) from hermes_os.dashboard_context_settings' into v_n;
    v_state := 'LU:'||v_n::text;
  exception when insufficient_privilege then
    v_state := 'DENIED_42501';
  when others then
    v_state := 'OTHER:'||sqlstate;
  end;
  perform set_config('phase1.g_state', v_state, true);
end $$;
reset role;

insert into phase1_results (test, expected, actual, status)
select 'G: lecture directe en authenticated', 'DENIED_42501',
       current_setting('phase1.g_state'),
       case when current_setting('phase1.g_state') = 'DENIED_42501' then 'PASS' else 'FAIL' end;

-- === Rapport =================================================================
select id, test, expected, actual, status from phase1_results order by id;

rollback;
