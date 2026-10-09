-- =============================================================================
-- ROLLBACK de 20261009_vault_hardening_ovh.sql : remet la cle (courante, rotation incluse) dans le reglage de base et restaure
-- les definitions d'origine de vault.create_secret et vault.decrypted_secrets, puis supprime vault._k() et vault.master_key.
-- Les secrets restent coherents avec la cle (la cle courante est reportee telle quelle). Idempotent.
-- Appliquer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier
-- =============================================================================
set local lock_timeout = '5s';
do $$
declare k text;
begin
  if to_regclass('vault.master_key') is not null then
    select key into k from vault.master_key where singleton;
    execute format('alter database %I set "hermes.vault_key" to %L', current_database(), k);
  end if;
end $$;

-- definitions d'origine (reglage de base)
create or replace view vault.decrypted_secrets as
  select id, name, description, extensions.pgp_sym_decrypt(encrypted_secret, current_setting('hermes.vault_key'::text, true)) as decrypted_secret, created_at, updated_at
  from vault.secrets;

create or replace function vault.create_secret(p_name text, p_secret text, p_description text default null)
  returns uuid language plpgsql security definer
as $function$
declare v_id uuid;
begin
  insert into vault.secrets(name, description, encrypted_secret)
  values (p_name, p_description, extensions.pgp_sym_encrypt(p_secret, current_setting('hermes.vault_key')))
  on conflict (name) do update set encrypted_secret = excluded.encrypted_secret,
    description = coalesce(excluded.description, vault.secrets.description), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;

drop function if exists vault._decrypt(bytea);
drop function if exists vault._k();
drop table if exists vault.master_key;
