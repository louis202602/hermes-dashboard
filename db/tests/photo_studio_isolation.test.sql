-- Assertions de sécurité REPRODUCTIBLES pour la verticale Hermès Studio (PHOTO-P0).
--
-- ⚠️ CES ASSERTIONS N'ONT PAS ENCORE ÉTÉ EXÉCUTÉES : les migrations
--    `20260818_photo_studio_*` ne sont pas appliquées (GO_LIVE = NO). Ce fichier
--    est le protocole de vérification à jouer AU MOMENT de la première migration,
--    exactement comme `hermes_chat_attachments_rls.test.sql` l'a été pour les
--    pièces jointes. Aucun résultat n'est présenté ici comme constaté.
--
-- Comment l'exécuter (psql, rôle propriétaire des migrations) :
--   \i db/tests/photo_studio_isolation.test.sql
--
-- Tout se déroule dans UNE transaction ROLLBACK : aucune donnée ne persiste.
-- L'usurpation se fait via `request.jwt.claims` (qui pilote `auth.uid()`).
--
-- Remplacer :member par un vrai `tenant.member` et :other par un uuid sans tenant.

\set member '00000000-0000-0000-0000-000000000000'
\set other  '99999999-9999-9999-9999-999999999999'
\set tenant 'heliosolar'

begin;

-- ---------------------------------------------------------------------------
-- A. PORTILLON D'ACTIVATION — par défaut, la verticale n'existe pour personne.
-- ---------------------------------------------------------------------------
create function pg_temp.a_gate() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; r jsonb;
  member text := current_setting('hermes.test_member', true);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', member, 'role', 'authenticated')::text, true);

  -- Aucune ligne d'activation ⇒ enabled = false.
  r := public.get_photo_module_state();
  out := out || jsonb_build_object('gate_default_enabled', (r->>'enabled')::bool);   -- attendu false

  -- Toutes les façades refusent tant que la verticale n'est pas activée.
  out := out || jsonb_build_object('today_disabled', public.get_photo_today()->>'resolution_status');       -- MODULE_DISABLED
  out := out || jsonb_build_object('sessions_disabled', public.get_photo_sessions(10)->>'resolution_status'); -- MODULE_DISABLED
  out := out || jsonb_build_object('upsert_disabled', public.upsert_photo_session('X','FAMILLE')->>'code');   -- MODULE_DISABLED
  return out;
end;
$$;

select set_config('hermes.test_member', :'member', false);
select pg_temp.a_gate() as a_gate;

-- ---------------------------------------------------------------------------
-- B. ISOLATION TENANT — activation réelle, puis vérification stricte.
-- ---------------------------------------------------------------------------
insert into hermes_os.photo_studio_activation(tenant_id, enabled, activated_by)
values (:'tenant', true, 'test');

