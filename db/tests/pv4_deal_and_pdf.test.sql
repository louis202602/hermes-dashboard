-- Assertions REPRODUCTIBLES pour le LOT PV-4 (dossier commercial).
--
-- Transaction ROLLED BACK : rien n'est persiste. Le tenant B est SYNTHETIQUE.
-- Substituer un uuid de `tenant.admin` reel pour :admin avant execution.
-- Execution (psql) : \i db/tests/pv4_deal_and_pdf.test.sql
--
-- Couverture (numerotation de la mission PV-4) :
--   1-8    purge : reservee a TENANT_ADMIN, membre refuse, A ne purge pas B,
--          delai de grace revalide cote serveur, purge rejouee idempotente,
--          ancienne signature sans delai supprimee
--   9-12   journal de purge : contenu complet, borne au tenant, lisible par un
--          membre (transparence), refuse a l anonyme
--   13-20  vue Affaire : agregation seule, selection DETERMINISTE de l etude et
--          du chiffrage retenus, aucun DRAFT retenu, isolation tenant
--   21-33  PDF : DRAFT libre, FINAL conditionne EN BASE, idempotence par
--          request_id, perimetre de chemin, empreinte, taille, stade, rattachement
--   34-47  etat declaratif + non-regression PV-1 / PV-2 / PV-3 / Phase 1 / Phase 2
--
-- Les tests d interface (grille de widgets, confirmation explicite, vocabulaire
-- « Retirer » / « Purger definitivement ») et de contenu PDF sont dans
-- `tests/pv4-readiness.test.ts`, `tests/pv4-pdf.test.ts`, `tests/widgets.test.ts`.

\set admin '00000000-0000-0000-0000-000000000000'

begin;
set local pv.admin = :'admin';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;

insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv4_tenant_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.admin')::uuid;
  pa uuid; pb uuid; sa uuid; sb uuid; sb0 uuid;
  s_v1 uuid; s_v2 uuid; s_v3 uuid; s_b uuid;
  e_ok uuid; e_calc uuid; e_old uuid; e_other uuid;
  da uuid; db_ uuid; dgen uuid;
  v text; j jsonb; j2 jsonb; n int;
  v_grant text; v_grant_at timestamptz;
  h64 text := repeat('a', 64);
  h64b text := repeat('b', 64);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role', 'authenticated')::text, true);

  -- ===================== JEU D ESSAI =====================
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','Dupont','0600000001',v_uid) returning id into pa;
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv4_tenant_b__','PROFESSIONNEL','SARL B','b@b.fr') returning id into pb;

  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pa,'3 rue A','13100','Aix') returning id into sa;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv4_tenant_b__',pb,'4 rue B','75001','Paris') returning id into sb0;

  insert into hermes_os.pv_consumption_profiles
    (tenant_id,site_id,annual_consumption_kwh,verification_status,verified_by,verified_at)
  values ('heliosolar',sa,5200,'VERIFIED',v_uid,now());

  -- v1 VALIDEE, v2 BROUILLON PLUS RECENTE ET DE VERSION SUPERIEURE.
  -- C'est le piege que la selection deterministe doit eviter.
  insert into hermes_os.pv_studies
    (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sa,1,'MANUAL','VALIDATED',9.000,v_uid,now()) returning id into s_v1;
  insert into hermes_os.pv_studies
    (tenant_id,site_id,version,prepared_by,status,target_power_kwc)
  values ('heliosolar',sa,2,'MANUAL','DRAFT',12.000) returning id into s_v2;
  insert into hermes_os.pv_studies
    (tenant_id,site_id,version,prepared_by,status,target_power_kwc)
  values ('__pv4_tenant_b__',sb0,1,'MANUAL','DRAFT',7.000) returning id into s_b;

  -- Chiffrages de l etude v1 : un VERIFIE ancien, un VERIFIE recent, un CALCULE.
  insert into hermes_os.pv_economics
    (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at,created_at)
  values ('heliosolar',s_v1,'VERIFIED','MANUAL',14000,v_uid,now(),now() - interval '2 days')
  returning id into e_old;
  insert into hermes_os.pv_economics
    (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at,created_at)
  values ('heliosolar',s_v1,'VERIFIED','MANUAL',15000,v_uid,now(),now() - interval '1 hour')
  returning id into e_ok;
  insert into hermes_os.pv_economics
    (tenant_id,study_id,status,computed_by,investment_ht_eur,created_at)
  values ('heliosolar',s_v1,'CALCULATED','MANUAL',99000,now()) returning id into e_calc;
  -- Chiffrage rattache a une AUTRE etude (v2) : ne doit jamais etre retenu.
  insert into hermes_os.pv_economics
    (tenant_id,study_id,status,computed_by,investment_ht_eur)
  values ('heliosolar',s_v2,'CALCULATED','MANUAL',1234) returning id into e_other;

  -- ===================== 13-20. VUE AFFAIRE =====================
  j := public.get_pv_deal(pa);
  insert into r (test,expected,actual,status) values (
    'T13: la vue Affaire repond pour un prospect du tenant','OK', coalesce(j->>'code','null'),
    case when j->>'code' = 'OK' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status) values (
    'T14: etude RETENUE = la VALIDATED, pas le DRAFT plus recent', s_v1::text,
    coalesce(j->'retained_study'->>'id','null'),
    case when (j->'retained_study'->>'id')::uuid = s_v1 then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T14b: la derniere etude reste visible, distincte de la retenue', s_v2::text,
    coalesce(j->'latest_study'->>'id','null'),
    case when (j->'latest_study'->>'id')::uuid = s_v2 then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T15: chiffrage RETENU = le VERIFIED le plus recent DE l etude retenue', e_ok::text,
    coalesce(j->'retained_economics'->>'id','null'),
    case when (j->'retained_economics'->>'id')::uuid = e_ok then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T15b: un chiffrage CALCULATED n est JAMAIS retenu','VERIFIED',
    coalesce(j->'retained_economics'->>'status','null'),
    case when j->'retained_economics'->>'status' = 'VERIFIED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T15c: le chiffrage d une AUTRE etude n est pas retenu','non',
    case when (j->'retained_economics'->>'id')::uuid = e_other then 'oui' else 'non' end,
    case when (j->'retained_economics'->>'id')::uuid is distinct from e_other then 'PASS' else 'FAIL' end);

  -- Une etude VALIDATED de version SUPERIEURE devient la retenue.
  insert into hermes_os.pv_studies
    (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sa,3,'MANUAL','VALIDATED',11.000,v_uid,now()) returning id into s_v3;
  j2 := public.get_pv_deal(pa);
  insert into r (test,expected,actual,status) values (
    'T16: la VALIDATED de plus haute version devient la retenue', s_v3::text,
    coalesce(j2->'retained_study'->>'id','null'),
    case when (j2->'retained_study'->>'id')::uuid = s_v3 then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T16b: aucun chiffrage retenu si la nouvelle etude n en a pas','null',
    case when j2->'retained_economics' = 'null'::jsonb then 'null' else 'non-null' end,
    case when j2->'retained_economics' = 'null'::jsonb then 'PASS' else 'FAIL' end);
  update hermes_os.pv_studies set status='SUPERSEDED' where id = s_v3;

  -- Aucune etude VALIDEE => aucune etude retenue (et surtout pas un DRAFT).
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','SansEtude','0600000002',v_uid) returning id into pb;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pb,'5 rue A','13100','Aix') returning id into sb;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status)
  values ('heliosolar',sb,1,'MANUAL','DRAFT');
  j2 := public.get_pv_deal(pb);
  insert into r (test,expected,actual,status) values (
    'T17: un DRAFT seul et recent n est JAMAIS retenu','null',
    case when j2->'retained_study' = 'null'::jsonb then 'null' else 'non-null' end,
    case when j2->'retained_study' = 'null'::jsonb then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T17b: le dossier reste lisible sans etude retenue (aucune invention)','1',
    jsonb_array_length(j2->'studies')::text,
    case when jsonb_array_length(j2->'studies') = 1 then 'PASS' else 'FAIL' end);

  -- Isolation.
  j2 := public.get_pv_deal(pa);  -- prospect A, appelant A : OK (deja teste)
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv4_tenant_b__','PROFESSIONNEL','SARL B2','b2@b.fr') returning id into pb;
  j2 := public.get_pv_deal(pb);
  insert into r (test,expected,actual,status) values (
    'T18: A ne peut pas lire l affaire d un prospect de B','NOT_FOUND',
    coalesce(j2->>'code','null'),
    case when j2->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  -- ===================== 21-33. PDF =====================
  -- DRAFT : autorise meme si l etude n est pas validee.
  j := public.register_pv_study_summary(
    'req-draft-0001', s_v2, null, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/draft.pdf', 42000, h64);
  dgen := (j->>'document_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T21: un BROUILLON est generable sur une etude non validee','GENERATED',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'GENERATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T21b: le document generE porte etude + stade + type MIME',
         s_v2::text||'|STUDY_SUMMARY_DRAFT|application/pdf',
         coalesce(study_id::text,'null')||'|'||document_stage||'|'||mime_type,
         case when study_id = s_v2 and document_stage='STUDY_SUMMARY_DRAFT'
                   and mime_type='application/pdf' then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id = dgen;

  -- Idempotence : meme request_id => AUCUN second fichier.
  j := public.register_pv_study_summary(
    'req-draft-0001', s_v2, null, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/draft-bis.pdf', 42000, h64b);
  insert into r (test,expected,actual,status) values (
    'T22: generation REJOUEE = idempotente','ALREADY_GENERATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'ALREADY_GENERATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T22b: le document renvoye est le PREMIER, pas un nouveau', dgen::text,
    coalesce(j->>'document_id','null'),
    case when (j->>'document_id')::uuid = dgen then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.pv_documents
   where tenant_id='heliosolar' and generation_request_id='req-draft-0001';
  insert into r (test,expected,actual,status) values (
    'T22c: un seul fichier existe pour cette demande','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- FINAL refuse si l etude n est pas VALIDEE — revErifie EN BASE.
  j := public.register_pv_study_summary(
    'req-final-0001', s_v2, null, 'STUDY_SUMMARY_FINAL',
    'heliosolar/'||sa::text||'/gen/final.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T23: FINAL refuse si l etude n est pas VALIDEE','PDF_FINAL_NOT_READY|STUDY_NOT_VALIDATED',
    coalesce(j->>'code','null')||'|'||coalesce(j->>'reason','null'),
    case when j->>'code'='PDF_FINAL_NOT_READY' and j->>'reason'='STUDY_NOT_VALIDATED'
         then 'PASS' else 'FAIL' end);

  -- FINAL refuse si le chiffrage n est pas VERIFIE (CALCULATED ne suffit pas).
  j := public.register_pv_study_summary(
    'req-final-0002', s_v1, e_calc, 'STUDY_SUMMARY_FINAL',
    'heliosolar/'||sa::text||'/gen/final.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T24: FINAL refuse si le chiffrage est CALCULATED','PDF_FINAL_NOT_READY|ECONOMICS_NOT_VERIFIED',
    coalesce(j->>'code','null')||'|'||coalesce(j->>'reason','null'),
    case when j->>'code'='PDF_FINAL_NOT_READY' and j->>'reason'='ECONOMICS_NOT_VERIFIED'
         then 'PASS' else 'FAIL' end);

  -- FINAL refuse sans chiffrage du tout.
  j := public.register_pv_study_summary(
    'req-final-0003', s_v1, null, 'STUDY_SUMMARY_FINAL',
    'heliosolar/'||sa::text||'/gen/final.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T24b: FINAL refuse sans chiffrage','PDF_FINAL_NOT_READY|ECONOMICS_NOT_VERIFIED',
    coalesce(j->>'code','null')||'|'||coalesce(j->>'reason','null'),
    case when j->>'code'='PDF_FINAL_NOT_READY' and j->>'reason'='ECONOMICS_NOT_VERIFIED'
         then 'PASS' else 'FAIL' end);

  -- FINAL accepte : etude VALIDATED + chiffrage VERIFIED.
  j := public.register_pv_study_summary(
    'req-final-0004', s_v1, e_ok, 'STUDY_SUMMARY_FINAL',
    'heliosolar/'||sa::text||'/gen/final.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T25: FINAL accepte quand VALIDATED + VERIFIED','GENERATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'GENERATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T25b: le FINAL trace etude ET chiffrage', s_v1::text||'|'||e_ok::text,
         coalesce(study_id::text,'null')||'|'||coalesce(economics_id::text,'null'),
         case when study_id = s_v1 and economics_id = e_ok then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id = (j->>'document_id')::uuid;
  insert into r (test,expected,actual,status)
  select 'T25c: empreinte SHA-256, taille et chemin prive enregistres', h64||'|42000|true',
         coalesce(sha256,'null')||'|'||coalesce(size_bytes::text,'null')||'|'||
         (storage_path like 'heliosolar/%')::text,
         case when sha256 = h64 and size_bytes = 42000
                   and storage_path like 'heliosolar/%' then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id = (j->>'document_id')::uuid;

  -- Perimetre / integrite.
  j := public.register_pv_study_summary(
    'req-path-0001', s_v1, e_ok, 'STUDY_SUMMARY_DRAFT',
    '__pv4_tenant_b__/'||sb0::text||'/gen/vole.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T26: un chemin hors perimetre tenant/site est refuse','PATH_OUT_OF_SCOPE',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'PATH_OUT_OF_SCOPE' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'req-hash-0001', s_v1, e_ok, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/x.pdf', 42000, 'PAS-UN-SHA');
  insert into r (test,expected,actual,status) values (
    'T27: une empreinte non SHA-256 est refusee','BAD_HASH', coalesce(j->>'code','null'),
    case when j->>'code' = 'BAD_HASH' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'req-size-0001', s_v1, e_ok, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/x.pdf', 99999999, h64);
  insert into r (test,expected,actual,status) values (
    'T28: une taille hors borne est refusee','BAD_SIZE', coalesce(j->>'code','null'),
    case when j->>'code' = 'BAD_SIZE' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'req-stage-0001', s_v1, e_ok, 'CONTRAT_SIGNE',
    'heliosolar/'||sa::text||'/gen/x.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T29: un stade inconnu est refuse','BAD_STAGE', coalesce(j->>'code','null'),
    case when j->>'code' = 'BAD_STAGE' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'court', s_v1, e_ok, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/x.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T29b: une cle d idempotence trop courte est refusee','BAD_REQUEST_ID',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'BAD_REQUEST_ID' then 'PASS' else 'FAIL' end);

  -- Isolation PDF.
  j := public.register_pv_study_summary(
    'req-tenant-0001', s_b, null, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/x.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T30: A ne peut pas generer une synthese sur une etude de B','NOT_FOUND',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'req-econ-0001', s_v1, e_other, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/x.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T31: un chiffrage d une AUTRE etude est refuse','ECONOMICS_NOT_FOUND',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'ECONOMICS_NOT_FOUND' then 'PASS' else 'FAIL' end);

  -- Le schema lui-meme refuse le rattachement inter-tenant (FK composite).
  begin
    insert into hermes_os.pv_documents
      (tenant_id,site_id,study_id,doc_type,document_stage,storage_path,mime_type,size_bytes,uploaded_by)
    values ('heliosolar',sa,s_b,'NOTE_TECHNIQUE','STUDY_SUMMARY_DRAFT',
            'heliosolar/'||sa::text||'/gen/y.pdf','application/pdf',1000,v_uid);
    v := 'ACCEPTE';
  exception when foreign_key_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T32: la FK COMPOSITE interdit de rattacher l etude d un autre tenant','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  begin
    insert into hermes_os.pv_documents
      (tenant_id,site_id,doc_type,document_stage,storage_path,mime_type,size_bytes,uploaded_by)
    values ('heliosolar',sa,'NOTE_TECHNIQUE','STUDY_SUMMARY_FINAL',
            'heliosolar/'||sa::text||'/gen/z.pdf','application/pdf',1000,v_uid);
    v := 'ACCEPTE';
  exception when check_violation then v := 'REFUSE'; when others then v := 'AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T33: une synthese SANS etude rattachee est refusee par la contrainte','REFUSE',v,
    case when v = 'REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 1-8. PURGE RESERVEE A L ADMINISTRATEUR =====================
  insert into hermes_os.pv_documents
    (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,uploaded_by,
     original_filename,deleted_at,deleted_by)
  values ('heliosolar',sa,'FACTURE_ENERGIE','heliosolar/'||sa::text||'/doc-a/f.pdf',
          'application/pdf',120000,v_uid,'facture-2025.pdf', now() - interval '30 days', v_uid)
  returning id into da;
  insert into hermes_os.pv_documents
    (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,original_filename,
     deleted_at,deleted_by)
  values ('__pv4_tenant_b__',sb0,'PLAN','__pv4_tenant_b__/'||sb0::text||'/doc-b/p.pdf',
          'application/pdf',90000,'plan-b.pdf', now() - interval '30 days', v_uid)
  returning id into db_;

  -- 1. L administrateur PEUT lister.
  j := public.list_pv_documents_to_purge('7 days', 100);
  insert into r (test,expected,actual,status) values (
    'T1: un TENANT_ADMIN peut lister les documents purgeables','OK', coalesce(j->>'code','null'),
    case when j->>'code' = 'OK' then 'PASS' else 'FAIL' end);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = da);
  insert into r (test,expected,actual,status) values (
    'T1b: la liste contient le document retire depuis 30 jours','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);
  n := (select count(*) from jsonb_array_elements(j->'items') e where (e->>'document_id')::uuid = db_);
  insert into r (test,expected,actual,status) values (
    'T5: la liste ne contient AUCUN document du tenant B','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- 3. MEMBRE NON-ADMIN REFUSE.
  --    La permission `tenant.admin` est retiree PUIS RESTITUEE A L IDENTIQUE
  --    (colonnes `granted_by` / `granted_at` conservees) : le jeu d essai ne
  --    doit pas alterer le modele de droits, meme dans une transaction annulee.
  select granted_by, granted_at into v_grant, v_grant_at
    from hermes_os.user_tenant_permissions
   where user_id = v_uid and tenant_id = 'heliosolar' and permission = 'tenant.admin';
  delete from hermes_os.user_tenant_permissions
   where user_id = v_uid and tenant_id = 'heliosolar' and permission = 'tenant.admin';

  j := public.mark_pv_document_purged(da, '7 days');
  insert into r (test,expected,actual,status) values (
    'T3: un membre NON-admin ne peut PAS purger','NOT_ADMIN', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_ADMIN' then 'PASS' else 'FAIL' end);
  j := public.list_pv_documents_to_purge('7 days', 100);
  insert into r (test,expected,actual,status) values (
    'T3b: un membre NON-admin ne peut PAS lister les purgeables','NOT_ADMIN',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_ADMIN' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T3c: le refus ne fuit aucune liste','0',
    jsonb_array_length(j->'items')::text,
    case when jsonb_array_length(j->'items') = 0 then 'PASS' else 'FAIL' end);
  -- Le journal, lui, RESTE lisible : la transparence n est pas un privilege.
  j := public.get_pv_purge_journal(50);
  insert into r (test,expected,actual,status) values (
    'T11: le JOURNAL de purge reste lisible par un membre non-admin','OK',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'OK' then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.pv_documents where id = da and purged_at is null;
  insert into r (test,expected,actual,status) values (
    'T3d: aucun octet n a ete purge par le non-admin','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);

  insert into hermes_os.user_tenant_permissions (user_id, tenant_id, permission, granted_by, granted_at)
  values (v_uid, 'heliosolar', 'tenant.admin', v_grant, v_grant_at);

  -- 4. Admin A purge A.
  j := public.mark_pv_document_purged(da, '7 days');
  insert into r (test,expected,actual,status) values (
    'T4: l administrateur A PEUT purger un document de A','PURGED', coalesce(j->>'code','null'),
    case when j->>'code' = 'PURGED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T4b: chemin efface, ancien chemin conserve pour l audit','null|non-null',
         coalesce(storage_path,'null')||'|'||case when purged_path is null then 'null' else 'non-null' end,
         case when storage_path is null and purged_path is not null then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id = da;

  -- 5. Admin A ne purge pas B.
  j := public.mark_pv_document_purged(db_, '7 days');
  insert into r (test,expected,actual,status) values (
    'T5b: l administrateur A ne peut PAS purger un document de B','NOT_FOUND',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_FOUND' then 'PASS' else 'FAIL' end);

  -- 7. Idempotence.
  j := public.mark_pv_document_purged(da, '7 days');
  insert into r (test,expected,actual,status) values (
    'T7: purge REJOUEE = idempotente','ALREADY_PURGED', coalesce(j->>'code','null'),
    case when j->>'code' = 'ALREADY_PURGED' then 'PASS' else 'FAIL' end);

  -- 6. Delai de grace revErifie MEME en appel direct, sans passer par la liste.
  insert into hermes_os.pv_documents
    (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,uploaded_by,
     original_filename,deleted_at,deleted_by)
  values ('heliosolar',sa,'PLAN','heliosolar/'||sa::text||'/doc-c/p.pdf',
          'application/pdf',50000,v_uid,'plan-recent.pdf', now() - interval '1 hour', v_uid)
  returning id into dgen;
  j := public.mark_pv_document_purged(dgen, '7 days');
  insert into r (test,expected,actual,status) values (
    'T6: le delai de grace de 7 jours est REVERIFIE en appel direct','GRACE_PERIOD',
    coalesce(j->>'code','null'),
    case when j->>'code' = 'GRACE_PERIOD' then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.pv_documents where id = dgen and storage_path is not null;
  insert into r (test,expected,actual,status) values (
    'T6b: le document protege garde ses octets','1', n::text,
    case when n = 1 then 'PASS' else 'FAIL' end);

  -- 8. Un document NON retire n est pas purgeable.
  insert into hermes_os.pv_documents
    (tenant_id,site_id,doc_type,storage_path,mime_type,size_bytes,uploaded_by)
  values ('heliosolar',sa,'PLAN','heliosolar/'||sa::text||'/doc-d/p.pdf',
          'application/pdf',50000,v_uid) returning id into dgen;
  j := public.mark_pv_document_purged(dgen, '0 seconds');
  insert into r (test,expected,actual,status) values (
    'T8: purger un document NON retire est refuse','NOT_DELETED', coalesce(j->>'code','null'),
    case when j->>'code' = 'NOT_DELETED' then 'PASS' else 'FAIL' end);

  -- ===================== 9-12. JOURNAL DE PURGE =====================
  j := public.get_pv_purge_journal(50);
  insert into r (test,expected,actual,status) values (
    'T9: le journal de purge repond','OK', coalesce(j->>'code','null'),
    case when j->>'code' = 'OK' then 'PASS' else 'FAIL' end);

  select count(*) into n from jsonb_array_elements(j->'items') e
   where (e->>'document_id')::uuid = da
     and e->>'doc_type' = 'FACTURE_ENERGIE'
     and e->>'original_filename' = 'facture-2025.pdf'
     and e->>'site_id' = sa::text
     and e->>'deleted_at' is not null
     and e->>'purged_at' is not null
     and e->>'purged_path' is not null
     and (e->>'purged_by')::uuid = v_uid
     and e->>'outcome' = 'PURGED';
  insert into r (test,expected,actual,status) values (
    'T9b: le journal porte document/type/site/nom/retrait/purge/auteur/chemin/issue','1',
    n::text, case when n = 1 then 'PASS' else 'FAIL' end);

  select count(*) into n from jsonb_array_elements(j->'items') e
   where (e->>'document_id')::uuid = db_;
  insert into r (test,expected,actual,status) values (
    'T10: le journal ne contient AUCUN document du tenant B','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  select count(*) into n from jsonb_array_elements(j->'items') e
   where (e->>'document_id')::uuid = dgen;
  insert into r (test,expected,actual,status) values (
    'T10b: un document NON purge n apparaît pas au journal','0', n::text,
    case when n = 0 then 'PASS' else 'FAIL' end);

  -- 12. Anonyme refuse sur les trois facades.
  perform set_config('request.jwt.claims', '', true);
  j := public.list_pv_documents_to_purge('7 days', 10);
  insert into r (test,expected,actual,status) values (
    'T12a: lister les purgeables en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);
  j := public.mark_pv_document_purged(da, '7 days');
  insert into r (test,expected,actual,status) values (
    'T12b: purger en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);
  j := public.get_pv_purge_journal(10);
  insert into r (test,expected,actual,status) values (
    'T12c: lire le journal en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);
  j := public.get_pv_deal(pa);
  insert into r (test,expected,actual,status) values (
    'T12d: lire une affaire en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);
  j := public.register_pv_study_summary(
    'req-anon-0001', s_v1, e_ok, 'STUDY_SUMMARY_DRAFT',
    'heliosolar/'||sa::text||'/gen/anon.pdf', 42000, h64);
  insert into r (test,expected,actual,status) values (
    'T12e: enregistrer une synthese en anonyme refuse','UNAUTHENTICATED', coalesce(j->>'code','null'),
    case when j->>'code' = 'UNAUTHENTICATED' then 'PASS' else 'FAIL' end);

  -- Sans tenant : un utilisateur authentifie mais rattache a rien.
  perform set_config('request.jwt.claims',
    json_build_object('sub','11111111-2222-3333-4444-555555555555','role','authenticated')::text, true);
  j := public.mark_pv_document_purged(da, '7 days');
  insert into r (test,expected,actual,status) values (
    'T12f: purger sans tenant resolu refuse','NO_TENANT', coalesce(j->>'code','null'),
    case when j->>'code' = 'NO_TENANT' then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role', 'authenticated')::text, true);
end;
$$;

-- ===================== 34-40. ETAT DECLARATIF =====================
-- `pg_get_function_identity_arguments` inclut les NOMS de parametres
-- (« p_document_id uuid »), pas seulement les types : comparer a 'uuid' ne
-- pourrait jamais correspondre et l assertion serait vide de sens. On compte
-- donc les surcharges a UN seul argument.
insert into r (test,expected,actual,status)
select 'T34: l ancienne signature mark_pv_document_purged(uuid) SANS delai a disparu','0',
       count(*)::text, case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='mark_pv_document_purged'
   and p.pronargs = 1;

insert into r (test,expected,actual,status)
select 'T34b: une SEULE surcharge de mark_pv_document_purged, a 2 arguments','1|2',
       count(*)::text||'|'||coalesce(max(p.pronargs)::text,'null'),
       case when count(*) = 1 and max(p.pronargs) = 2 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='mark_pv_document_purged';

insert into r (test,expected,actual,status)
select 'T35: les 2 facades de purge passent par pv_guard_admin()','2', count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('list_pv_documents_to_purge','mark_pv_document_purged')
   and pg_get_functiondef(p.oid) like '%pv_guard_admin()%';

insert into r (test,expected,actual,status)
select 'T36: les 3 nouvelles facades PV-4 sont exposees et SECURITY DEFINER','3|3',
       count(*)::text||'|'||count(*) filter (where p.prosecdef)::text,
       case when count(*) = 3 and count(*) filter (where p.prosecdef) = 3 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('get_pv_deal','get_pv_purge_journal','register_pv_study_summary');

insert into r (test,expected,actual,status)
select 'T37: aucune facade PV-4 n accepte de tenant_id','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.proname in ('get_pv_deal','get_pv_purge_journal','register_pv_study_summary',
                     'list_pv_documents_to_purge','mark_pv_document_purged')
   and pg_get_function_identity_arguments(p.oid) ~* 'tenant';

insert into r (test,expected,actual,status)
select 'T38: aucun GRANT anon sur une facade PV-4','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where grantee='anon' and specific_schema='public'
   and routine_name in ('get_pv_deal','get_pv_purge_journal','register_pv_study_summary',
                        'list_pv_documents_to_purge','mark_pv_document_purged');

insert into r (test,expected,actual,status)
select 'T39: toutes les facades PV-4 ont un search_path verrouille','5', count(*)::text,
       case when count(*) = 5 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('get_pv_deal','get_pv_purge_journal','register_pv_study_summary',
                     'list_pv_documents_to_purge','mark_pv_document_purged')
   and array_to_string(p.proconfig, ',') like '%search_path%';

insert into r (test,expected,actual,status)
select 'T40: FK COMPOSITES etude/chiffrage + contraintes de stade posees','4', count(*)::text,
       case when count(*) = 4 then 'PASS' else 'FAIL' end
  from pg_constraint
 where conname in ('pv_documents_study_fk','pv_documents_economics_fk',
                   'pv_documents_stage_valide','pv_documents_synthese_rattachee');

insert into r (test,expected,actual,status)
select 'T40b: unicite PARTIELLE de la cle d idempotence de generation','1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_indexes
 where schemaname='hermes_os' and indexname='idx_pv_documents_generation_request'
   and indexdef like '%WHERE (generation_request_id IS NOT NULL)%';

-- ===================== 41-47. NON-REGRESSION =====================
insert into r (test,expected,actual,status)
select 'T41: Phase 1 gate SW15 toujours FAIL-CLOSED','FAIL_CLOSED_OK',
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'FAIL_CLOSED_OK' else 'REGRESSION' end,
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hermes_os' and p.proname='gateway_policy_gate';

insert into r (test,expected,actual,status)
select 'T42: Phase 2 TTL + FK tenant presentes','2', count(*)::text,
       case when count(*) = 2 then 'PASS' else 'FAIL' end
  from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='hermes_os' and p.proname='expire_stale_queued_agent_actions'
    union all
    select 1 from pg_constraint where conname='agent_action_requests_tenant_id_fkey'
  ) x;

insert into r (test,expected,actual,status)
select 'T43: PV-1 9 tables metier + 33 transitions prospect intactes','9|33',
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
select 'T44: PV-2 intact — bucket PRIVE + 3 policies storage + aucune policy DELETE','false|3|0',
       (select public::text from storage.buckets where id='hermes-pv-documents')
       ||'|'||(select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%')::text
       ||'|'||(select count(*) from pg_policies where schemaname='storage'
                and policyname like 'hermes_pv_documents%' and cmd='DELETE')::text,
       case when (select public from storage.buckets where id='hermes-pv-documents') = false
             and (select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%') = 3
             and (select count(*) from pg_policies where schemaname='storage'
                   and policyname like 'hermes_pv_documents%' and cmd='DELETE') = 0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T45: PV-3 machines a etats intactes (31 chemins declares)','31', count(*)::text,
       case when count(*) = 31 then 'PASS' else 'FAIL' end
  from hermes_os.pv_status_transitions;

insert into r (test,expected,actual,status)
select 'T46: capacites PV toujours desactivees, 0 consumer, 0 PERMIT actif','3|0|0',
       (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false)::text
       ||'|'||(select count(*) from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled=true)::text
       ||'|'||(select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')::text,
       case when (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false) = 3
             and (select count(*) from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled=true) = 0
             and (select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT') = 0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T47: requetes reelles toujours QUEUED, INTACTES (>= 12)','>=12', count(*)::text,
       case when count(*) >= 12 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

insert into r (test,expected,actual,status)
select 'T47b: aucune table pv_quotes creee (hors perimetre PV-4)','0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.tables
 where table_schema='hermes_os' and table_name like 'pv_quote%';

select id, status, test, expected, actual from r order by id;

rollback;
