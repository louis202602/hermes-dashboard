-- 20260901_pv_daily_finder_quality_priority.sql
-- Ameliore le rendement du finder quotidien PV sans relacher la qualification.
-- Tant que l'objectif du jour n'est pas atteint, on traite d'abord les dossiers
-- officiels actifs, etablissements employeurs, jamais tentes, proches, avec fit PV
-- HIGH/MEDIUM. Aucun prospect n'est qualifie par cette fonction : elle ne fait
-- que choisir l'ordre de recherche de contact.

create or replace function hermes_os.hb_contacts_to_find_niche(p_niche text)
returns table(prospect_id uuid, niche_key text, company_name text, siren text, ville text)
language sql
security definer
set search_path to 'hermes_os','public','pg_catalog','pg_temp'
as $function$
  select p.prospect_id,
         p.niche_key,
         p.company_name,
         coalesce(c.siren,p.context->>'siren'),
         p.context->>'ville'
  from hermes_os.hb_prospects p
  left join hermes_os.hb_counterparties c using(counterparty_id)
  left join hermes_os.hb_pv_site_profiles sp on sp.prospect_id=p.prospect_id
  where p.niche_key=p_niche
    and p.status in ('NEW','ENRICHED')
    and coalesce(p.pipeline_stage,'')<>'REJECTED'
    and p.qualification_verdict not in ('EXCLUDED','UNQUALIFIED')
    and hermes_os.hb_pick_contact(p.prospect_id) is null
    and coalesce((p.context->>'finder_attempts')::int,0)<3
    and (
      p.context->>'finder_last_at' is null
      or (p.context->>'finder_last_at')::timestamptz < now()-interval '4 hours'
    )
  order by
    case when p_niche='pv_toitures' and coalesce(p.active_status_verified,false) then 0 else 1 end,
    case when p_niche='pv_toitures'
               and p.context->>'source'='recherche-entreprises.api.gouv.fr'
               and p.context->>'etat_administratif'='A'
         then 0 else 1 end,
    case when p_niche='pv_toitures' then
      case coalesce(p.context->>'caractere_employeur','')
        when 'O' then 0
        when '' then 1
        else 2
      end
      else 0
    end,
    coalesce((p.context->>'finder_attempts')::int,0),
    case when p_niche='pv_toitures' then
      case coalesce(p.context->>'geo_priority','P4_AUTRE_ZONE_AUTORISEE')
        when 'P1_MARSEILLE' then 0
        when 'P2_BOUCHES_DU_RHONE' then 1
        when 'P3_PACA_LIMITROPHE' then 2
        else 3
      end
      else 0
    end,
    case when p_niche='pv_toitures' then
      case sp.pv_fit
        when 'HIGH' then 0
        when 'MEDIUM' then 1
        when 'UNKNOWN' then 2
        when 'LOW' then 3
        else 4
      end
      else 0
    end,
    case when p_niche='pv_toitures' and coalesce(p.context->>'effectif','NN')='NN' then 1 else 0 end,
    coalesce(p.score,0) desc nulls last,
    p.updated_at
  limit case
    when p_niche='pv_toitures'
         and coalesce((hermes_os.hb_pv_exploitable_snapshot()->>'shortfall_today')::int,0)>0
      then 5
    else 1
  end;
$function$;

revoke all on function hermes_os.hb_contacts_to_find_niche(text) from public, anon, authenticated;
