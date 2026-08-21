-- Assertions REPRODUCTIBLES pour le LOT PV-7 (approvisionnement matériel).
--
-- Transaction ROLLED BACK : rien n'est persiste. Le tenant B est SYNTHETIQUE.
-- Substituer un uuid de membre reel pour :admin avant execution.
-- Execution (psql) : \i db/tests/pv7_material_procurement.test.sql
--
-- Couverture (numerotation de la mission PV-7) :
--   T1-T3    merge PV-6 : tables, facades et porte de visite toujours en place
--   T4-T9    catalogue et fournisseurs : isolation, SKU unique, actif/inactif
--   T10-T14  tarifs DATES : historique preserve, prix a une date
--   T15-T22  besoins : origine conservee, aucune interpretation de texte libre
--   T23-T33  commandes : numerotation, machine a etats, porte de commande
--   T34-T39  reception : partielle, exces refuse, manque calcule
--   T40-T43  readiness materiel
--   T44-T47  couts : aucun prix client ecrase, marge refusee si incomplete
--   T48-T52  isolation multi-tenant et surface exposee
--   T53-T64  non-regression Phase 1 / Phase 2 / PV-1 a PV-6

\set admin '00000000-0000-0000-0000-000000000000'

begin;
set local pv.admin = :'admin';

create temp table r (id serial primary key, test text, expected text, actual text, status text) on commit drop;
insert into hermes_os.tenants (tenant_id, name, display_name) values ('__pv7_b__','B','B');

