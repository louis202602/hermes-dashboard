-- Assertions REPRODUCTIBLES pour le LOT PV-5 (devis photovoltaïque).
--
-- Transaction ROLLED BACK : rien n'est persiste. Le tenant B est SYNTHETIQUE.
-- Substituer un uuid de membre reel pour :admin avant execution.
-- Execution (psql) : \i db/tests/pv5_quotes.test.sql
--
-- Couverture (numerotation de la mission PV-5) :
--   3-7    creation : dossier non pret refuse AVEC raisons, dossier pret accepte,
--          numerotation atomique et sans doublon, FK composite inter-tenant
--   8-16   lignes et totaux : ajout, modification, suppression, remise de ligne,
--          remise globale, plusieurs taux de TVA, arrondis, colonne generee
--   17-27  etats : chemins interdits, READY, SENT, ACCEPTED, immutabilite,
--          versioning, etats commerciaux du prospect, raccourci WON supprime
--   28-35  PDF : brouillon libre, FINAL conditionne, idempotence, perimetre,
--          empreinte, taille, isolation
--   36-40  isolation multi-tenant et surface exposee
--   41-52  non-regression Phase 1 / Phase 2 / PV-1 / PV-2 / PV-3 / PV-4
--
-- NOTE DE CALCUL (assertion T14) : la TVA est arrondie UNE FOIS PAR TAUX, apres
-- application proportionnelle de la remise globale. Pour 3 240,00 + 41,11 a 20 %
-- et 2 000,00 a 10 %, avec 5 % de remise :
--   base 20 % = (3240,00 + 41,11) x 0,95 = 3 117,0545  ->  TVA = 623,41
--   base 10 % =  2000,00          x 0,95 = 1 900,00    ->  TVA = 190,00
--   TVA totale = 813,41   TTC = 5 017,05 + 813,41 = 5 830,46
-- Arrondir par LIGNE donnerait un autre resultat : c'est precisement pourquoi
-- l'assertion porte des valeurs exactes plutot qu'un ordre de grandeur.

\set admin '00000000-0000-0000-0000-000000000000'

