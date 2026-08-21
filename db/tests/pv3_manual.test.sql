-- Assertions REPRODUCTIBLES pour le LOT PV-3 (exploitation manuelle).
--
-- Transaction ROLLED BACK : rien n'est persisté. Le tenant B est SYNTHETIQUE.
-- Substituer un uuid de `tenant.member` reel pour :member avant execution.
-- Execution (psql) : \i db/tests/pv3_manual.test.sql
--
-- Couverture des tests exiges (numerotation de la mission) :
--   8-10   documents : suppression logique conservatrice, purge bornee au
--          tenant, purge rejouee idempotente
--   13-15  consommation : humain peut VERIFY, non-humain ne peut pas,
--          usurpation refusee
--   16-20  etude : creation DRAFT, modification, transition invalide refusee,
--          validation humaine, Agent 5 toujours incapable de VALIDATE
--   21-24  economie : creation DRAFT, modification, VERIFY humain,
--          non-humain incapable
--   29-33  non-regression : Phase 1, Phase 2, PV-1, PV-2, capacites desactivees
--   + isolation tenant A / tenant B sur TOUTES les facades nouvelles
--
-- Les tests 3-7 (upload, MIME, taille, URL signee) portent sur la couche
-- Storage et le service TypeScript : voir `tests/pv3-manual.test.ts`.

\set member '00000000-0000-0000-0000-000000000000'

begin;
set local pv.member = :'member';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;

insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv3_tenant_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.member')::uuid;
  pa uuid; pb uuid; sa uuid; sb uuid; cpa uuid; cpb uuid;
  st uuid; stb uuid; ec uuid; da uuid; db_ uuid;
  v text; j jsonb; n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','Martin','0600000000',v_uid) returning id into pa;
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv3_tenant_b__','PROFESSIONNEL','SARL B','b@b.fr') returning id into pb;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pa,'1 rue A','13100','Aix') returning id into sa;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv3_tenant_b__',pb,'2 rue B','75001','Paris') returning id into sb;
  insert into hermes_os.pv_consumption_profiles (tenant_id,site_id,annual_consumption_kwh)
  values ('heliosolar',sa,5200) returning id into cpa;
  insert into hermes_os.pv_consumption_profiles (tenant_id,site_id,annual_consumption_kwh)
  values ('__pv3_tenant_b__',sb,3000) returning id into cpb;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status)
  values ('__pv3_tenant_b__',sb,1,'MANUAL','DRAFT') returning id into stb;

  -- ============ 16-17. ETUDE : creation et modification manuelles ============
  j := public.upsert_pv_study(null, sa, 9.000, 20, 450.0);
  st := (j->>'study_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T16a: un humain PEUT creer une etude','CREATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'CREATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T16b: une etude creee a la main naît en DRAFT, prepared_by=MANUAL','DRAFT|MANUAL',
         status||'|'||prepared_by,
         case when status='DRAFT' and prepared_by='MANUAL' then 'PASS' else 'FAIL' end
    from hermes_os.pv_studies where id = st;
  insert into r (test,expected,actual,status)
  select 'T16c: la version est calculee EN BASE','1', version::text,
         case when version = 1 then 'PASS' else 'FAIL' end
    from hermes_os.pv_studies where id = st;

  j := public.upsert_pv_study(st, null, 10.500);
  insert into r (test,expected,actual,status) values (
    'T17a: un humain PEUT modifier une etude','UPDATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UPDATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T17b: la modification est bien appliquee','10.500', target_power_kwc::text,
         case when target_power_kwc = 10.5 then 'PASS' else 'FAIL' end
    from hermes_os.pv_studies where id = st;

  j := public.upsert_pv_study_assumptions(st, 0.2516, 4.00, 25);
  insert into r (test,expected,actual,status) values (
    'T17c: les hypotheses typees sont enregistrables','OK', coalesce(j->>'code','null'),
    case when j->>'code' = 'OK' then 'PASS' else 'FAIL' end);

  -- ============ 18. TRANSITION INVALIDE REFUSEE ============
  begin
    update hermes_os.pv_studies set status='VALIDATED', validated_by=v_uid, validated_at=now() where id=st;
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T18a: DRAFT -> VALIDATED refuse par la machine a etats','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  j := public.set_pv_study_status(st, 'SUPERSEDED');
  insert into r (test,expected,actual,status) values (
    'T18b: DRAFT -> SUPERSEDED accepte (chemin declare)','UPDATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UPDATED' then 'PASS' else 'FAIL' end);
  j := public.set_pv_study_status(st, 'CALCULATED');
  insert into r (test,expected,actual,status) values (
    'T18c: SUPERSEDED -> CALCULATED refuse (aucun chemin sortant)','TRANSITION_REFUSED',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'TRANSITION_REFUSED' then 'PASS' else 'FAIL' end);

  j := public.set_pv_study_status(st, 'VALIDATED');
  insert into r (test,expected,actual,status) values (
    'T18d: la facade de statut REFUSE de valider (porte derobee fermee)','USE_VALIDATION_FACADE',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'USE_VALIDATION_FACADE' then 'PASS' else 'FAIL' end);

  -- ============ 19-20. VALIDATION HUMAINE ============
  -- Nouvelle etude, amenee proprement a CALCULATED.
  j := public.upsert_pv_study(null, sa, 9.000);
  st := (j->>'study_id')::uuid;
  perform public.set_pv_study_status(st, 'CALCULATED');

  perform set_config('request.jwt.claims', '', true);
  begin
    update hermes_os.pv_studies set status='VALIDATED', validated_by=v_uid, validated_at=now() where id=st;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T20: Agent 5 (sans auth.uid) reste incapable de VALIDATE','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);
  j := public.validate_pv_study(st);
  insert into r (test,expected,actual,status) values (
    'T19: un humain autorise PEUT valider','VALIDATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'VALIDATED' then 'PASS' else 'FAIL' end);

  -- ============ 21-24. ECONOMIE ============
  j := public.upsert_pv_economics(null, st, 15000, 18000);
  ec := (j->>'economics_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T21a: un humain PEUT creer un chiffrage','CREATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'CREATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T21b: un chiffrage cree a la main naît en DRAFT / MANUAL','DRAFT|MANUAL',
         status||'|'||computed_by,
         case when status='DRAFT' and computed_by='MANUAL' then 'PASS' else 'FAIL' end
    from hermes_os.pv_economics where id = ec;

  j := public.upsert_pv_economics(ec, null, null, null, 3000, 15000);
  insert into r (test,expected,actual,status) values (
    'T22: un humain PEUT modifier un chiffrage','UPDATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UPDATED' then 'PASS' else 'FAIL' end);

  j := public.set_pv_economics_status(ec, 'VERIFIED');
  insert into r (test,expected,actual,status) values (
    'T23a: la facade de statut REFUSE de verifier','USE_VALIDATION_FACADE',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'USE_VALIDATION_FACADE' then 'PASS' else 'FAIL' end);
  perform public.set_pv_economics_status(ec, 'CALCULATED');
  j := public.verify_pv_economics(ec);
  insert into r (test,expected,actual,status) values (
    'T23b: un humain PEUT verifier un chiffrage','VERIFIED', coalesce(j->>'code','null'),
    case when j->>'code' = 'VERIFIED' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '', true);
  begin
    insert into hermes_os.pv_economics (tenant_id, study_id, status, computed_by, verified_by, verified_at)
    values ('heliosolar', st, 'VERIFIED', 'AGENT_5', v_uid, now());
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T24: un non-humain ne peut pas creer un chiffrage VERIFIED','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  -- ============ 13-15. CONSOMMATION ============
  begin
    update hermes_os.pv_consumption_profiles
       set verification_status='VERIFIED', verified_by=v_uid, verified_at=now() where id=cpa;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T14: un runner (sans auth.uid) ne peut pas VERIFIER une consommation','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);
  begin
    update hermes_os.pv_consumption_profiles
       set verification_status='VERIFIED',
           verified_by='99999999-9999-9999-9999-999999999999', verified_at=now()
     where id=cpa;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T15: verification de consommation au nom d un AUTRE refusee','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  j := public.verify_pv_consumption_profile(cpa);
  insert into r (test,expected,actual,status) values (
    'T13a: un humain PEUT verifier une consommation','VERIFIED', coalesce(j->>'code','null'),
    case when j->>'code' = 'VERIFIED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T13b: verified_by = l appelant lui-meme', v_uid::text, coalesce(verified_by::text,'null'),
         case when verified_by = v_uid then 'PASS' else 'FAIL' end
    from hermes_os.pv_consumption_profiles where id = cpa;

  -- ============ 8-10. DOCUMENTS : suppression logique et purge ============
  insert into hermes_os.pv_documents (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,uploaded_by)
  values ('heliosolar',sa,'FACTURE_ENERGIE','heliosolar/'||sa::text||'/doc-a/f.pdf','application/pdf',120000,v_uid)
  returning id into da;
  insert into hermes_os.pv_documents (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes)
  values ('__pv3_tenant_b__',sb,'PLAN','__pv3_tenant_b__/'||sb::text||'/doc-b/p.pdf','application/pdf',90000)
  returning id into db_;

  j := public.mark_pv_document_purged(da);
  insert into r (test,expected,actual,status) values (
    'T8a: purger un document NON supprime est refuse','NOT_DELETED', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_DELETED' then 'PASS' else 'FAIL' end);

  j := public.soft_delete_pv_document(da);
  insert into r (test,expected,actual,status) values (
    'T8b: suppression logique acceptee','DELETED', coalesce(j->>'code','null'),
    case when j->>'code' = 'DELETED' then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.pv_documents where id = da;
  insert into r (test,expected,actual,status) values (
    'T8c: la LIGNE metier survit a la suppression logique','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);

  j := public.mark_pv_document_purged(db_);
  insert into r (test,expected,actual,status) values (
    'T9a: purger un document du tenant B est refuse','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  j := public.list_pv_documents_to_purge('0 seconds', 100);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = db_);
  insert into r (test,expected,actual,status) values (
    'T9b: la liste a purger ne contient AUCUN document du tenant B','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = da);
  insert into r (test,expected,actual,status) values (
    'T9c: la liste a purger contient bien le document supprime de A','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- Le delai de grace protege un retrait recent : c'est la fenetre de rattrapage
  -- apres une suppression accidentelle. Sans elle, purger serait irreversible
  -- dans la seconde.
  j := public.list_pv_documents_to_purge('7 days', 100);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = da);
  insert into r (test,expected,actual,status) values (
    'T9d: le delai de grace de 7 jours protege un retrait recent','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  j := public.mark_pv_document_purged(da);
  insert into r (test,expected,actual,status) values (
    'T10a: enregistrement de la purge accepte','PURGED', coalesce(j->>'code','null'),
    case when j->>'code' = 'PURGED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T10b: chemin efface, ancien chemin conserve pour l audit','null|non-null',
         coalesce(storage_path,'null')||'|'||case when purged_path is null then 'null' else 'non-null' end,
         case when storage_path is null and purged_path is not null then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id = da;

  j := public.mark_pv_document_purged(da);
  insert into r (test,expected,actual,status) values (
    'T10c: purge REJOUEE = idempotente','ALREADY_PURGED', coalesce(j->>'code','null'),
    case when j->>'code' = 'ALREADY_PURGED' then 'PASS' else 'FAIL' end);
  j := public.list_pv_documents_to_purge('0 seconds', 100);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = da);
  insert into r (test,expected,actual,status) values (
    'T10d: un document purge ne reapparaît plus dans la liste','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- ============ ISOLATION TENANT A / TENANT B sur les NOUVELLES facades ============
  j := public.verify_pv_consumption_profile(cpb);
  insert into r (test,expected,actual,status) values (
    'TI1: A ne peut pas verifier la consommation de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.upsert_pv_study(stb, null, 99.000);
  insert into r (test,expected,actual,status) values (
    'TI2: A ne peut pas modifier une etude de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.upsert_pv_study(null, sb, 9.000);
  insert into r (test,expected,actual,status) values (
    'TI3: A ne peut pas creer une etude sur un site de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.upsert_pv_study_assumptions(stb, 0.30);
  insert into r (test,expected,actual,status) values (
    'TI4: A ne peut pas ecrire les hypotheses d une etude de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.set_pv_study_status(stb, 'CALCULATED');
  insert into r (test,expected,actual,status) values (
    'TI5: A ne peut pas changer le statut d une etude de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.upsert_pv_economics(null, stb, 1000);
  insert into r (test,expected,actual,status) values (
    'TI6: A ne peut pas creer un chiffrage sur une etude de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  select count(*) into n from hermes_os.pv_studies where id = stb and target_power_kwc = 99.000;
  insert into r (test,expected,actual,status) values (
    'TI7: l etude du tenant B est RESTEE intacte','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- ============ SANS TENANT / ANONYME sur les NOUVELLES facades ============
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-2222-3333-4444-555555555555','role','authenticated')::text, true);
  j := public.upsert_pv_study(null, sa, 9.000);
  insert into r (test,expected,actual,status) values (
    'TI8: creation d etude sans tenant refusee','NO_TENANT', coalesce(j->>'code','null'),
    case when j->>'code' = 'NO_TENANT' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '', true);
  j := public.upsert_pv_economics(null, st, 1000);
  insert into r (test,expected,actual,status) values (
    'TI9: creation de chiffrage par un anonyme refusee','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);
  j := public.list_pv_documents_to_purge('0 seconds', 10);
  insert into r (test,expected,actual,status) values (
    'TI10: lister les purgeables en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);

  -- ============ AUDIT ============
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);
  select count(*) into n from hermes_os.entity_audit_log
   where tenant_id='heliosolar' and entity_type in ('pv_studies','pv_economics','pv_consumption_profiles','pv_documents');
  insert into r (test,expected,actual,status) values (
    'TA1: les gestes humains sont traces dans entity_audit_log (brique existante)','>=6', n::text,
    case when n >= 6 then 'PASS' else 'FAIL' end);
end;
$$;

-- ============ ETAT DECLARATIF ============
insert into r (test,expected,actual,status)
select 'TD1: 8 nouvelles facades PV-3 exposees','8', count(*)::text,
       case when count(*) = 8 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
   ('verify_pv_consumption_profile','upsert_pv_study','upsert_pv_study_assumptions',
    'set_pv_study_status','upsert_pv_economics','set_pv_economics_status',
    'list_pv_documents_to_purge','mark_pv_document_purged');

insert into r (test,expected,actual,status)
select 'TD2: aucune facade PV-3 n accepte de tenant_id','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and (p.proname like '%\_pv\_%' or p.proname like 'get\_pv\_%' or p.proname like 'promote\_pv%')
   and pg_get_function_identity_arguments(p.oid) ~* 'tenant';

insert into r (test,expected,actual,status)
select 'TD3: aucune facade PV n expose de parametre d acteur','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.proname like '%pv%'
   and pg_get_function_identity_arguments(p.oid) ~* '(verified_by|validated_by|promoted_by|p_actor|p_user_id)';

insert into r (test,expected,actual,status)
select 'TD4: aucun GRANT anon sur une facade PV','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where grantee='anon' and specific_schema='public' and routine_name like '%pv%';

insert into r (test,expected,actual,status)
select 'TD5: machines a etats etude/chiffrage declarees en donnees','31', count(*)::text,
       case when count(*) = 31 then 'PASS' else 'FAIL' end
  from hermes_os.pv_status_transitions;

insert into r (test,expected,actual,status)
select 'TD6: pv_status_transitions en RLS deny-all, aucun acces direct','true|0',
       c.relrowsecurity::text||'|'||
       (select count(*) from pg_policies p where p.schemaname='hermes_os' and p.tablename='pv_status_transitions')::text,
       case when c.relrowsecurity
             and (select count(*) from pg_policies p where p.schemaname='hermes_os' and p.tablename='pv_status_transitions')=0
            then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='hermes_os' and c.relname='pv_status_transitions';

-- ============ 29-33. NON-REGRESSION ============
insert into r (test,expected,actual,status)
select 'T29: Phase 1 gate SW15 toujours FAIL-CLOSED','FAIL_CLOSED_OK',
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'FAIL_CLOSED_OK' else 'REGRESSION' end,
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hermes_os' and p.proname='gateway_policy_gate';

insert into r (test,expected,actual,status)
select 'T30: Phase 2 TTL + FK tenant presentes','2', count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
  from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='hermes_os' and p.proname='expire_stale_queued_agent_actions'
    union all
    select 1 from pg_constraint where conname='agent_action_requests_tenant_id_fkey'
  ) x;

insert into r (test,expected,actual,status)
select 'T31: PV-1 9 tables metier + 33 transitions prospect intactes','9|33',
       (select count(*) from information_schema.tables where table_schema='hermes_os' and table_name in
         ('pv_prospects','pv_prospect_transitions','pv_sites','pv_consumption_profiles',
          'pv_energy_bills','pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics'))::text
       ||'|'||(select count(*) from hermes_os.pv_prospect_transitions)::text,
       case when (select count(*) from information_schema.tables where table_schema='hermes_os' and table_name in
                   ('pv_prospects','pv_prospect_transitions','pv_sites','pv_consumption_profiles',
                    'pv_energy_bills','pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics')) = 9
             and (select count(*) from hermes_os.pv_prospect_transitions) = 33
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T32: PV-2 intact — 23 facades, bucket prive, 3 policies storage','23|false|3',
       (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and (p.proname like 'get\_pv\_%' or p.proname like '%\_pv\_%' or p.proname like 'promote\_pv%')
           and p.proname not in ('verify_pv_consumption_profile','upsert_pv_study','upsert_pv_study_assumptions',
                                 'set_pv_study_status','upsert_pv_economics','set_pv_economics_status',
                                 'list_pv_documents_to_purge','mark_pv_document_purged','get_pv_pilot_snapshot'))::text
       ||'|'||(select public::text from storage.buckets where id='hermes-pv-documents')
       ||'|'||(select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%')::text,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and (p.proname like 'get\_pv\_%' or p.proname like '%\_pv\_%' or p.proname like 'promote\_pv%')
                     and p.proname not in ('verify_pv_consumption_profile','upsert_pv_study','upsert_pv_study_assumptions',
                                           'set_pv_study_status','upsert_pv_economics','set_pv_economics_status',
                                           'list_pv_documents_to_purge','mark_pv_document_purged','get_pv_pilot_snapshot')) = 23
             and (select public from storage.buckets where id='hermes-pv-documents') = false
             and (select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%') = 3
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T33: capacites PV toujours desactivees, 0 consumer, 0 PERMIT actif','3|0|0',
       (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false)::text
       ||'|'||(select count(*) from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled=true)::text
       ||'|'||(select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')::text,
       case when (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false) = 3
             and (select count(*) from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled=true) = 0
             and (select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT') = 0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T37: requetes reelles toujours QUEUED (>= 11)','>=11', count(*)::text,
       case when count(*) >= 11 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

select id, status, test, expected, actual from r order by id;

rollback;
