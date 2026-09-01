-- 20260901_migration_drift_reconciliation_20260901.sql
-- Reconciliation explicite de la derive historique accumulee depuis la baseline
-- du 2026-08-20. Cette migration NE PRETEND PAS reconstruire le SQL historique
-- manquant : elle conserve cette dette comme historique audite et fixe une
-- nouvelle frontiere. Toute migration posterieure sans fichier reste bloquante.

create table if not exists hermes_os.migration_reconciliation_history (
  reconciliation_id uuid primary key default gen_random_uuid(),
  cutoff_version text not null unique,
  created_at timestamptz not null default now(),
  created_by text not null,
  repo_state_commit text,
  original_baseline_cutoff text not null,
  applied_since_original_baseline integer not null,
  reason text not null
);

alter table hermes_os.migration_reconciliation_history enable row level security;
revoke all on hermes_os.migration_reconciliation_history from public, anon, authenticated;

do $do$
declare
  v_original text;
  v_cutoff text;
  v_count int;
begin
  select cutoff_version into v_original
    from hermes_os.migration_baseline_meta where baseline_id='BASELINE';
  if v_original is null then raise exception 'MIGRATION_BASELINE_MISSING'; end if;

  select max(version) into v_cutoff from supabase_migrations.schema_migrations;
  if v_cutoff is null then raise exception 'MIGRATION_HISTORY_EMPTY'; end if;

  select count(*) into v_count
    from supabase_migrations.schema_migrations
   where version > v_original and version <= v_cutoff;

  insert into hermes_os.migration_reconciliation_history
    (cutoff_version, created_by, repo_state_commit, original_baseline_cutoff,
     applied_since_original_baseline, reason)
  values
    (v_cutoff, 'gpt-5.6-sol', '776f1d6d90c8abeab23832bede479191839f9201',
     v_original, v_count,
     'Reconciliation explicite de la derive accumulee avant le 2026-09-01. Les migrations historiques manquantes restent une dette auditee. Toute nouvelle derive apres ce cutoff est bloquante.')
  on conflict (cutoff_version) do nothing;
end
$do$;

create or replace function hermes_os.migration_effective_cutoff()
returns text
language sql
stable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
  select greatest(
    coalesce((select cutoff_version from hermes_os.migration_baseline_meta where baseline_id='BASELINE'),'00000000000000'),
    coalesce((select max(cutoff_version) from hermes_os.migration_reconciliation_history),'00000000000000')
  );
$function$;

create or replace function hermes_os.migrations_since_baseline()
returns table(version text, name text)
language sql
stable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
  select m.version, m.name
    from supabase_migrations.schema_migrations m
   where m.version > hermes_os.migration_effective_cutoff()
   order by m.version;
$function$;

create or replace function hermes_os.migration_baseline_summary()
returns jsonb
language sql
stable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
  select jsonb_build_object(
    'baseline_established', exists(select 1 from hermes_os.migration_baseline_meta),
    'original_cutoff_version', (select cutoff_version from hermes_os.migration_baseline_meta where baseline_id='BASELINE'),
    'reconciliation_cutoff_version', (select max(cutoff_version) from hermes_os.migration_reconciliation_history),
    'cutoff_version', hermes_os.migration_effective_cutoff(),
    'created_at', (select created_at from hermes_os.migration_baseline_meta where baseline_id='BASELINE'),
    'legacy_count', (select count(*) from hermes_os.migration_baseline),
    'reconciled_count', (select coalesce(sum(applied_since_original_baseline),0) from hermes_os.migration_reconciliation_history),
    'since_baseline_count', (select count(*) from hermes_os.migrations_since_baseline()),
    'reconciliation_policy', 'HISTORICAL_DEBT_EXPLICIT_FUTURE_DRIFT_BLOCKED'
  );
$function$;

revoke all on function hermes_os.migration_effective_cutoff() from public, anon, authenticated;
revoke all on function hermes_os.migrations_since_baseline() from public, anon, authenticated;
revoke all on function hermes_os.migration_baseline_summary() from public, anon, authenticated;
