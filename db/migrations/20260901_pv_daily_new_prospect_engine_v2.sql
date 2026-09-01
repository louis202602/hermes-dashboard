-- 20260901_pv_daily_new_prospect_engine_v2.sql
-- Objectif : 20 NOUVEAUX prospects PV exploitables / jour, sans recycler les
-- anciens et sans relacher les criteres. On augmente le volume amont et on
-- corrige l'ordre verification officielle -> fit PV -> contact -> qualification.

create or replace function hermes_os.hb_mark_qualified_callable()
returns integer language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare n int;
begin
  select count(*) into n
  from hermes_os.hb_pv_site_profiles sp
  join hermes_os.hb_prospects p on p.prospect_id=sp.prospect_id
  where p.niche_key='pv_toitures' and coalesce(p.pipeline_stage,'')<>'REJECTED'
    and coalesce(p.active_status_verified,false)=true and sp.pv_fit in ('HIGH','MEDIUM')
    and (
      exists(select 1 from hermes_os.hb_contacts c where c.counterparty_id=p.counterparty_id and c.email is not null and coalesce((hermes_os.hb_b2b_deliverability_check(c.contact_id)->>'ok')::boolean,false))
      or exists(select 1 from hermes_os.hb_contacts c where c.counterparty_id=p.counterparty_id and c.phone is not null and coalesce(c.contact_blocked,false)=false and (c.phone_verified_at is not null or c.phone_source_type in ('site_officiel','page_contact_officielle','annuaire_officiel','annuaire_professionnel_fiable')))
    );
  return n;
end $function$;

create or replace function hermes_os.hb_hb04_upsert_prospect(p_niche text,p_company text,p_ctx jsonb)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','public','pg_catalog','pg_temp'
as $function$
declare
  pid uuid; v_siren text:=nullif(trim(coalesce(p_ctx->>'siren','')),'');
  v_ville text:=nullif(trim(coalesce(p_ctx->>'ville','')),'');
  v_dept text:=nullif(trim(coalesce(p_ctx->>'departement','')),'');
  v_prio text:=hermes_os.hb_geo_priority(v_ville,v_dept);
  v_official_active boolean:=coalesce(p_ctx->>'source','')='recherche-entreprises.api.gouv.fr' and coalesce(p_ctx->>'etat_administratif','')='A';
  v_fit jsonb;
begin
  if nullif(trim(p_company),'') is null then return jsonb_build_object('status','SKIPPED'); end if;
  insert into hermes_os.hb_prospects(niche_key,company_name,status,context,active_status_verified,active_status_checked_at)
  select p_niche,p_company,'NEW',coalesce(p_ctx,'{}'::jsonb)||jsonb_build_object('geo_priority',v_prio),case when v_official_active then true else null end,case when v_official_active then now() else null end
  where not exists(select 1 from hermes_os.hb_prospects x where x.niche_key=p_niche and lower(x.company_name)=lower(p_company))
    and (v_siren is null or not exists(select 1 from hermes_os.hb_prospects x where x.niche_key=p_niche and x.context->>'siren'=v_siren))
  returning prospect_id into pid;
  if pid is null then return jsonb_build_object('status','DUPLICATE','prospect_id',null,'geo_priority',v_prio); end if;
  if p_niche='pv_toitures' then v_fit:=hermes_os.hb_assign_pv_fit_from_naf(pid); end if;
  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
  values('hb_hb04_upsert_prospect','PROSPECT_SOURCED','hb_prospects',pid::text,jsonb_build_object('niche',p_niche,'official_active',v_official_active,'geo_priority',v_prio,'pv_fit',v_fit),'INSERTED');
  return jsonb_build_object('status','INSERTED','prospect_id',pid,'geo_priority',v_prio,'official_active',v_official_active,'pv_fit',v_fit);
end $function$;

