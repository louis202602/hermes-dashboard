-- PHOTO-P0 / ROLLBACK — annule intégralement les lots 1 → 5.
-- (project smubxqorirlfldatzmym)
--
-- Ordre inverse des dépendances. Après exécution, la base ne porte plus aucune
-- trace de la verticale photo et retrouve exactement son état antérieur.
--
-- NE SUPPRIME PAS, volontairement :
--   * `hermes_os.is_active_tenant_member(text)` — créée par la migration
--     `20260813_hermes_chat_attachments_1.sql` ; elle appartient à l'ardoise des
--     pièces jointes du chat et reste utilisée par ses policies. Ce lot l'a
--     seulement RÉUTILISÉE.
--   * le bucket `hermes-chat-attachments` et ses policies.
--
-- Le bucket `hermes-photo-proxies` doit être VIDÉ hors bande avant ce rollback :
-- Postgres refuse de supprimer un bucket non vide.

begin;

-- --- Lot 5 : registres dormants -------------------------------------------
delete from hermes_os.sw23_tenant_budget_config where tenant_id = 'photo-pilote';

delete from hermes_os.sw19_metric_definitions
 where metric_key in ('PHOTO_CULL_MINUTES_PER_100', 'PHOTO_DELIVERY_LEAD_TIME',
                      'PHOTO_UPSELL_ACCEPT_RATE', 'PHOTO_CLIENT_RESPONSE_HOURS');

delete from hermes_os.sw20_subscribers where subscriber_name like 'PHOTO — %';

delete from hermes_os.sw15_policies where action_pattern like 'photo.%';

delete from hermes_os.resolver_runtime_config where action_key like 'photo.%';

-- Fail-soft : une action déjà référencée par une requête de passerelle (ce qui
-- ne peut arriver qu'après un go-live) n'est pas supprimée — la FK protège
-- l'historique d'audit plutôt que de le casser.
delete from hermes_os.agent_action_catalog c
 where c.action_key like 'photo.%'
   and not exists (select 1 from hermes_os.agent_action_requests r
                    where r.action_key = c.action_key);

-- --- Lot 4 : stockage des proxies -----------------------------------------
drop function if exists public.mark_photo_proxy_purged(uuid);
drop function if exists public.list_expired_photo_proxies(integer);
drop function if exists public.mark_photo_proxy_failed(uuid);
drop function if exists public.finalize_photo_proxy(uuid, text, text, bigint);

drop policy if exists "hermes_photo_proxy_update_tenant" on storage.objects;
drop policy if exists "hermes_photo_proxy_select_tenant" on storage.objects;
drop policy if exists "hermes_photo_proxy_insert_tenant" on storage.objects;

delete from storage.buckets where id = 'hermes-photo-proxies';

-- --- Lot 3 : façades -------------------------------------------------------
drop function if exists public.record_photo_consent(uuid, text[], text[], text, text, boolean, boolean, text, uuid, timestamptz);
drop function if exists public.record_photo_culling_instruction(uuid, text, text, text);
drop function if exists public.apply_photo_culling_review(uuid, jsonb, boolean);
drop function if exists public.record_photo_culling_signals(uuid, jsonb);
drop function if exists public.register_photo_import(uuid, jsonb);
drop function if exists public.upsert_photo_session(text, text, timestamptz, text, text, uuid, text);
drop function if exists public.get_photo_value_snapshot();
drop function if exists public.get_photo_consent(uuid);
drop function if exists public.get_photo_clients(integer);
drop function if exists public.get_photo_culling_review(uuid, integer);
drop function if exists public.get_photo_session_detail(uuid);
drop function if exists public.get_photo_sessions(integer);
drop function if exists public.get_photo_today();
drop function if exists public.get_photo_module_state();
drop function if exists hermes_os.photo_guard();

-- --- Lot 2 : services canoniques ------------------------------------------
drop function if exists hermes_os.derive_photo_culling_verdicts(text, uuid);
drop function if exists hermes_os.detect_photo_upsell_opportunities(text, date);
drop function if exists hermes_os.verifier_consentement_photo(text, uuid, text, text, text, timestamptz);
drop function if exists hermes_os.compute_photo_session_state(text, uuid);
drop function if exists hermes_os.photo_session_status_rank(text);

-- --- Lot 1 : schéma (ordre inverse des FK) --------------------------------
drop table if exists hermes_os.photo_marketing_draft;
drop table if exists hermes_os.photo_media_consent;
drop table if exists hermes_os.photo_upsell_opportunities;
drop table if exists hermes_os.photo_galleries;
drop table if exists hermes_os.photo_edit_jobs;
drop table if exists hermes_os.photo_style_profiles;
drop table if exists hermes_os.photo_culling_instructions;
drop table if exists hermes_os.photo_culling_verdicts;
drop table if exists hermes_os.photo_culling_signals;
drop table if exists hermes_os.photo_session_assets;
drop table if exists hermes_os.photo_sessions;
drop table if exists hermes_os.photo_client_members;
drop table if exists hermes_os.photo_clients;
drop table if exists hermes_os.photo_studio_activation;

commit;
