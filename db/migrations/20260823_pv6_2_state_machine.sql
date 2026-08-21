-- PACK PHOTOVOLTAÏQUE — LOT PV-6 / 2 — Machine à états de la visite, validation
-- humaine, immutabilité après validation, audit.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- Même forme que PV-1 (prospect), PV-3 (étude/chiffrage) et PV-5 (devis) : les
-- transitions sont des DONNÉES. Ajouter un chemin demain = insérer une ligne.

begin;

-- ---------------------------------------------------------------------------
-- 1. LES CHEMINS DE LA VISITE.
--
--    Ce que la table interdit, et pourquoi :
--      PLANNED -> VALIDATED   : on ne valide pas une visite qui n'a pas eu lieu.
--      BLOCKING -> VALIDATED  : un blocage ne se lève pas par un changement de
--                               statut. Il faut repasser par le terrain
--                               (IN_PROGRESS) ou par une revue (NEEDS_REVIEW).
--      VALIDATED -> *         : une preuve terrain validée ne se déjuge pas ;
--                               on planifie une NOUVELLE visite.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_survey_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

comment on table hermes_os.pv_survey_transitions is
  'PV-6 — chemins de statut autorisés pour une visite technique. Données de référence.';

alter table hermes_os.pv_survey_transitions enable row level security;
revoke all on table hermes_os.pv_survey_transitions from anon, authenticated;

insert into hermes_os.pv_survey_transitions (from_status, to_status) values
  ('PLANNED',      'IN_PROGRESS'),
  ('PLANNED',      'CANCELLED'),
  ('IN_PROGRESS',  'DONE'),
  ('IN_PROGRESS',  'PLANNED'),
  ('IN_PROGRESS',  'CANCELLED'),
  -- Une visite faite mène à trois issues, et à une seule reprise possible.
  ('DONE',         'VALIDATED'),
  ('DONE',         'NEEDS_REVIEW'),
  ('DONE',         'BLOCKING'),
  ('DONE',         'IN_PROGRESS'),
  ('NEEDS_REVIEW', 'VALIDATED'),
  ('NEEDS_REVIEW', 'BLOCKING'),
  ('NEEDS_REVIEW', 'IN_PROGRESS'),
  -- Un blocage se lève par le terrain ou par une revue, JAMAIS directement.
  ('BLOCKING',     'IN_PROGRESS'),
  ('BLOCKING',     'NEEDS_REVIEW'),
  ('BLOCKING',     'CANCELLED')
on conflict (from_status, to_status) do nothing;

create or replace function hermes_os.pv_survey_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from hermes_os.pv_survey_transitions t
     where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'PV_VISITE_TRANSITION_INTERDITE: % -> % n''est pas une transition declaree',
      old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_site_surveys_status_guard on hermes_os.pv_site_surveys;
create trigger trg_pv_site_surveys_status_guard
  before update on hermes_os.pv_site_surveys
  for each row execute function hermes_os.pv_survey_status_guard();

-- ---------------------------------------------------------------------------
-- 2. UN AGENT NE VALIDE PAS UNE VISITE.
--
--    On RÉUTILISE la garde de validation humaine de PV-1, paramétrée — la même
--    qui protège l'étude, le chiffrage, la consommation et l'acceptation d'un
--    devis. Elle refuse quand `auth.uid()` est NULL (un runner, un
--    `service_role`), quand l'acteur ou l'horodatage manque, ou quand l'acteur
--    déclaré n'est pas l'appelant. `SECURITY DEFINER` ne la contourne pas :
--    `auth.uid()` lit le jeton de la requête, pas le propriétaire de la fonction.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_site_surveys_human_validation on hermes_os.pv_site_surveys;
create trigger trg_pv_site_surveys_human_validation
  before insert or update on hermes_os.pv_site_surveys
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'VALIDATED', 'validated_by', 'validated_at');

-- Le tenant d'une visite ne bouge jamais : garde G1 de PV-1, réutilisée.
drop trigger if exists trg_pv_site_surveys_tenant_immutable on hermes_os.pv_site_surveys;
create trigger trg_pv_site_surveys_tenant_immutable
  before update on hermes_os.pv_site_surveys
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_findings_tenant_immutable on hermes_os.pv_site_survey_findings;
create trigger trg_pv_findings_tenant_immutable
  before update on hermes_os.pv_site_survey_findings
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 3. LES MESURES D'UNE VISITE VALIDÉE SONT FIGÉES.
--
--    Une preuve terrain qu'on peut réécrire après coup n'est plus une preuve.
--    Reste modifiable après validation : rien du relevé. Une correction passe
--    par une NOUVELLE visite — l'historique conserve les deux.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_survey_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if old.status <> 'VALIDATED' then
    return new;
  end if;
  if to_jsonb(new) - 'updated_at' - 'updated_by' - 'status'
     is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' - 'status'
  then
    raise exception
      'PV_VISITE_FIGEE: le releve d''une visite VALIDEE ne peut plus etre modifie. Planifiez une nouvelle visite.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_site_surveys_immutable on hermes_os.pv_site_surveys;
create trigger trg_pv_site_surveys_immutable
  before update on hermes_os.pv_site_surveys
  for each row execute function hermes_os.pv_survey_immutable_guard();

-- ---------------------------------------------------------------------------
-- 4. AUDIT. `entity_audit_log` via `_pv_audit`, comme tout le Pack PV.
--    AUCUN journal parallèle.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_survey_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_summary text; v_old jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_summary := format('visite technique creee (statut %s)', new.status);
  elsif old.status is distinct from new.status then
    v_old := jsonb_build_object('status', old.status);
    v_summary := format('visite technique : statut %s -> %s', old.status, new.status);
  elsif to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    v_summary := 'releve de visite technique modifie';
  else
    return null;
  end if;

  perform hermes_os._pv_audit(new.tenant_id, 'pv_site_surveys', new.id, v_old,
    jsonb_build_object('status', new.status), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_site_surveys_audit on hermes_os.pv_site_surveys;
create trigger trg_pv_site_surveys_audit
  after insert or update on hermes_os.pv_site_surveys
  for each row execute function hermes_os.pv_survey_audit();

create or replace function hermes_os.pv_survey_finding_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_row hermes_os.pv_site_survey_findings := case when tg_op = 'DELETE' then old else new end;
        v_summary text;
begin
  if tg_op = 'INSERT' then
    v_summary := format('ecart de visite detecte : %s (%s)', v_row.code, v_row.severity);
  elsif tg_op = 'DELETE' then
    v_summary := format('ecart de visite leve : %s', v_row.code);
  elsif old.resolution is distinct from new.resolution then
    v_summary := format('ecart de visite %s : resolution %s', v_row.code, coalesce(new.resolution, 'effacee'));
  else
    v_summary := format('ecart de visite %s mis a jour (%s)', v_row.code, v_row.severity);
  end if;

  perform hermes_os._pv_audit(v_row.tenant_id, 'pv_site_surveys', v_row.survey_id,
    case when tg_op = 'DELETE' then jsonb_build_object('code', old.code, 'severity', old.severity)
         else '{}'::jsonb end,
    jsonb_build_object('code', v_row.code, 'severity', v_row.severity), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_findings_audit on hermes_os.pv_site_survey_findings;
create trigger trg_pv_findings_audit
  after insert or update or delete on hermes_os.pv_site_survey_findings
  for each row execute function hermes_os.pv_survey_finding_audit();

commit;
