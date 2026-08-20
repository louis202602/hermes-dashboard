-- 20260820_hermes_migration_governance_2_functions.sql
-- GOUVERNANCE DES MIGRATIONS PRODUCTION — LOT 2 : acquérir, relâcher, consulter.
--
-- Réversible : 20260820_hermes_migration_governance_9_rollback.sql

-- --- Acquisition ----------------------------------------------------------------
--
-- Le piège de tout verrou en table : deux sessions lisent « libre » en même temps
-- et insèrent toutes les deux. La clé primaire en ferait échouer une, mais avec une
-- ERREUR de contrainte — illisible, et qui annule la transaction de l'appelant.
-- On sérialise donc les acquisitions par un verrou consultatif de transaction :
-- la deuxième session attend, relit, et reçoit un verdict propre.
create or replace function hermes_os.acquire_production_migration_lock(
  p_owner        text,
  p_mission      text,
  p_base_sha     text,
  p_ttl_minutes  int default 30
) returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cur    hermes_os.production_migration_lock%rowtype;
  v_expiry timestamptz;
begin
  -- TTL_REQUIRED, borné des deux côtés. Moins d'une minute est une erreur de
  -- frappe ; plus de deux heures est un verrou qu'on oubliera.
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 120 then
    return jsonb_build_object(
      'ok', false, 'status', 'INVALID_TTL',
      'detail', 'p_ttl_minutes doit etre compris entre 1 et 120');
  end if;
  if p_base_sha is null or p_base_sha !~ '^[0-9a-f]{40}$' then
    return jsonb_build_object(
      'ok', false, 'status', 'INVALID_BASE_SHA',
      'detail', 'base_sha doit etre un SHA de commit complet (40 hexadecimaux)');
  end if;
  if p_owner is null or btrim(p_owner) = '' or p_mission is null or btrim(p_mission) = '' then
    return jsonb_build_object(
      'ok', false, 'status', 'INVALID_IDENTITY',
      'detail', 'owner et mission sont obligatoires');
  end if;

  perform pg_advisory_xact_lock(hashtext('hermes_os.production_migration_lock'));

  select * into v_cur from hermes_os.production_migration_lock where lock_id = 'PRODUCTION';
  v_expiry := now() + make_interval(mins => p_ttl_minutes);

  if found and v_cur.expires_at > now() then
    -- Verrou vivant.
    if v_cur.owner = p_owner then
      -- Réentrant : le même propriétaire prolonge. Utile quand une migration
      -- longue approche de son TTL — on préfère une prolongation explicite à un
      -- TTL initial gonflé « au cas où ».
      update hermes_os.production_migration_lock
         set expires_at = v_expiry, mission = p_mission, base_sha = p_base_sha
       where lock_id = 'PRODUCTION';
      return jsonb_build_object(
        'ok', true, 'status', 'ALREADY_HELD_EXTENDED',
        'owner', v_cur.owner, 'expires_at', v_expiry);
    end if;

    -- Occupé par quelqu'un d'autre. C'est le verdict que la procédure attend.
    return jsonb_build_object(
      'ok', false, 'status', 'STOP_CONCURRENT_MIGRATION',
      'holder', v_cur.owner, 'holder_mission', v_cur.mission,
      'holder_base_sha', v_cur.base_sha,
      'acquired_at', v_cur.acquired_at, 'expires_at', v_cur.expires_at,
      'seconds_remaining', ceil(extract(epoch from (v_cur.expires_at - now()))));
  end if;

  if found then
    -- EXPIRED_LOCK_CAN_BE_RECLAIMED. On archive AVANT de reprendre : un verrou
    -- expiré signale une migration qui n'a jamais dit qu'elle avait fini, et
    -- c'est précisément ce qu'il faut pouvoir relire ensuite.
    insert into hermes_os.production_migration_lock_history
      (owner, mission, base_sha, acquired_at, expires_at, outcome)
    values (v_cur.owner, v_cur.mission, v_cur.base_sha, v_cur.acquired_at,
            v_cur.expires_at, 'RECLAIMED_AFTER_EXPIRY');
    delete from hermes_os.production_migration_lock where lock_id = 'PRODUCTION';

    insert into hermes_os.production_migration_lock
      (lock_id, owner, mission, acquired_at, expires_at, base_sha)
    values ('PRODUCTION', p_owner, p_mission, now(), v_expiry, p_base_sha);

    return jsonb_build_object(
      'ok', true, 'status', 'ACQUIRED_AFTER_EXPIRY',
      'expires_at', v_expiry,
      'reclaimed_from', v_cur.owner,
      'reclaimed_mission', v_cur.mission,
      'warning', 'Le detenteur precedent n a jamais relache : verifier que sa migration est complete avant d ecrire.');
  end if;

  insert into hermes_os.production_migration_lock
    (lock_id, owner, mission, acquired_at, expires_at, base_sha)
  values ('PRODUCTION', p_owner, p_mission, now(), v_expiry, p_base_sha);

  return jsonb_build_object('ok', true, 'status', 'ACQUIRED', 'expires_at', v_expiry);