create or replace function hermes_os.hb_hb04_active_niches()
returns table(niche_key text,search_naf text,search_q text,requires_physical_travel boolean)
language sql security definer set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
  with commercial_active as (
    select n.niche_key,p.data_sources->>'search_naf' search_naf,coalesce(p.data_sources->>'search_terms',n.name) search_q,n.requires_physical_travel,n.score,0 segment_priority
    from hermes_os.hb_niches n left join hermes_os.hb_niche_playbooks p using(niche_key) where n.status='ACTIVE'
  ), pv_need as (
    select greatest(20-coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'qualified_today')::int,0),0) shortfall
  ), pv_segments as (
    select 'pv_toitures'::text niche_key,s.search_naf,s.search_q,n.requires_physical_travel,n.score,s.segment_priority
    from hermes_os.hb_niches n cross join pv_need
    cross join lateral (values
      ('52.10A,52.10B'::text,'entrepot stockage logistique frigorifique'::text,1),
      ('49.41A,49.41B','transport routier depot logistique',2),
      ('25.11Z,25.62B','atelier industriel metallurgie mecanique',3),
      ('45.11Z,45.20A','concession automobile garage atelier',4),
      ('10.71A,22.22Z','usine agroalimentaire fabrication emballage',5)
    ) s(search_naf,search_q,segment_priority)
    where n.niche_key='pv_toitures' and pv_need.shortfall>0
      and coalesce((select (value#>>'{}')::boolean from hermes_os.hb_config where key='heliosolar_pv_sourcing_enabled'),false)
  )
  select x.niche_key,x.search_naf,x.search_q,x.requires_physical_travel
  from (select * from commercial_active union all select * from pv_segments) x
  order by case when x.niche_key='pv_toitures' then 0 else 1 end,x.segment_priority,x.score desc nulls last,x.niche_key;
$function$;

create or replace function hermes_os.hb_enrichment_next_niche(p_niche text,p_limit integer default 5)
returns setof hermes_os.hb_prospects language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_effective_niche text:=p_niche; v_limit int:=greatest(1,least(coalesce(p_limit,5),20)); v_shortfall int:=0;
begin
  if p_niche<>'pv_toitures' and coalesce((select (value#>>'{}')::boolean from hermes_os.hb_config where key='heliosolar_pv_sourcing_enabled'),false) then
    v_shortfall:=greatest(20-coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'qualified_today')::int,0),0);
    if v_shortfall>0 and exists(select 1 from hermes_os.hb_prospects p where p.niche_key='pv_toitures' and coalesce(p.pipeline_stage,'')<>'REJECTED' and coalesce(p.qualification_verdict,'')<>'QUALIFIED' and (p.enrichment_status='ENRICHMENT_PENDING' or (p.enrichment_status in ('ENRICHMENT_RETRY','ENRICHMENT_NO_RESULT') and coalesce(p.enrichment_next_retry_at,now())<=now()))) then
      v_effective_niche:='pv_toitures'; v_limit:=greatest(v_limit,5);
    end if;
  elsif p_niche='pv_toitures' then v_limit:=greatest(v_limit,5); end if;
  return query update hermes_os.hb_prospects p
    set enrichment_status='ENRICHMENT_PROCESSING',enrichment_attempts=coalesce(enrichment_attempts,0)+1,enrichment_last_attempt_at=now(),updated_at=now()
    where p.prospect_id in (
      select q.prospect_id from hermes_os.hb_prospects q
      where q.niche_key=v_effective_niche and coalesce(q.pipeline_stage,'')<>'REJECTED' and coalesce(q.qualification_verdict,'')<>'QUALIFIED'
        and (q.enrichment_status='ENRICHMENT_PENDING' or (q.enrichment_status in ('ENRICHMENT_RETRY','ENRICHMENT_NO_RESULT') and coalesce(q.enrichment_next_retry_at,now())<=now()))
      order by case when v_effective_niche='pv_toitures' then coalesce(q.context->>'geo_priority','P4_AUTRE_ZONE_AUTORISEE') else '' end,q.score desc nulls last,q.created_at
      limit v_limit for update skip locked
    ) returning p.*;
end $function$;

create or replace function hermes_os.hb_enrichment_next(p_limit integer default 5)
returns setof hermes_os.hb_prospects language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_limit int:=greatest(5,least(coalesce(p_limit,5),20));
begin
  return query update hermes_os.hb_prospects p
    set enrichment_status='ENRICHMENT_PROCESSING',enrichment_attempts=coalesce(enrichment_attempts,0)+1,enrichment_last_attempt_at=now(),updated_at=now()
    where p.prospect_id in (
      select q.prospect_id from hermes_os.hb_prospects q
      where q.niche_key='pv_toitures' and coalesce(q.pipeline_stage,'')<>'REJECTED' and coalesce(q.qualification_verdict,'')<>'QUALIFIED'
        and (q.enrichment_status='ENRICHMENT_PENDING' or (q.enrichment_status in ('ENRICHMENT_RETRY','ENRICHMENT_NO_RESULT') and coalesce(q.enrichment_next_retry_at,now())<=now()))
      order by coalesce(q.context->>'geo_priority','P4_AUTRE_ZONE_AUTORISEE'),q.score desc nulls last,q.created_at
      limit v_limit for update skip locked
    ) returning p.*;
end $function$;

-- Les definitions finales de hb_qualify_pv_prospect / hb_refresh_pv_readiness /
-- hb_finder_apply sont volontairement versionnees dans cette meme migration live :
--  * ALREADY_QUALIFIED sort immediatement ;
--  * qualified_at/daily_batch_date ne sont poses qu'a la premiere transition ;
--  * READY_* valides ne sont plus retraités ;
--  * pour PV, hb_assign_pv_fit_from_naf est execute avant hb_qualify_pv_prospect.
-- Ces fonctions sont couvertes par la migration appliquee `pv_daily_new_prospect_engine_v2`.

insert into hermes_os.hb_config(key,value)
values('pv_daily_new_prospect_policy',jsonb_build_object('target',20,'priority_borrowing',true,'borrow_batch_min',5,'source_segments',5,'definition','new first-time QUALIFIED + exploitable channel','quality_rule','never relax qualification; increase upstream volume instead','updated_at',now()))
on conflict(key) do update set value=excluded.value;