create function pg_temp.b_isolation() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; r jsonb; sid uuid; cid uuid;
  member text := current_setting('hermes.test_member', true);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', member, 'role', 'authenticated')::text, true);

  -- Création : le client est créé au passage, la séance est idempotente.
  r := public.upsert_photo_session('Famille Test','FAMILLE', now(), 'Séance test', 'Studio');
  sid := (r->>'session_id')::uuid;
  cid := (r->>'client_id')::uuid;
  out := out || jsonb_build_object('create_ok', (r->>'ok')::bool);                    -- true
  r := public.upsert_photo_session('Famille Test','FAMILLE', now(), 'Séance test', 'Studio');
  out := out || jsonb_build_object('create_idempotent', (r->>'session_id')::uuid = sid); -- true

  -- Mise à jour de statut : AUCUN client fantôme ne doit être créé.
  r := public.upsert_photo_session(null, null, null, null, null, sid, 'SHOT');
  out := out || jsonb_build_object('update_ok', (r->>'ok')::bool);                    -- true
  out := out || jsonb_build_object('no_ghost_client',
    (select count(*) from hermes_os.photo_clients where tenant_id = current_setting('hermes.test_tenant', true))); -- 1

  -- Import : les références seulement, jamais de RAW.
  r := public.register_photo_import(sid, jsonb_build_array(
    jsonb_build_object('source_reference','/DCIM/a.arw','original_filename','a.arw',
                       'file_sha256', repeat('a',64), 'captured_at', now()::text),
    jsonb_build_object('source_reference','/DCIM/b.arw','original_filename','b.arw',
                       'file_sha256', repeat('b',64), 'captured_at', now()::text)));
  out := out || jsonb_build_object('import_inserted', r->>'inserted');                -- 2
  r := public.register_photo_import(sid, jsonb_build_array(
    jsonb_build_object('source_reference','/DCIM/a.arw','original_filename','a.arw',
                       'file_sha256', repeat('a',64))));
  out := out || jsonb_build_object('import_idempotent', r->>'inserted');              -- 0

  -- Un asset_id d'un autre tenant/séance est simplement ignoré (fail-closed).
  r := public.record_photo_culling_signals(sid, jsonb_build_array(
    jsonb_build_object('asset_id', gen_random_uuid(), 'sharpness', 0.9, 'clip_low', 0,
                       'clip_high', 0, 'brightness', 0.5,
                       'ahash', repeat('0',16), 'dhash', repeat('0',16))));
  out := out || jsonb_build_object('signals_forged_asset_ignored', r->>'signals_written'); -- 0

  -- Consigne PROTECT : le verdict ne peut pas devenir un rejet.
  r := public.record_photo_culling_instruction(sid, 'garde toutes les photos de a', 'PROTECT', 'a.arw');
  out := out || jsonb_build_object('instruction_ok', (r->>'ok')::bool);               -- true

  -- Séance d'un autre tenant : indistinguable d'une séance inexistante.
  r := public.get_photo_session_detail(gen_random_uuid());
  out := out || jsonb_build_object('unknown_session_found', (r->>'found')::bool);     -- false
  return out;
end;
$$;

select set_config('hermes.test_tenant', :'tenant', false);
select pg_temp.b_isolation() as b_isolation;

-- ---------------------------------------------------------------------------
-- C. NON-MEMBRE ET NON AUTHENTIFIÉ — fail-closed, aucune fuite.
-- ---------------------------------------------------------------------------
create function pg_temp.c_denied() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb;
begin
  -- Utilisateur sans tenant.
  perform set_config('request.jwt.claims',
    json_build_object('sub','99999999-9999-9999-9999-999999999999','role','authenticated')::text, true);
  out := out || jsonb_build_object('nonmember_today', public.get_photo_today()->>'resolution_status');  -- NO_TENANT
  out := out || jsonb_build_object('nonmember_sessions',
    jsonb_array_length(public.get_photo_sessions(10)->'sessions'));                                     -- 0
  out := out || jsonb_build_object('nonmember_write', public.upsert_photo_session('X','FAMILLE')->>'code'); -- NO_TENANT

  -- Non authentifié.
  perform set_config('request.jwt.claims', '', true);
  out := out || jsonb_build_object('anon_module', public.get_photo_module_state()->>'resolution_status'); -- UNAUTHENTICATED
  out := out || jsonb_build_object('anon_today', public.get_photo_today()->>'resolution_status');         -- UNAUTHENTICATED
  out := out || jsonb_build_object('anon_write', public.upsert_photo_session('X','FAMILLE')->>'code');    -- UNAUTHENTICATED
  return out;
end;
$$;

select pg_temp.c_denied() as c_denied;

