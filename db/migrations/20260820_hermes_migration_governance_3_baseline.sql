-- 20260820_hermes_migration_governance_3_baseline.sql
-- GOUVERNANCE DES MIGRATIONS PRODUCTION — LOT 3 : la ligne de base.
--
-- L'audit du 2026-08-19 a établi un fait inconfortable : sur ~203 migrations
-- appliquées à la production, la grande majorité n'a aucun fichier dans le dépôt.
-- Le dépôt n'a jamais été la source de vérité de cette base.
--
-- Une règle naïve — « toute migration sans fichier = STOP » — bloquerait Hermès
-- définitivement sur cette dette. On sépare donc deux choses qui n'ont rien à voir :
--
--   LEGACY_BASELINE      ce qui était déjà là le jour où l'on a posé la règle.
--                        Dette documentée. Ne bloque RIEN. Se résorbe si on veut,
--                        quand on veut, migration par migration.
--
--   NEW_UNVERSIONED_DRIFT  ce qui est appliqué APRÈS. Doit avoir un fichier.
--                          Sinon STOP_UNVERSIONED_DB_DRIFT.
--
-- La frontière est une date, pas un jugement : `cutoff_version`. Elle est exacte,
-- pas heuristique — aucune comparaison de noms n'intervient pour classer une
-- migration en héritage.
--
-- ⚠️ CE FICHIER N'EST PAS REJOUABLE À L'IDENTIQUE, et c'est voulu : il
-- photographie l'état de la base à l'instant où on l'applique. Appliqué deux fois,
-- il ne refait PAS la photo (le marqueur singleton l'en empêche). C'est la seule
-- migration du dépôt dont le contenu dépend du moment — parce que son objet est
-- précisément de dater une frontière.
--
-- Réversible : 20260820_hermes_migration_governance_9_rollback.sql

create table if not exists hermes_os.migration_baseline (
  version     text not null,
  name        text not null,
  recorded_at timestamptz not null default now(),
  constraint migration_baseline_pkey primary key (version)
);

create table if not exists hermes_os.migration_baseline_meta (
  baseline_id    text not null default 'BASELINE',
  cutoff_version text not null,
  created_at     timestamptz not null default now(),
  created_by     text not null,
  note           text,
  constraint migration_baseline_meta_pkey primary key (baseline_id),
  -- Singleton : il n'y a qu'une ligne de base. En redéfinir une seconde
  -- reviendrait à effacer la dette d'un trait de plume.
  constraint migration_baseline_meta_singleton check (baseline_id = 'BASELINE')
);

alter table hermes_os.migration_baseline      enable row level security;
alter table hermes_os.migration_baseline_meta enable row level security;
revoke all on hermes_os.migration_baseline      from public, anon, authenticated;
revoke all on hermes_os.migration_baseline_meta from public, anon, authenticated;

-- --- La photo -------------------------------------------------------------------
do $do$
declare v_cutoff text;
begin
  if exists (select 1 from hermes_os.migration_baseline_meta) then
    raise notice 'migration_baseline: deja etablie, aucune reprise de photo.';
    return;
  end if;

  insert into hermes_os.migration_baseline (version, name)
  select version, name from supabase_migrations.schema_migrations
  on conflict (version) do nothing;

  select max(version) into v_cutoff from hermes_os.migration_baseline;
  if v_cutoff is null then
    raise exception 'migration_baseline: aucune migration lue, refus d etablir une ligne de base vide';
  end if;

  insert into hermes_os.migration_baseline_meta (cutoff_version, created_by, note)
  values (v_cutoff, 'hermes-migration-governance',
          'Dette historique anterieure a la regle du verrou. Documentee, non bloquante.');
end;
$do$;

-- --- Lecture ---------------------------------------------------------------------
--
-- Ce que la base sait : ce qui a été appliqué après la frontière. Ce qu'elle ne
-- sait PAS : quels fichiers existent dans le dépôt. La confrontation des deux se
-- fait côté dépôt (`lib/db/migrationDrift.ts`), là où les deux moitiés sont
-- connues — et là où elle est testable hors ligne.
create or replace function hermes_os.migrations_since_baseline()
returns table (version text, name text)
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select m.version, m.name
    from supabase_migrations.schema_migrations m
   where m.version > (select cutoff_version from hermes_os.migration_baseline_meta)
   order by m.version;
$function$;

create or replace function hermes_os.migration_baseline_summary()
returns jsonb
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select jsonb_build_object(
    'baseline_established', exists (select 1 from hermes_os.migration_baseline_meta),
    'cutoff_version', (select cutoff_version from hermes_os.migration_baseline_meta),
    'created_at',     (select created_at     from hermes_os.migration_baseline_meta),
    'legacy_count',   (select count(*) from hermes_os.migration_baseline),
    'since_baseline_count', (select count(*) from hermes_os.migrations_since_baseline()));
$function$;

revoke all on function hermes_os.migrations_since_baseline()    from public, anon, authenticated;
revoke all on function hermes_os.migration_baseline_summary()   from public, anon, authenticated;
