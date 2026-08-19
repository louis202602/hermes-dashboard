-- Assertions REPRODUCTIBLES pour le LOT PV-1 (modèle de données photovoltaïque).
--
-- Transaction ROLLED BACK : rien n'est persisté. Le tenant B est SYNTHÉTIQUE ;
-- le tenant A est `heliosolar` (réel) mais AUCUNE ligne n'y survit à la
-- transaction — vérifié par ailleurs (0 ligne PV en production).
--
-- Substituer un uuid de `tenant.member` réel pour :member avant exécution.
-- Exécution (psql) : \i db/tests/pv1_schema.test.sql
--
-- Couverture des 12 tests exigés :
--   T1/T1b  isolation lecture + FK composite inter-tenant
--   T2      tenant_id immuable (pas de déplacement de ligne)
--   T3      FK tenant invalide refusée
--   T4      statut prospect invalide refusé
--   T5      transition interdite refusée / transition légale acceptée
--   T6      facture : un runner ne peut pas atteindre VERIFIED ; usurpation refusée
--   T7      étude AGENT_5 ne peut pas s'auto-valider
--   T8      économique ne peut pas s'auto-vérifier
--   T9      suppression prospect/site refusée tant qu'il reste des données
--   T10     le rollback du lot fonctionne et ne retire QUE le lot
--   T11     aucune table d'une autre verticale touchée
--   T12     aucune capacité / aucun runner n8n activé
--   + AUDIT (brique existante réutilisée), PROMO (promotion ≠ certification), RLS

\set member '00000000-0000-0000-0000-000000000000'

begin;
set local pv.member = :'member';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;

insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv_tenant_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.member')::uuid;
  pa uuid; pb uuid; sa uuid; ba uuid; st uuid; ec uuid; v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','Dupont','0600000000',v_uid) returning id into pa;
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv_tenant_b__','PROFESSIONNEL','SARL B','b@b.fr') returning id into pb;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pa,'1 rue A','13100','Aix') returning id into sa;

  -- T3
  begin
    insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone)
    values ('__tenant_inexistant__','PARTICULIER','X','0600000001');
    v := 'ACCEPTE';
  exception when foreign_key_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T3: FK tenant invalide refusée','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- T1b : la FK COMPOSITE (tenant_id, id) empêche un site de A de pointer un prospect de B
  begin
    insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
    values ('heliosolar',pb,'3 rue X','13100','Aix');
    v := 'ACCEPTE';
  exception when foreign_key_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T1b: site A -> prospect B refusé (FK composite)','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- T2
  begin
    update hermes_os.pv_prospects set tenant_id='__pv_tenant_b__' where id=pa;
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T2: déplacement de tenant refusé','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- T4
  begin
    update hermes_os.pv_prospects set status='BIDON' where id=pa;
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T4: statut prospect invalide refusé','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- T5
  begin
    update hermes_os.pv_prospects set status='WON' where id=pa;
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T5a: transition NEW -> WON refusée','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);
  update hermes_os.pv_prospects set status='CONTACTED' where id=pa;
  insert into r (test,expected,actual,status)
  select 'T5b: transition NEW -> CONTACTED acceptée','CONTACTED',status, case when status='CONTACTED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_prospects where id=pa;

  -- T6 : la validation exige l'utilisateur authentifié APPELANT
  insert into hermes_os.pv_energy_bills (tenant_id,site_id,status,supplier)
  values ('heliosolar',sa,'EXTRACTED','EDF') returning id into ba;
  perform set_config('request.jwt.claims','',true);   -- cas « runner / service_role »
  begin
    update hermes_os.pv_energy_bills set status='VERIFIED', verified_by=v_uid, verified_at=now() where id=ba;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE_NON_HUMAIN'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T6a: facture VERIFIED par un runner refusée','REFUSE_NON_HUMAIN',v, case when v='REFUSE_NON_HUMAIN' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);
  begin
    update hermes_os.pv_energy_bills set status='VERIFIED', verified_by='00000000-0000-0000-0000-0000000000aa', verified_at=now() where id=ba;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE_USURPATION'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T6b: validation au nom d''autrui refusée','REFUSE_USURPATION',v, case when v='REFUSE_USURPATION' then 'PASS' else 'FAIL' end);

  update hermes_os.pv_energy_bills set status='VERIFIED', verified_by=v_uid, verified_at=now() where id=ba;
  insert into r (test,expected,actual,status)
  select 'T6c: validation par l''humain authentifié acceptée','VERIFIED',status, case when status='VERIFIED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_energy_bills where id=ba;

  -- T7
  insert into hermes_os.pv_studies (tenant_id,site_id,status,prepared_by,source,target_power_kwc,calculated_at)
  values ('heliosolar',sa,'CALCULATED','AGENT_5','PVGIS',9.0,now()) returning id into st;
  perform set_config('request.jwt.claims','',true);
  begin
    update hermes_os.pv_studies set status='VALIDATED', validated_by=v_uid, validated_at=now() where id=st;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE_NON_HUMAIN'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T7a: étude AGENT_5 auto-validée refusée','REFUSE_NON_HUMAIN',v, case when v='REFUSE_NON_HUMAIN' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T7b: l''étude reste CALCULATED / AGENT_5','CALCULATED/AGENT_5',status||'/'||prepared_by,
         case when status='CALCULATED' and prepared_by='AGENT_5' then 'PASS' else 'FAIL' end
    from hermes_os.pv_studies where id=st;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  -- T8
  insert into hermes_os.pv_economics (tenant_id,study_id,status,computed_by,investment_ht_eur)
  values ('heliosolar',st,'CALCULATED','AGENT_5',15000) returning id into ec;
  perform set_config('request.jwt.claims','',true);
  begin
    update hermes_os.pv_economics set status='VERIFIED', verified_by=v_uid, verified_at=now() where id=ec;
    v := 'ACCEPTE';
  exception when insufficient_privilege then v := 'REFUSE_NON_HUMAIN'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T8: économique auto-vérifiée refusée','REFUSE_NON_HUMAIN',v, case when v='REFUSE_NON_HUMAIN' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.member'), 'role', 'authenticated')::text, true);

  -- T9 : ON DELETE RESTRICT
  begin
    delete from hermes_os.pv_prospects where id=pa; v := 'SUPPRIME';
  exception when foreign_key_violation then v := 'REFUSE_RESTRICT'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T9a: suppression prospect avec site refusée','REFUSE_RESTRICT',v, case when v='REFUSE_RESTRICT' then 'PASS' else 'FAIL' end);
  begin
    delete from hermes_os.pv_sites where id=sa; v := 'SUPPRIME';
  exception when foreign_key_violation then v := 'REFUSE_RESTRICT'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values ('T9b: suppression site avec facture/étude refusée','REFUSE_RESTRICT',v, case when v='REFUSE_RESTRICT' then 'PASS' else 'FAIL' end);

  -- PROMO : une extraction promue passe en NEEDS_REVIEW, JAMAIS en VERIFIED
  insert into hermes_os.pv_energy_bills (tenant_id,site_id,status) values ('heliosolar',sa,'RECEIVED') returning id into ba;
  insert into hermes_os.pv_energy_bill_extractions (tenant_id,bill_id,extracted_by,confidence,consumption_kwh,supplier)
  values ('heliosolar',ba,'AGENT_4',0.91,4200,'EDF');
  perform hermes_os.pv_promote_bill_extraction((select id from hermes_os.pv_energy_bill_extractions where bill_id=ba));
  insert into r (test,expected,actual,status)
  select 'PROMO: extraction promue => NEEDS_REVIEW, jamais VERIFIED','NEEDS_REVIEW',status,
         case when status='NEEDS_REVIEW' then 'PASS' else 'FAIL' end from hermes_os.pv_energy_bills where id=ba;

  -- AUDIT : brique EXISTANTE réutilisée. Seules les transitions ABOUTIES sont tracées :
  -- CONTACTED (1) + facture VERIFIED (2) + promotion (3). Les refus n'écrivent rien.
  insert into r (test,expected,actual,status)
  select 'AUDIT: transitions abouties tracées dans entity_audit_log','3',count(*)::text,
         case when count(*)=3 then 'PASS' else 'FAIL' end
    from hermes_os.entity_audit_log where entity_type like 'pv\_%';
end $$;

-- T1 : aucune lecture directe en `authenticated` (RLS deny-all + aucun GRANT)
set local role authenticated;
do $$
declare n int; v text;
begin
  begin
    execute 'select count(*) from hermes_os.pv_prospects' into n; v := 'LU:'||n::text;
  exception when insufficient_privilege then v := 'REFUSE_42501'; when others then v := 'AUTRE:'||sqlstate; end;
  perform set_config('pv.t1', v, true);
end $$;
reset role;
insert into r (test,expected,actual,status)
select 'T1: lecture directe pv_prospects en authenticated','REFUSE_42501',current_setting('pv.t1'),
       case when current_setting('pv.t1')='REFUSE_42501' then 'PASS' else 'FAIL' end;

-- RLS effective
insert into r (test,expected,actual,status)
select 'RLS: 9 tables PV en RLS, 0 policy','9/0',
       count(*)::text||'/'||sum((select count(*) from pg_policy p where p.polrelid=c.oid))::text,
       case when count(*)=9 and sum((select count(*) from pg_policy p where p.polrelid=c.oid))=0 then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='hermes_os' and c.relname like 'pv\_%' and c.relkind='r' and c.relrowsecurity;

