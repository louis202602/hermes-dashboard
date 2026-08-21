-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / 1 — Machines à états étude & chiffrage + audit.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- PV-1 avait donné une machine à états PILOTÉE PAR DONNÉES au prospect
-- (`pv_prospect_transitions`, 33 chemins) mais laissé `pv_studies.status` et
-- `pv_economics.status` sous simple `CHECK` : n'importe quel chemin entre deux
-- statuts valides était donc accepté, y compris `DRAFT -> VALIDATED`. Tant que
-- seules des façades de validation existaient, le trou était théorique. PV-3
-- ouvre la création et la modification humaines : il devient réel. Ce lot le ferme.
--
-- UNE table pour les deux entités, pas deux tables jumelles : la colonne
-- `entity` porte la distinction. Ajouter un chemin demain = insérer une ligne,
-- jamais modifier une fonction.
--
-- ⚠️ COMPATIBILITÉ VÉRIFIÉE, pas supposée : les chemins réellement empruntés par
-- les façades PV-2 (`CALCULATED -> VALIDATED` pour une étude,
-- `CALCULATED -> VERIFIED` pour un chiffrage, et les deux `-> REJECTED`) sont
-- déclarés ci-dessous. PV-2 continue donc de fonctionner à l'identique.
--
-- Le déclencheur agit UNIQUEMENT sur `UPDATE`, comme celui du prospect : une
-- CRÉATION reste libre au niveau du schéma (c'est la façade qui impose `DRAFT`
-- pour un humain), sinon les jeux d'essai de PV-1 et PV-2 — qui insèrent
-- directement des lignes `CALCULATED` — deviendraient impossibles à écrire.

begin;

-- ---------------------------------------------------------------------------
-- 1. Les chemins autorisés, en DONNÉES.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_status_transitions (
  entity      text not null check (entity in ('pv_studies', 'pv_economics')),
  from_status text not null,
  to_status   text not null,
  primary key (entity, from_status, to_status)
);

comment on table hermes_os.pv_status_transitions is
  'PV-3 — chemins de statut autorisés pour les études et les chiffrages. Données de référence, pas du métier.';

alter table hermes_os.pv_status_transitions enable row level security;
revoke all on table hermes_os.pv_status_transitions from anon, authenticated;

insert into hermes_os.pv_status_transitions (entity, from_status, to_status)
values
  -- ÉTUDES ------------------------------------------------------------------
  -- Un brouillon ne peut PAS sauter directement à « validée » : c'est
  -- précisément le raccourci que ce lot interdit.
  ('pv_studies', 'DRAFT',        'CALCULATED'),
  ('pv_studies', 'DRAFT',        'NEEDS_REVIEW'),
  ('pv_studies', 'DRAFT',        'REJECTED'),
  ('pv_studies', 'DRAFT',        'SUPERSEDED'),
  ('pv_studies', 'CALCULATED',   'DRAFT'),
  ('pv_studies', 'CALCULATED',   'NEEDS_REVIEW'),
  ('pv_studies', 'CALCULATED',   'VALIDATED'),
  ('pv_studies', 'CALCULATED',   'REJECTED'),
  ('pv_studies', 'CALCULATED',   'SUPERSEDED'),
  ('pv_studies', 'NEEDS_REVIEW', 'DRAFT'),
  ('pv_studies', 'NEEDS_REVIEW', 'CALCULATED'),
  ('pv_studies', 'NEEDS_REVIEW', 'VALIDATED'),
  ('pv_studies', 'NEEDS_REVIEW', 'REJECTED'),
  ('pv_studies', 'NEEDS_REVIEW', 'SUPERSEDED'),
  -- Une étude VALIDÉE ne redevient pas un brouillon : on en crée une nouvelle
  -- version. Le seul chemin sortant est donc « remplacée ».
  ('pv_studies', 'VALIDATED',    'SUPERSEDED'),
  ('pv_studies', 'REJECTED',     'DRAFT'),
  ('pv_studies', 'REJECTED',     'CALCULATED'),
  ('pv_studies', 'REJECTED',     'SUPERSEDED'),

  -- CHIFFRAGES --------------------------------------------------------------
  ('pv_economics', 'DRAFT',        'CALCULATED'),
  ('pv_economics', 'DRAFT',        'NEEDS_REVIEW'),
  ('pv_economics', 'DRAFT',        'REJECTED'),
  ('pv_economics', 'CALCULATED',   'DRAFT'),
  ('pv_economics', 'CALCULATED',   'NEEDS_REVIEW'),
  ('pv_economics', 'CALCULATED',   'VERIFIED'),
  ('pv_economics', 'CALCULATED',   'REJECTED'),
  ('pv_economics', 'NEEDS_REVIEW', 'DRAFT'),
  ('pv_economics', 'NEEDS_REVIEW', 'CALCULATED'),
  ('pv_economics', 'NEEDS_REVIEW', 'VERIFIED'),
  ('pv_economics', 'NEEDS_REVIEW', 'REJECTED'),
  ('pv_economics', 'REJECTED',     'DRAFT'),
  ('pv_economics', 'REJECTED',     'CALCULATED')
