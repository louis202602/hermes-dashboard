-- 20260901_pv_daily_engine_function_snapshot.sql
-- Snapshot SQL exact des trois fonctions critiques du moteur quotidien PV.
-- Il complete la migration v2 afin que l'etat courant soit reconstructible.

create or replace function hermes_os.hb_finder_apply(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','public','pg_catalog','pg_temp'
as $function$
declare
  pid uuid:=(p->>'prospect_id')::uuid;r jsonb;q jsonb;o jsonb;fit_result jsonb;
  em text:=lower(coalesce(p->>'email',''));ph text:=nullif(trim(coalesce(p->>'phone','')),'');
  v_attempts int;v_niche text;v_has_email boolean;v_has_phone boolean;
begin
  if pid is null then return jsonb_build_object('status','MISSING_PROSPECT'); end if;
  select niche_key into v_niche from hermes_os.hb_prospects where prospect_id=pid;
  v_has_email:=coalesce((p->>'found')::boolean,false) and em<>'';
  v_has_phone:=coalesce((p->>'found')::boolean,false) and ph is not null;
  update hermes_os.hb_prospects set context=context||jsonb_build_object('finder_attempts',coalesce((context->>'finder_attempts')::int,0)+1,'finder_last_at',now()),updated_at=now()
   where prospect_id=pid returning (context->>'finder_attempts')::int into v_attempts;
  if not v_has_email and not v_has_phone then
    if v_attempts>=3 then
      insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,(p-'html')||jsonb_build_object('attempts',v_attempts),'EXHAUSTED');
      return jsonb_build_object('status','EXHAUSTED');
    end if;
    insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,(p-'html')||jsonb_build_object('attempts',v_attempts),'NOT_FOUND');
    return jsonb_build_object('status','NOT_FOUND');
  end if;
  if v_has_email and exists(select 1 from hermes_os.hb_suppression_list s where lower(s.email)=em) then
    em:='';v_has_email:=false;
    if not v_has_phone then
      insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,jsonb_build_object('email',p->>'email'),'SUPPRESSED_SKIPPED');
      return jsonb_build_object('status','SUPPRESSED_SKIPPED');
    end if;
  end if;
  r:=hermes_os.hb_upsert_contact_and_context(pid,nullif(p->>'full_name',''),nullif(p->>'role_title',''),nullif(em,''),coalesce(nullif(p->>'source',''),'page_contact'),p->>'source_url',coalesce((p->>'mx_ok')::boolean,false),jsonb_build_object('finder_method',p->>'method','finder_at',coalesce(p->>'discovered_at',now()::text)),ph,p->>'phone_source_url',p->>'phone_source_type',p->>'phone_scope');
  if v_niche='pv_toitures' then
    fit_result:=hermes_os.hb_assign_pv_fit_from_naf(pid);
    q:=hermes_os.hb_qualify_pv_prospect(pid);
    if q->>'verdict'='QUALIFIED' and v_has_email then
      o:=hermes_os.hb_prepare_outreach(pid,hermes_os.hb_pick_template(v_niche),jsonb_build_object('first_name',coalesce(nullif(split_part(coalesce(p->>'full_name',''),' ',1),''),'Bonjour'),'company',(select company_name from hermes_os.hb_prospects where prospect_id=pid),'sector',v_niche),true,null,null);
    end if;
  else
    q:=jsonb_build_object('verdict','N/A');
    if v_has_email then
      q:=hermes_os.hb_qualify_prospect(pid);
      if q->>'verdict'='QUALIFIED' then
        o:=hermes_os.hb_prepare_outreach(pid,hermes_os.hb_pick_template(v_niche),jsonb_build_object('first_name',coalesce(nullif(split_part(coalesce(p->>'full_name',''),' ',1),''),'Bonjour'),'company',(select company_name from hermes_os.hb_prospects where prospect_id=pid),'sector',v_niche),true,null,null);
      end if;
    end if;
  end if;
  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
  values('HB07_finder','CONTACT_FOUND','hb_prospects',pid::text,jsonb_build_object('email',nullif(em,''),'phone',ph,'source',p->>'source','source_url',p->>'source_url','phone_source_url',p->>'phone_source_url','mx_ok',p->>'mx_ok','method',p->>'method','email_confidence',r->>'email_confidence','qualify',q->>'verdict','outreach',o->>'status','pv_fit_result',fit_result,'niche_key',v_niche),'FOUND');
  return jsonb_build_object('status','APPLIED','email_confidence',r->>'email_confidence','phone_persisted',r->>'phone_persisted','qualify',q->>'verdict','outreach_test',o->>'status','pv_fit',fit_result->>'pv_fit');
