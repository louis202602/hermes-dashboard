-- =============================================================================
-- PROPOSITION (NON APPLIQUEE EN PRODUCTION) : durcissement du coffre vault (OVH hermes_os)
-- =============================================================================
-- Constat : la cle de chiffrement du coffre est un reglage de base (ALTER DATABASE ... SET "hermes.vault_key"), donc lisible par
-- TOUT role SQL (current_setting, SHOW, pg_settings, pg_db_role_setting) et ecrite en clair dans chaque sauvegarde pg_dump.
-- Correction : la cle passe dans une table reservee au proprietaire (vault.master_key, RLS sans politique, aucun droit), lue par une
-- fonction SECURITY DEFINER non executable par les autres roles. vault.create_secret et vault.decrypted_secrets l'utilisent ;
-- le reglage de base est ensuite supprime. Aucun secret n'est modifie ici (voir ..._vault_rotation_ovh.sql pour la rotation).
-- Les sessions deja ouvertes n'ont rien a rejouer : les fonctions lisent la table a chaque appel (pas de coordination de pools).
-- Appliquer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier   (idempotent). Retour arriere : ..._vault_hardening_ovh_rollback.sql
-- =============================================================================
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('vault.secrets') is null then raise exception 'PRECONDITION: vault.secrets absent'; end if;
  if nullif(current_setting('hermes.vault_key', true), '') is null and to_regclass('vault.master_key') is null then
    raise exception 'PRECONDITION: ni reglage hermes.vault_key ni table vault.master_key';
  end if;
end $$;

create table if not exists vault.master_key (
  singleton  boolean primary key default true check (singleton),
  key        text not null check (length(key) >= 32),
  version    integer not null default 1,
  rotated_at timestamptz not null default now()
);
alter table vault.master_key enable row level security;   -- aucune politique : refus pour tout role non proprietaire
alter table vault.master_key force row level security;
do $$
declare r record;
begin
  execute 'revoke all on vault.master_key from public';
  for r in select rolname from pg_roles where rolname !~ '^pg_' and rolname <> current_user loop
    execute format('revoke all on vault.master_key from %I', r.rolname);
  end loop;
  if not exists (select 1 from vault.master_key) then
    insert into vault.master_key (key) values (current_setting('hermes.vault_key'));
  end if;
end $$;

create or replace function vault._k() returns text
  language sql stable security definer set search_path = pg_catalog
as $f$ select key from vault.master_key where singleton $f$;
do $$
declare r record;
begin
  execute 'revoke all on function vault._k() from public';
  for r in select rolname from pg_roles where rolname !~ '^pg_' and rolname <> current_user loop
    execute format('revoke all on function vault._k() from %I', r.rolname);
  end loop;
end $$;

create or replace function vault.create_secret(p_name text, p_secret text, p_description text default null)
  returns uuid language plpgsql security definer set search_path = pg_catalog, vault
as $function$
declare v_id uuid;
begin
  insert into vault.secrets(name, description, encrypted_secret)
  values (p_name, p_description, extensions.pgp_sym_encrypt(p_secret, vault._k()))
  on conflict (name) do update set encrypted_secret = excluded.encrypted_secret,
    description = coalesce(excluded.description, vault.secrets.description), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;

-- Les fonctions appelees par une vue sont verifiees avec les droits de l'APPELANT : la vue ne peut donc pas appeler vault._k() (reservee
-- au proprietaire). On passe par vault._decrypt(), SECURITY DEFINER, qui dechiffre sans jamais renvoyer la cle ; seul service_role
-- (le seul lecteur legitime de la vue aujourd'hui) peut l'executer.
create or replace function vault._decrypt(p_enc bytea) returns text
  language sql stable security definer set search_path = pg_catalog
as $f$ select extensions.pgp_sym_decrypt(p_enc, vault._k()) $f$;
do $$
declare r record;
begin
  execute 'revoke all on function vault._decrypt(bytea) from public';
  for r in select rolname from pg_roles where rolname !~ '^pg_' and rolname <> current_user loop
    execute format('revoke all on function vault._decrypt(bytea) from %I', r.rolname);
  end loop;
  execute 'grant execute on function vault._decrypt(bytea) to service_role';
end $$;

create or replace view vault.decrypted_secrets as
  select id, name, description, vault._decrypt(encrypted_secret) as decrypted_secret, created_at, updated_at
  from vault.secrets;

-- le reglage de base n'est plus lu par personne : on le supprime (nouvelles sessions uniquement)
do $$
begin
  if exists (select 1 from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase and s.setrole = 0
              where d.datname = current_database() and exists (select 1 from unnest(s.setconfig) c where c like 'hermes.vault_key=%')) then
    execute format('alter database %I reset "hermes.vault_key"', current_database());
  end if;
end $$;

-- controle : chaque secret se dechiffre avec la cle de la table
do $$
declare bad integer;
begin
  select count(*) into bad from vault.decrypted_secrets where decrypted_secret is null;
  if bad > 0 then raise exception 'VERIF: % secret(s) non dechiffrable(s)', bad; end if;
end $$;