-- ---------------------------------------------------------------------------
-- D. CONSENTEMENT — verrou mineurs, fail-closed.
-- ---------------------------------------------------------------------------
create function pg_temp.d_consent() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; r jsonb; cid uuid;
  member text := current_setting('hermes.test_member', true);
  tenant text := current_setting('hermes.test_tenant', true);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', member, 'role', 'authenticated')::text, true);
  select id into cid from hermes_os.photo_clients where tenant_id = tenant limit 1;

  -- Mineurs SANS représentant légal ⇒ refusé par la façade.
  r := public.record_photo_consent(cid, array['PORTFOLIO'], array['PHOTO'], 'FACE', 'CITY',
                                   true, false, 'v2026-01');
  out := out || jsonb_build_object('minor_without_guardian', r->>'code');            -- MINOR_WITHOUT_GUARDIAN

  -- Avec représentant légal ⇒ accepté.
  r := public.record_photo_consent(cid, array['PORTFOLIO'], array['PHOTO'], 'FACE', 'CITY',
                                   true, true, 'v2026-01');
  out := out || jsonb_build_object('minor_with_guardian_ok', (r->>'ok')::bool);      -- true

  -- Le gate refuse un usage NON accordé (fail-closed).
  out := out || jsonb_build_object('gate_unknown_use_case',
    hermes_os.verifier_consentement_photo(tenant, cid, 'PUBLICITE', 'PHOTO', 'FACE')->>'code'); -- NO_CONSENT
  -- Le gate refuse une portée d'identité plus large que celle accordée.
  out := out || jsonb_build_object('gate_scope_ok',
    (hermes_os.verifier_consentement_photo(tenant, cid, 'PORTFOLIO', 'PHOTO', 'SILHOUETTE')->>'allowed')::bool); -- true
  -- Aucun consentement pour un client inconnu.
  out := out || jsonb_build_object('gate_unknown_client',
    hermes_os.verifier_consentement_photo(tenant, gen_random_uuid(), 'PORTFOLIO', 'PHOTO', 'NONE')->>'code'); -- NO_CONSENT
  return out;
end;
$$;

select pg_temp.d_consent() as d_consent;

-- ---------------------------------------------------------------------------
-- E. AUCUNE SUPPRESSION DE PHOTO — la propriété la plus importante du produit.
-- ---------------------------------------------------------------------------
create function pg_temp.e_no_delete() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; before_count int; after_count int; sid uuid; aid uuid;
  member text := current_setting('hermes.test_member', true);
  tenant text := current_setting('hermes.test_tenant', true);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', member, 'role', 'authenticated')::text, true);
  select id into sid from hermes_os.photo_sessions where tenant_id = tenant limit 1;
  select count(*) into before_count from hermes_os.photo_session_assets where session_id = sid;
  select id into aid from hermes_os.photo_session_assets where session_id = sid limit 1;

  -- « Écarter » toutes les photos…
  perform public.apply_photo_culling_review(sid,
    (select jsonb_agg(jsonb_build_object('asset_id', a.id, 'decision', 'DISCARD'))
       from hermes_os.photo_session_assets a where a.session_id = sid), false);
  select count(*) into after_count from hermes_os.photo_session_assets where session_id = sid;
  out := out || jsonb_build_object('assets_preserved', before_count = after_count);   -- true

  -- …et même la purge du proxy conserve la ligne d'inventaire.
  perform public.mark_photo_proxy_purged(aid);
  out := out || jsonb_build_object('asset_still_present',
    exists(select 1 from hermes_os.photo_session_assets where id = aid));             -- true
  out := out || jsonb_build_object('proxy_forgotten',
    (select proxy_path is null from hermes_os.photo_session_assets where id = aid));  -- true
  return out;
end;
$$;

select pg_temp.e_no_delete() as e_no_delete;

-- ---------------------------------------------------------------------------
-- F. DORMANCE DE LA PASSERELLE — une action photo reste inexécutable.
-- ---------------------------------------------------------------------------
create function pg_temp.f_dormant() returns jsonb language plpgsql as $$
declare out jsonb := '{}'::jsonb; r jsonb;
  member text := current_setting('hermes.test_member', true);
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', member, 'role', 'authenticated')::text, true);
  -- Même authentifié, membre et autorisé : `enabled=false` ⇒ UNKNOWN_ACTION.
  r := public.request_agent_action('photo.culling.start', '{"session_id":"x"}'::jsonb, gen_random_uuid()::text);
  out := out || jsonb_build_object('dormant_action_status', r->>'status');            -- UNKNOWN_ACTION
  -- La capacité n'est donc pas offerte au dashboard.
  out := out || jsonb_build_object('not_in_capabilities',
    not exists (select 1 from jsonb_array_elements(public.get_available_capabilities()->'capabilities') c
                 where c->>'action_key' like 'photo.%'));                             -- true
  return out;
end;
$$;

select pg_temp.f_dormant() as f_dormant;

-- Rien n'est conservé.
rollback;
