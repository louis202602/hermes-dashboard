-- Assertions REPRODUCTIBLES pour le LOT PV-2 (façades, stockage, capacités).
--
-- Transaction ROLLED BACK : rien n'est persisté. Le tenant B est SYNTHÉTIQUE.
-- Le tenant A est `heliosolar` (réel) mais aucune ligne n'y survit.
--
-- Substituer un uuid de `tenant.member` réel pour :member avant exécution.
-- Exécution (psql) : \i db/tests/pv2_facades.test.sql
--
-- Couverture des tests exigés (numérotation de la mission) :
--   1-6    façades / tenant : A voit A, A ne voit pas B, A ne modifie pas B,
--          ressource étrangère non révélée, sans tenant refus, anonyme refus
--   7-11   stockage : bucket privé, doc A inaccessible à B, MIME refusé,
--          taille refusée, aucune URL publique persistable
--   13-16  humain / IA : Agent 4 ne peut pas VERIFY, Agent 5 ne peut pas
--          VALIDATE, humain autorisé peut valider, usurpation refusée
--   17-22  actions : 3 capacités, désactivées, sensibles, 0 consumer actif,
--          SW15 REQUIRE_APPROVAL, 0 PERMIT actif PV
--   28-32  non-régression : Phase 1, Phase 2, PV-1, 11+ requêtes QUEUED, n8n
--   + RLS deny-all, GRANT anon = 0, search_path verrouillé, aucun tenant_id
--     acceptable depuis le client
--
-- Le test 12 (TTL d'URL signée) et les tests 23-27 (moteur de verticales) sont
-- côté TypeScript : ils ne sont pas exprimables en SQL. Voir
-- `tests/pv2-facades.test.ts` et `tests/pv2-verticals.test.ts`.

\set member '00000000-0000-0000-0000-000000000000'

begin;
set local pv.member = :'member';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;

insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv2_tenant_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.member')::uuid;
  pa uuid; pb uuid; sa uuid; sb uuid; ba uuid; xa uuid; st uuid; ec uuid; da uuid; db_ uuid;
  v text; j jsonb; n int;
begin
  -- ===================== JEU D'ESSAI =====================
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','Dupont','0600000000',v_uid) returning id into pa;
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv2_tenant_b__','PROFESSIONNEL','SARL B','b@b.fr') returning id into pb;

  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pa,'1 rue A','13100','Aix') returning id into sa;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv2_tenant_b__',pb,'2 rue B','75001','Paris') returning id into sb;

  insert into hermes_os.pv_energy_bills (tenant_id,site_id,supplier,consumption_kwh)
  values ('heliosolar',sa,'EDF',5200) returning id into ba;
  insert into hermes_os.pv_energy_bill_extractions (tenant_id,bill_id,extracted_by,supplier,consumption_kwh,confidence)
  values ('heliosolar',ba,'AGENT_4','EDF',5230,0.870) returning id into xa;

  insert into hermes_os.pv_studies (tenant_id,site_id,prepared_by,status,target_power_kwc)
  values ('heliosolar',sa,'AGENT_5','CALCULATED',9.000) returning id into st;
  insert into hermes_os.pv_economics (tenant_id,study_id,computed_by,status,investment_ttc_eur)
  values ('heliosolar',st,'AGENT_5','CALCULATED',18000) returning id into ec;

  insert into hermes_os.pv_documents (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,uploaded_by)
  values ('heliosolar',sa,'FACTURE_ENERGIE','heliosolar/'||sa::text||'/doc-a/facture.pdf','application/pdf',120000,v_uid)
  returning id into da;
  insert into hermes_os.pv_documents (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes)
  values ('__pv2_tenant_b__',sb,'PLAN','__pv2_tenant_b__/'||sb::text||'/doc-b/plan.pdf','application/pdf',90000)
  returning id into db_;

  -- ===================== 1. A VOIT A =====================
  j := public.get_pv_prospects(null,null,null,50);
  insert into r (test,expected,actual,status) values (
    'T1: tenant A voit ses prospects via la facade',
    'ok + >=1',
    (j->>'ok') || ' + ' || jsonb_array_length(j->'items')::text,
    case when (j->>'ok')::boolean and jsonb_array_length(j->'items') >= 1 then 'PASS' else 'FAIL' end);

  j := public.get_pv_prospect(pa);
  insert into r (test,expected,actual,status) values (
    'T1b: detail de SON prospect accessible','ok', coalesce(j->>'ok','null'),
    case when (j->>'ok')::boolean then 'PASS' else 'FAIL' end);

  -- ===================== 2-4. A NE VOIT PAS B =====================
  j := public.get_pv_prospects(null,null,null,200);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'id')::uuid = pb);
  insert into r (test,expected,actual,status) values (
    'T2: le prospect du tenant B n''apparait pas dans la liste de A','0',n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  j := public.get_pv_prospect(pb);
  insert into r (test,expected,actual,status) values (
    'T4a: prospect etranger -> NOT_FOUND (existence non revelee)','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  j := public.get_pv_site(sb);
  insert into r (test,expected,actual,status) values (
    'T4b: site etranger -> NOT_FOUND','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  j := public.get_pv_energy_bills(sb, 50);
  insert into r (test,expected,actual,status) values (
    'T4c: factures d''un site etranger -> liste VIDE','0', jsonb_array_length(j->'items')::text,
    case when jsonb_array_length(j->'items') = 0 then 'PASS' else 'FAIL' end);

  j := public.upsert_pv_prospect(pb, null, null, 'PIRATE');
  insert into r (test,expected,actual,status) values (
    'T3a: A ne peut pas MODIFIER un prospect de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  j := public.set_pv_prospect_status(pb, 'CONTACTED');
  insert into r (test,expected,actual,status) values (
    'T3b: A ne peut pas changer le STATUT d''un prospect de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  j := public.upsert_pv_site(sb, null, 'PIRATE');
  insert into r (test,expected,actual,status) values (
    'T3c: A ne peut pas modifier un site de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  select count(*) into n from hermes_os.pv_prospects where id = pb and last_name = 'PIRATE';
  insert into r (test,expected,actual,status) values (
    'T3d: la ligne du tenant B est RESTEE intacte','0',n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- ===================== 5. SANS TENANT =====================
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-2222-3333-4444-555555555555','role','authenticated')::text, true);
  j := public.get_pv_prospects(null,null,null,50);
  insert into r (test,expected,actual,status) values (
    'T5: utilisateur authentifie SANS tenant -> refus','NO_TENANT', coalesce(j->>'code','null'),
    case when j->>'code' = 'NO_TENANT' then 'PASS' else 'FAIL' end);

  j := public.upsert_pv_prospect(null,'PARTICULIER',null,'X',null,'0600000000');
  insert into r (test,expected,actual,status) values (
    'T5b: ecriture sans tenant -> refus','NO_TENANT', coalesce(j->>'code','null'),
    case when j->>'code' = 'NO_TENANT' then 'PASS' else 'FAIL' end);

  -- ===================== 6. ANONYME =====================
  perform set_config('request.jwt.claims', '', true);
  j := public.get_pv_prospects(null,null,null,50);
  insert into r (test,expected,actual,status) values (
    'T6: appelant NON authentifie -> refus','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);

  j := public.verify_pv_energy_bill(ba);
  insert into r (test,expected,actual,status) values (
    'T6b: verification humaine par un anonyme -> refus','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);

  -- ===================== 8-10. STOCKAGE =====================
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  j := public.get_pv_documents(sb, 50);
  insert into r (test,expected,actual,status) values (
    'T8: documents d''un site du tenant B -> liste VIDE pour A','0', jsonb_array_length(j->'items')::text,
    case when jsonb_array_length(j->'items') = 0 then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T8b: is_active_tenant_member(tenant etranger) = false','false',
         hermes_os.is_active_tenant_member('__pv2_tenant_b__')::text,
         case when hermes_os.is_active_tenant_member('__pv2_tenant_b__') is not true then 'PASS' else 'FAIL' end;

  j := public.finalize_pv_document(gen_random_uuid(), sa, 'PLAN', 'x', 'application/zip', 1000);
  insert into r (test,expected,actual,status) values (
    'T9: MIME hors allowlist refuse (chemin invalide -> refus en amont)','PATH_OUT_OF_SCOPE|BAD_MIME', coalesce(j->>'code','null'),
    case when j->>'code' in ('BAD_MIME','PATH_OUT_OF_SCOPE') then 'PASS' else 'FAIL' end);

  -- MIME refusé sur un chemin VALIDE : isole vraiment le contrôle de MIME.
  declare d2 uuid := gen_random_uuid();
  begin
    j := public.finalize_pv_document(d2, sa, 'PLAN',
           'heliosolar/'||sa::text||'/'||d2::text||'/x.zip', 'application/zip', 1000);
    insert into r (test,expected,actual,status) values (
      'T9b: MIME refuse sur un chemin par ailleurs valide','BAD_MIME', coalesce(j->>'code','null'),
      case when j->>'code' = 'BAD_MIME' then 'PASS' else 'FAIL' end);

    j := public.finalize_pv_document(d2, sa, 'PLAN',
           'heliosolar/'||sa::text||'/'||d2::text||'/gros.pdf', 'application/pdf', 26214401);
    insert into r (test,expected,actual,status) values (
      'T10: taille au-dela du plafond refusee','BAD_SIZE', coalesce(j->>'code','null'),
      case when j->>'code' = 'BAD_SIZE' then 'PASS' else 'FAIL' end);

    j := public.finalize_pv_document(d2, sb, 'PLAN',
           'heliosolar/'||sa::text||'/'||d2::text||'/ok.pdf', 'application/pdf', 1000);
    insert into r (test,expected,actual,status) values (
      'T10b: finaliser sur un site du tenant B refuse','NOT_FOUND', coalesce(j->>'code','null'),
      case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  end;

  begin
    insert into hermes_os.pv_documents (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes)
    values ('heliosolar',sa,'PLAN','https://exemple.test/fuite.pdf','application/pdf',1000);
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T11: URL publique INSTOCKABLE dans un chemin de document','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 13-16. HUMAIN / IA =====================
  -- Runner sans identité authentifiée : c'est le cas d'un Agent 4/5 en service_role.
  perform set_config('request.jwt.claims', '', true);
  begin
    update hermes_os.pv_energy_bills set status='VERIFIED', verified_by=v_uid, verified_at=now() where id=ba;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T13: Agent 4 (sans auth.uid) ne peut pas produire VERIFIED','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  begin
    update hermes_os.pv_studies set status='VALIDATED', validated_by=v_uid, validated_at=now() where id=st;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T14: Agent 5 (sans auth.uid) ne peut pas produire VALIDATED','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  j := public.validate_pv_study(st);
  insert into r (test,expected,actual,status) values (
    'T15a: un humain authentifie PEUT valider une etude','VALIDATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'VALIDATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T15b: validated_by = l''appelant lui-meme', v_uid::text, coalesce(validated_by::text,'null'),
         case when validated_by = v_uid then 'PASS' else 'FAIL' end
    from hermes_os.pv_studies where id = st;

  j := public.verify_pv_economics(ec);
  insert into r (test,expected,actual,status) values (
    'T15c: un humain authentifie PEUT verifier un chiffrage','VERIFIED', coalesce(j->>'code','null'),
    case when j->>'code' = 'VERIFIED' then 'PASS' else 'FAIL' end);

  -- Usurpation : valider au nom d'un AUTRE utilisateur, en SQL direct.
  begin
    update hermes_os.pv_energy_bills
       set status='VERIFIED', verified_by='99999999-9999-9999-9999-999999999999', verified_at=now()
     where id = ba;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T16: validation au nom d''un AUTRE utilisateur refusee','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T16b: aucune facade n''expose de parametre d''acteur (verified_by / validated_by)','0', count(*)::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like '%pv%'
     and pg_get_function_identity_arguments(p.oid) ~* '(verified_by|validated_by|promoted_by|p_actor|p_user_id)';

  -- La promotion PROPOSE, elle ne certifie pas.
  j := public.promote_pv_bill_extraction(xa);
  insert into r (test,expected,actual,status)
  select 'T16c: promouvoir une lecture IA aboutit a NEEDS_REVIEW, jamais VERIFIED','NEEDS_REVIEW', status,
         case when status = 'NEEDS_REVIEW' then 'PASS' else 'FAIL' end
    from hermes_os.pv_energy_bills where id = ba;

  -- ===================== TENANT_ID JAMAIS ACCEPTÉ =====================
  insert into r (test,expected,actual,status)
  select 'TZ: aucune facade PV n''accepte de tenant_id','0', count(*)::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and (p.proname like '%\_pv\_%' or p.proname like 'get\_pv\_%' or p.proname like 'promote\_pv%')
     and pg_get_function_identity_arguments(p.oid) ~* 'tenant';
end;
$$;

-- ===================== HORS BLOC : ÉTAT DÉCLARATIF =====================

-- 7. Bucket strictement privé + plafond + allowlist MIME.
insert into r (test,expected,actual,status)
select 'T7: bucket hermes-pv-documents PRIVE, 25 MiB, 4 MIME','false|26214400|4',
       coalesce(b.public::text,'?')||'|'||coalesce(b.file_size_limit::text,'?')||'|'||
       coalesce(array_length(b.allowed_mime_types,1)::text,'?'),
       case when b.public = false and b.file_size_limit = 26214400
             and array_length(b.allowed_mime_types,1) = 4 then 'PASS' else 'FAIL' end
  from storage.buckets b where b.id = 'hermes-pv-documents';

insert into r (test,expected,actual,status)
select 'T7b: 3 policies storage bornees au bucket ET au tenant, 0 policy DELETE','3|0',
       count(*) filter (where p.policyname like 'hermes_pv_documents%')::text || '|' ||
       count(*) filter (where p.policyname like 'hermes_pv_documents%' and p.cmd = 'DELETE')::text,
       case when count(*) filter (where p.policyname like 'hermes_pv_documents%') = 3
             and count(*) filter (where p.policyname like 'hermes_pv_documents%' and p.cmd = 'DELETE') = 0
            then 'PASS' else 'FAIL' end
  from pg_policies p where p.schemaname = 'storage';

insert into r (test,expected,actual,status)
select 'T11b: les 3 policies derivent le tenant du 1er segment du chemin','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from pg_policies p
 where p.schemaname = 'storage' and p.policyname like 'hermes_pv_documents%'
   and coalesce(p.qual,'') || coalesce(p.with_check,'') like '%is_active_tenant_member%';

-- 17-19. Capacités PV.
insert into r (test,expected,actual,status)
select 'T17: 3 capacites PV presentes','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key in ('pv.bill.extract','pv.study.prepare','pv.economics.compute');

insert into r (test,expected,actual,status)
select 'T18: 3 capacites PV enabled=false','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key like 'pv.%' and enabled = false;

insert into r (test,expected,actual,status)
select 'T19: 3 capacites PV is_sensitive=true','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key like 'pv.%' and is_sensitive = true;

insert into r (test,expected,actual,status)
select 'T19b: aucune capacite PV ne cible un workflow n8n','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key like 'pv.%' and (target_workflow_id is not null or target_agent is not null);

insert into r (test,expected,actual,status)
select 'T19c: payload schema strict (1 cle obligatoire par capacite)','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key like 'pv.%' and array_length(required_payload_keys,1) >= 1
   and required_permission = 'tenant.member';

-- 20. Aucun consumer actif.
insert into r (test,expected,actual,status)
select 'T20: aucun consumer PV actif','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled = true;

-- 21-22. Politiques SW15.
insert into r (test,expected,actual,status)
select 'T21: 3 politiques SW15 PV ACTIVE + REQUIRE_APPROVAL','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.sw15_policies
 where action_pattern like 'pv.%' and status = 'ACTIVE' and effect = 'REQUIRE_APPROVAL';

insert into r (test,expected,actual,status)
select 'T22: aucun PERMIT ACTIF sur une action PV sensible','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from hermes_os.sw15_policies
 where action_pattern like 'pv.%' and status = 'ACTIVE' and effect = 'PERMIT';

-- RLS / GRANT.
insert into r (test,expected,actual,status)
select 'TR1: pv_documents — RLS activee, 0 policy (deny-all)','true|0',
       c.relrowsecurity::text || '|' ||
       (select count(*) from pg_policies p where p.schemaname='hermes_os' and p.tablename='pv_documents')::text,
       case when c.relrowsecurity
             and (select count(*) from pg_policies p where p.schemaname='hermes_os' and p.tablename='pv_documents') = 0
            then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='hermes_os' and c.relname='pv_documents';

insert into r (test,expected,actual,status)
select 'TR2: aucun GRANT anon sur une facade PV','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where grantee = 'anon' and specific_schema = 'public' and routine_name like '%pv%';

insert into r (test,expected,actual,status)
select 'TR3: toutes les facades PV sont SECURITY DEFINER avec search_path verrouille',
       '0', count(*)::text, case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and (p.proname like 'get\_pv\_%' or p.proname like '%\_pv\_%' or p.proname like 'promote\_pv%')
   and (p.prosecdef = false or p.proconfig is null
        or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));

insert into r (test,expected,actual,status)
select 'TR4: aucun acces direct des roles applicatifs aux tables pv_*','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants
 where table_schema = 'hermes_os' and table_name like 'pv\_%'
   and grantee in ('anon','authenticated');

-- 28-32. NON-RÉGRESSION.
insert into r (test,expected,actual,status)
select 'T28: Phase 1 — gate SW15 toujours FAIL-CLOSED','FAIL_CLOSED_OK',
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'FAIL_CLOSED_OK' else 'REGRESSION' end,
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hermes_os' and p.proname='gateway_policy_gate';

insert into r (test,expected,actual,status)
select 'T28b: Phase 1 — 3 politiques BTP ACTIVE / REQUIRE_APPROVAL','3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from hermes_os.sw15_policies
 where action_pattern like 'btp.%' and status='ACTIVE' and effect='REQUIRE_APPROVAL';

insert into r (test,expected,actual,status)
select 'T29: Phase 2 — TTL de file + FK tenant presentes','2', count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
  from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='hermes_os' and p.proname='expire_stale_queued_agent_actions'
    union all
    select 1 from pg_constraint where conname='agent_action_requests_tenant_id_fkey'
  ) x;

insert into r (test,expected,actual,status)
select 'T30: PV-1 — 9 tables metier toujours presentes','9', count(*)::text,
       case when count(*) = 9 then 'PASS' else 'FAIL' end
  from information_schema.tables
 where table_schema='hermes_os' and table_name in
   ('pv_prospects','pv_prospect_transitions','pv_sites','pv_consumption_profiles',
    'pv_energy_bills','pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics');

insert into r (test,expected,actual,status)
select 'T30b: PV-1 — 33 transitions de reference intactes','33', count(*)::text,
       case when count(*) = 33 then 'PASS' else 'FAIL' end
  from hermes_os.pv_prospect_transitions;

insert into r (test,expected,actual,status)
select 'T31: les requetes reelles restent QUEUED (>= 11, aucune expiree par ce lot)','>=11', count(*)::text,
       case when count(*) >= 11 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

insert into r (test,expected,actual,status)
select 'T32: n8n inchange — 5 capacites actives, aucune PV, 0 runner PV','5|0|0',
       (select count(*) from hermes_os.agent_action_catalog where enabled=true)::text || '|' ||
       (select count(*) from hermes_os.agent_action_catalog where enabled=true and action_key like 'pv.%')::text || '|' ||
       (select count(*) from hermes_os.resolver_runtime_config where enabled=true and action_key like 'pv.%')::text,
       case when (select count(*) from hermes_os.agent_action_catalog where enabled=true) = 5
             and (select count(*) from hermes_os.agent_action_catalog where enabled=true and action_key like 'pv.%') = 0
             and (select count(*) from hermes_os.resolver_runtime_config where enabled=true and action_key like 'pv.%') = 0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T32b: tables des autres verticales inchangees (photo/immo/btp/peinture)','43', count(*)::text,
       case when count(*) = 43 then 'PASS' else 'FAIL' end
  from information_schema.tables
 where table_schema='hermes_os'
   and (table_name like 'photo\_%' or table_name like 'immo\_%' or table_name like 'btp\_%'
        or table_name like 'peinture\_%');

select status, count(*) from r group by status order by status;
select id, status, test, expected, actual from r order by id;

rollback;
