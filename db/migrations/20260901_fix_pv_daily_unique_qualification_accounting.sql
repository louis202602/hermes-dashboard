-- 20260901_fix_pv_daily_unique_qualification_accounting.sql
-- Le KPI quotidien compte uniquement la date de premiere qualification durable.
-- Il ne doit jamais reutiliser/rebasculer un ancien prospect dans le jour courant.

create or replace function hermes_os.hb_pv_exploitable_snapshot()
returns jsonb
language sql
stable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
  select jsonb_build_object(
    'ok',true,
    'target_per_day',20,
    'ready_total',count(*) filter(where p.qualification_verdict='QUALIFIED' and p.ready_status in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL','READY_VERIFIED_PHONE','READY_FORM')),
    'ready_email',count(*) filter(where p.qualification_verdict='QUALIFIED' and p.ready_status in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL')),
    'ready_phone',count(*) filter(where p.qualification_verdict='QUALIFIED' and p.ready_status='READY_VERIFIED_PHONE'),
    'qualified_today',count(*) filter(where (sp.qualified_at at time zone 'Europe/Paris')::date=(now() at time zone 'Europe/Paris')::date and p.qualification_verdict='QUALIFIED' and p.ready_status in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL','READY_VERIFIED_PHONE','READY_FORM')),
    'shortfall_today',greatest(20-count(*) filter(where (sp.qualified_at at time zone 'Europe/Paris')::date=(now() at time zone 'Europe/Paris')::date and p.qualification_verdict='QUALIFIED' and p.ready_status in ('READY_CONFIRMED_EMAIL','READY_HIGH_CONFIDENCE_EMAIL','READY_COMPANY_EMAIL','READY_PROBABLE_OFFICIAL_EMAIL','READY_VERIFIED_PHONE','READY_FORM')),0),
    'pending_enrichment',count(*) filter(where p.enrichment_status in ('ENRICHMENT_PENDING','ENRICHMENT_RETRY','ENRICHMENT_PROCESSING')),
    'review_required',count(*) filter(where p.qualification_verdict='REVIEW_REQUIRED'),
    'provenance','REAL'
  )
  from hermes_os.hb_prospects p
  left join hermes_os.hb_pv_site_profiles sp on sp.prospect_id=p.prospect_id
  where p.niche_key='pv_toitures' and coalesce(p.pipeline_stage,'')<>'REJECTED';
$function$;
