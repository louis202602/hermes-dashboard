-- 20260819_pv1_2_functions.sql
-- PACK PHOTOVOLTAÏQUE — LOT PV-1 : garde-fous et transitions.
-- Idempotent (CREATE OR REPLACE + DROP/CREATE TRIGGER).
--
-- Ces déclencheurs transforment quatre règles métier en invariants de SCHÉMA,
-- opposables à TOUT écrivain — façade applicative, migration, runner n8n futur,
-- ou requête SQL directe :
--
--   G1. `tenant_id` est IMMUABLE. Une ligne ne peut pas changer de tenant.
--   G2. Le statut d'un prospect ne suit que les chemins déclarés dans
--       `pv_prospect_transitions`.
--   G3. Une donnée ne peut atteindre VERIFIED/VALIDATED que si l'UTILISATEUR
--       AUTHENTIFIÉ APPELANT s'y inscrit lui-même. Un runner qui s'exécute en
--       `service_role` a `auth.uid() = NULL` : il ne peut donc PAS valider.
--       C'est la garantie structurelle que « une extraction IA ne devient
--       jamais automatiquement une donnée VERIFIED ».
--   G4. Les transitions importantes sont tracées dans la brique d'audit
--       EXISTANTE `hermes_os.entity_audit_log` — aucun second système d'audit.
--
-- Réversible : 20260819_pv1_9_rollback.sql

-- ---------------------------------------------------------------------------
-- G4 — écriture d'audit, sur la brique existante
-- ---------------------------------------------------------------------------
create or replace function hermes_os._pv_audit(
  p_tenant_id text, p_entity_type text, p_entity_id uuid,
  p_old jsonb, p_new jsonb, p_summary text
) returns void
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  insert into hermes_os.entity_audit_log
    (tenant_id, entity_id, entity_type, change_type, old_values, new_values,
     change_summary, changed_by, timestamp)
  values
    (p_tenant_id, p_entity_id, p_entity_type, 'UPDATE', p_old, p_new,
     p_summary, coalesce(auth.uid()::text, 'SYSTEM'), (now() at time zone 'UTC'));
end;
$function$;

revoke all on function hermes_os._pv_audit(text, text, uuid, jsonb, jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- G1 — tenant_id immuable
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_tenant_immutable()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'PV_TENANT_IMMUTABLE: le tenant d''une ligne % ne peut pas être modifié (% -> %)',
      tg_table_name, old.tenant_id, new.tenant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- G2 — machine à états du prospect
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_prospect_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from hermes_os.pv_prospect_transitions t
     where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'PV_TRANSITION_INTERDITE: % -> % n''est pas une transition déclarée',
      old.status, new.status using errcode = 'check_violation';
  end if;
  perform hermes_os._pv_audit(
    new.tenant_id, 'pv_prospects', new.id,
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status),
    format('statut prospect %s -> %s', old.status, new.status));
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- G3 — la validation ne peut venir que d'un humain authentifié
-- ---------------------------------------------------------------------------
-- Paramétré par déclencheur : TG_ARGV[0] = colonne de statut,
-- TG_ARGV[1] = valeur « validé », TG_ARGV[2] = colonne de l'acteur,
-- TG_ARGV[3] = colonne d'horodatage.
create or replace function hermes_os.pv_human_validation_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_status_col text := tg_argv[0];
  v_validated  text := tg_argv[1];
  v_actor_col  text := tg_argv[2];
  v_at_col     text := tg_argv[3];
  v_new_status text;
  v_old_status text;
  v_actor      uuid;
  v_at         timestamptz;
  v_uid        uuid := auth.uid();
