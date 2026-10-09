-- =============================================================================
-- PROPOSITION (NON APPLIQUEE) : droits herites sur public.social_publish & fonctions Visibility voisines (OVH hermes_os)
-- =============================================================================
-- Constat (reproduit sur la copie restauree de la production) : public.social_publish(uuid), social_generate_content(uuid) et
-- social_plan_content(uuid,text) sont SECURITY DEFINER et EXECUTABLES par ~38 roles, dont anon, authenticated, hermes_web_anon
-- (roles exposes par PostgREST). Aucun appelant legitime n'a ete trouve : ni le tableau de bord, ni un workflow n8n, ni un cron.
-- La garde STOP de la migration v3 protege deja social_publish (refus PUBLISH_STOPPED), mais l'exposition reste inutile.
--
-- Cette proposition ne touche AUCUN autre systeme : elle retire seulement l'EXECUTE aux roles exposes au web.
-- Elle est volontairement separee de la migration v3 : a appliquer UNIQUEMENT apres decision explicite.
--   psql -X -1 -v ON_ERROR_STOP=1 -f 20261009_media_optimizer_v3_ovh_social_publish_acl_PROPOSITION.sql
-- Retour arriere : section ROLLBACK en bas de fichier.
-- =============================================================================

-- Palier 1 (recommande) : roles exposes au web
revoke execute on function public.social_publish(uuid)            from anon, authenticated, hermes_web_anon;
revoke execute on function public.social_generate_content(uuid)   from anon, authenticated, hermes_web_anon;
revoke execute on function public.social_plan_content(uuid, text) from anon, authenticated, hermes_web_anon;

-- Palier 2 (a decider avec le proprietaire de chaque role) : roles applicatifs/agents qui portent le meme droit herite.
-- Non execute ici : leur usage reel n'est pas prouve. Liste : hermes_app, hermes_os_legacy_n8n, hb_n8n, service_role,
-- agent2/7/8/9/10/56_app_role, agent_bi_app_role, int_youtube_app_role, sw1/7/9/10/11/12/13/16/18/19/22/23_app_role,
-- sw20_event_bus_role, youtube_approval_authority_role, supabase_admin, ap2_owner, ap2_app, n8n_wg_test, gotrue_*, *authenticator.
-- revoke execute on function public.social_publish(uuid) from <role>;   -- a lancer role par role, apres verification d'usage

-- ROLLBACK (rend exactement les droits d'origine du palier 1) :
-- grant execute on function public.social_publish(uuid)            to anon, authenticated, hermes_web_anon;
-- grant execute on function public.social_generate_content(uuid)   to anon, authenticated, hermes_web_anon;
-- grant execute on function public.social_plan_content(uuid, text) to anon, authenticated, hermes_web_anon;
