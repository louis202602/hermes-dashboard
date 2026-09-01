-- 20260901_pv_official_source_refill_and_controller.sql
-- Refill autonome de la file PV depuis l'API officielle Recherche d'entreprises.
-- Aucune entreprise n'est qualifiee sur cette seule source : le refill alimente
-- uniquement le stock, puis les gardes contact + fit PV + qualification decident.

create table if not exists hermes_os.hb_pv_source_cursors (
  naf_code text primary key,
  next_page integer not null default 1 check(next_page>=1),
  total_pages integer,
  last_http_status integer,
  last_seen_results integer,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table hermes_os.hb_pv_source_cursors enable row level security;
revoke all on hermes_os.hb_pv_source_cursors from public,anon,authenticated;

create or replace function hermes_os.hb_pv_source_refill(p_pages_per_segment integer default 1,p_queue_floor integer default 220,p_max_insert integer default 120)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','extensions','public','pg_catalog','pg_temp'
as $function$
declare
  v_shortfall int:=coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'shortfall_today')::int,0);
  v_queue int:=0;v_inserted int:=0;v_duplicates int:=0;v_skipped int:=0;v_http_failures int:=0;v_calls int:=0;
  v_naf text;v_page int;v_total_pages int;v_url text;v_resp extensions.http_response;v_json jsonb;v_company jsonb;v_site jsonb;v_upsert jsonb;v_results int;v_round int;
  v_seg text[]:=array['52.10B','52.10A','49.41A','49.41B','25.11Z','25.62B','45.11Z','45.20A','10.71A','22.22Z'];
begin
  select count(*) into v_queue from hermes_os.hb_prospects p
   where p.niche_key='pv_toitures' and p.status in ('NEW','ENRICHED') and coalesce(p.pipeline_stage,'')<>'REJECTED'
     and coalesce(p.qualification_verdict,'') not in ('QUALIFIED','EXCLUDED','UNQUALIFIED')
     and hermes_os.hb_pick_contact(p.prospect_id) is null and coalesce((p.context->>'finder_attempts')::int,0)<3;
  if v_shortfall<=0 then return jsonb_build_object('ok',true,'status','TARGET_ALREADY_MET','shortfall',0,'queue',v_queue,'inserted',0,'api_calls',0); end if;
  if v_queue>=greatest(p_queue_floor,20) then return jsonb_build_object('ok',true,'status','QUEUE_SUFFICIENT','shortfall',v_shortfall,'queue',v_queue,'inserted',0,'api_calls',0); end if;

  foreach v_naf in array v_seg loop
    exit when v_inserted>=greatest(1,p_max_insert) or v_queue+v_inserted>=greatest(p_queue_floor,20);
    insert into hermes_os.hb_pv_source_cursors(naf_code,next_page) values(v_naf,1) on conflict(naf_code) do nothing;
    for v_round in 1..greatest(1,least(coalesce(p_pages_per_segment,1),3)) loop
      exit when v_inserted>=greatest(1,p_max_insert) or v_queue+v_inserted>=greatest(p_queue_floor,20);
      select next_page into v_page from hermes_os.hb_pv_source_cursors where naf_code=v_naf for update;
      v_url:=format('https://recherche-entreprises.api.gouv.fr/search?activite_principale=%s&departement=13&etat_administratif=A&per_page=25&page=%s',v_naf,v_page);
      begin v_resp:=extensions.http_get(v_url::varchar);
      exception when others then
        v_http_failures:=v_http_failures+1;
        update hermes_os.hb_pv_source_cursors set last_http_status=null,last_run_at=now(),updated_at=now() where naf_code=v_naf;
        perform pg_sleep(0.20);continue;
      end;
      v_calls:=v_calls+1;
      if v_resp.status<>200 then
        v_http_failures:=v_http_failures+1;
        update hermes_os.hb_pv_source_cursors set last_http_status=v_resp.status,last_run_at=now(),updated_at=now() where naf_code=v_naf;
        perform pg_sleep(0.20);continue;
      end if;
      begin v_json:=v_resp.content::jsonb; exception when others then v_json:='{}'::jsonb; end;
      v_total_pages:=greatest(coalesce((v_json->>'total_pages')::int,1),1);
      v_results:=jsonb_array_length(coalesce(v_json->'results','[]'::jsonb));
      for v_company in select value from jsonb_array_elements(coalesce(v_json->'results','[]'::jsonb)) loop
        v_site:=null;
        select e.value into v_site from jsonb_array_elements(coalesce(v_company->'matching_etablissements','[]'::jsonb)) e(value)
         where e.value->>'etat_administratif'='A' and left(coalesce(e.value->>'code_postal',''),2)='13' and e.value->>'activite_principale'=v_naf
         order by coalesce((e.value->>'tranche_effectif_salarie')::text,'') desc,e.value->>'date_creation' desc nulls last limit 1;
        if v_site is null then v_skipped:=v_skipped+1;continue;end if;
        v_upsert:=hermes_os.hb_hb04_upsert_prospect('pv_toitures',coalesce(nullif(v_company->>'nom_complet',''),nullif(v_company->>'nom_raison_sociale',''),'SIREN '||coalesce(v_company->>'siren','INCONNU')),
          jsonb_build_object('source','recherche-entreprises.api.gouv.fr','source_url',v_url,'fetched_at',now(),'etat_administratif','A','siren',v_company->>'siren','siret_site',v_site->>'siret','ville',v_site->>'libelle_commune','departement','13','code_postal',v_site->>'code_postal','adresse_site',v_site->>'adresse','naf',v_naf,'effectif',v_site->>'tranche_effectif_salarie','caractere_employeur',v_site->>'caractere_employeur','latitude',v_site->>'latitude','longitude',v_site->>'longitude','sourcing_mode','OFFICIAL_API_ROTATING_REFILL'));
        if v_upsert->>'status'='INSERTED' then v_inserted:=v_inserted+1;
        elsif v_upsert->>'status'='DUPLICATE' then v_duplicates:=v_duplicates+1;else v_skipped:=v_skipped+1;end if;
        exit when v_inserted>=greatest(1,p_max_insert) or v_queue+v_inserted>=greatest(p_queue_floor,20);
      end loop;
      update hermes_os.hb_pv_source_cursors set total_pages=v_total_pages,next_page=case when v_page>=v_total_pages then 1 else v_page+1 end,last_http_status=v_resp.status,last_seen_results=v_results,last_run_at=now(),updated_at=now() where naf_code=v_naf;
      perform pg_sleep(0.20);
    end loop;
  end loop;
  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
  values('hb_pv_source_refill','PV_OFFICIAL_SOURCE_REFILL','pv_toitures',(now() at time zone 'Europe/Paris')::date::text,
    jsonb_build_object('shortfall',v_shortfall,'queue_before',v_queue,'queue_floor',p_queue_floor,'inserted',v_inserted,'duplicates',v_duplicates,'skipped',v_skipped,'api_calls',v_calls,'http_failures',v_http_failures,'source','recherche-entreprises.api.gouv.fr'),case when v_http_failures=0 then 'OK' else 'PARTIAL' end);
  return jsonb_build_object('ok',v_http_failures=0,'status','REFILL_COMPLETE','shortfall',v_shortfall,'queue_before',v_queue,'queue_estimated_after',v_queue+v_inserted,'inserted',v_inserted,'duplicates',v_duplicates,'skipped',v_skipped,'api_calls',v_calls,'http_failures',v_http_failures,'provenance','OFFICIAL_API');
