-- HERMÈS / INTÉGRATIONS — ROLLBACK des migrations integrations_1 et _2.
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉ (les migrations concernées ne le sont pas non plus).
--
-- NE SUPPRIME PAS, volontairement :
--   * l'extension `supabase_vault` ni le schéma `vault` — ils PRÉEXISTENT et
--     appartiennent à Supabase ; ces migrations les ont seulement RÉUTILISÉS ;
--   * les secrets éventuellement déposés dans `vault.secrets` — leur
--     destruction est une opération d'infrastructure délibérée, pas un effet
--     de bord d'un rollback de schéma ;
--   * `hermes_os.photo_phone_config` et `photo_calls` — ils appartiennent à la
--     migration `photo_studio_7`, qui a son propre rollback.

begin;

-- --- integrations_2 : provisionnement téléphonique --------------------------
drop function if exists public.get_phone_status();
drop function if exists hermes_os.compute_phone_costs(text, date, date);
drop function if exists hermes_os.phone_is_operational(text);
drop table if exists hermes_os.phone_provisioning;

-- --- integrations_1 : connexions OAuth --------------------------------------
drop function if exists hermes_os.integration_is_usable(text, text);
drop function if exists hermes_os.complete_integration_connection(text, uuid, text, text[], timestamptz);
drop function if exists public.revoke_integration_connection(text);
drop function if exists public.begin_integration_connection(text, text);
drop function if exists public.get_tenant_integrations();
drop function if exists hermes_os.integration_guard();

drop table if exists hermes_os.tenant_integration_oauth_states;
drop table if exists hermes_os.tenant_integration_connections;
drop table if exists hermes_os.integration_providers;

commit;