do $$
declare
  v_uid uuid := current_setting('pv.admin')::uuid;
  pa uuid; pb uuid; sa uuid; sb0 uuid; st uuid; ec uuid; vi uuid; q uuid;
  m_pan uuid; m_ond uuid; m_off uuid; m_b uuid;
  f1 uuid; f2 uuid; fb uuid;
  o1 uuid; o2 uuid; ob uuid; l1 uuid; l2 uuid;
  req_pan uuid; req_libre uuid;
  j jsonb; n int; v text; codes text[]; nums text[];
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- ===================== JEU D ESSAI =====================
  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by,status)
  values ('heliosolar','PARTICULIER','Appro','0600000071',v_uid,'STUDY_DELIVERED') returning id into pa;
  insert into hermes_os.pv_sites
    (tenant_id,prospect_id,address_line1,postal_code,city,roof_area_usable_m2,azimuth_deg,tilt_deg,
     roof_type,roof_condition,shading_level,access_difficulty)
  values ('heliosolar',pa,'21 rue des Modules','13100','Aix',80,180,30,
          'PENTE','BON','FAIBLE','MOYEN') returning id into sa;
  insert into hermes_os.pv_studies (tenant_id,site_id,version,prepared_by,status,target_power_kwc,validated_by,validated_at)
  values ('heliosolar',sa,1,'MANUAL','VALIDATED',9.000,v_uid,now()) returning id into st;
  insert into hermes_os.pv_economics (tenant_id,study_id,status,computed_by,investment_ht_eur,verified_by,verified_at)
  values ('heliosolar',st,'VERIFIED','MANUAL',15000,v_uid,now()) returning id into ec;

  insert into hermes_os.pv_prospects (tenant_id,prospect_type,last_name,phone,created_by)
  values ('__pv7_b__','PARTICULIER','AutreB','0600000072',v_uid) returning id into pb;
  insert into hermes_os.pv_sites (tenant_id,prospect_id,address_line1,postal_code,city)
  values ('__pv7_b__',pb,'1 rue B','75000','Paris') returning id into sb0;

  -- ===================== 1. MERGE PV-6 TOUJOURS EN PLACE =====================

  insert into r (test,expected,actual,status)
  select 'T1 tables PV-6 toujours presentes apres le merge de #73','4',count(*)::text,
         case when count(*)=4 then 'PASS' else 'FAIL' end
    from information_schema.tables where table_schema='hermes_os'
     and table_name in ('pv_site_surveys','pv_site_survey_findings',
                        'pv_survey_transitions','pv_survey_thresholds');

  insert into r (test,expected,actual,status)
  select 'T2 les 11 facades PV-6 repondent toujours','11',count(*)::text,
         case when count(*)=11 then 'PASS' else 'FAIL' end
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in
     ('plan_pv_site_survey','upsert_pv_survey_roof','upsert_pv_survey_electrical',
      'upsert_pv_survey_context','set_pv_survey_status','validate_pv_site_survey',
      'resolve_pv_survey_finding','apply_pv_survey_measurement','get_pv_site_survey',
      'get_pv_site_surveys','register_pv_survey_report');

  insert into r (test,expected,actual,status)
  values ('T3 la porte de visite PV-6 repond toujours (aucune visite = NONE)','NONE',
          hermes_os.pv_survey_gate('heliosolar', sa),
          case when hermes_os.pv_survey_gate('heliosolar', sa)='NONE' then 'PASS' else 'FAIL' end);

  -- ===================== 2. CATALOGUE =====================

  j := public.upsert_pv_material(null, 'PANNEAU', 'PAN-400', 'Module 400 Wc monocristallin',
        null, 'SolarCo', 'SC-M400', null, 'U', 145.00);
  m_pan := (j->>'material_id')::uuid;
  insert into r (test,expected,actual,status)
  values ('T4 creation d''un article de catalogue','SAVED', coalesce(j->>'code','(null)'),
          case when j->>'code'='SAVED' and m_pan is not null then 'PASS' else 'FAIL' end);

  j := public.upsert_pv_material(null, 'ONDULEUR', 'OND-6K', 'Onduleur 6 kW', null, null, null, null, 'U', 890.00);
  m_ond := (j->>'material_id')::uuid;

  -- SKU unique PAR TENANT : le meme SKU est refuse ici...
  j := public.upsert_pv_material(null, 'PANNEAU', 'PAN-400', 'Doublon');
  insert into r (test,expected,actual,status)
  values ('T5 SKU deja pris dans le tenant : refuse','DUPLICATE_SKU', coalesce(j->>'code','(null)'),
          case when j->>'code'='DUPLICATE_SKU' then 'PASS' else 'FAIL' end);

  -- ... mais parfaitement legitime chez un AUTRE tenant.
  insert into hermes_os.pv_material_catalog (tenant_id, category, sku, designation)
  values ('__pv7_b__', 'PANNEAU', 'PAN-400', 'Module du tenant B') returning id into m_b;
  insert into r (test,expected,actual,status)
  values ('T6 le meme SKU est libre chez un AUTRE tenant','oui',
          case when m_b is not null then 'oui' else 'non' end,
          case when m_b is not null then 'PASS' else 'FAIL' end);

  -- Article desactive : plus propose par defaut, toujours lisible sur demande.
  j := public.upsert_pv_material(null, 'CONSOMMABLE', 'CONS-OLD', 'Ancien consommable');
  m_off := (j->>'material_id')::uuid;
  perform public.set_pv_material_active(m_off, false);
  insert into r (test,expected,actual,status)
  values ('T7 article desactive : absent par defaut, present si demande','absent|present',
          case when public.get_pv_materials(false)::text like '%CONS-OLD%' then 'present' else 'absent' end
          ||'|'||
          case when public.get_pv_materials(true)::text like '%CONS-OLD%' then 'present' else 'absent' end,
          case when public.get_pv_materials(false)::text not like '%CONS-OLD%'
                and public.get_pv_materials(true)::text like '%CONS-OLD%'
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T8 isolation catalogue : l''article du tenant B est invisible','0',
         jsonb_array_length(coalesce(public.get_pv_materials(true)->'items','[]'::jsonb))
           - (select count(*) from hermes_os.pv_material_catalog where tenant_id='heliosolar')::int,
         case when jsonb_array_length(coalesce(public.get_pv_materials(true)->'items','[]'::jsonb))
                 = (select count(*) from hermes_os.pv_material_catalog where tenant_id='heliosolar')
              then 'PASS' else 'FAIL' end;

  -- ===================== 3. FOURNISSEURS =====================

  j := public.upsert_pv_supplier(null, 'Distri Solaire', 'Marc', 'contact@distri.example',
        '0400000000', '3 zone Nord', '13400', 'Aubagne', 7, '30 jours fin de mois', 1500);
  f1 := (j->>'supplier_id')::uuid;
  j := public.upsert_pv_supplier(null, 'Elec Pro');
  f2 := (j->>'supplier_id')::uuid;
  insert into r (test,expected,actual,status)
  values ('T9 creation de deux fournisseurs','oui',
          case when f1 is not null and f2 is not null then 'oui' else 'non' end,
          case when f1 is not null and f2 is not null then 'PASS' else 'FAIL' end);

  insert into hermes_os.pv_suppliers (tenant_id, name) values ('__pv7_b__','Fournisseur B') returning id into fb;
  insert into r (test,expected,actual,status)
  select 'T10 isolation fournisseurs : celui du tenant B est invisible','0',
         (jsonb_array_length(coalesce(public.get_pv_suppliers(true)->'items','[]'::jsonb))
          - (select count(*) from hermes_os.pv_suppliers where tenant_id='heliosolar'))::text,
         case when jsonb_array_length(coalesce(public.get_pv_suppliers(true)->'items','[]'::jsonb))
                 = (select count(*) from hermes_os.pv_suppliers where tenant_id='heliosolar')
              then 'PASS' else 'FAIL' end;

  -- FK COMPOSITE : impossible de rattacher un article a un fournisseur d'un autre tenant.
  begin
    update hermes_os.pv_material_catalog set preferred_supplier_id = fb where id = m_pan;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE';
  end;
  insert into r (test,expected,actual,status)
  values ('T11 FK composite : fournisseur d''un AUTRE tenant refuse','REFUSE', v,
          case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 4. TARIFS DATES =====================

  perform public.upsert_pv_supplier_price(m_pan, f1, 140.00, current_date - 60, 'DS-PAN400', 10);
  perform public.upsert_pv_supplier_price(m_pan, f2, 138.50, current_date - 60, 'EP-PAN400', 20);
  insert into r (test,expected,actual,status)
  select 'T12 plusieurs fournisseurs tarifent le MEME article','2',count(*)::text,
         case when count(*)=2 then 'PASS' else 'FAIL' end
    from hermes_os.pv_supplier_prices where tenant_id='heliosolar' and material_id=m_pan;

  -- Nouveau prix : la periode precedente est CLOSE, pas ecrasee.
  perform public.upsert_pv_supplier_price(m_pan, f1, 152.00, current_date);
  insert into r (test,expected,actual,status)
  select 'T13 nouveau tarif : la periode precedente est CLOSE, pas ecrasee','2 periodes',
         count(*)::text||' periodes',
         case when count(*)=2 then 'PASS' else 'FAIL' end
    from hermes_os.pv_supplier_prices
   where tenant_id='heliosolar' and material_id=m_pan and supplier_id=f1;

  insert into r (test,expected,actual,status)
  values ('T14 prix A UNE DATE : 140 hier, 152 aujourd''hui','140.0000|152.0000',
          coalesce(hermes_os.pv_supplier_price_at('heliosolar', m_pan, f1, current_date - 1)::text,'(null)')
          ||'|'||
          coalesce(hermes_os.pv_supplier_price_at('heliosolar', m_pan, f1, current_date)::text,'(null)'),
          case when hermes_os.pv_supplier_price_at('heliosolar', m_pan, f1, current_date - 1) = 140.00
                and hermes_os.pv_supplier_price_at('heliosolar', m_pan, f1, current_date) = 152.00
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T15 chaque tarif porte sa provenance et sa date de controle','0 sans source',
         count(*) filter (where source is null or last_checked_at is null)::text||' sans source',
         case when count(*) filter (where source is null or last_checked_at is null)=0
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_supplier_prices where tenant_id='heliosolar';

  -- ===================== 5. BESOINS =====================

  -- Un devis ACCEPTE : c'est lui qui autorisera la commande.
  j := public.create_pv_quote(pa);
  q := (j->>'quote_id')::uuid;
  -- Ligne reconnaissable (designation EXACTE d'un article) et ligne en texte libre.
  perform public.upsert_pv_quote_line(null, q, 'PANNEAUX', 'Module 400 Wc monocristallin', 24, 'U', 210, 20, 0);
  perform public.upsert_pv_quote_line(null, q, 'POSE', 'Pose et mise en service — forfait', 1, 'U', 2400, 20, 0);

  -- La visite technique, validee : elle debloque le devis ET produit des besoins.
  j := public.plan_pv_site_survey(pa, current_date);
  vi := (j->>'survey_id')::uuid;
  perform public.set_pv_survey_status(vi, 'IN_PROGRESS');
  perform public.upsert_pv_survey_roof(vi, null, 80, 180, 30, 'PENTE', 'BON', 'FAIBLE', 'MOYEN', 4);
  perform public.upsert_pv_survey_electrical(vi, null, null, null, null, 80);
  perform public.set_pv_survey_status(vi, 'DONE');
  perform public.validate_pv_site_survey(vi);

  perform public.set_pv_quote_ready(q);
  perform public.send_pv_quote(q, current_date);
  perform public.accept_pv_quote(q, current_date, 'BON-POUR-ACCORD');

  j := public.derive_pv_material_requirements(pa);
  insert into r (test,expected,actual,status)
  values ('T16 derivation : 2 besoins du devis, 1 de la visite','2|1',
          coalesce(j->>'from_quote','?')||'|'||coalesce(j->>'from_survey','?'),
          case when (j->>'from_quote')::int = 2 and (j->>'from_survey')::int = 1
               then 'PASS' else 'FAIL' end);

  -- La ligne RECONNUE est rattachee au catalogue et consolidable telle quelle.
  select id into req_pan from hermes_os.pv_material_requirements
   where tenant_id='heliosolar' and site_id=sa and material_id=m_pan;
  insert into r (test,expected,actual,status)
  select 'T17 ligne de devis RECONNUE : rattachee au catalogue, sans confirmation','24|f',
         coalesce(quantity_required::text,'?')||'|'||coalesce(needs_confirmation::text,'?'),
         case when quantity_required = 24 and needs_confirmation = false then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_requirements where id = req_pan;

  -- LA LIGNE DE TEXTE LIBRE N'EST PAS INTERPRETEE. « Pose — forfait » ne devient
  -- pas 24 panneaux : le besoin existe, mais ce qu'il contient reste a dire.
  select id into req_libre from hermes_os.pv_material_requirements
   where tenant_id='heliosolar' and site_id=sa and origin='QUOTE' and material_id is null;
  insert into r (test,expected,actual,status)
  select 'T18 texte libre NON interprete : besoin cree, confirmation exigee','t|non rattache',
         coalesce(needs_confirmation::text,'?')||'|'||
         case when material_id is null then 'non rattache' else 'rattache' end,
         case when needs_confirmation = true and material_id is null then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_requirements where id = req_libre;

  insert into r (test,expected,actual,status)
  select 'T19 l''ORIGINE de chaque besoin est conservee','QUOTE,SURVEY',
         string_agg(distinct origin, ',' order by origin),
         case when string_agg(distinct origin, ',' order by origin) = 'QUOTE,SURVEY'
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_requirements where tenant_id='heliosolar' and site_id=sa;

  insert into r (test,expected,actual,status)
  select 'T20 le besoin issu de la visite porte la longueur RELEVEE (80 m)','80.000',
         coalesce(quantity_required::text,'(aucun)'),
         case when quantity_required = 80 then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_requirements
   where tenant_id='heliosolar' and site_id=sa and origin='SURVEY';

  -- Idempotence : relancer ne redouble rien.
  select count(*) into n from hermes_os.pv_material_requirements where tenant_id='heliosolar' and site_id=sa;
  perform public.derive_pv_material_requirements(pa);
  insert into r (test,expected,actual,status)
  select 'T21 derivation IDEMPOTENTE : relancer ne redouble aucun besoin', n::text, count(*)::text,
         case when count(*) = n then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_requirements where tenant_id='heliosolar' and site_id=sa;

  j := public.add_pv_material_requirement(pa, 1, m_ond, null, 'U', true, 'Ajout manuel');
  insert into r (test,expected,actual,status)
  values ('T22 besoin MANUEL sur article catalogue : sans confirmation requise','ADDED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ADDED'
                and (select needs_confirmation from hermes_os.pv_material_requirements
                      where id = (j->>'requirement_id')::uuid) = false
               then 'PASS' else 'FAIL' end);

  -- ===================== 6. COMMANDES =====================

  j := public.create_pv_purchase_order(pa, f1, current_date + 14);
  o1 := (j->>'order_id')::uuid;
  insert into r (test,expected,actual,status)
  values ('T23 creation d''une commande en BROUILLON','CREATED|DRAFT',
          coalesce(j->>'code','(null)')||'|'||
          coalesce((select status from hermes_os.pv_purchase_orders where id=o1),'?'),
          case when j->>'code'='CREATED'
                and (select status from hermes_os.pv_purchase_orders where id=o1)='DRAFT'
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T24 numerotation CMD-AAAA-NNNNNN, tenant-safe et sans doublon','oui',
          coalesce((select order_number from hermes_os.pv_purchase_orders where id=o1),'?'),
          case when (select order_number from hermes_os.pv_purchase_orders where id=o1)
                    ~ ('^CMD-' || extract(year from now())::text || '-[0-9]{6}$')
               then 'PASS' else 'FAIL' end);

  j := public.create_pv_purchase_order(pa, f2);
  o2 := (j->>'order_id')::uuid;
  select array_agg(order_number order by order_number) into nums
    from hermes_os.pv_purchase_orders where tenant_id='heliosolar';
  insert into r (test,expected,actual,status)
  values ('T25 deux commandes, deux numeros distincts','2 distincts',
          array_length(nums,1)::text||' / '||
          (select count(distinct x) from unnest(nums) x)::text||' distincts',
          case when array_length(nums,1) = (select count(distinct x) from unnest(nums) x)
               then 'PASS' else 'FAIL' end);

  -- Le TOTAL vient de la colonne generee : aucune facade ne l'accepte.
  j := public.upsert_pv_purchase_order_line(null, o1, 'Module 400 Wc monocristallin', 24, 'U', 152.00, 20, m_pan);
  l1 := (j->>'line_id')::uuid;
  insert into r (test,expected,actual,status)
  select 'T26 total de ligne CALCULE (24 x 152,00) et total de commande reporte','3648.00|3648.00',
         coalesce((select line_total_ht_eur::text from hermes_os.pv_purchase_order_lines where id=l1),'?')
         ||'|'||coalesce(subtotal_ht_eur::text,'?'),
         case when (select line_total_ht_eur from hermes_os.pv_purchase_order_lines where id=l1) = 3648.00
               and subtotal_ht_eur = 3648.00 then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_orders where id = o1;

  insert into r (test,expected,actual,status)
  select 'T27 aucune facade de commande n''accepte un total','0',count(*)::text,
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public'
     and p.proname in ('upsert_pv_purchase_order_line','create_pv_purchase_order')
     and pg_get_function_identity_arguments(p.oid) ~* '(total|montant|amount)';

  -- DRAFT -> RECEIVED est INTERDIT : on ne recoit pas ce qu'on n'a pas commande.
  begin
    update hermes_os.pv_purchase_orders set status='RECEIVED' where id=o1;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE';
  end;
  insert into r (test,expected,actual,status)
  values ('T28 DRAFT -> RECEIVED interdit','REFUSE', v,
          case when v='REFUSE' then 'PASS' else 'FAIL' end);

  begin
    update hermes_os.pv_purchase_orders set status='PARTIALLY_RECEIVED' where id=o1;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE';
  end;
  insert into r (test,expected,actual,status)
  values ('T29 DRAFT -> PARTIALLY_RECEIVED interdit','REFUSE', v,
          case when v='REFUSE' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T30 10 transitions de commande declarees EN DONNEES','10',count(*)::text,
         case when count(*)=10 then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_order_transitions;

  insert into r (test,expected,actual,status)
  select 'T31 RECEIVED est TERMINAL : aucune transition sortante','0',count(*)::text,
         case when count(*)=0 then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_order_transitions where from_status='RECEIVED';

  -- La porte de commande : ici tout est reuni, donc elle s'ouvre.
  j := public.set_pv_purchase_order_ready(o1);
  insert into r (test,expected,actual,status)
  values ('T32 READY accepte : devis ACCEPTE + visite VALIDEE + aucun ecart bloquant','READY',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='READY' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T33 approbation HUMAINE horodatee avec son acteur','oui',
         case when approved_by = v_uid and approved_at is not null then 'oui' else 'non' end,
         case when approved_by = v_uid and approved_at is not null then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_orders where id = o1;

  j := public.mark_pv_purchase_order_ordered(o1, current_date);
  insert into r (test,expected,actual,status)
  values ('T34 ORDERED accepte, acteur et horodatage enregistres','ORDERED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ORDERED'
                and (select ordered_by from hermes_os.pv_purchase_orders where id=o1) = v_uid
               then 'PASS' else 'FAIL' end);

  -- Une commande passee ne se modifie plus.
  j := public.upsert_pv_purchase_order_line(l1, o1, 'Autre module', 30, 'U', 100, 20);
  insert into r (test,expected,actual,status)
  values ('T35 modification commerciale apres ORDERED refusee','ORDER_LOCKED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ORDER_LOCKED' then 'PASS' else 'FAIL' end);

  begin
    update hermes_os.pv_purchase_order_lines set unit_price_ht_eur = 1 where id = l1;
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE';
  end;
  insert into r (test,expected,actual,status)
  values ('T36 meme en SQL direct, le prix d''une commande passee est fige','REFUSE', v,
          case when v='REFUSE' then 'PASS' else 'FAIL' end);

  -- ===================== 7. RECEPTION =====================

  j := public.record_pv_purchase_receipt(l1, 18, current_date, 'BL-2026-11', 'CONFORME');
  insert into r (test,expected,actual,status)
  values ('T37 reception PARTIELLE : 18 sur 24, il manque 6','RECEIVED|18|6',
          coalesce(j->>'code','(null)')||'|'||coalesce(j->>'line_received','?')
          ||'|'||coalesce(j->>'line_missing','?'),
          case when j->>'code'='RECEIVED' and (j->>'line_received')::numeric = 18
                and (j->>'line_missing')::numeric = 6 then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T38 la commande passe d''elle-meme en PARTIALLY_RECEIVED','PARTIALLY_RECEIVED',
         status, case when status='PARTIALLY_RECEIVED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_orders where id = o1;

  -- Recevoir PLUS que commande est refuse : erreur de saisie ou sur-livraison,
  -- les deux demandent un geste.
  j := public.record_pv_purchase_receipt(l1, 10);
  insert into r (test,expected,actual,status)
  values ('T39 reception EXCEDENTAIRE refusee (18 + 10 > 24)','OVER_RECEIPT',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='OVER_RECEIPT' then 'PASS' else 'FAIL' end);

  j := public.record_pv_purchase_receipt(l1, 6, current_date, 'BL-2026-12');
  insert into r (test,expected,actual,status)
  values ('T40 reception du solde : la commande passe en RECEIVED','RECEIVED|RECEIVED',
          coalesce(j->>'code','(null)')||'|'||coalesce(j->>'order_status','?'),
          case when j->>'code'='RECEIVED' and j->>'order_status'='RECEIVED'
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  select 'T41 deux receptions datees conservees, pas un compteur ecrase','2',count(*)::text,
         case when count(*)=2 then 'PASS' else 'FAIL' end
    from hermes_os.pv_purchase_receipts where tenant_id='heliosolar' and line_id=l1;

  -- Un agent ne receptionne pas.
  perform set_config('request.jwt.claims', null, true);
  begin
    insert into hermes_os.pv_purchase_receipts (tenant_id, order_id, line_id, quantity_received, received_by)
    values ('heliosolar', o1, l1, 1, v_uid);
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE:'||sqlerrm;
  end;
  insert into r (test,expected,actual,status)
  values ('T42 appelant NON authentifie : reception refusee par la garde humaine','REFUSE',
          left(v, 70),
          case when v like 'REFUSE:%' and v ~* '(HUMAINE|auth)' then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('pv.admin'), 'role','authenticated')::text, true);

  -- ===================== 8. ECART ET READINESS =====================

  insert into r (test,expected,actual,status)
  select 'T43 ecart : les panneaux sont RECUS (24 requis, 24 recus)','RECEIVED',
         coalesce(status,'(aucun)'),
         case when status='RECEIVED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_balance('heliosolar', sa) where material_id = m_pan;

  insert into r (test,expected,actual,status)
  select 'T44 ecart : l''onduleur n''est PAS commande','NOT_ORDERED',
         coalesce(status,'(aucun)'),
         case when status='NOT_ORDERED' then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_balance('heliosolar', sa) where material_id = m_ond;

  insert into r (test,expected,actual,status)
  select 'T45 un BROUILLON de commande ne compte PAS comme commande','0',
         coalesce(sum(qty_ordered) filter (where material_id is null)::text,'0'),
         case when coalesce(sum(qty_ordered) filter (where material_id is null),0) = 0
              then 'PASS' else 'FAIL' end
    from hermes_os.pv_material_balance('heliosolar', sa);

  insert into r (test,expected,actual,status)
  values ('T46 besoin non commande => readiness NOT_READY ou PARTIAL','PARTIAL',
          hermes_os.pv_material_readiness('heliosolar', sa),
          case when hermes_os.pv_material_readiness('heliosolar', sa) = 'PARTIAL'
               then 'PASS' else 'FAIL' end);

  -- Tant qu'un besoin obligatoire attend une confirmation, READY est impossible
  -- MEME si tout se trouve couvert : c'est le garde-fou du texte libre.
  perform public.dismiss_pv_material_requirement(req_libre, 'Forfait de pose : aucun materiel.');
  perform public.dismiss_pv_material_requirement(
    (select id from hermes_os.pv_material_requirements
      where tenant_id='heliosolar' and site_id=sa and origin='SURVEY'),
    'Cable deja en stock atelier.');
  perform public.dismiss_pv_material_requirement(
    (select id from hermes_os.pv_material_requirements
      where tenant_id='heliosolar' and site_id=sa and material_id=m_ond),
    'Onduleur fourni par le client.');
  insert into r (test,expected,actual,status)
  values ('T47 tous les besoins obligatoires restants sont recus => READY','READY',
          hermes_os.pv_material_readiness('heliosolar', sa),
          case when hermes_os.pv_material_readiness('heliosolar', sa) = 'READY'
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T48 la vue Affaire expose la readiness materiel','READY',
          coalesce(public.get_pv_deal(pa)->>'material_readiness','(absent)'),
          case when public.get_pv_deal(pa)->>'material_readiness' = 'READY'
               then 'PASS' else 'FAIL' end);

  -- ===================== 9. COUTS =====================

  j := hermes_os.pv_material_costs('heliosolar', sa);
  insert into r (test,expected,actual,status)
  values ('T49 cout PREVU deterministe (24 x 145,00 de cout catalogue)','3480.00',
          coalesce(j->>'planned_cost_ht_eur','?'),
          case when (j->>'planned_cost_ht_eur')::numeric = 3480.00 then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T50 cout COMMANDE et cout RECU deterministes (24 x 152,00)','3648.00|3648.00',
          coalesce(j->>'ordered_cost_ht_eur','?')||'|'||coalesce(j->>'received_cost_ht_eur','?'),
          case when (j->>'ordered_cost_ht_eur')::numeric = 3648.00
                and (j->>'received_cost_ht_eur')::numeric = 3648.00
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T51 le prix de VENTE du devis n''est jamais ecrase par le prix d''achat','210.00',
          coalesce((select unit_price_ht_eur::text from hermes_os.pv_quote_lines
                     where quote_id=q and designation='Module 400 Wc monocristallin'),'?'),
          case when (select unit_price_ht_eur from hermes_os.pv_quote_lines
                      where quote_id=q and designation='Module 400 Wc monocristallin') = 210.00
               then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T52 marge MATERIELLE indicative fiable ici (aucun cout inconnu)','t',
          coalesce(j->>'margin_reliable','?'),
          case when (j->>'margin_reliable')::boolean = true then 'PASS' else 'FAIL' end);

  -- Un article sans cout connu rend la marge NON fiable : on ne l'affiche plus.
  perform public.add_pv_material_requirement(pa, 2, m_off, null, 'U', true, 'Sans cout connu');
  insert into r (test,expected,actual,status)
  values ('T53 un article SANS COUT rend la marge non fiable','f',
          coalesce(hermes_os.pv_material_costs('heliosolar', sa)->>'margin_reliable','?'),
          case when (hermes_os.pv_material_costs('heliosolar', sa)->>'margin_reliable')::boolean = false
               then 'PASS' else 'FAIL' end);

  -- ===================== 10. PORTE DE COMMANDE (cas de refus) =====================

  -- Commande du tenant B : aucun devis accepte, aucune visite.
  insert into hermes_os.pv_purchase_orders (tenant_id, supplier_id, prospect_id, site_id, order_number)
  values ('__pv7_b__', fb, pb, sb0, 'CMD-TEST-000001') returning id into ob;
  insert into hermes_os.pv_purchase_order_lines (tenant_id, order_id, designation, quantity, unit_price_ht_eur)
  values ('__pv7_b__', ob, 'Module', 10, 100);

  codes := hermes_os.pv_purchase_blockers(ob);
  insert into r (test,expected,actual,status)
  values ('T54 sans devis ACCEPTE ni visite VALIDEE : deux blocages','present',
          case when 'QUOTE_NOT_ACCEPTED' = any(codes)
                and 'SITE_SURVEY_NOT_VALIDATED' = any(codes) then 'present' else 'absent' end,
          case when 'QUOTE_NOT_ACCEPTED' = any(codes)
                and 'SITE_SURVEY_NOT_VALIDATED' = any(codes) then 'PASS' else 'FAIL' end);

  -- Une commande VIDE ne peut pas etre engagee.
  codes := hermes_os.pv_purchase_blockers(o2);
  insert into r (test,expected,actual,status)
  values ('T55 commande sans ligne : NO_LINE et TOTAL_NOT_POSITIVE','present',
          case when 'NO_LINE' = any(codes) and 'TOTAL_NOT_POSITIVE' = any(codes)
               then 'present' else 'absent' end,
          case when 'NO_LINE' = any(codes) and 'TOTAL_NOT_POSITIVE' = any(codes)
               then 'PASS' else 'FAIL' end);

  j := public.set_pv_purchase_order_ready(o2);
  insert into r (test,expected,actual,status)
  values ('T56 READY refuse AVEC ses raisons','ORDER_NOT_READY',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ORDER_NOT_READY'
                and jsonb_array_length(coalesce(j->'missing_requirements','[]'::jsonb)) >= 2
               then 'PASS' else 'FAIL' end);

  j := public.mark_pv_purchase_order_ordered(o2);
  insert into r (test,expected,actual,status)
  values ('T57 ORDERED refuse sur une commande non engageable','ORDER_NOT_READY',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ORDER_NOT_READY' then 'PASS' else 'FAIL' end);

  j := public.record_pv_purchase_receipt(
    (select id from hermes_os.pv_purchase_order_lines where order_id=o1 limit 1), 1);
  insert into r (test,expected,actual,status)
  values ('T58 on ne receptionne pas une commande deja RECEIVED','ORDER_NOT_ORDERED',
          coalesce(j->>'code','(null)'),
          case when j->>'code'='ORDER_NOT_ORDERED' then 'PASS' else 'FAIL' end);

  -- ===================== 11. ISOLATION =====================

  insert into r (test,expected,actual,status)
  values ('T59 isolation : la commande du tenant B est illisible depuis heliosolar','NOT_FOUND',
          coalesce(public.get_pv_purchase_order(ob)->>'code','(null)'),
          case when public.get_pv_purchase_order(ob)->>'code'='NOT_FOUND' then 'PASS' else 'FAIL' end);

  insert into r (test,expected,actual,status)
  values ('T60 isolation : la commande du tenant B n''est pas modifiable','NOT_FOUND',
          coalesce(public.cancel_pv_purchase_order(ob, 'tentative')->>'code','(null)'),
          case when public.cancel_pv_purchase_order(ob, 'tentative')->>'code'='NOT_FOUND'
               then 'PASS' else 'FAIL' end);

  -- FK COMPOSITE : impossible de commander un article d'un autre tenant.
  begin
    insert into hermes_os.pv_purchase_order_lines (tenant_id, order_id, material_id, designation, quantity)
    values ('heliosolar', o2, m_b, 'Article du tenant B', 1);
    v := 'ACCEPTE';
  exception when others then v := 'REFUSE';
  end;
  insert into r (test,expected,actual,status)
  values ('T61 FK composite : commander un article d''un AUTRE tenant est refuse','REFUSE', v,
          case when v='REFUSE' then 'PASS' else 'FAIL' end);
end;
$$;

-- ===================== ASSERTIONS HORS BLOC =====================

insert into r (test,expected,actual,status)
select 'T62 tables PV-7 en deny-all : RLS active, ZERO politique','9 RLS / 0 politique',
       count(*) filter (where c.relrowsecurity)::text||' RLS / '||
       (select count(*) from pg_policies where schemaname='hermes_os'
         and (tablename like 'pv_%material%' or tablename like 'pv_supplier%'
              or tablename like 'pv_purchase%'))::text||' politique',
       case when count(*) filter (where c.relrowsecurity)=9
             and (select count(*) from pg_policies where schemaname='hermes_os'
                   and (tablename like 'pv_%material%' or tablename like 'pv_supplier%'
                        or tablename like 'pv_purchase%'))=0
            then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
 where ns.nspname='hermes_os'
   and c.relname in ('pv_material_catalog','pv_suppliers','pv_supplier_prices',
                     'pv_material_requirements','pv_purchase_orders','pv_purchase_order_lines',
                     'pv_purchase_receipts','pv_purchase_order_transitions',
                     'pv_purchase_order_sequences');

insert into r (test,expected,actual,status)
select 'T63 aucun GRANT anon/authenticated sur les tables PV-7','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants
 where table_schema='hermes_os'
   and (table_name like 'pv_%material%' or table_name like 'pv_supplier%'
        or table_name like 'pv_purchase%')
   and grantee in ('anon','authenticated');

insert into r (test,expected,actual,status)
select 'T64 les 20 facades PV-7 accordees a authenticated UNIQUEMENT','20 authenticated / 0 anon',
       count(*) filter (where grantee='authenticated')::text||' authenticated / '||
       count(*) filter (where grantee='anon')::text||' anon',
       case when count(*) filter (where grantee='authenticated')=20
             and count(*) filter (where grantee='anon')=0
            then 'PASS' else 'FAIL' end
  from information_schema.role_routine_grants
 where routine_schema='public'
   and routine_name in ('upsert_pv_material','set_pv_material_active','get_pv_materials',
       'upsert_pv_supplier','get_pv_suppliers','upsert_pv_supplier_price','get_pv_supplier_prices',
       'add_pv_material_requirement','derive_pv_material_requirements',
       'confirm_pv_material_requirement','dismiss_pv_material_requirement','get_pv_material_plan',
       'create_pv_purchase_order','upsert_pv_purchase_order_line','delete_pv_purchase_order_line',
       'set_pv_purchase_order_ready','mark_pv_purchase_order_ordered','cancel_pv_purchase_order',
       'record_pv_purchase_receipt','get_pv_purchase_order');

insert into r (test,expected,actual,status)
select 'T65 aucune facade PV-7 n''expose un parametre de tenant','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public'
   and p.proname in ('upsert_pv_material','set_pv_material_active','get_pv_materials',
       'upsert_pv_supplier','get_pv_suppliers','upsert_pv_supplier_price','get_pv_supplier_prices',
       'add_pv_material_requirement','derive_pv_material_requirements',
       'confirm_pv_material_requirement','dismiss_pv_material_requirement','get_pv_material_plan',
       'create_pv_purchase_order','upsert_pv_purchase_order_line','delete_pv_purchase_order_line',
       'set_pv_purchase_order_ready','mark_pv_purchase_order_ordered','cancel_pv_purchase_order',
       'record_pv_purchase_receipt','get_pv_purchase_order')
   and pg_get_function_identity_arguments(p.oid) ~* '(p_tenant|tenant_id)';

insert into r (test,expected,actual,status)
select 'T66 les 20 facades PV-7 en SECURITY DEFINER, search_path verrouille','20',count(*)::text,
       case when count(*)=20 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.prosecdef
   and array_to_string(p.proconfig,',') like '%search_path=hermes_os%'
   and p.proname in ('upsert_pv_material','set_pv_material_active','get_pv_materials',
       'upsert_pv_supplier','get_pv_suppliers','upsert_pv_supplier_price','get_pv_supplier_prices',
       'add_pv_material_requirement','derive_pv_material_requirements',
       'confirm_pv_material_requirement','dismiss_pv_material_requirement','get_pv_material_plan',
       'create_pv_purchase_order','upsert_pv_purchase_order_line','delete_pv_purchase_order_line',
       'set_pv_purchase_order_ready','mark_pv_purchase_order_ordered','cancel_pv_purchase_order',
       'record_pv_purchase_receipt','get_pv_purchase_order');

insert into r (test,expected,actual,status)
select 'T67 aucun nouveau bucket : toujours un seul hermes-pv%','1',count(*)::text,
       case when count(*)=1 then 'PASS' else 'FAIL' end
  from storage.buckets where id like 'hermes-pv%';

insert into r (test,expected,actual,status)
select 'T68 le bucket PV reste PRIVE','false', coalesce(public::text,'?'),
       case when public = false then 'PASS' else 'FAIL' end
  from storage.buckets where id = 'hermes-pv-documents';

insert into r (test,expected,actual,status)
select 'T69 audit PV-7 dans entity_audit_log, aucun journal parallele','>=6',count(*)::text,
       case when count(*) >= 6 then 'PASS' else 'FAIL' end
  from hermes_os.entity_audit_log
 where tenant_id='heliosolar'
   and entity_type in ('pv_material_catalog','pv_suppliers','pv_supplier_prices',
                       'pv_material_requirements','pv_purchase_orders');

insert into r (test,expected,actual,status)
select 'T70 Phase 1 / Phase 2 / PV-1 a PV-6 : transitions intactes','46|31|15|15',
       (select count(*) from hermes_os.pv_prospect_transitions)::text||'|'||
       (select count(*) from hermes_os.pv_status_transitions)::text||'|'||
       (select count(*) from hermes_os.pv_quote_transitions)::text||'|'||
       (select count(*) from hermes_os.pv_survey_transitions)::text,
       case when (select count(*) from hermes_os.pv_prospect_transitions)=46
             and (select count(*) from hermes_os.pv_status_transitions)=31
             and (select count(*) from hermes_os.pv_quote_transitions)=15
             and (select count(*) from hermes_os.pv_survey_transitions)=15
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T71 les 9 seuils de visite PV-6 sont intacts','9',count(*)::text,
       case when count(*)=9 then 'PASS' else 'FAIL' end
  from hermes_os.pv_survey_thresholds where tenant_id is null;

insert into r (test,expected,actual,status)
select 'T72 aucune capacite pv.* activee (PV_ACTIONS_ENABLED = NO)','3 total / 0 active',
       count(*)::text||' total / '||count(*) filter (where enabled)::text||' active',
       case when count(*)=3 and count(*) filter (where enabled)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog where action_key like 'pv.%';

insert into r (test,expected,actual,status)
select 'T73 aucune capacite materiel/commande creee dans ce lot','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_catalog
 where action_key like 'pv.material%' or action_key like 'pv.purchase%'
    or action_key like 'pv.supplier%' or action_key like 'pv.order%';

insert into r (test,expected,actual,status)
select 'T74 aucun consumer PV actif (Agent 4 / Agent 5 inactifs)','0',count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL' end
  from hermes_os.resolver_runtime_config where action_key like 'pv.%' and enabled = true;

insert into r (test,expected,actual,status)
select 'T75 aucun PERMIT PV sensible : 3 REQUIRE_APPROVAL, 0 PERMIT','3|0',
       (select count(*) from hermes_os.sw15_policies
         where action_pattern like 'pv.%' and status='ACTIVE' and effect='REQUIRE_APPROVAL')::text
       ||'|'||
       (select count(*) from hermes_os.sw15_policies
         where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')::text,
       case when (select count(*) from hermes_os.sw15_policies
                   where action_pattern like 'pv.%' and status='ACTIVE' and effect='REQUIRE_APPROVAL')=3
             and (select count(*) from hermes_os.sw15_policies
                   where action_pattern like 'pv.%' and status='ACTIVE' and effect='PERMIT')=0
            then 'PASS' else 'FAIL' end;

insert into r (test,expected,actual,status)
select 'T76 requetes QUEUED intactes (>=13), aucune PV','oui',
       count(*)::text||' dont '||count(*) filter (where action_key like 'pv.%')::text||' PV',
       case when count(*)>=13 and count(*) filter (where action_key like 'pv.%')=0
            then 'PASS' else 'FAIL' end
  from hermes_os.agent_action_requests where status='QUEUED';

select id, status, test, expected, actual from r order by id;

rollback;