end;
$function$;

-- --- Libération ------------------------------------------------------------------
create or replace function hermes_os.release_production_migration_lock(p_owner text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cur hermes_os.production_migration_lock%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('hermes_os.production_migration_lock'));

  select * into v_cur from hermes_os.production_migration_lock where lock_id = 'PRODUCTION';
  if not found then
    return jsonb_build_object('ok', true, 'status', 'NO_LOCK');
  end if;

  -- On ne relâche pas le verrou de quelqu'un d'autre tant qu'il est vivant.
  -- Une fois expiré, il n'appartient plus à personne : n'importe qui peut nettoyer.
  if v_cur.owner <> p_owner and v_cur.expires_at > now() then
    return jsonb_build_object(
      'ok', false, 'status', 'NOT_OWNER',
      'holder', v_cur.owner, 'expires_at', v_cur.expires_at);
  end if;

  insert into hermes_os.production_migration_lock_history
    (owner, mission, base_sha, acquired_at, expires_at, outcome)
  values (v_cur.owner, v_cur.mission, v_cur.base_sha, v_cur.acquired_at, v_cur.expires_at,
          case when v_cur.expires_at > now() then 'RELEASED' else 'RECLAIMED_AFTER_EXPIRY' end);

  delete from hermes_os.production_migration_lock where lock_id = 'PRODUCTION';

  return jsonb_build_object('ok', true, 'status', 'RELEASED', 'released_owner', v_cur.owner);
end;
$function$;

-- --- Consultation ----------------------------------------------------------------
-- Lecture seule, sans effet de bord : c'est l'étape 1 de la procédure, celle qu'on
-- fait AVANT de décider quoi que ce soit.
create or replace function hermes_os.production_migration_lock_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cur hermes_os.production_migration_lock%rowtype;
begin
  select * into v_cur from hermes_os.production_migration_lock where lock_id = 'PRODUCTION';
  if not found then
    return jsonb_build_object('locked', false, 'status', 'FREE');
  end if;
  if v_cur.expires_at <= now() then
    return jsonb_build_object(
      'locked', false, 'status', 'EXPIRED_RECLAIMABLE',
      'stale_owner', v_cur.owner, 'stale_mission', v_cur.mission,
      'expired_at', v_cur.expires_at);
  end if;
  return jsonb_build_object(
    'locked', true, 'status', 'HELD',
    'owner', v_cur.owner, 'mission', v_cur.mission, 'base_sha', v_cur.base_sha,
    'acquired_at', v_cur.acquired_at, 'expires_at', v_cur.expires_at,
    'seconds_remaining', ceil(extract(epoch from (v_cur.expires_at - now()))));
end;
$function$;

-- --- Exposition : aucune ----------------------------------------------------------
-- Ce sont des fonctions d'exploitation. Aucun utilisateur de l'application ne doit
-- pouvoir poser, lire ou lever le verrou de migration : ce n'est pas une capacité
-- métier, et aucune façade `public` ne les appelle.
revoke all on function hermes_os.acquire_production_migration_lock(text, text, text, int)
  from public, anon, authenticated;
revoke all on function hermes_os.release_production_migration_lock(text)
  from public, anon, authenticated;
revoke all on function hermes_os.production_migration_lock_status()
  from public, anon, authenticated;