-- T12 : périmètre n8n intact
insert into r (test,expected,actual,status)
select 'T12a: aucune capacité pv.* dans le catalogue','0',count(*)::text, case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where action_key like 'pv.%'
union all
select 'T12b: capacités actives inchangées','5',count(*)::text, case when count(*)=5 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where enabled
union all
select 'T12c: aucun runner activé','0',count(*)::text, case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.resolver_runtime_config where enabled;

-- T10 : le rollback du lot (contenu EXACT de 20260819_pv1_9_rollback.sql)
do $$
declare t text; n_avant int; n_apres int; n_tot_avant int; n_tot_apres int;
begin
  select count(*) into n_avant     from information_schema.tables where table_schema='hermes_os' and table_name like 'pv\_%';
  select count(*) into n_tot_avant from information_schema.tables where table_schema='hermes_os';

  foreach t in array array['pv_prospects','pv_sites','pv_consumption_profiles','pv_energy_bills',
                           'pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics']
  loop
    if to_regclass('hermes_os.'||t) is not null then
      execute format('drop trigger if exists trg_%1$s_tenant_immutable on hermes_os.%1$s;', t);
      execute format('drop trigger if exists trg_%1$s_updated_at on hermes_os.%1$s;', t);
    end if;
  end loop;
  drop trigger if exists trg_pv_prospects_status_guard       on hermes_os.pv_prospects;
  drop trigger if exists trg_pv_bills_human_validation       on hermes_os.pv_energy_bills;
  drop trigger if exists trg_pv_consumption_human_validation on hermes_os.pv_consumption_profiles;
  drop trigger if exists trg_pv_studies_human_validation     on hermes_os.pv_studies;
  drop trigger if exists trg_pv_economics_human_validation   on hermes_os.pv_economics;
  drop function if exists hermes_os.pv_promote_bill_extraction(uuid);
  drop function if exists hermes_os.pv_human_validation_guard();
  drop function if exists hermes_os.pv_prospect_status_guard();
  drop function if exists hermes_os.pv_tenant_immutable();
  drop function if exists hermes_os._pv_audit(text, text, uuid, jsonb, jsonb, text);
  drop table if exists hermes_os.pv_economics;
  drop table if exists hermes_os.pv_study_assumptions;
  drop table if exists hermes_os.pv_studies;
  drop table if exists hermes_os.pv_energy_bill_extractions;
  drop table if exists hermes_os.pv_energy_bills;
  drop table if exists hermes_os.pv_consumption_profiles;
  drop table if exists hermes_os.pv_sites;
  drop table if exists hermes_os.pv_prospect_transitions;
  drop table if exists hermes_os.pv_prospects;

  select count(*) into n_apres     from information_schema.tables where table_schema='hermes_os' and table_name like 'pv\_%';
  select count(*) into n_tot_apres from information_schema.tables where table_schema='hermes_os';
  insert into r (test,expected,actual,status) values
    ('T10a: 9 tables PV avant rollback','9',n_avant::text, case when n_avant=9 then 'PASS' else 'FAIL' end),
    ('T10b: 0 table PV après rollback','0',n_apres::text, case when n_apres=0 then 'PASS' else 'FAIL' end),
    ('T10c: le rollback ne retire QUE les 9 tables PV','9',(n_tot_avant-n_tot_apres)::text,
     case when (n_tot_avant-n_tot_apres)=9 then 'PASS' else 'FAIL' end),
    ('T10d: aucune fonction PV résiduelle','0',
     (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hermes_os' and p.proname like 'pv\_%'),
     case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hermes_os' and p.proname like 'pv\_%')=0 then 'PASS' else 'FAIL' end);
end $$;

-- T11 + non-régression des phases précédentes (après le rollback PV)
insert into r (test,expected,actual,status)
select 'T11: verticales photo/immo/peinture/btp intactes','>=40',count(*)::text, case when count(*)>=40 then 'PASS' else 'FAIL' end
  from information_schema.tables where table_schema='hermes_os'
   and (table_name like 'photo\_%' or table_name like 'immo\_%' or table_name like 'peinture\_%' or table_name like 'btp\_%')
union all
select 'PHASE1: gate toujours fail-closed','OK',
       (select case when prosrc like '%FAIL-CLOSED%' then 'OK' else 'REGRESSION' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hermes_os' and p.proname='gateway_policy_gate'),
       (select case when prosrc like '%FAIL-CLOSED%' then 'PASS' else 'FAIL' end
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hermes_os' and p.proname='gateway_policy_gate')
union all
select 'PHASE2: fonction TTL toujours présente','OK', case when count(*)=1 then 'OK' else 'ABSENTE' end, case when count(*)=1 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hermes_os' and p.proname='expire_stale_queued_agent_actions'
union all
select 'DATA: les 11 requêtes réelles intactes','11',count(*)::text, case when count(*)=11 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

select id, test, expected, actual, status from r order by id;

rollback;