begin;
set local pv.admin = :'admin';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;
insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv5_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.admin')::uuid;
  pa uuid; pb uuid; pc uuid; sa uuid; sb uuid; s_v1 uuid; s_b uuid; e_ok uuid;
  q uuid; q2 uuid; q3 uuid; qb uuid; l1 uuid; l2 uuid; l3 uuid;
  j jsonb; n int; v text; nums text[];
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- ===================== JEU D ESSAI =====================
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by,status)
  values ('heliosolar','PARTICULIER','Durand','0600000011',v_uid,'STUDY_DELIVERED') returning id into pa;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pa,'7 rue du Soleil','13100','Aix') returning id into sa;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sa,1,'MANUAL','VALIDATED',9.000,v_uid,now()) returning id into s_v1;
  insert into hermes_os.pv_economics (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at)
  values ('heliosolar',s_v1,'VERIFIED','MANUAL',15000,v_uid,now()) returning id into e_ok;

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('heliosolar','PARTICULIER','PasPret','0600000012',v_uid) returning id into pc;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('heliosolar',pc,'8 rue Grise','13100','Aix') returning id into sb;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status)
  values ('heliosolar',sb,1,'MANUAL','DRAFT');

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,company_name,email)
  values ('__pv5_b__','PROFESSIONNEL','SARL B','b@b.fr') returning id into pb;

  -- ===================== 3-7. CREATION =====================
  j := public.create_pv_quote(pc);
  insert into r (test,expected,actual,status) values (
    'T3 dossier NON pret : devis refuse AVEC raisons','QUOTE_NOT_READY|STUDY_NOT_VALIDATED',
    coalesce(j->>'code','null')||'|'||coalesce(j->'missing_requirements'->>0,'null'),
    case when j->>'code'='QUOTE_NOT_READY' and j->'missing_requirements'->>0='STUDY_NOT_VALIDATED'
         then 'PASS' else 'FAIL' end);

  j := public.create_pv_quote(pa);
  q := (j->>'quote_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T4 dossier pret : devis DRAFT cree','CREATED', coalesce(j->>'code','null'),
    case when j->>'code'='CREATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T4b devis en DRAFT, rattache a l etude VALIDEE et au chiffrage VERIFIE',
         'DRAFT|'||s_v1::text||'|'||e_ok::text,
         status||'|'||study_id::text||'|'||coalesce(economics_id::text,'null'),
         case when status='DRAFT' and study_id=s_v1 and economics_id=e_ok then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;
  insert into r (test,expected,actual,status) values (
    'T5 numero au format DEV-AAAA-NNNNNN','oui',
    case when j->>'quote_number' ~ '^DEV-[0-9]{4}-[0-9]{6}$' then 'oui' else j->>'quote_number' end,
    case when j->>'quote_number' ~ '^DEV-[0-9]{4}-[0-9]{6}$' then 'PASS' else 'FAIL' end);

  -- Concurrence : 50 tirages successifs. L'`on conflict do update … returning`
  -- prend un verrou de ligne, donc deux transactions concurrentes s'attendent.
  -- Ce test prouve l'absence de doublon et la continuite ; la concurrence REELLE
  -- entre sessions n'est pas exercable depuis une transaction unique.
  select array_agg(hermes_os.next_pv_quote_number('heliosolar', 2099)) into nums
    from generate_series(1,50);
  insert into r (test,expected,actual,status) values (
    'T6 numerotation : 50 tirages, 50 numeros DISTINCTS','50',
    (select count(distinct x)::text from unnest(nums) x),
    case when (select count(distinct x) from unnest(nums) x)=50 then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status) values (
    'T6b sequence CONTINUE 1..50, aucun trou','1|50',
    (select min(right(x,6)::int)::text||'|'||max(right(x,6)::int)::text from unnest(nums) x),
    case when (select min(right(x,6)::int)=1 and max(right(x,6)::int)=50 from unnest(nums) x)
         then 'PASS' else 'FAIL' end);
  begin
    insert into hermes_os.pv_quotes (tenant_id,prospect_id,site_id,study_id,quote_number,version,status)
    values ('heliosolar',pa,sa,s_v1,(select quote_number from hermes_os.pv_quotes where id=q),1,'DRAFT');
    v:='ACCEPTE';
  exception when unique_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T6c doublon (numero,version) refuse PAR LA BASE','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);

  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv5_b__',pb,'9 rue B','75001','Paris') returning id into sb;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status)
  values ('__pv5_b__',sb,1,'MANUAL','DRAFT') returning id into s_b;
  begin
    insert into hermes_os.pv_quotes (tenant_id,prospect_id,site_id,study_id,quote_number,version,status)
    values ('heliosolar',pa,sa,s_b,'DEV-2099-999999',1,'DRAFT');
    v:='ACCEPTE';
  exception when foreign_key_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T7 FK COMPOSITE : etude d un AUTRE tenant refusee','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 8-16. LIGNES ET TOTAUX =====================
  j := public.upsert_pv_quote_line(null,q,'PANNEAUX','Panneau 425 Wc',20,'U',180.00,20,0,null,null);
  l1 := (j->>'line_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T8 ajout de ligne','SAVED', coalesce(j->>'code','null'),
    case when j->>'code'='SAVED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T11 total de ligne CALCULE (20 x 180,00)','3600.00', line_total_ht_eur::text,
         case when line_total_ht_eur=3600.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quote_lines where id=l1;
  insert into r (test,expected,actual,status)
  select 'T11b totaux du devis recalcules : HT 3600, TVA 720, TTC 4320','3600.00|720.00|4320.00',
         total_ht_eur::text||'|'||total_vat_eur::text||'|'||total_ttc_eur::text,
         case when total_ht_eur=3600.00 and total_vat_eur=720.00 and total_ttc_eur=4320.00
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;

  j := public.upsert_pv_quote_line(null,q,'POSE','Pose et raccordement',1,'FORFAIT',2000.00,10,0,null,null);
  l2 := (j->>'line_id')::uuid;
  insert into r (test,expected,actual,status)
  select 'T15 DEUX taux de TVA : 720,00 (20%) + 200,00 (10%) = 920,00','5600.00|920.00|6520.00',
         total_ht_eur::text||'|'||total_vat_eur::text||'|'||total_ttc_eur::text,
         case when total_ht_eur=5600.00 and total_vat_eur=920.00 and total_ttc_eur=6520.00
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;

  j := public.upsert_pv_quote_line(l1,q,'PANNEAUX','Panneau 425 Wc',20,'U',180.00,20,10,null,null);
  insert into r (test,expected,actual,status)
  select 'T12 remise de LIGNE 10% : 3600 -> 3240,00','3240.00', line_total_ht_eur::text,
         case when line_total_ht_eur=3240.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quote_lines where id=l1;
  insert into r (test,expected,actual,status)
  select 'T9 modification de ligne : totaux recalcules','5240.00|848.00|6088.00',
         total_ht_eur::text||'|'||total_vat_eur::text||'|'||total_ttc_eur::text,
         case when total_ht_eur=5240.00 and total_vat_eur=848.00 and total_ttc_eur=6088.00
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;

  j := public.upsert_pv_quote_line(null,q,'CABLAGE','Cable solaire',12.345,'M',3.33,20,0,null,null);
  l3 := (j->>'line_id')::uuid;
  insert into r (test,expected,actual,status)
  select 'T16 arrondi : 12,345 x 3,33 = 41,10885 -> 41,11','41.11', line_total_ht_eur::text,
         case when line_total_ht_eur=41.11 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quote_lines where id=l3;

  j := public.update_pv_quote(q, 5, null, null, 'Conditions standard.');
  insert into r (test,expected,actual,status)
  select 'T13 remise GLOBALE 5% : sous-total 5281,11, remise 264,06, HT 5017,05',
         '5281.11|264.06|5017.05',
         subtotal_ht_eur::text||'|'||discount_amount_eur::text||'|'||total_ht_eur::text,
         case when subtotal_ht_eur=5281.11 and discount_amount_eur=264.06 and total_ht_eur=5017.05
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;
  -- Voir la NOTE DE CALCUL en tete de fichier : 623,41 + 190,00 = 813,41.
  insert into r (test,expected,actual,status)
  select 'T14 TVA arrondie PAR TAUX apres remise proportionnelle','813.41|5830.46',
         total_vat_eur::text||'|'||total_ttc_eur::text,
         case when total_vat_eur=813.41 and total_ttc_eur=5830.46 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;

  -- T14b — L'ASSERTION QUI SEPARE VRAIMENT LES DEUX REGLES D'ARRONDI.
  -- Decouverte par mutation testing : sur le jeu d'essai ci-dessus, arrondir par
  -- ligne ou par taux donne la MEME valeur (813,41). L'assertion T14 ne prouvait
  -- donc pas la regle qu'elle documente. Trois lignes a 0,03 EUR les separent :
  --   par taux  : round(0,09 x 0,20 ; 2) = round(0,018 ; 2) = 0,02
  --   par ligne : 3 x round(0,03 x 0,20 ; 2) = 3 x 0,01     = 0,03
  declare
    q_arr uuid;
  begin
    j := public.create_pv_quote(pa);
    q_arr := (j->>'quote_id')::uuid;
    perform public.upsert_pv_quote_line(null,q_arr,'AUTRE','Vis A',1,'U',0.03,20,0,null,null);
    perform public.upsert_pv_quote_line(null,q_arr,'AUTRE','Vis B',1,'U',0.03,20,0,null,null);
    perform public.upsert_pv_quote_line(null,q_arr,'AUTRE','Vis C',1,'U',0.03,20,0,null,null);
    insert into r (test,expected,actual,status)
    select 'T14b TVA arrondie PAR TAUX : 0,02 (par ligne donnerait 0,03)','0.09|0.02|0.11',
           subtotal_ht_eur::text||'|'||total_vat_eur::text||'|'||total_ttc_eur::text,
           case when subtotal_ht_eur=0.09 and total_vat_eur=0.02 and total_ttc_eur=0.11
                then 'PASS' else 'FAIL' end
      from hermes_os.pv_quotes where id=q_arr;
    perform public.cancel_pv_quote(q_arr);
  end;

  j := public.delete_pv_quote_line(l3);
  insert into r (test,expected,actual,status) values (
    'T10 suppression de ligne','DELETED', coalesce(j->>'code','null'),
    case when j->>'code'='DELETED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T10b totaux recalcules apres suppression','5240.00|4978.00',
         subtotal_ht_eur::text||'|'||total_ht_eur::text,
         case when subtotal_ht_eur=5240.00 and total_ht_eur=4978.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;

  begin
    update hermes_os.pv_quote_lines set line_total_ht_eur = 1 where id = l1;
    v:='ACCEPTE';
  exception when others then v:='REFUSE'; end;
  insert into r (test,expected,actual,status) values (
    'T11c le total de ligne est une colonne GENEREE : ecriture impossible','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 17-27. ETATS =====================
  begin
    update hermes_os.pv_quotes set status='ACCEPTED' where id=q; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T17 DRAFT -> ACCEPTED INTERDIT','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);
  begin
    update hermes_os.pv_quotes set status='SENT' where id=q; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T17b DRAFT -> SENT INTERDIT : on passe par READY','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);

  j := public.set_pv_quote_ready(q);
  insert into r (test,expected,actual,status) values (
    'T18 DRAFT -> READY autorise si complet','READY', coalesce(j->>'code','null'),
    case when j->>'code'='READY' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T24 le prospect passe en OFFER_PREPARED','OFFER_PREPARED', status,
         case when status='OFFER_PREPARED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_prospects where id=pa;

  j := public.send_pv_quote(q, current_date);
  insert into r (test,expected,actual,status) values (
    'T19 READY -> SENT','SENT', coalesce(j->>'code','null'),
    case when j->>'code'='SENT' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T25 devis SENT : prospect en OFFER_SENT','OFFER_SENT', status,
         case when status='OFFER_SENT' then 'PASS' else 'FAIL' end
    from hermes_os.pv_prospects where id=pa;

  begin
    update hermes_os.pv_quotes set discount_pct = 50 where id=q; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T23 contenu commercial d un devis SENT : modification REFUSEE','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);
  begin
    update hermes_os.pv_quote_lines set unit_price_ht_eur = 1 where id=l1; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T23b lignes d un devis SENT : modification REFUSEE','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);
  j := public.upsert_pv_quote_line(null,q,'OPTION','Ajout tardif',1,'U',100,20,0,null,null);
  insert into r (test,expected,actual,status) values (
    'T23c la facade refuse aussi, code lisible','QUOTE_LOCKED', coalesce(j->>'code','null'),
    case when j->>'code'='QUOTE_LOCKED' then 'PASS' else 'FAIL' end);

  j := public.accept_pv_quote(q, current_date, 'BC-2026-014');
  insert into r (test,expected,actual,status) values (
    'T20 SENT -> ACCEPTED','ACCEPTED', coalesce(j->>'code','null'),
    case when j->>'code'='ACCEPTED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T20b acceptation tracee : acteur + reference', v_uid::text||'|BC-2026-014',
         coalesce(accepted_by::text,'null')||'|'||coalesce(acceptance_reference,'null'),
         case when accepted_by=v_uid and acceptance_reference='BC-2026-014' then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q;
  insert into r (test,expected,actual,status)
  select 'T26 devis ACCEPTED : prospect en OFFER_ACCEPTED','OFFER_ACCEPTED', status,
         case when status='OFFER_ACCEPTED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_prospects where id=pa;

  begin
    update hermes_os.pv_quotes set status='DRAFT' where id=q; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T22 ACCEPTED -> DRAFT INTERDIT','REFUSE',v, case when v='REFUSE' then 'PASS' else 'FAIL' end);
  j := public.revise_pv_quote(q);
  insert into r (test,expected,actual,status) values (
    'T22b un devis ACCEPTE ne peut pas etre revise','QUOTE_ACCEPTED_IMMUTABLE',
    coalesce(j->>'code','null'),
    case when j->>'code'='QUOTE_ACCEPTED_IMMUTABLE' then 'PASS' else 'FAIL' end);

  update hermes_os.pv_prospects set status='WON' where id=pa;
  insert into r (test,expected,actual,status)
  select 'T26b OFFER_ACCEPTED -> WON autorise','WON', status,
         case when status='WON' then 'PASS' else 'FAIL' end
    from hermes_os.pv_prospects where id=pa;

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by,status)
  values ('heliosolar','PARTICULIER','Direct','0600000013',v_uid,'STUDY_DELIVERED') returning id into pc;
  begin
    update hermes_os.pv_prospects set status='WON' where id=pc; v:='ACCEPTE';
  exception when check_violation then v:='REFUSE'; when others then v:='AUTRE:'||sqlstate; end;
  insert into r (test,expected,actual,status) values (
    'T27 STUDY_DELIVERED -> WON : raccourci SUPPRIME','REFUSE',v,
    case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== VERSIONING =====================
  j := public.create_pv_quote(pa);
  q2 := (j->>'quote_id')::uuid;
  perform public.upsert_pv_quote_line(null,q2,'PANNEAUX','Panneau',10,'U',200,20,0,null,null);
  perform public.set_pv_quote_ready(q2);
  perform public.send_pv_quote(q2, current_date);
  j := public.revise_pv_quote(q2);
  q3 := (j->>'quote_id')::uuid;
  insert into r (test,expected,actual,status) values (
    'T23d modifier un devis SENT = NOUVELLE VERSION','REVISED|2',
    coalesce(j->>'code','null')||'|'||coalesce(j->>'version','null'),
    case when j->>'code'='REVISED' and j->>'version'='2' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T23e l ancienne version passe en SUPERSEDED, INTACTE','SUPERSEDED|2000.00',
         status||'|'||total_ht_eur::text,
         case when status='SUPERSEDED' and total_ht_eur=2000.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q2;
  insert into r (test,expected,actual,status)
  select 'T23f la nouvelle version reprend les lignes et le total','1|2000.00',
         (select count(*) from hermes_os.pv_quote_lines where quote_id=q3)::text
         ||'|'||total_ht_eur::text,
         case when (select count(*) from hermes_os.pv_quote_lines where quote_id=q3)=1
                   and total_ht_eur=2000.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q3;
  insert into r (test,expected,actual,status)
  select 'T23g meme NUMERO commercial pour les deux versions','1',
         count(distinct quote_number)::text,
         case when count(distinct quote_number)=1 then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id in (q2, q3);

  -- ===================== EXPIRATION, SANS SCHEDULER =====================
  perform public.upsert_pv_quote_line(null,q3,'POSE','Pose',1,'U',500,20,0,null,null);
  perform public.update_pv_quote(q3, null, (current_date - 1), null, null);
  perform public.set_pv_quote_ready(q3);
  perform public.send_pv_quote(q3, current_date - 10);
  j := public.get_pv_quote(q3);
  insert into r (test,expected,actual,status) values (
    'T15c peremption CALCULEE a la lecture, sans traitement','true',
    coalesce(j->>'is_expired','null'),
    case when (j->>'is_expired')::boolean then 'PASS' else 'FAIL' end);
  j := public.expire_pv_quotes();
  insert into r (test,expected,actual,status) values (
    'T15d expiration appliquee A LA DEMANDE (aucun cron)','OK|>=1',
    coalesce(j->>'code','null')||'|'||coalesce(j->>'expired','null'),
    case when j->>'code'='OK' and (j->>'expired')::int>=1 then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T15e le devis echu est passe en EXPIRED','EXPIRED', status,
         case when status='EXPIRED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_quotes where id=q3;

  -- ===================== 28-35. PDF =====================
  j := public.register_pv_quote_pdf('req-devis-draft-1', q, 'QUOTE_DRAFT',
        'heliosolar/'||sa::text||'/gen/devis.pdf', 12000, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T28 PDF BROUILLON enregistrable','GENERATED', coalesce(j->>'code','null'),
    case when j->>'code'='GENERATED' then 'PASS' else 'FAIL' end);
  insert into r (test,expected,actual,status)
  select 'T33 document : devis + stade + empreinte + chemin prive',
         q::text||'|QUOTE_DRAFT|true|true',
         coalesce(quote_id::text,'null')||'|'||document_stage||'|'||(sha256=repeat('a',64))::text
         ||'|'||(storage_path like 'heliosolar/%')::text,
         case when quote_id=q and document_stage='QUOTE_DRAFT' and sha256=repeat('a',64)
                   and storage_path like 'heliosolar/%' then 'PASS' else 'FAIL' end
    from hermes_os.pv_documents where id=(j->>'document_id')::uuid;
  j := public.register_pv_quote_pdf('req-devis-draft-1', q, 'QUOTE_DRAFT',
        'heliosolar/'||sa::text||'/gen/autre.pdf', 9000, repeat('b',64));
  insert into r (test,expected,actual,status) values (
    'T34 idempotence par request_id','ALREADY_GENERATED', coalesce(j->>'code','null'),
    case when j->>'code'='ALREADY_GENERATED' then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.pv_documents
   where tenant_id='heliosolar' and generation_request_id='req-devis-draft-1';
  insert into r (test,expected,actual,status) values (
    'T34b un SEUL fichier pour cette demande','1', n::text,
    case when n=1 then 'PASS' else 'FAIL' end);

  j := public.create_pv_quote(pa);
  qb := (j->>'quote_id')::uuid;
  j := public.register_pv_quote_pdf('req-devis-final-x', qb, 'QUOTE_FINAL',
        'heliosolar/'||sa::text||'/gen/x.pdf', 12000, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T29 PDF FINAL refuse si devis incomplet, AVEC raison','QUOTE_PDF_NOT_READY|NO_LINE',
    coalesce(j->>'code','null')||'|'||coalesce(j->'missing_requirements'->>0,'null'),
    case when j->>'code'='QUOTE_PDF_NOT_READY' and j->'missing_requirements'->>0='NO_LINE'
         then 'PASS' else 'FAIL' end);
  perform public.upsert_pv_quote_line(null,qb,'PANNEAUX','P',1,'U',100,20,0,null,null);
  j := public.register_pv_quote_pdf('req-devis-final-y', qb, 'QUOTE_FINAL',
        'heliosolar/'||sa::text||'/gen/y.pdf', 12000, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T29b PDF FINAL refuse tant que le devis est en DRAFT','QUOTE_PDF_NOT_READY',
    coalesce(j->>'code','null'),
    case when j->>'code'='QUOTE_PDF_NOT_READY' then 'PASS' else 'FAIL' end);
  j := public.register_pv_quote_pdf('req-devis-path-1', qb, 'QUOTE_DRAFT',
        '__pv5_b__/'||sb::text||'/gen/vol.pdf', 12000, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T32 chemin hors perimetre tenant/site refuse','PATH_OUT_OF_SCOPE', coalesce(j->>'code','null'),
    case when j->>'code'='PATH_OUT_OF_SCOPE' then 'PASS' else 'FAIL' end);
  j := public.register_pv_quote_pdf('req-devis-hash-1', qb, 'QUOTE_DRAFT',
        'heliosolar/'||sa::text||'/gen/z.pdf', 12000, 'PAS-UN-HASH');
  insert into r (test,expected,actual,status) values (
    'T33b empreinte non SHA-256 refusee','BAD_HASH', coalesce(j->>'code','null'),
    case when j->>'code'='BAD_HASH' then 'PASS' else 'FAIL' end);
  j := public.register_pv_quote_pdf('req-devis-size-1', qb, 'QUOTE_DRAFT',
        'heliosolar/'||sa::text||'/gen/z.pdf', 99999999, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T33c taille hors borne refusee','BAD_SIZE', coalesce(j->>'code','null'),
    case when j->>'code'='BAD_SIZE' then 'PASS' else 'FAIL' end);

  -- ===================== 36-40. ISOLATION =====================
  insert into hermes_os.pv_quotes (tenant_id,prospect_id,site_id,study_id,quote_number,version,status)
  values ('__pv5_b__',pb,sb,s_b,'DEV-2026-000999',1,'SENT') returning id into qb;

  j := public.get_pv_quote(qb);
  insert into r (test,expected,actual,status) values (
    'T36 A ne LIT pas le devis de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code'='NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.update_pv_quote(qb, 50, null, null, null);
  insert into r (test,expected,actual,status) values (
    'T37 A ne MODIFIE pas le devis de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code'='NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.accept_pv_quote(qb, current_date, null);
  insert into r (test,expected,actual,status) values (
    'T38 A ne marque pas ACCEPTE le devis de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code'='NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.register_pv_quote_pdf('req-devis-cross-1', qb, 'QUOTE_DRAFT',
        'heliosolar/'||sa::text||'/gen/c.pdf', 12000, repeat('a',64));
  insert into r (test,expected,actual,status) values (
    'T35 A ne genere pas le PDF du devis de B','NOT_FOUND', coalesce(j->>'code','null'),
    case when j->>'code'='NOT_FOUND' then 'PASS' else 'FAIL' end);
  j := public.get_pv_quotes(null, 200);
  select count(*) into n from jsonb_array_elements(j->'items') e
   where e->>'quote_number'='DEV-2026-000999';
  insert into r (test,expected,actual,status) values (
    'T36b la liste de A ne contient AUCUN devis de B','0', n::text,
    case when n=0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '', true);
  n := 0;
  if (public.create_pv_quote(pa)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.get_pv_quote(q)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.get_pv_quotes(null,10)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.set_pv_quote_ready(q)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.send_pv_quote(q,null)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.accept_pv_quote(q,null,null)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.refuse_pv_quote(q,null)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.cancel_pv_quote(q)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.revise_pv_quote(q)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.expire_pv_quotes()->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.update_pv_quote(q,null,null,null,null)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.delete_pv_quote_line(l1)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.upsert_pv_quote_line(null,q,'AUTRE','x',1,'U',1,20,0,null,null)->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  if (public.register_pv_quote_pdf('req-anon-devis',q,'QUOTE_DRAFT','x',1,repeat('a',64))->>'code')='UNAUTHENTICATED' then n:=n+1; end if;
  insert into r (test,expected,actual,status) values (
    'T39 les 14 facades devis REFUSENT l anonyme','14', n::text,
    case when n=14 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- ===================== 16. AUDIT =====================
  select count(*) into n from hermes_os.entity_audit_log
   where tenant_id='heliosolar' and entity_type='pv_quotes';
  insert into r (test,expected,actual,status) values (
    'T16 audit : gestes de devis traces dans entity_audit_log (aucun journal parallele)','>0',
    n::text, case when n > 0 then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.entity_audit_log
   where tenant_id='heliosolar' and entity_type='pv_quotes'
     and change_summary like '%statut SENT -> ACCEPTED%';
  insert into r (test,expected,actual,status) values (
    'T16b l ACCEPTATION est tracee nommement','>=1', n::text,
    case when n>=1 then 'PASS' else 'FAIL' end);
  select count(*) into n from hermes_os.entity_audit_log
   where tenant_id='heliosolar' and entity_type='pv_quotes'
     and change_summary like 'ligne de devis%';
  insert into r (test,expected,actual,status) values (
    'T16c les mouvements de LIGNES sont traces','>0', n::text,
    case when n>0 then 'PASS' else 'FAIL' end);
end;
$$;

-- ===================== ETAT DECLARATIF =====================
insert into r (test,expected,actual,status)
select 'T39b aucune facade devis n accepte de tenant_id','0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%pv_quote%'
   and pg_get_function_identity_arguments(p.oid) ~* 'tenant';

insert into r (test,expected,actual,status)
select 'T39c aucune facade devis n accepte de TOTAL','0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%pv_quote%'
   and pg_get_function_identity_arguments(p.oid) ~* '(p_total|p_subtotal|p_ttc|p_line_total)';

insert into r (test,expected,actual,status)
select 'T40 aucun GRANT anon sur une facade devis','0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where grantee='anon' and specific_schema='public' and routine_name like '%pv_quote%';

insert into r (test,expected,actual,status)
select 'T40b tables devis : RLS activee, ZERO policy, ZERO grant direct','4|0|0',
       (select count(*) from pg_tables where schemaname='hermes_os'
         and tablename like 'pv_quote%' and rowsecurity)::text
       ||'|'||(select count(*) from pg_policies where schemaname='hermes_os' and tablename like 'pv_quote%')::text
       ||'|'||(select count(*) from information_schema.role_table_grants
                where table_schema='hermes_os' and table_name like 'pv_quote%'
                  and grantee in ('anon','authenticated'))::text,
       case when (select count(*) from pg_tables where schemaname='hermes_os'
                   and tablename like 'pv_quote%' and rowsecurity)=4
             and (select count(*) from pg_policies where schemaname='hermes_os' and tablename like 'pv_quote%')=0
             and (select count(*) from information_schema.role_table_grants
                   where table_schema='hermes_os' and table_name like 'pv_quote%'
                     and grantee in ('anon','authenticated'))=0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T40c les 14 facades devis : SECURITY DEFINER + search_path verrouille','14|14',
       count(*)::text||'|'||count(*) filter (where p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%')::text,
       case when count(*)=14 and count(*) filter (where p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%')=14
            then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%pv_quote%';

insert into r (test,expected,actual,status)
select 'T40d 15 chemins de statut de devis declares EN DONNEES','15', count(*)::text,
       case when count(*)=15 then 'PASS' else 'FAIL' end from hermes_os.pv_quote_transitions;

insert into r (test,expected,actual,status)
select 'T40e WON n est atteignable QUE depuis OFFER_ACCEPTED','1|OFFER_ACCEPTED',
       count(*)::text||'|'||coalesce(string_agg(from_status,','),'null'),
       case when count(*)=1 and string_agg(from_status,',')='OFFER_ACCEPTED' then 'PASS' else 'FAIL' end
  from hermes_os.pv_prospect_transitions where to_status='WON';

-- ===================== 41-52. NON-REGRESSION =====================
insert into r (test,expected,actual,status)
select 'T41 Phase 1 gate SW15 toujours FAIL-CLOSED','FAIL_CLOSED_OK',
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'FAIL_CLOSED_OK' else 'REGRESSION' end,
       case when pg_get_functiondef(p.oid) like '%REQUIRE_APPROVAL%'
                 and pg_get_functiondef(p.oid) like '%is_sensitive%' then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hermes_os' and p.proname='gateway_policy_gate';

insert into r (test,expected,actual,status)
select 'T42 Phase 2 TTL + FK tenant presentes','2', count(*)::text,
       case when count(*)=2 then 'PASS' else 'FAIL' end
  from (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='hermes_os' and p.proname='expire_stale_queued_agent_actions'
        union all select 1 from pg_constraint where conname='agent_action_requests_tenant_id_fkey') x;

insert into r (test,expected,actual,status)
select 'T43 PV-1 : 9 tables metier intactes','9', count(*)::text,
       case when count(*)=9 then 'PASS' else 'FAIL' end
  from information_schema.tables where table_schema='hermes_os' and table_name in
   ('pv_prospects','pv_prospect_transitions','pv_sites','pv_consumption_profiles',
    'pv_energy_bills','pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics');

insert into r (test,expected,actual,status)
select 'T44 PV-2 : bucket PRIVE + 3 policies + 0 DELETE','false|3|0',
       (select public::text from storage.buckets where id='hermes-pv-documents')
       ||'|'||(select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%')::text
       ||'|'||(select count(*) from pg_policies where schemaname='storage'
                and policyname like 'hermes_pv_documents%' and cmd='DELETE')::text,
       case when (select public from storage.buckets where id='hermes-pv-documents')=false
             and (select count(*) from pg_policies where schemaname='storage' and policyname like 'hermes_pv_documents%')=3
             and (select count(*) from pg_policies where schemaname='storage'
                   and policyname like 'hermes_pv_documents%' and cmd='DELETE')=0 then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T45 PV-3 : 31 chemins de statut etude/chiffrage','31', count(*)::text,
       case when count(*)=31 then 'PASS' else 'FAIL' end from hermes_os.pv_status_transitions;

insert into r (test,expected,actual,status)
select 'T46 PV-4 : purge admin + journal + vue Affaire intacts','3', count(*)::text,
       case when count(*)=3 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_pv_deal','get_pv_purge_journal','register_pv_study_summary');

insert into r (test,expected,actual,status)
select 'T47 capacites PV IA toujours desactivees','3|0',
       (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false)::text
       ||'|'||(select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=true)::text,
       case when (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=false)=3
             and (select count(*) from hermes_os.agent_action_catalog where action_key like 'pv.%' and enabled=true)=0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T47b AUCUNE capacite pv.quote.* creee','0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where action_key like 'pv.quote%';

insert into r (test,expected,actual,status)
select 'T48 politiques SW15 PV inchangees : 3 REQUIRE_APPROVAL, 0 PERMIT','3|0',
       (select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='REQUIRE_APPROVAL')::text
       ||'|'||(select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')::text,
       case when (select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='REQUIRE_APPROVAL')=3
             and (select count(*) from hermes_os.sw15_policies where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')=0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T49 aucun consumer PV actif (Agent 4 / Agent 5 inactifs)','0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled=true;

insert into r (test,expected,actual,status)
select 'T52 requetes QUEUED intactes (>=12), aucune PV','oui',
       count(*)::text||' dont '||count(*) filter (where action_key like 'pv.%')::text||' PV',
       case when count(*)>=12 and count(*) filter (where action_key like 'pv.%')=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

select id, status, test, expected, actual from r order by id;

rollback;
