-- =============================================================================
-- PROPOSITION (NON APPLIQUEE EN PRODUCTION) : rotation controlee de la cle du coffre (a lancer APRES vault_hardening)
-- =============================================================================
-- Genere une nouvelle cle dans la base (jamais affichee ni journalisee), re-chiffre TOUS les secrets de vault.secrets, bascule
-- vault.master_key puis verifie, secret par secret, que la valeur en clair est strictement identique (comparaison de hachages).
-- Une seule transaction : toute anomalie annule tout. Les valeurs des secrets (dont la cle API n8n) ne changent pas.
-- Faire une sauvegarde pg_dump complete AVANT et APRES (la sauvegarde d'apres contient la nouvelle cle et les secrets associes).
-- Appliquer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier
-- =============================================================================
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
declare
  v_old text; v_new text; v_bad integer; v_n integer; v_ver integer;
begin
  if to_regclass('vault.master_key') is null then raise exception 'PRECONDITION: appliquer d abord vault_hardening'; end if;
  perform pg_advisory_xact_lock(hashtext('hermes_os.vault_rotation'));
  select key into v_old from vault.master_key where singleton for update;
  if v_old is null then raise exception 'PRECONDITION: master_key vide'; end if;

  create temp table _vr_before on commit drop as
    select id, md5(extensions.pgp_sym_decrypt(encrypted_secret, v_old)) as h from vault.secrets;
  select count(*) into v_n from _vr_before;

  v_new := encode(extensions.gen_random_bytes(32), 'hex');
  update vault.secrets
     set encrypted_secret = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(encrypted_secret, v_old), v_new);
  update vault.master_key set key = v_new, version = version + 1, rotated_at = now() where singleton returning version into v_ver;

  select count(*) into v_bad from vault.secrets s join _vr_before b using (id)
   where md5(extensions.pgp_sym_decrypt(s.encrypted_secret, v_new)) is distinct from b.h;
  if v_bad > 0 then raise exception 'ROTATION: % secret(s) non conserve(s) -> annulation', v_bad; end if;
  if (select count(*) from vault.secrets) <> v_n then raise exception 'ROTATION: nombre de secrets modifie'; end if;
  raise notice 'rotation ok : % secret(s) re-chiffre(s), version de cle %', v_n, v_ver;
end $$;