end
$function$;

create or replace function hermes_os.hb_qualify_pv_prospect(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  p hermes_os.hb_prospects;sp hermes_os.hb_pv_site_profiles;rec record;reasons text[]:='{}';
  v_channel text;v_contact uuid;v_del jsonb;v_promote jsonb;v_ready text;v_first boolean:=false;
begin
  select * into p from hermes_os.hb_prospects hp where hp.prospect_id=p_prospect_id;
  if not found or p.niche_key<>'pv_toitures' then return jsonb_build_object('verdict','UNKNOWN_OR_NON_PV'); end if;
  if p.qualification_verdict='QUALIFIED' and p.ready_status in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL','READY_VERIFIED_PHONE','READY_FORM') then
    return jsonb_build_object('verdict','QUALIFIED','status','ALREADY_QUALIFIED','ready_status',p.ready_status);
  end if;
  if coalesce(p.pipeline_stage,'')='REJECTED' or p.status in ('OPPOSED','ARCHIVED') then reasons:=array_append(reasons,'PROSPECT_REJECTED_OR_OPPOSED'); end if;
  if coalesce(p.active_status_verified,false)<>true then reasons:=array_append(reasons,'ACTIVE_STATUS_NOT_VERIFIED'); end if;
  select * into sp from hermes_os.hb_pv_site_profiles hsp where hsp.prospect_id=p_prospect_id;
  if not found then reasons:=array_append(reasons,'PV_SITE_PROFILE_MISSING');
  else
    if coalesce(sp.pv_fit,'UNKNOWN') not in ('HIGH','MEDIUM') then reasons:=array_append(reasons,'PV_FIT_NOT_PROVED'); end if;
    if sp.existing_pv_status in ('PV_DETECTED','PARTIAL_PV_DETECTED') and coalesce(sp.existing_pv_classification,'')='PV_EXISTING_NO_OBVIOUS_OPPORTUNITY' then reasons:=array_append(reasons,'PV_ALREADY_EQUIPPED_NO_OPPORTUNITY'); end if;
  end if;
  for rec in select hc.* from hermes_os.hb_contacts hc where hc.counterparty_id=p.counterparty_id and coalesce(hc.contact_blocked,false)=false and hc.email is not null order by case hc.email_confidence when 'CONFIRMED' then 1 when 'HIGH' then 2 when 'COMPANY_GENERIC' then 3 when 'verified' then 4 when 'probable' then 5 else 9 end,hc.priority nulls last,hc.updated_at desc loop
    v_del:=hermes_os.hb_b2b_deliverability_check(rec.contact_id);
    if coalesce((v_del->>'ok')::boolean,false) then
      v_contact:=rec.contact_id;v_channel:='EMAIL';
      v_ready:=case rec.email_confidence when 'CONFIRMED' then 'READY_CONFIRMED_EMAIL' when 'HIGH' then 'READY_HIGH_CONFIDENCE_EMAIL' when 'COMPANY_GENERIC' then 'READY_COMPANY_EMAIL' when 'verified' then 'READY_CONFIRMED_EMAIL' else 'READY_PROBABLE_OFFICIAL_EMAIL' end;
      exit;
    end if;
  end loop;
  if v_contact is null then
    select hc.contact_id into v_contact from hermes_os.hb_contacts hc where hc.counterparty_id=p.counterparty_id and hc.phone is not null and coalesce(hc.contact_blocked,false)=false and (hc.phone_verified_at is not null or hc.phone_source_type in ('site_officiel','page_contact_officielle','annuaire_officiel','annuaire_professionnel_fiable')) order by hc.phone_verified_at desc nulls last,hc.updated_at desc limit 1;
    if v_contact is not null then v_channel:='PHONE';v_ready:='READY_VERIFIED_PHONE';end if;
  end if;
  if v_contact is null then reasons:=array_append(reasons,'NO_EXPLOITABLE_CONTACT_CHANNEL');end if;
  if cardinality(reasons)>0 then
    update hermes_os.hb_prospects hp set qualification_verdict='REVIEW_REQUIRED',qualification_reasons=to_jsonb(reasons),qualification_retryable=true,qualification_reviewed_at=now(),qualification_next_review_at=now()+interval '24 hours',updated_at=now() where hp.prospect_id=p_prospect_id;
    insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('hb_qualify_pv_prospect','QUALIFY_PV','hb_prospects',p_prospect_id::text,jsonb_build_object('reasons',to_jsonb(reasons)),'REVIEW_REQUIRED');
    return jsonb_build_object('verdict','REVIEW_REQUIRED','reasons',to_jsonb(reasons),'retryable',true);
  end if;
  v_first:=p.qualification_verdict is distinct from 'QUALIFIED';
  update hermes_os.hb_pv_site_profiles hsp set qualified_at=case when v_first then coalesce(hsp.qualified_at,now()) else hsp.qualified_at end,daily_batch_date=case when v_first and hsp.daily_batch_date is null then (now() at time zone 'Europe/Paris')::date else hsp.daily_batch_date end,updated_at=now() where hsp.prospect_id=p_prospect_id;
  update hermes_os.hb_prospects hp set qualification_verdict='QUALIFIED',qualification_reasons='[]'::jsonb,qualification_retryable=false,qualification_reviewed_at=now(),qualification_next_review_at=null,status='READY_FOR_OUTREACH',pipeline_stage='READY',ready_status=v_ready,updated_at=now() where hp.prospect_id=p_prospect_id;
  if v_channel='EMAIL' then v_promote:=hermes_os.hb_promote_pv_prospect(p_prospect_id);end if;
  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('hb_qualify_pv_prospect',case when v_first then 'QUALIFY_PV_FIRST' else 'QUALIFY_PV' end,'hb_prospects',p_prospect_id::text,jsonb_build_object('channel',v_channel,'ready_status',v_ready,'contact_id',v_contact,'promotion',v_promote,'existing_pv_status',sp.existing_pv_status,'first_qualification',v_first),'QUALIFIED');
  return jsonb_build_object('verdict','QUALIFIED','channel',v_channel,'ready_status',v_ready,'contact_id',v_contact,'promotion',v_promote,'first_qualification',v_first);
end
$function$;

create or replace function hermes_os.hb_refresh_pv_readiness(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare r record;v_checked int:=0;v_qualified int:=0;v_res jsonb;v_contactable int;
begin
  v_contactable:=hermes_os.hb_mark_qualified_callable();
  for r in select p.prospect_id from hermes_os.hb_prospects p where p.niche_key='pv_toitures' and coalesce(p.pipeline_stage,'')<>'REJECTED' and (p.qualification_verdict is distinct from 'QUALIFIED' or p.ready_status is null or p.ready_status not in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL','READY_VERIFIED_PHONE','READY_FORM')) order by case p.enrichment_status when 'ENRICHMENT_PROVED' then 1 when 'ENRICHMENT_PARTIAL' then 2 else 3 end,p.score desc nulls last,p.updated_at desc limit least(greatest(coalesce(p_limit,200),1),500) loop
    v_res:=hermes_os.hb_qualify_pv_prospect(r.prospect_id);v_checked:=v_checked+1;
    if v_res->>'verdict'='QUALIFIED' and coalesce((v_res->>'first_qualification')::boolean,false) then v_qualified:=v_qualified+1;end if;
  end loop;
  return jsonb_build_object('ok',true,'checked',v_checked,'newly_qualified',v_qualified,'contactable_candidates',v_contactable,'target_per_day',20);
end
$function$;
