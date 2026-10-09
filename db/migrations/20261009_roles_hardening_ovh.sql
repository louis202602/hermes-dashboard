-- =============================================================================
-- PROPOSITION (NON APPLIQUEE EN PRODUCTION) : privileges minimaux pour authenticator / staging_authenticator (OVH hermes_os)
-- =============================================================================
-- Constat (reproduit) :
--  * staging_authenticator est membre en HERITAGE (inherit=true) de anon, authenticated et service_role : un compte de la staging
--    peut lire vault.decrypted_secrets de la PRODUCTION (CONNECT sur hermes_os + pg_hba 127.0.0.1 scram pour tout role).
--  * authenticator et staging_authenticator portent chacun 15 EXECUTE directs (dont public.social_publish, social_generate_content,
--    social_plan_content) qu'aucun appel PostgREST n'utilise : PostgREST bascule (SET ROLE) vers anon/authenticated/service_role.
-- Correction : (1) staging_authenticator NOINHERIT (SET ROLE vers anon/authenticated/service_role reste possible) ;
--              (2) retrait des EXECUTE directs des deux roles de connexion.
-- Complement hors SQL (pg_hba.conf) : voir ..._pg_hba_PROPOSITION.md (staging_authenticator refuse sur la base de production).
-- Retour arriere exact : ..._roles_hardening_ovh_rollback.sql (genere a partir de l'etat teste).
-- Appliquer : psql -X -1 -v ON_ERROR_STOP=1 -f ce fichier   (idempotent)
-- =============================================================================
set local lock_timeout = '5s';

alter role staging_authenticator noinherit;
alter role authenticator noinherit;

-- PostgreSQL 16+ : l'attribut NOINHERIT du role ne change PAS les appartenances deja accordees (chacune porte son propre
-- inherit_option, fige a l'octroi). Constate sur la copie : apres ALTER ROLE ... NOINHERIT, staging_authenticator heritait encore
-- de anon/authenticated/service_role. On repasse donc chaque appartenance en INHERIT FALSE (SET ROLE reste possible, ce que
-- PostgREST utilise).
do $$
declare r record;
begin
  for r in
    select g.rolname as grp, m.rolname as mem, gr.rolname as grantor
      from pg_auth_members am
      join pg_roles g  on g.oid  = am.roleid
      join pg_roles m  on m.oid  = am.member
      join pg_roles gr on gr.oid = am.grantor
     where m.rolname in ('authenticator', 'staging_authenticator') and am.inherit_option
  loop
    execute format('grant %I to %I with inherit false granted by %I', r.grp, r.mem, r.grantor);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn, ro.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join pg_roles ro
     where ro.rolname in ('authenticator', 'staging_authenticator')
       and n.nspname in ('public', 'hermes_os')
       and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = ro.oid and a.privilege_type = 'EXECUTE')
  loop
    execute format('revoke execute on function %s from %I', r.fn, r.rolname);
  end loop;
end $$;
