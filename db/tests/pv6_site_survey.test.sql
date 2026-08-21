-- Assertions REPRODUCTIBLES pour le LOT PV-6 (visite technique photovoltaïque).
--
-- Transaction ROLLED BACK : rien n'est persiste. Le tenant B est SYNTHETIQUE.
-- Substituer un uuid de membre reel pour :admin avant execution.
-- Execution (psql) : \i db/tests/pv6_site_survey.test.sql
--
-- Couverture (49 assertions numerotees) :
--   T1-T8    schema : mesures en colonnes TYPEES et non en JSON, FK composites,
--            deny-all, seuils EN DONNEES (defaut global + surcharge tenant),
--            rattachement documentaire sans nouveau bucket
--   T9-T17   machine a etats : 15 transitions declarees, PLANNED->VALIDATED et
--            BLOCKING->VALIDATED absents, VALIDATED terminal, releve fige
--   T18-T21  validation HUMAINE : un agent ne valide jamais
--   T22-T35  moteur d'ecarts DETERMINISTE : chaque regle, ses deux paliers,
--            l'azimut circulaire, le determinisme, la preservation des
--            resolutions humaines, la disparition des ecarts non resolus
--   T36-T39  ecarts bloquants : la validation est refusee tant qu'ils tiennent
--   T40-T44  application d'une mesure : geste explicite, audite, jamais automatique
--   T45-T47  porte de devis : les trois codes, et un devis SENT non modifie
--   T48-T49  isolation multi-tenant et non-regression du perimetre gele

\set admin '00000000-0000-0000-0000-000000000000'