end $function$;
revoke all on function hermes_os.hb_pv_source_refill(integer,integer,integer) from public,anon,authenticated;
grant execute on function hermes_os.hb_pv_source_refill(integer,integer,integer) to service_role;

create or replace function hermes_os.hb_pv_daily_goal_controller()
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_target int:=coalesce((select (value#>>'{}')::int from hermes_os.hb_config where key='pv_daily_exploitable_target'),20);
  v_refresh jsonb;v_snap jsonb;v_source jsonb;v_shortfall int;v_prioritized int:=0;
begin
  insert into hermes_os.hb_runtime_heartbeats(component,last_seen_at,metadata) values('heliosolar_pv_goal_controller',now(),jsonb_build_object('started_at',now())) on conflict(component) do update set last_seen_at=excluded.last_seen_at,metadata=excluded.metadata;
  v_refresh:=hermes_os.hb_refresh_pv_readiness(500);v_snap:=hermes_os.hb_pv_exploitable_snapshot();v_shortfall:=greatest(v_target-coalesce((v_snap->>'qualified_today')::int,0),0);
  if v_shortfall>0 then
    v_source:=hermes_os.hb_pv_source_refill(1,220,80);
    with candidates as (
      select p.prospect_id from hermes_os.hb_prospects p where p.niche_key='pv_toitures' and coalesce(p.pipeline_stage,'')<>'REJECTED' and coalesce(p.qualification_verdict,'')<>'QUALIFIED' and p.enrichment_status in ('ENRICHMENT_PENDING','ENRICHMENT_RETRY','ENRICHMENT_NO_RESULT')
      order by case when coalesce(p.active_status_verified,false) then 0 else 1 end,coalesce(p.context->>'geo_priority','P4_AUTRE_ZONE_AUTORISEE'),case p.enrichment_status when 'ENRICHMENT_RETRY' then 1 when 'ENRICHMENT_NO_RESULT' then 2 else 3 end,p.score desc nulls last,p.created_at limit least(greatest(v_shortfall*5,40),120)
    )
    update hermes_os.hb_prospects p set enrichment_status=case when p.enrichment_status='ENRICHMENT_NO_RESULT' then 'ENRICHMENT_RETRY' else p.enrichment_status end,enrichment_next_retry_at=case when p.enrichment_status in ('ENRICHMENT_RETRY','ENRICHMENT_NO_RESULT') then now() else p.enrichment_next_retry_at end,updated_at=now() where p.prospect_id in(select prospect_id from candidates);
    get diagnostics v_prioritized=row_count;
  end if;
  v_snap:=hermes_os.hb_pv_exploitable_snapshot();v_shortfall:=greatest(v_target-coalesce((v_snap->>'qualified_today')::int,0),0);
  insert into hermes_os.hb_runtime_heartbeats(component,last_seen_at,metadata) values('heliosolar_pv_goal_controller',now(),jsonb_build_object('target',v_target,'snapshot',v_snap,'refresh',v_refresh,'source_refill',v_source,'shortfall',v_shortfall,'prioritized',v_prioritized)) on conflict(component) do update set last_seen_at=excluded.last_seen_at,metadata=excluded.metadata;
  insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict) values('hb_pv_daily_goal_controller','PV_DAILY_GOAL_CONTROL','pv_toitures',(now() at time zone 'Europe/Paris')::date::text,jsonb_build_object('target',v_target,'shortfall',v_shortfall,'prioritized',v_prioritized,'source_refill',v_source,'snapshot',v_snap),case when v_shortfall=0 then 'TARGET_MET' else 'ENRICHMENT_REQUIRED' end);
  return jsonb_build_object('ok',true,'target',v_target,'shortfall',v_shortfall,'prioritized',v_prioritized,'source_refill',v_source,'snapshot',v_snap,'refresh',v_refresh);
end $function$;