on conflict (entity, from_status, to_status) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Le déclencheur. Même forme que `pv_prospect_status_guard` : il LIT la
--    table, il ne code aucun chemin en dur.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from hermes_os.pv_status_transitions t
     where t.entity = tg_table_name
       and t.from_status = old.status
       and t.to_status = new.status
  ) then
    raise exception 'PV_TRANSITION_INTERDITE: %.% -> % n''est pas une transition déclarée',
      tg_table_name, old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_studies_status_guard on hermes_os.pv_studies;
create trigger trg_pv_studies_status_guard
  before update on hermes_os.pv_studies
  for each row execute function hermes_os.pv_status_guard();

drop trigger if exists trg_pv_economics_status_guard on hermes_os.pv_economics;
create trigger trg_pv_economics_status_guard
  before update on hermes_os.pv_economics
  for each row execute function hermes_os.pv_status_guard();

-- ---------------------------------------------------------------------------
-- 3. Audit des créations et modifications humaines.
--
--    PV-1 traçait déjà les VALIDATIONS (via `pv_human_validation_guard`) et les
--    changements de statut de prospect. Il ne traçait PAS la création ni la
--    modification d'une étude, d'un chiffrage ou d'une consommation — parce que
--    rien ne pouvait encore en créer. PV-3 ouvre ces gestes : ils doivent être
--    traçables, et par un DÉCLENCHEUR plutôt que par la façade, pour qu'une
--    écriture SQL directe soit tracée elle aussi.
--
--    Anti-doublon : quand le statut atteint la valeur « validée » (TG_ARGV[0]),
--    `pv_human_validation_guard` a déjà écrit l'entrée d'audit. On ne la
--    redouble pas — le journal resterait vrai mais deviendrait illisible.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_change_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_validated text := tg_argv[0];
  v_old jsonb := '{}'::jsonb;
  v_summary text;
begin
  if new.status = v_validated
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    return new;  -- déjà tracé par la garde de validation humaine
  end if;

  if tg_op = 'INSERT' then
    v_summary := format('%s créé (statut %s)', tg_table_name, new.status);
  else
    if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
      return new;  -- rien n'a changé hors horodatage
    end if;
    v_old := jsonb_build_object('status', old.status);
    v_summary := case
      when old.status is distinct from new.status
        then format('%s : statut %s -> %s', tg_table_name, old.status, new.status)
      else format('%s modifié (statut %s)', tg_table_name, new.status)
    end;
  end if;

  perform hermes_os._pv_audit(
    new.tenant_id, tg_table_name, new.id, v_old,
    jsonb_build_object('status', new.status), v_summary);
  return new;
end;
$function$;

drop trigger if exists trg_pv_studies_change_audit on hermes_os.pv_studies;
create trigger trg_pv_studies_change_audit
  after insert or update on hermes_os.pv_studies
  for each row execute function hermes_os.pv_change_audit('VALIDATED');

drop trigger if exists trg_pv_economics_change_audit on hermes_os.pv_economics;
create trigger trg_pv_economics_change_audit
  after insert or update on hermes_os.pv_economics
  for each row execute function hermes_os.pv_change_audit('VERIFIED');

-- La consommation a une colonne de statut DIFFÉRENTE (`verification_status`) :
-- elle a donc son propre déclencheur, minimal, plutôt qu'un paramètre de plus.
create or replace function hermes_os.pv_consumption_change_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.verification_status = 'VERIFIED'
     and (tg_op = 'INSERT' or old.verification_status is distinct from new.verification_status) then
    return new;  -- déjà tracé par la garde de validation humaine
  end if;
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;

  perform hermes_os._pv_audit(
    new.tenant_id, 'pv_consumption_profiles', new.id,
    case when tg_op = 'UPDATE'
         then jsonb_build_object('verification_status', old.verification_status)
         else '{}'::jsonb end,
    jsonb_build_object('verification_status', new.verification_status),
    case when tg_op = 'INSERT' then 'profil de consommation créé'
         else 'profil de consommation modifié' end);
  return new;
end;
$function$;

drop trigger if exists trg_pv_consumption_change_audit on hermes_os.pv_consumption_profiles;
create trigger trg_pv_consumption_change_audit
  after insert or update on hermes_os.pv_consumption_profiles
  for each row execute function hermes_os.pv_consumption_change_audit();

commit;
