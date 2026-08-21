-- 20260820_hermes_migration_governance_1_lock.sql
-- GOUVERNANCE DES MIGRATIONS PRODUCTION — LOT 1 : le verrou.
--
-- Pourquoi ce fichier existe : le 2026-08-19, deux sessions Claude ont écrit sur
-- la même base à quelques minutes d'intervalle (PV-1 à 13:22, PV-2 à 16:10-16:14)
-- pendant qu'une troisième mission auditait cette même base. Aucune n'a mal agi ;
-- aucune ne pouvait savoir. C'est cette cécité mutuelle que le verrou supprime.
--
-- MODE = COOPÉRATIF, et il faut le dire franchement : ce verrou ne PEUT PAS
-- empêcher une écriture. Il n'y a pas d'event trigger DDL, donc un migrateur qui
-- ne le consulte pas passera au travers sans rien casser et sans rien savoir.
-- Ce qu'il apporte est plus modeste et suffisant pour aujourd'hui : rendre
-- l'occupation VISIBLE et OPPOSABLE à qui accepte de regarder. Le jour où cela
-- ne suffira plus, le passage à un event trigger se fera sur base au repos.
--
-- Réversible : 20260820_hermes_migration_governance_9_rollback.sql

-- --- Le verrou -----------------------------------------------------------------
--
-- ONE_ACTIVE_LOCK_MAX n'est pas une convention ici : c'est structurel. La clé
-- primaire porte sur `lock_id`, et un CHECK n'autorise QUE la valeur 'PRODUCTION'.
-- La table ne peut donc physiquement pas contenir deux lignes. Aucun code, aucune
-- fonction, aucun oubli ne peut créer un second verrou actif.
create table if not exists hermes_os.production_migration_lock (
  lock_id      text        not null default 'PRODUCTION',
  owner        text        not null,
  mission      text        not null,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  base_sha     text        not null,

  constraint production_migration_lock_pkey primary key (lock_id),

  -- Le singleton. C'est lui qui garantit ONE_ACTIVE_LOCK_MAX.
  constraint production_migration_lock_singleton check (lock_id = 'PRODUCTION'),

  -- TTL_REQUIRED. Un verrou sans expiration est un interblocage à retardement :
  -- la session qui l'a posé peut disparaître (fin de contexte, container recyclé)
  -- sans jamais le relâcher. On refuse donc l'éternité, dans les deux sens.
  constraint production_migration_lock_ttl_positive check (expires_at > acquired_at),
  constraint production_migration_lock_ttl_bounded
    check (expires_at <= acquired_at + interval '2 hours'),

  -- Un verrou anonyme ne sert à rien : on doit pouvoir dire À QUI parler.
  constraint production_migration_lock_owner_named   check (length(btrim(owner))   > 0),
  constraint production_migration_lock_mission_named check (length(btrim(mission)) > 0),

  -- base_sha n'est pas décoratif : il force le migrateur à déclarer DEPUIS QUEL
  -- code il migre. Un SHA de 40 hexadécimaux, pas « main », pas « HEAD » — ces
  -- mots-là ne désignent rien deux heures plus tard.
  constraint production_migration_lock_base_sha check (base_sha ~ '^[0-9a-f]{40}$')
);

-- --- L'historique ---------------------------------------------------------------
--
-- Un verrou repris après expiration est l'évènement le plus intéressant du
-- système : il signifie qu'une migration a commencé et n'a jamais dit qu'elle
-- était finie. Le perdre serait perdre la seule trace d'une migration
-- possiblement interrompue à mi-chemin.
create table if not exists hermes_os.production_migration_lock_history (
  id          bigint generated always as identity primary key,
  owner       text        not null,
  mission     text        not null,
  base_sha    text        not null,
  acquired_at timestamptz not null,
  expires_at  timestamptz not null,
  ended_at    timestamptz not null default now(),
  outcome     text        not null,
  constraint production_migration_lock_history_outcome
    check (outcome in ('RELEASED', 'RECLAIMED_AFTER_EXPIRY'))
);

create index if not exists idx_production_migration_lock_history_ended
  on hermes_os.production_migration_lock_history (ended_at desc);

-- --- Exposition : aucune ---------------------------------------------------------
--
-- Le verrou est un objet d'exploitation, pas une donnée métier. Il n'a aucune
-- colonne tenant_id et ne doit apparaître dans aucune façade `public`. RLS activée
-- sans aucune policy = deny-all, conformément au socle.
alter table hermes_os.production_migration_lock         enable row level security;
alter table hermes_os.production_migration_lock_history enable row level security;

revoke all on hermes_os.production_migration_lock         from public, anon, authenticated;
revoke all on hermes_os.production_migration_lock_history from public, anon, authenticated;
