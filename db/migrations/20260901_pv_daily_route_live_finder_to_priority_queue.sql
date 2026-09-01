-- 20260901_pv_daily_route_live_finder_to_priority_queue.sql
-- Le worker n8n reel appelle hb_contacts_to_find_auto(). Tant que le quota PV
-- quotidien n'est pas atteint, ce point d'entree sert 5 dossiers PV par cycle.

create or replace function hermes_os.hb_contacts_to_find_niche(p_niche text)
returns table(prospect_id uuid,niche_key text,company_name text,siren text,ville text)
language sql security definer
set search_path to 'hermes_os','public','pg_catalog','pg_temp'
as $function$
  select p.prospect_id,p.niche_key,p.company_name,
         coalesce(c.siren,p.context->>'siren'),p.context->>'ville'
  from hermes_os.hb_prospects p
  left join hermes_os.hb_counterparties c using(counterparty_id)
  left join hermes_os.hb_pv_site_profiles sp on sp.prospect_id=p.prospect_id
  where p.niche_key=p_niche
    and p.status in ('NEW','ENRICHED')
    and coalesce(p.pipeline_stage,'')<>'REJECTED'
    and p.qualification_verdict not in ('EXCLUDED','UNQUALIFIED')
    and hermes_os.hb_pick_contact(p.prospect_id) is null
    and coalesce((p.context->>'finder_attempts')::int,0)<3
    and (p.context->>'finder_last_at' is null or (p.context->>'finder_last_at')::timestamptz<now()-interval '4 hours')
  order by
    case when p_niche='pv_toitures' and coalesce(p.active_status_verified,false) then 0 else 1 end,
    case when p_niche='pv_toitures' then coalesce(p.context->>'geo_priority','P4_AUTRE_ZONE_AUTORISEE') else 'ZZZ' end,
    case when p_niche='pv_toitures' then case sp.pv_fit when 'HIGH' then 0 when 'MEDIUM' then 1 when 'UNKNOWN' then 2 when 'LOW' then 3 else 4 end else 0 end,
    coalesce(p.score,0) desc nulls last,
    coalesce((p.context->>'finder_attempts')::int,0),p.updated_at
  limit case when p_niche='pv_toitures' and coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'shortfall_today')::int,0)>0 then 5 else 1 end;
$function$;

create or replace function hermes_os.hb_contacts_to_find_auto()
returns table(prospect_id uuid,niche_key text,company_name text,siren text,ville text)
language plpgsql security definer
set search_path to 'hermes_os','public','pg_catalog','pg_temp'
as $function$
declare v_primary text;v_niche text;v_shortfall int:=0;v_pv_enabled boolean:=false;
begin
  v_pv_enabled:=coalesce((select (value#>>'{}')::boolean from hermes_os.hb_config where key='heliosolar_pv_sourcing_enabled'),false);
  if v_pv_enabled then
    v_shortfall:=coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'shortfall_today')::int,0);
    if v_shortfall>0 and exists(
      select 1 from hermes_os.hb_prospects p
      where p.niche_key='pv_toitures' and p.status in ('NEW','ENRICHED')
        and coalesce(p.pipeline_stage,'')<>'REJECTED'
        and coalesce(p.qualification_verdict,'') not in ('QUALIFIED','EXCLUDED','UNQUALIFIED')
        and hermes_os.hb_pick_contact(p.prospect_id) is null
        and coalesce((p.context->>'finder_attempts')::int,0)<3
        and (p.context->>'finder_last_at' is null or (p.context->>'finder_last_at')::timestamptz<now()-interval '4 hours')
    ) then
      return query select * from hermes_os.hb_contacts_to_find_niche('pv_toitures');
      return;
    end if;
  end if;

  select value->>'niche_key' into v_primary from hermes_os.hb_config where key='primary_niche';
  if v_primary is not null and exists(select 1 from hermes_os.hb_niches n where n.niche_key=v_primary and n.status='ACTIVE') then
    return query select * from hermes_os.hb_contacts_to_find_niche(v_primary);
    return;
  end if;
  for v_niche in select n.niche_key from hermes_os.hb_niches n where n.status='ACTIVE' order by n.score desc nulls last loop
    return query select * from hermes_os.hb_contacts_to_find_niche(v_niche);
    if found then return; end if;
  end loop;
  return;
end $function$;

insert into hermes_os.hb_audit_log(actor,action,entity_type,entity_id,payload,verdict)
values('system_migration','PV_LIVE_FINDER_ROUTED','hb_contacts_to_find_auto','pv_toitures',jsonb_build_object('batch_size',5,'priority_until_daily_target',20,'source','live_n8n_endpoint'),'OK');