begin
  v_new_status := to_jsonb(new) ->> v_status_col;
  v_old_status := case when tg_op = 'UPDATE' then to_jsonb(old) ->> v_status_col else null end;

  if v_new_status is distinct from v_validated then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_old_status = v_validated then
    return new;  -- déjà validé, pas une nouvelle validation
  end if;

  v_actor := nullif(to_jsonb(new) ->> v_actor_col, '')::uuid;
  v_at    := nullif(to_jsonb(new) ->> v_at_col, '')::timestamptz;

  if v_uid is null then
    raise exception 'PV_VALIDATION_NON_HUMAINE: % ne peut pas atteindre % sans utilisateur authentifié (auth.uid() est NULL — un runner ou service_role ne valide pas)',
      tg_table_name, v_validated using errcode = 'insufficient_privilege';
  end if;
  if v_actor is null or v_at is null then
    raise exception 'PV_VALIDATION_INCOMPLETE: % exige % et % renseignés pour atteindre %',
      tg_table_name, v_actor_col, v_at_col, v_validated using errcode = 'check_violation';
  end if;
  if v_actor <> v_uid then
    raise exception 'PV_VALIDATION_USURPEE: % doit être l''utilisateur authentifié appelant (% attendu, % fourni)',
      v_actor_col, v_uid, v_actor using errcode = 'insufficient_privilege';
  end if;

  perform hermes_os._pv_audit(
    new.tenant_id, tg_table_name, (to_jsonb(new) ->> 'id')::uuid,
    jsonb_build_object(v_status_col, v_old_status),
    jsonb_build_object(v_status_col, v_new_status, v_actor_col, v_actor),
    format('validation humaine %s -> %s', coalesce(v_old_status,'(création)'), v_new_status));
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Câblage des déclencheurs
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pv_prospects','pv_sites','pv_consumption_profiles','pv_energy_bills',
                           'pv_energy_bill_extractions','pv_studies','pv_study_assumptions','pv_economics']
  loop
    execute format(
      'drop trigger if exists trg_%1$s_tenant_immutable on hermes_os.%1$s;
       create trigger trg_%1$s_tenant_immutable before update on hermes_os.%1$s
         for each row execute function hermes_os.pv_tenant_immutable();', t);
  end loop;
end $$;

drop trigger if exists trg_pv_prospects_status_guard on hermes_os.pv_prospects;
create trigger trg_pv_prospects_status_guard
  before update on hermes_os.pv_prospects
  for each row execute function hermes_os.pv_prospect_status_guard();

drop trigger if exists trg_pv_bills_human_validation on hermes_os.pv_energy_bills;
create trigger trg_pv_bills_human_validation
  before insert or update on hermes_os.pv_energy_bills
  for each row execute function hermes_os.pv_human_validation_guard('status','VERIFIED','verified_by','verified_at');

drop trigger if exists trg_pv_consumption_human_validation on hermes_os.pv_consumption_profiles;
create trigger trg_pv_consumption_human_validation
  before insert or update on hermes_os.pv_consumption_profiles
  for each row execute function hermes_os.pv_human_validation_guard('verification_status','VERIFIED','verified_by','verified_at');

drop trigger if exists trg_pv_studies_human_validation on hermes_os.pv_studies;
create trigger trg_pv_studies_human_validation
  before insert or update on hermes_os.pv_studies
  for each row execute function hermes_os.pv_human_validation_guard('status','VALIDATED','validated_by','validated_at');

drop trigger if exists trg_pv_economics_human_validation on hermes_os.pv_economics;
create trigger trg_pv_economics_human_validation
  before insert or update on hermes_os.pv_economics
  for each row execute function hermes_os.pv_human_validation_guard('status','VERIFIED','verified_by','verified_at');

-- ---------------------------------------------------------------------------
-- Promotion d'une extraction vers la facture — chemin sanctionné
-- ---------------------------------------------------------------------------
-- L'extraction reste la proposition de l'IA ; cette fonction est le SEUL chemin
-- prévu pour en faire une donnée retenue, et elle exige un humain authentifié.
-- Elle ne met PAS la facture en VERIFIED : promouvoir des valeurs et les
-- certifier sont deux gestes distincts.
create or replace function hermes_os.pv_promote_bill_extraction(p_extraction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_x hermes_os.pv_energy_bill_extractions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'status', 'UNAUTHENTICATED');
  end if;

  select * into v_x from hermes_os.pv_energy_bill_extractions where id = p_extraction_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'NOT_FOUND');
  end if;
  if not exists (
    select 1 from hermes_os.user_tenant_permissions p
     where p.user_id = v_uid and p.tenant_id = v_x.tenant_id and p.permission = 'tenant.member'
  ) then
    return jsonb_build_object('ok', false, 'status', 'UNAUTHORIZED');
  end if;
  if v_x.promoted_to_bill then
    return jsonb_build_object('ok', true, 'status', 'ALREADY_PROMOTED', 'bill_id', v_x.bill_id);
  end if;

  update hermes_os.pv_energy_bills b
     set supplier             = coalesce(v_x.supplier, b.supplier),
         period_start         = coalesce(v_x.period_start, b.period_start),
         period_end           = coalesce(v_x.period_end, b.period_end),
         issued_on            = coalesce(v_x.issued_on, b.issued_on),
         amount_ht_eur        = coalesce(v_x.amount_ht_eur, b.amount_ht_eur),
         amount_ttc_eur       = coalesce(v_x.amount_ttc_eur, b.amount_ttc_eur),
         consumption_kwh      = coalesce(v_x.consumption_kwh, b.consumption_kwh),
         subscribed_power_kva = coalesce(v_x.subscribed_power_kva, b.subscribed_power_kva),
         tariff_option        = coalesce(v_x.tariff_option, b.tariff_option),
         delivery_point_ref   = coalesce(v_x.delivery_point_ref, b.delivery_point_ref),
         -- NEEDS_REVIEW, jamais VERIFIED : la promotion propose, elle ne certifie pas.
         status               = 'NEEDS_REVIEW',
         updated_at           = now()
   where b.id = v_x.bill_id and b.tenant_id = v_x.tenant_id;

  update hermes_os.pv_energy_bill_extractions
     set promoted_to_bill = true, promoted_by = v_uid, promoted_at = now()
   where id = p_extraction_id;

  perform hermes_os._pv_audit(
    v_x.tenant_id, 'pv_energy_bills', v_x.bill_id,
    jsonb_build_object('source', 'extraction'),
    jsonb_build_object('status', 'NEEDS_REVIEW', 'extraction_id', p_extraction_id, 'confidence', v_x.confidence),
    'promotion d''une extraction vers la facture (reste à vérifier)');

  return jsonb_build_object('ok', true, 'status', 'PROMOTED', 'bill_id', v_x.bill_id);
end;
$function$;

revoke all on function hermes_os.pv_promote_bill_extraction(uuid) from public;

comment on function hermes_os.pv_promote_bill_extraction(uuid) is
  'PV-1 — promeut les valeurs d une extraction vers sa facture et met celle-ci en NEEDS_REVIEW. Exige un utilisateur authentifie membre du tenant. Ne met JAMAIS la facture en VERIFIED.';