begin;
set local pv.admin = :'admin';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;
insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv6_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.admin')::uuid;
  pa uuid; pb uuid; sa uuid; sb0 uuid; st uuid; ec uuid;
  vi uuid; vi2 uuid; vib uuid; vhg uuid; q uuid;
  pq uuid; sq uuid; stq uuid; ecq uuid; viq uuid; viq2 uuid;
  j jsonb; n int; v text; v2 text; f uuid; codes text[]; sig1 text; sig2 text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- ===================== JEU D ESSAI =====================
  -- Site DECLARE : 120 m² total, 80 m² exploitables, azimut 180°, inclinaison 30°,
  -- couverture PENTE en BON etat, ombrage FAIBLE, acces MOYEN.
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by,status)
  values ('heliosolar','PARTICULIER','Visite','0600000061',v_uid,'STUDY_DELIVERED') returning id into pa;
  insert into hermes_os.pv_sites
    (tenant_id,prospect_id,address_line1,postal_code,city,
     roof_type,roof_condition,roof_area_total_m2,roof_area_usable_m2,
     azimuth_deg,tilt_deg,shading_level,access_difficulty,height_m)
  values ('heliosolar',pa,'12 rue du Zenith','13100','Aix',
     'PENTE','BON',120,80,180,30,'FAIBLE','MOYEN',4) returning id into sa;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sa,1,'MANUAL','VALIDATED',9.000,v_uid,now()) returning id into st;
  insert into hermes_os.pv_economics (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at)
  values ('heliosolar',st,'VERIFIED','MANUAL',15000,v_uid,now()) returning id into ec;

  -- Tenant B, synthetique : sert aux assertions d'isolation.
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('__pv6_b__','PARTICULIER','Autre','0600000062',v_uid) returning id into pb;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv6_b__',pb,'1 rue B','75000','Paris') returning id into sb0;

  -- ===================== 1. SCHEMA =====================

  insert into r (test,expected,actual,status)
  select 'T1 mesures en COLONNES TYPEES (numeric/text), jamais un blob JSON','>=12 typees',
         count(*)::text||' typees',
         case when count(*) >= 12 then 'PASS' else 'FAIL' end
    from information_schema.columns
   where table_schema='hermes_os' and table_name='pv_site_surveys'
     and (column_name like '%_measured%' or column_name in
          ('ridge_length_m','eave_length_m','slope_length_m','cable_distance_m',
           'panel_board_free_slots','main_breaker_rating_a'))
     and data_type in ('numeric','text','integer','boolean');

  insert into r (test,expected,actual,status)
  select 'T2 aucune mesure essentielle stockee dans metadata (jsonb complementaire seulement)','1 seule colonne jsonb',
         count(*)::text||' colonne(s) jsonb',
         case when count(*)=1 then 'PASS' else 'FAIL' end
    from information_schema.columns
   where table_schema='hermes_os' and table_name='pv_site_surveys' and data_type='jsonb';

  insert into r (test,expected,actual,status)
  select 'T3 FK COMPOSITES (tenant_id, x) sur prospect et site','2',count(*)::text,
         case when count(*)=2 then 'PASS' else 'FAIL' end
    from pg_constraint
   where conname in ('pv_site_surveys_prospect_fk','pv_site_surveys_site_fk')
     and array_length(conkey,1)=2;

  insert into r (test,expected,actual,status)
  select 'T4 RLS active et ZERO politique sur les tables PV-6 (deny-all)','3 tables RLS / 0 politique',
         count(*) filter (where c.relrowsecurity)::text||' tables RLS / '||
         (select count(*) from pg_policies where schemaname='hermes_os'
           and tablename in ('pv_site_surveys','pv_site_survey_findings','pv_survey_thresholds'))::text||' politique',
         case when count(*) filter (where c.relrowsecurity)=3
               and (select count(*) from pg_policies where schemaname='hermes_os'
                     and tablename in ('pv_site_surveys','pv_site_survey_findings','pv_survey_thresholds'))=0
              then 'PASS' else 'FAIL' end
    from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
   where ns.nspname='hermes_os'
     and c.relname in ('pv_site_surveys','pv_site_survey_findings','pv_survey_thresholds');

  insert into r (test,expected,actual,status)
  select 'T5 aucun GRANT anon/authenticated sur les tables PV-6','0',count(*)::text,
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from information_schema.role_table_grants
   where table_schema='hermes_os'
     and table_name in ('pv_site_surveys','pv_site_survey_findings','pv_survey_thresholds')
     and grantee in ('anon','authenticated');

  insert into r (test,expected,actual,status)
  select 'T6 SEUILS EN DONNEES : 9 defauts globaux, aucun nombre magique','9',count(*)::text,
         case when count(*)=9 then 'PASS' else 'FAIL' end
    from hermes_os.pv_survey_thresholds where tenant_id is null;

  -- Surcharge par tenant : le defaut global est bien remplace, pas complete.
  insert into hermes_os.pv_survey_thresholds (tenant_id,code,value,unit,description)
  values ('heliosolar','TILT_REVIEW_DEG',9,'°','surcharge de test');
  insert into r (test,expected,actual,status)
  select 'T7 seuil surchargeable par tenant (9 pour heliosolar, 5 en defaut global)','9|5',
         hermes_os.pv_survey_threshold('heliosolar','TILT_REVIEW_DEG')::text||'|'||
         hermes_os.pv_survey_threshold('__pv6_b__','TILT_REVIEW_DEG')::text,
         case when hermes_os.pv_survey_threshold('heliosolar','TILT_REVIEW_DEG')=9
               and hermes_os.pv_survey_threshold('__pv6_b__','TILT_REVIEW_DEG')=5
              then 'PASS' else 'FAIL' end;
  delete from hermes_os.pv_survey_thresholds where tenant_id='heliosolar';

  insert into r (test,expected,actual,status)
  select 'T8 documents de visite dans pv_documents et AUCUN nouveau bucket','survey_id|1 bucket',
         (select count(*) from information_schema.columns
           where table_schema='hermes_os' and table_name='pv_documents' and column_name='survey_id')::text
         ||'|'||(select count(*) from storage.buckets where id like 'hermes-pv%')::text,
         case when (select count(*) from information_schema.columns
                     where table_schema='hermes_os' and table_name='pv_documents' and column_name='survey_id')=1
               and (select count(*) from storage.buckets where id like 'hermes-pv%')=1
              then 'PASS' else 'FAIL' end;

  -- ===================== 2. MACHINE A ETATS =====================

  insert into r (test,expected,actual,status)
  select 'T9 15 transitions de visite declarees EN DONNEES','15',count(*)::text,
         case when count(*)=15 then 'PASS' else 'FAIL' end
    from hermes_os.pv_survey_transitions;

  insert into r (test,expected,actual,status)
  select 'T10 PLANNED -> VALIDATED ABSENT de la table (on ne valide pas une visite non faite)','absent',
         case when exists (select 1 from hermes_os.pv_survey_transitions
                            where from_status='PLANNED' and to_status='VALIDATED')
              then 'present' else 'absent' end,
         case when not exists (select 1 from hermes_os.pv_survey_transitions
                                where from_status='PLANNED' and to_status='VALIDATED')
              then 'PASS' else 'FAIL' end;

  insert into r (test,expected,actual,status)
  select 'T11 BLOCKING -> VALIDATED ABSENT (un blocage se leve par le terrain ou une revue)','absent',
         case when exists (select 1 from hermes_os.pv_survey_transitions
                            where from_status='BLOCKING' and to_status='VALIDATED')
              then 'present' else 'absent' end,
         case when not exists (select 1 from hermes_os.pv_survey_transitions
                                where from_status='BLOCKING' and to_status='VALIDATED')
              then 'PASS' else 'FAIL' end;

  insert into r (test,expected,actual,status)
  select 'T12 VALIDATED est TERMINAL : aucune transition sortante','0',count(*)::text,
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from hermes_os.pv_survey_transitions where from_status='VALIDATED';

  -- Planification via la facade : aucun tenant_id n'est propose par l'appelant.
  j := public.plan_pv_site_survey(pa, current_date);
  vi := (j->>'survey_id')::uuid;
  insert into r (test,expected,actual,status)
  values ('T13 planification par facade : visite PLANNED rattachee au site principal','PLANNED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='PLANNED' and (j->>'site_id')::uuid = sa then 'PASS' else 'FAIL' end);

  -- Transition INTERDITE tentee par la facade : refus explicite, pas un succes.
  j := public.set_pv_survey_status(vi, 'DONE');
  insert into r (test,expected,actual,status)
  values ('T14 PLANNED -> DONE refuse (transition non declaree)','TRANSITION_REFUSED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='TRANSITION_REFUSED' then 'PASS' else 'FAIL' end);

  j := public.set_pv_survey_status(vi, 'VALIDATED');
  insert into r (test,expected,actual,status)
  values ('T15 set_pv_survey_status refuse VALIDATED : la validation a sa facade','USE_VALIDATION_FACADE',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='USE_VALIDATION_FACADE' then 'PASS' else 'FAIL' end);

  j := public.set_pv_survey_status(vi, 'IN_PROGRESS');
  insert into r (test,expected,actual,status)
  values ('T16 PLANNED -> IN_PROGRESS accepte et started_at horodate','IN_PROGRESS',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='IN_PROGRESS'
                and (select started_at from hermes_os.pv_site_surveys where id=vi) is not null
               then 'PASS' else 'FAIL' end);

  j := public.set_pv_survey_status(vi, 'ZZZ_INEXISTANT');
  insert into r (test,expected,actual,status)
  values ('T17 statut hors vocabulaire refuse','BAD_STATUS', coalesce(j->>'code','(null)'),
          case when j->>'code'='BAD_STATUS' then 'PASS' else 'FAIL' end);

  -- ===================== 3. VALIDATION HUMAINE =====================

  -- Releve conforme : aucune mesure ne s'ecarte du declare.
  j := public.upsert_pv_survey_roof(vi, 120, 80, 180, 30, 'PENTE', 'BON', 'FAIBLE', 'MOYEN', 4);
  insert into r (test,expected,actual,status)
  values ('T18 releve conforme enregistre : AUCUN ecart constate','SAVED|0',
          coalesce(j->>'code','(null)')||'|'||coalesce(j->>'findings','?'),
          case when j->>'code'='SAVED' and (j->>'findings')::int = 0 then 'PASS' else 'FAIL' end);

  perform public.set_pv_survey_status(vi, 'DONE');
  j := public.validate_pv_site_survey(vi);
  insert into r (test,expected,actual,status)
  values ('T19 validation humaine acceptee depuis DONE (acteur = appelant)','VALIDATED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='VALIDATED' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T20 validated_by = appelant et validated_at horodate','oui',
         case when validated_by = v_uid and validated_at is not null then 'oui' else 'non' end,
         case when validated_by = v_uid and validated_at is not null then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_surveys where id = vi;

  -- UN AGENT NE VALIDE PAS. Sur une visite NON encore validee (sinon c'est la
  -- garde d'immutabilite qui refuserait, et l'assertion ne prouverait rien de la
  -- validation humaine). Sans jeton, `auth.uid()` est NULL : la garde refuse.
  j := public.plan_pv_site_survey(pa, current_date);
  vhg := (j->>'survey_id')::uuid;
  perform public.set_pv_survey_status(vhg, 'IN_PROGRESS');
  perform public.set_pv_survey_status(vhg, 'DONE');

  perform set_config('request.jwt.claims', null, true);
  begin
    update hermes_os.pv_site_surveys
       set status='VALIDATED', validated_by=v_uid, validated_at=now()
     where id = vhg;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE:'||sqlerrm;
  end;
  insert into r (test,expected,actual,status)
  values ('T21 appelant NON authentifie (agent/runner) : validation refusee par la garde humaine',
          'REFUSE (garde de validation humaine)', left(v, 80),
          case when v like 'REFUSE:%' and v ~* '(HUMAIN|HUMAN|auth)' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- Meme authentifie, on ne valide pas AU NOM D'UN AUTRE.
  begin
    update hermes_os.pv_site_surveys
       set status='VALIDATED',
           validated_by='00000000-0000-0000-0000-0000000000ff'::uuid,
           validated_at=now()
     where id = vhg;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE:'||sqlerrm;
  end;
  insert into r (test,expected,actual,status)
  values ('T21b validation au nom d''un AUTRE utilisateur refusee','REFUSE', left(v, 80),
          case when v like 'REFUSE:%' then 'PASS' else 'FAIL' end);

  -- Le releve d'une visite VALIDEE est fige.
  j := public.upsert_pv_survey_roof(vi, 130);
  insert into r (test,expected,actual,status)
  values ('T22 releve d''une visite VALIDEE fige','SURVEY_LOCKED', coalesce(j->>'code','(null)'),
          case when j->>'code'='SURVEY_LOCKED' then 'PASS' else 'FAIL' end);

  -- ===================== 4. MOTEUR D'ECARTS =====================

  -- Deuxieme visite : c'est elle qui porte les ecarts.
  j := public.plan_pv_site_survey(pa, current_date);
  vi2 := (j->>'survey_id')::uuid;
  perform public.set_pv_survey_status(vi2, 'IN_PROGRESS');

  -- Surface exploitable 80 -> 70 = 12,5 % : au-dela de 10 (REVIEW), en deca de 25.
  perform public.upsert_pv_survey_roof(vi2, null, 70);
  insert into r (test,expected,actual,status)
  select 'T23 surface exploitable -12,5 % : REVIEW, non bloquant','REVIEW|f',
         coalesce(severity,'(aucun)')||'|'||coalesce(is_blocking::text,'?'),
         case when severity='REVIEW' and is_blocking=false then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='USABLE_AREA_MISMATCH';

  -- 80 -> 50 = 37,5 % : au-dela de 25, donc BLOCKING. Le meme ecart change de gravite.
  perform public.upsert_pv_survey_roof(vi2, null, 50);
  insert into r (test,expected,actual,status)
  select 'T24 surface exploitable -37,5 % : BLOCKING (deuxieme palier)','BLOCKING|t',
         coalesce(severity,'(aucun)')||'|'||coalesce(is_blocking::text,'?'),
         case when severity='BLOCKING' and is_blocking=true then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='USABLE_AREA_MISMATCH';

  insert into r (test,expected,actual,status)
  select 'T25 l''ecart porte les DEUX valeurs (declaree et mesuree), pas un drapeau','80|50',
         coalesce(declared_value,'(null)')||'|'||coalesce(measured_value,'(null)'),
         case when declared_value like '80%' and measured_value like '50%' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='USABLE_AREA_MISMATCH';

  -- Azimut CIRCULAIRE : 10° mesure contre 350° declare = 20°, pas 340°.
  update hermes_os.pv_sites set azimuth_deg = 350 where id = sa;
  perform public.upsert_pv_survey_roof(vi2, null, null, 10);
  insert into r (test,expected,actual,status)
  select 'T26 azimut 350 vs 10 : ecart CIRCULAIRE de 20 -> REVIEW, jamais BLOCKING','REVIEW',
         coalesce(severity,'(aucun)'),
         case when severity='REVIEW' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='AZIMUTH_MISMATCH';

  insert into r (test,expected,actual,status)
  values ('T27 pv_angle_delta(350,10) = 20 (et non 340)','20',
          hermes_os.pv_angle_delta(350,10)::text,
          case when hermes_os.pv_angle_delta(350,10)=20 then 'PASS' else 'FAIL' end);

  update hermes_os.pv_sites set azimuth_deg = 180 where id = sa;
  perform public.upsert_pv_survey_roof(vi2, null, null, 130);
  insert into r (test,expected,actual,status)
  select 'T28 azimut 180 vs 130 : ecart de 50 -> BLOCKING','BLOCKING',coalesce(severity,'(aucun)'),
         case when severity='BLOCKING' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='AZIMUTH_MISMATCH';

  perform public.upsert_pv_survey_roof(vi2, null, null, 180, 38);
  insert into r (test,expected,actual,status)
  select 'T29 inclinaison 30 vs 38 : ecart de 8 -> REVIEW','REVIEW',coalesce(severity,'(aucun)'),
         case when severity='REVIEW' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='TILT_MISMATCH';

  perform public.upsert_pv_survey_roof(vi2, null, null, null, null, 'TERRASSE', 'MAUVAIS', 'FORT');
  insert into r (test,expected,actual,status)
  select 'T30 type de couverture different : REVIEW','REVIEW',coalesce(severity,'(aucun)'),
         case when severity='REVIEW' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='ROOF_TYPE_MISMATCH';

  insert into r (test,expected,actual,status)
  select 'T31 couverture MAUVAIS : BLOCKING (poser dessus engagerait l''entreprise)','BLOCKING',
         coalesce(severity,'(aucun)'),
         case when severity='BLOCKING' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='ROOF_CONDITION_ISSUE';

  insert into r (test,expected,actual,status)
  select 'T32 ombrage FAIBLE -> FORT (2 crans) : BLOCKING','BLOCKING',coalesce(severity,'(aucun)'),
         case when severity='BLOCKING' then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='SHADING_MISMATCH';

  perform public.upsert_pv_survey_roof(vi2, null, null, null, null, null, null, null, null, 9);
  insert into r (test,expected,actual,status)
  select 'T33 hauteur 9 m > seuil 6 m : INFO, jamais bloquant','INFO|f',
         coalesce(severity,'(aucun)')||'|'||coalesce(is_blocking::text,'?'),
         case when severity='INFO' and is_blocking=false then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='HEIGHT_ACCESS_NOTICE';

  perform public.upsert_pv_survey_electrical(vi2, null, null, null, null, 80, null, 'DEGRADE', null, null, 'ABSENTE');
  insert into r (test,expected,actual,status)
  select 'T34 tableau DEGRADE, terre ABSENTE, cable 80 m : 3 ecarts REVIEW en ELECTRICITE','3',
         count(*)::text,
         case when count(*)=3 then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and category='ELECTRICITE' and severity='REVIEW';

  perform public.upsert_pv_survey_context(vi2, 'SEC', 'IMPOSSIBLE', 'AUCUN', 'CRITIQUE');
  insert into r (test,expected,actual,status)
  select 'T35 acces IMPOSSIBLE et site CRITIQUE : 2 ecarts BLOCKING','2',count(*)::text,
         case when count(*)=2 then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code in ('ACCESS_BLOCKED','STRUCTURAL_CONCERN') and is_blocking;

  -- Amiante : CONSTAT, pas diagnostic — signale, jamais bloquant d'office.
  perform public.upsert_pv_survey_roof(vi2, null,null,null,null,null,null,null,null,null,null,null,null,null,
                                       true, 'plaques ondulees grises sous la couverture');
  insert into r (test,expected,actual,status)
  select 'T36 suspicion d''amiante : REVIEW et NON bloquant (constat, pas diagnostic)','REVIEW|f',
         coalesce(severity,'(aucun)')||'|'||coalesce(is_blocking::text,'?'),
         case when severity='REVIEW' and is_blocking=false then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and code='ASBESTOS_SUSPICION';

  -- DETERMINISME : deux executions du moteur sur le meme releve, meme resultat.
  select string_agg(code||':'||severity, ',' order by code) into sig1
    from hermes_os.pv_site_survey_findings where survey_id=vi2;
  perform hermes_os.compute_pv_survey_findings(vi2);
  select string_agg(code||':'||severity, ',' order by code) into sig2
    from hermes_os.pv_site_survey_findings where survey_id=vi2;
  insert into r (test,expected,actual,status)
  values ('T37 moteur DETERMINISTE : deux executions, ecarts identiques','identiques',
          case when sig1 = sig2 then 'identiques' else 'differents' end,
          case when sig1 = sig2 and sig1 is not null then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T38 aucune IA dans le moteur : sa definition ne contient aucun appel externe','0',
          (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='hermes_os' and p.proname='compute_pv_survey_findings'
              and (pg_get_functiondef(p.oid) ~* '(http|net\.|openai|anthropic|pg_background)')),
          case when (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='hermes_os' and p.proname='compute_pv_survey_findings'
                        and (pg_get_functiondef(p.oid) ~* '(http|net\.|openai|anthropic|pg_background)'))=0
               then 'PASS' else 'FAIL' end);

  -- ===================== 5. ECARTS BLOQUANTS ET VALIDATION =====================

  perform public.set_pv_survey_status(vi2, 'DONE');
  j := public.validate_pv_site_survey(vi2);
  insert into r (test,expected,actual,status)
  values ('T39 validation REFUSEE tant qu''un ecart bloquant n''est pas resolu','BLOCKING_FINDINGS_UNRESOLVED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='BLOCKING_FINDINGS_UNRESOLVED'
                and jsonb_array_length(coalesce(j->'findings','[]'::jsonb)) > 0
               then 'PASS' else 'FAIL' end);

  -- Resolution humaine de chaque ecart bloquant, un par un.
  for f in select id from hermes_os.pv_site_survey_findings
            where survey_id=vi2 and is_blocking and resolution is null loop
    perform public.resolve_pv_survey_finding(f, 'ACCEPTED_AS_IS', 'accepte apres arbitrage');
  end loop;

  insert into r (test,expected,actual,status)
  select 'T40 resolution : acteur et horodatage enregistres, motif conserve','0 non resolu',
         count(*)::text||' non resolu',
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and is_blocking and (resolution is null or resolved_by is null or resolved_at is null);

  -- REGENERER ne doit PAS effacer une resolution humaine.
  perform hermes_os.compute_pv_survey_findings(vi2);
  insert into r (test,expected,actual,status)
  select 'T41 regeneration des ecarts : les resolutions humaines SURVIVENT','0 perdue',
         count(*)::text||' perdue',
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings
   where survey_id=vi2 and is_blocking and resolution is null;

  j := public.validate_pv_site_survey(vi2);
  insert into r (test,expected,actual,status)
  values ('T42 validation ACCEPTEE une fois les ecarts bloquants resolus','VALIDATED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='VALIDATED' then 'PASS' else 'FAIL' end);

  -- Un ecart non resolu qui n'est plus constate DISPARAIT.
  j := public.plan_pv_site_survey(pa, current_date);
  vib := (j->>'survey_id')::uuid;
  perform public.set_pv_survey_status(vib, 'IN_PROGRESS');
  perform public.upsert_pv_survey_roof(vib, null, 50);
  select count(*) into n from hermes_os.pv_site_survey_findings where survey_id=vib;
  perform public.upsert_pv_survey_roof(vib, null, 80);
  insert into r (test,expected,actual,status)
  select 'T43 ecart NON resolu qui n''est plus constate : supprime','1 puis 0',
         n::text||' puis '||count(*)::text,
         case when n=1 and count(*)=0 then 'PASS' else 'FAIL' end
    from hermes_os.pv_site_survey_findings where survey_id=vib;

  -- ===================== 6. APPLIQUER UNE MESURE =====================

  -- Le releve seul n'a JAMAIS touche au site : c'est la regle centrale du lot.
  insert into r (test,expected,actual,status)
  select 'T44 le site DECLARE est INCHANGE par les releves (aucun ecrasement automatique)','80',
         coalesce(roof_area_usable_m2::text,'(null)'),
         case when roof_area_usable_m2 = 80 then 'PASS' else 'FAIL' end
    from hermes_os.pv_sites where id = sa;

  j := public.apply_pv_survey_measurement(vi2, 'roof_area_usable_m2');
  insert into r (test,expected,actual,status)
  values ('T45 appliquer une mesure : geste explicite, ancienne et nouvelle valeur rendues','APPLIED|80|50',
          coalesce(j->>'code','(null)')||'|'||coalesce(j->>'previous_value','?')||'|'||coalesce(j->>'new_value','?'),
          case when j->>'code'='APPLIED'
                and (j->>'previous_value') like '80%' and (j->>'new_value') like '50%'
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T46 application AUDITEE dans entity_audit_log (aucun journal parallele)','>=1',count(*)::text,
         case when count(*) >= 1 then 'PASS' else 'FAIL' end
    from hermes_os.entity_audit_log
   where tenant_id='heliosolar' and entity_id = sa
     and change_summary like 'mesure de visite technique appliquee au site%';

  j := public.apply_pv_survey_measurement(vi2, 'colonne_inventee');
  insert into r (test,expected,actual,status)
  values ('T47 champ inconnu refuse (liste close cote base)','UNKNOWN_FIELD',coalesce(j->>'code','(null)'),
          case when j->>'code'='UNKNOWN_FIELD' then 'PASS' else 'FAIL' end);

  -- ===================== 7. PORTE DE DEVIS =====================

  -- Site de tenant B : aucune visite du tout.
  insert into r (test,expected,actual,status)
  values ('T48 porte de visite : NONE sans visite, OK apres validation','NONE|OK',
          hermes_os.pv_survey_gate('__pv6_b__', sb0)||'|'||hermes_os.pv_survey_gate('heliosolar', sa),
          case when hermes_os.pv_survey_gate('__pv6_b__', sb0)='NONE'
                and hermes_os.pv_survey_gate('heliosolar', sa)='OK'
               then 'PASS' else 'FAIL' end);

  -- Dossier NEUF, sans aucune visite : c'est le cas qui ferme le trou du lot.
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by,status)
  values ('heliosolar','PARTICULIER','SansVisite','0600000063',v_uid,'STUDY_DELIVERED') returning id into pq;
  insert into hermes_os.pv_sites
    (tenant_id,prospect_id,address_line1,postal_code,city,roof_area_usable_m2,azimuth_deg,tilt_deg)
  values ('heliosolar',pq,'3 rue Neuve','13100','Aix',60,180,30) returning id into sq;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sq,1,'MANUAL','VALIDATED',6.000,v_uid,now()) returning id into stq;
  insert into hermes_os.pv_economics (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at)
  values ('heliosolar',stq,'VERIFIED','MANUAL',12000,v_uid,now()) returning id into ecq;

  j := public.create_pv_quote(pq);
  q := (j->>'quote_id')::uuid;
  -- Ordre des parametres de PV-5 : (ligne, devis, categorie, designation, qte, ...).
  -- Aucun total n'est transmis : il vient d'une colonne generee.
  perform public.upsert_pv_quote_line(null, q, 'PANNEAUX', 'Module 400 Wc', 15, 'U', 300, 20, 0);

  codes := hermes_os.pv_quote_blockers(q);
  insert into r (test,expected,actual,status)
  values ('T49 devis sur un site JAMAIS visite : blocage SITE_SURVEY_REQUIRED','present',
          case when 'SITE_SURVEY_REQUIRED' = any(codes) then 'present' else 'absent' end,
          case when 'SITE_SURVEY_REQUIRED' = any(codes) then 'PASS' else 'FAIL' end);

  j := public.set_pv_quote_ready(q);
  insert into r (test,expected,actual,status)
  values ('T50 passage READY refuse sans visite validee','refuse', coalesce(j->>'code','(null)'),
          case when (j->>'ok')::boolean is not true then 'PASS' else 'FAIL' end);

  -- Une visite existe mais n'est pas validee : ce n'est pas une preuve.
  j := public.plan_pv_site_survey(pq, current_date);
  viq := (j->>'survey_id')::uuid;
  codes := hermes_os.pv_quote_blockers(q);
  insert into r (test,expected,actual,status)
  values ('T51 visite planifiee mais non validee : SITE_SURVEY_NOT_VALIDATED','present',
          case when 'SITE_SURVEY_NOT_VALIDATED' = any(codes) then 'present' else 'absent' end,
          case when 'SITE_SURVEY_NOT_VALIDATED' = any(codes)
                and not ('SITE_SURVEY_REQUIRED' = any(codes)) then 'PASS' else 'FAIL' end);

  -- Une visite BLOQUANTE : la pose est impossible, le devis ne peut pas avancer.
  perform public.set_pv_survey_status(viq, 'IN_PROGRESS');
  perform public.set_pv_survey_status(viq, 'DONE');
  perform public.set_pv_survey_status(viq, 'BLOCKING');
  codes := hermes_os.pv_quote_blockers(q);
  insert into r (test,expected,actual,status)
  values ('T52 visite BLOCKING : SITE_SURVEY_BLOCKING','present',
          case when 'SITE_SURVEY_BLOCKING' = any(codes) then 'present' else 'absent' end,
          case when 'SITE_SURVEY_BLOCKING' = any(codes) then 'PASS' else 'FAIL' end);

  -- Retour au terrain, puis revue, puis validation : la porte s'ouvre.
  perform public.set_pv_survey_status(viq, 'IN_PROGRESS');
  perform public.upsert_pv_survey_roof(viq, null, 60, 180, 30);
  perform public.set_pv_survey_status(viq, 'DONE');
  perform public.validate_pv_site_survey(viq);
  codes := hermes_os.pv_quote_blockers(q);
  insert into r (test,expected,actual,status)
  values ('T53 visite validee : plus aucun blocage de visite','0',
          (select count(*)::text from unnest(codes) c where c like 'SITE_SURVEY%'),
          case when (select count(*) from unnest(codes) c where c like 'SITE_SURVEY%')=0
               then 'PASS' else 'FAIL' end);

  -- UN DEVIS DEJA TRANSMIS N'EST PAS MODIFIE. On le transmet, puis on rend la
  -- visite bloquante : le devis garde son statut et son total. Seule l'alerte
  -- change — et c'est le but : le commercial doit savoir, sans que la base
  -- reecrive un engagement deja pris.
  perform public.set_pv_quote_ready(q);
  perform public.send_pv_quote(q, current_date);
  select status, total_ttc_eur::text into v, sig1 from hermes_os.pv_quotes where id = q;
  j := public.plan_pv_site_survey(pq, current_date);
  viq2 := (j->>'survey_id')::uuid;
  perform public.set_pv_survey_status(viq2, 'IN_PROGRESS');
  perform public.set_pv_survey_status(viq2, 'DONE');
  perform public.set_pv_survey_status(viq2, 'BLOCKING');
  select status, total_ttc_eur::text into sig2, v2 from hermes_os.pv_quotes where id = q;
  codes := hermes_os.pv_quote_blockers(q);
  insert into r (test,expected,actual,status)
  values ('T54 devis DEJA SENT : statut ET total INCHANGES malgre la visite bloquante',
          'SENT|'||coalesce(sig1,'?'),
          coalesce(sig2,'(null)')||'|'||coalesce(v2,'(null)'),
          case when sig2 = 'SENT' and v2 = sig1 then 'PASS' else 'FAIL' end);

  -- ... mais l'ALERTE, elle, apparait : le commercial doit savoir. La seule voie
  -- de correction reste la revision (nouvelle version), jamais une reecriture.
  insert into r (test,expected,actual,status)
  values ('T55 un BLOCAGE prime sur une validation anterieure : l''alerte remonte','present',
          case when 'SITE_SURVEY_BLOCKING' = any(codes) then 'present' else 'absent' end,
          case when 'SITE_SURVEY_BLOCKING' = any(codes) then 'PASS' else 'FAIL' end);

  -- Le blocage se leve par un geste declare, pas par oubli.
  perform public.set_pv_survey_status(viq2, 'CANCELLED');
  insert into r (test,expected,actual,status)
  values ('T56 blocage annule : la porte revient a OK (visite validee subsistante)','OK',
          hermes_os.pv_survey_gate('heliosolar', sq),
          case when hermes_os.pv_survey_gate('heliosolar', sq)='OK' then 'PASS' else 'FAIL' end);

  -- ===================== 8. ISOLATION ET PERIMETRE =====================

  insert into r (test,expected,actual,status)
  select 'T57 isolation : aucune visite du tenant B visible depuis heliosolar','0',
         jsonb_array_length(coalesce(public.get_pv_site_surveys(pb, 50)->'items','[]'::jsonb))::text,
         case when jsonb_array_length(coalesce(public.get_pv_site_surveys(pb, 50)->'items','[]'::jsonb))=0
              then 'PASS' else 'FAIL' end;
end;
$$;

-- ===================== ASSERTIONS HORS BLOC =====================

insert into r (test,expected,actual,status)
select 'T58 facades PV-6 accordees a authenticated UNIQUEMENT (jamais anon)','11 authenticated / 0 anon',
       count(*) filter (where grantee='authenticated')::text||' authenticated / '||
       count(*) filter (where grantee='anon')::text||' anon',
       case when count(*) filter (where grantee='authenticated')=11
             and count(*) filter (where grantee='anon')=0
            then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where routine_schema='public'
   and routine_name in ('plan_pv_site_survey','upsert_pv_survey_roof','upsert_pv_survey_electrical',
       'upsert_pv_survey_context','set_pv_survey_status','validate_pv_site_survey',
       'resolve_pv_survey_finding','apply_pv_survey_measurement','get_pv_site_survey',
       'get_pv_site_surveys','register_pv_survey_report');

insert into r (test,expected,actual,status)
select 'T59 aucune facade PV-6 n''expose un parametre de tenant','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('plan_pv_site_survey','upsert_pv_survey_roof','upsert_pv_survey_electrical',
       'upsert_pv_survey_context','set_pv_survey_status','validate_pv_site_survey',
       'resolve_pv_survey_finding','apply_pv_survey_measurement','get_pv_site_survey',
       'get_pv_site_surveys','register_pv_survey_report')
   and pg_get_function_identity_arguments(p.oid) ~* '(p_tenant|tenant_id)';

insert into r (test,expected,actual,status)
select 'T60 toutes les facades PV-6 en SECURITY DEFINER avec search_path verrouille','11',count(*)::text,
       case when count(*)=11 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef
   and array_to_string(p.proconfig,',') like '%search_path=hermes_os%'
   and p.proname in ('plan_pv_site_survey','upsert_pv_survey_roof','upsert_pv_survey_electrical',
       'upsert_pv_survey_context','set_pv_survey_status','validate_pv_site_survey',
       'resolve_pv_survey_finding','apply_pv_survey_measurement','get_pv_site_survey',
       'get_pv_site_surveys','register_pv_survey_report');

insert into r (test,expected,actual,status)
select 'T61 aucune capacite pv.* activee (PV_ACTIONS_ENABLED = NO)','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled = true;

insert into r (test,expected,actual,status)
select 'T62 aucune capacite pv.survey.* creee dans ce lot','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where action_key like 'pv.survey%';

insert into r (test,expected,actual,status)
select 'T63 aucun consumer PV actif (Agent 4 / Agent 5 inactifs)','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled = true;

insert into r (test,expected,actual,status)
select 'T64 requetes QUEUED intactes (>=13), aucune PV','oui',
       count(*)::text||' dont '||count(*) filter (where action_key like 'pv.%')::text||' PV',
       case when count(*)>=13 and count(*) filter (where action_key like 'pv.%')=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

select id, status, test, expected, actual from r order by id;

rollback;
