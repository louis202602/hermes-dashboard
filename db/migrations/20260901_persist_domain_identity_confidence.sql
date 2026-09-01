-- 20260901_persist_domain_identity_confidence.sql
-- Migration déjà appliquée en production à 03:23 UTC et détectée par le garde
-- de dérive. Ce fichier enregistre la définition live exacte de la fonction
-- concernée : aucune colonne domain_identity_confidence n'existe en base et
-- hb_finder_apply est la seule fonction contenant cette logique.

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
  v_identity_confidence text := coalesce(p->>'domain_identity_confidence','NONE');
begin
  if pid is null then return jsonb_build_object('status','MISSING_PROSPECT'); end if;
  select niche_key into v_niche from hermes_os.hb_prospects where prospect_id=pid;
  v_has_email:=coalesce((p->>'found')::boolean,false) and em<>'';
  v_has_phone:=coalesce((p->>'found')::boolean,false) and ph is not null;
  update hermes_os.hb_prospects
     set context=context||jsonb_build_object('finder_attempts',coalesce((context->>'finder_attempts')::int,0)+1,'finder_last_at',now()),updated_at=now()
   where prospect_id=pid
   returning (context->>'finder_attempts')::int into v_attempts;

  if not v_has_email and not v_has_phone then
    if v_attempts>=3 then
      insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
      values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,(p-'html')||jsonb_build_object('attempts',v_attempts),'EXHAUSTED');
      return jsonb_build_object('status','EXHAUSTED');
    end if;
    insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
    values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,(p-'html')||jsonb_build_object('attempts',v_attempts),'NOT_FOUND');
    return jsonb_build_object('status','NOT_FOUND');
  end if;

  if v_has_email and exists(select 1 from hermes_os.hb_suppression_list s where lower(s.email)=em) then
    em:='';v_has_email:=false;
    if not v_has_phone then
      insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
      values('HB07_finder','CONTACT_SEARCH','hb_prospects',pid::text,jsonb_build_object('email',p->>'email'),'SUPPRESSED_SKIPPED');
      return jsonb_build_object('status','SUPPRESSED_SKIPPED');
    end if;
  end if;

  r:=hermes_os.hb_upsert_contact_and_context(
    pid,
    nullif(p->>'full_name',''),
    nullif(p->>'role_title',''),
    nullif(em,''),
    coalesce(nullif(p->>'source',''),'page_contact'),
    p->>'source_url',
    coalesce((p->>'mx_ok')::boolean,false),
    jsonb_build_object(
      'finder_method',p->>'method',
      'finder_at',coalesce(p->>'discovered_at',now()::text),
      'identity_confidence',v_identity_confidence,
      'identity_evidence',case when v_identity_confidence in ('HIGH','PROBABLE')
        then jsonb_build_object('level',v_identity_confidence,'source','hb07ia_domain_resolution')
        else null end
    ),
    ph,p->>'phone_source_url',p->>'phone_source_type',p->>'phone_scope'
  );

  if v_niche='pv_toitures' then
    fit_result:=hermes_os.hb_assign_pv_fit_from_naf(pid);
    q:=hermes_os.hb_qualify_pv_prospect(pid);
    if q->>'verdict'='QUALIFIED' and v_has_email then
      o:=hermes_os.hb_prepare_outreach(
        pid,
        hermes_os.hb_pick_template(v_niche),
        jsonb_build_object(
          'first_name',coalesce(nullif(split_part(coalesce(p->>'full_name',''),' ',1),''),'Bonjour'),
          'company',(select company_name from hermes_os.hb_prospects where prospect_id=pid),
          'sector',v_niche
        ),
        true,null,null
      );
    end if;
  else
    q:=jsonb_build_object('verdict','N/A');
    if v_has_email then
      q:=hermes_os.hb_qualify_prospect(pid);
      if q->>'verdict'='QUALIFIED' then
        o:=hermes_os.hb_prepare_outreach(
          pid,
          hermes_os.hb_pick_template(v_niche),
          jsonb_build_object(
            'first_name',coalesce(nullif(split_part(coalesce(p->>'full_name',''),' ',1),''),'Bonjour'),
            'company',(select company_name from hermes_os.hb_prospects where prospect_id=pid),
            'sector',v_niche
          ),
          true,null,null
        );
      end if;
    end if;
  end if;

  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
  values(
    'HB07_finder','CONTACT_FOUND','hb_prospects',pid::text,
    jsonb_build_object(
      'email',nullif(em,''),'phone',ph,'source',p->>'source','source_url',p->>'source_url',
      'phone_source_url',p->>'phone_source_url','mx_ok',p->>'mx_ok','method',p->>'method',
      'email_confidence',r->>'email_confidence','qualify',q->>'verdict','outreach',o->>'status',
      'pv_fit_result',fit_result,'niche_key',v_niche,'domain_identity_confidence',v_identity_confidence
    ),
    'FOUND'
  );

  return jsonb_build_object(
    'status','APPLIED','email_confidence',r->>'email_confidence','phone_persisted',r->>'phone_persisted',
    'qualify',q->>'verdict','outreach_test',o->>'status','pv_fit',fit_result->>'pv_fit',
    'identity_confidence',v_identity_confidence
  );
end
$function$;
