-- PHOTO-P0 / 3 — Façades `public.*` (SECURITY DEFINER).
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO.
--
-- Contrat identique à toutes les façades Hermès existantes :
--   * SECURITY DEFINER, `search_path` verrouillé ;
--   * `REVOKE ALL … FROM public` / `GRANT EXECUTE … TO authenticated` ;
--   * tenant résolu SERVER-SIDE par `hermes_os.resolve_active_tenant(null)` —
--     AUCUN `tenant_id` n'est accepté depuis le client, sur aucune fonction ;
--   * fail-closed : non authentifié / sans tenant / verticale non activée /
--     ressource d'un autre tenant ⇒ résultat vide + code, jamais de fuite ;
--   * résultats BORNÉS (LIMIT) ⇒ aucun payload non borné.
--
-- Pourquoi ces écritures ne passent PAS par `request_agent_action` : la table
-- `agent_action_catalog` porte la contrainte `CHECK (target_kind='N8N_WORKFLOW')`,
-- donc une action dont le runner est une fonction Postgres n'y est pas
-- représentable sans modifier une contrainte existante. Ces écritures suivent
-- donc le patron déjà utilisé par `upsert_dashboard_user_preferences`,
-- `upsert_chantier_geocode` et `finalize_hermes_attachment` : écriture pilotée par
-- l'utilisateur, via façade fail-closed. Les actions pilotées par un AGENT
-- (tri VLM, édition, galerie, envois, marketing) restent, elles, réservées à la
-- passerelle unique — voir le lot 5.

begin;

-- ---------------------------------------------------------------------------
-- 0. Garde commune : authentification + tenant + activation de la verticale.
--    Une seule implémentation, appelée par toutes les façades.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_guard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text;
  v_status text;
  v_enabled boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', coalesce(v_status, 'NO_TENANT'));
  end if;
  select a.enabled into v_enabled
    from hermes_os.photo_studio_activation a where a.tenant_id = v_tenant;
  if coalesce(v_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'MODULE_DISABLED', 'tenant', v_tenant);
  end if;
  return jsonb_build_object('ok', true, 'code', 'OK', 'tenant', v_tenant, 'uid', v_uid);
end;
$function$;

revoke all on function hermes_os.photo_guard() from public;

-- ---------------------------------------------------------------------------
-- 1. LECTURE — état d'activation de la verticale pour le tenant appelant.
--    Seule façade qui n'exige PAS l'activation (c'est elle qui la rapporte).
--    Le dashboard s'en sert pour n'afficher la verticale que si elle existe.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_module_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_enabled boolean;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status', 'UNAUTHENTICATED', 'enabled', false);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status, 'NO_TENANT'), 'enabled', false);
  end if;
  select a.enabled into v_enabled
    from hermes_os.photo_studio_activation a where a.tenant_id = v_tenant;
  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_tenant,
    'enabled', coalesce(v_enabled, false));
end;
$function$;

revoke all on function public.get_photo_module_state() from public;
grant execute on function public.get_photo_module_state() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. LECTURE — « Aujourd'hui » : les 5 chiffres + les séances qui attendent.
--    Agrégats uniquement, tous dérivés de lignes réelles du tenant appelant.
--    Aucun chiffre n'est inventé : sans donnée, les compteurs valent 0.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_today()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text;
  v_sessions_active int; v_awaiting_review int; v_to_import int;
  v_assets_pending int; v_opportunities int; v_potential numeric;
  v_list jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'counters', '{}'::jsonb, 'sessions', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select count(*) filter (where s.status not in ('CLOSED', 'CANCELLED')),
         count(*) filter (where s.status = 'IMPORTED'),
         count(*) filter (where s.status = 'SHOT')
    into v_sessions_active, v_to_import, v_awaiting_review
    from hermes_os.photo_sessions s where s.tenant_id = v_t;

  select count(*) into v_assets_pending
    from hermes_os.photo_culling_verdicts v
   where v.tenant_id = v_t and v.human_decision is null and v.pass_no = 1;

  select count(*), coalesce(sum(o.estimated_amount_eur), 0)
    into v_opportunities, v_potential
    from hermes_os.photo_upsell_opportunities o
   where o.tenant_id = v_t and o.status = 'DETECTED';

  select coalesce(jsonb_agg(x.obj order by x.d desc nulls last), '[]'::jsonb) into v_list from (
    select jsonb_build_object(
      'session_id', s.id, 'title', coalesce(s.title, c.display_name),
      'client_name', c.display_name, 'session_type', s.session_type,
      'status', s.status, 'scheduled_at', s.scheduled_at,
      'state', hermes_os.compute_photo_session_state(v_t, s.id)) obj,
      s.scheduled_at d
      from hermes_os.photo_sessions s
      join hermes_os.photo_clients c on c.id = s.client_id and c.tenant_id = s.tenant_id
     where s.tenant_id = v_t and s.status not in ('CLOSED', 'CANCELLED')
     order by s.scheduled_at desc nulls last
     limit 8) x;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_t,
    'counters', jsonb_build_object(
      'sessions_active', coalesce(v_sessions_active, 0),
      'sessions_to_import', coalesce(v_to_import, 0),
      'sessions_awaiting_shot', coalesce(v_awaiting_review, 0),
      'photos_awaiting_review', coalesce(v_assets_pending, 0),
      'upsell_opportunities', coalesce(v_opportunities, 0),
      'upsell_potential_eur', coalesce(v_potential, 0)),
    'sessions', v_list,
    'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_today() from public;
grant execute on function public.get_photo_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. LECTURE — liste des séances (bornée, tenant appelant).
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_sessions(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'sessions', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(x.obj order by x.d desc nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'session_id', s.id, 'client_id', s.client_id, 'client_name', c.display_name,
      'title', s.title, 'session_type', s.session_type, 'status', s.status,
      'scheduled_at', s.scheduled_at, 'location_label', s.location_label,
      'quote_amount_eur', s.quote_amount_eur,
      'asset_count', (select count(*) from hermes_os.photo_session_assets a
                       where a.tenant_id = v_t and a.session_id = s.id),
      'undecided_count', (select count(*) from hermes_os.photo_culling_verdicts v
                           where v.tenant_id = v_t and v.session_id = s.id
                             and v.pass_no = 1 and v.human_decision is null)) obj,
      s.scheduled_at d
      from hermes_os.photo_sessions s
      join hermes_os.photo_clients c on c.id = s.client_id and c.tenant_id = s.tenant_id
     where s.tenant_id = v_t
     order by s.scheduled_at desc nulls last
     limit v_lim) x;

  return jsonb_build_object('resolution_status', 'OK', 'tenant_id', v_t,
    'sessions', v_rows, 'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_sessions(integer) from public;
grant execute on function public.get_photo_sessions(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. LECTURE — détail d'une séance + état Studio Director.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_session_detail(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_s hermes_os.photo_sessions%rowtype; v_client jsonb; v_instr jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_s from hermes_os.photo_sessions
   where id = p_session_id and tenant_id = v_t;
  if not found then
    -- Une séance d'un autre tenant est indistinguable d'une séance inexistante.
    return jsonb_build_object('resolution_status', 'OK', 'found', false);
  end if;

  select jsonb_build_object('client_id', c.id, 'display_name', c.display_name,
           'preferred_channel', c.preferred_channel, 'lifetime_value_eur', c.lifetime_value_eur)
    into v_client
    from hermes_os.photo_clients c where c.id = v_s.client_id and c.tenant_id = v_t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'instruction', i.instruction, 'kind', i.kind,
           'keyword', i.keyword, 'is_global', i.session_id is null,
           'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    into v_instr
    from hermes_os.photo_culling_instructions i
   where i.tenant_id = v_t and (i.session_id = p_session_id or i.session_id is null);

  return jsonb_build_object(
    'resolution_status', 'OK', 'found', true, 'tenant_id', v_t,
    'session', jsonb_build_object(
      'session_id', v_s.id, 'title', v_s.title, 'session_type', v_s.session_type,
      'status', v_s.status, 'scheduled_at', v_s.scheduled_at,
      'location_label', v_s.location_label, 'notes', v_s.notes,
      'quote_amount_eur', v_s.quote_amount_eur,
      'deposit_paid_eur', v_s.deposit_paid_eur, 'balance_paid_eur', v_s.balance_paid_eur,
      'shot_at', v_s.shot_at, 'imported_at', v_s.imported_at,
      'culled_at', v_s.culled_at, 'selection_approved_at', v_s.selection_approved_at,
      'delivered_at', v_s.delivered_at),
    'client', v_client,
    'instructions', v_instr,
    'state', hermes_os.compute_photo_session_state(v_t, p_session_id),
    'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_session_detail(uuid) from public;
grant execute on function public.get_photo_session_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. LECTURE — grille de revue du tri. Renvoie le chemin du proxy pour que le
--    serveur signe une URL courte ; jamais d'URL publique.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_culling_review(
  p_session_id uuid,
  p_limit      integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_rows jsonb; v_exists boolean;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select exists (select 1 from hermes_os.photo_sessions
                  where id = p_session_id and tenant_id = v_t) into v_exists;
  if not v_exists then
    return jsonb_build_object('resolution_status', 'OK', 'found', false, 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.obj order by x.burst, x.q desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'asset_id', a.id, 'filename', a.original_filename,
      'captured_at', a.captured_at, 'proxy_path', a.proxy_path,
      'thumb_path', a.thumb_path, 'proxy_status', a.proxy_status,
      'verdict', v.verdict, 'score', v.score, 'reason_code', v.reason_code,
      'is_protected', v.is_protected, 'human_decision', v.human_decision,
      'sharpness', g.sharpness, 'clip_low', g.clip_low, 'clip_high', g.clip_high) obj,
      coalesce(g.burst_group, 0) burst, coalesce(v.score, 0) q
      from hermes_os.photo_session_assets a
      left join hermes_os.photo_culling_verdicts v
        on v.asset_id = a.id and v.tenant_id = v_t and v.pass_no = 1
      left join hermes_os.photo_culling_signals g
        on g.asset_id = a.id and g.tenant_id = v_t
     where a.tenant_id = v_t and a.session_id = p_session_id
     limit v_lim) x;

  return jsonb_build_object('resolution_status', 'OK', 'found', true,
    'session_id', p_session_id, 'items', v_rows,
    'state', hermes_os.compute_photo_session_state(v_t, p_session_id),
    'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_culling_review(uuid, integer) from public;
grant execute on function public.get_photo_culling_review(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. LECTURE — clients (bornée). Inclut le statut de consentement, jamais son
--    contenu de preuve.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_clients(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'clients', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(x.obj order by x.n), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'client_id', c.id, 'display_name', c.display_name, 'status', c.status,
      'preferred_channel', c.preferred_channel,
      'lifetime_value_eur', c.lifetime_value_eur, 'follow_up_date', c.follow_up_date,
      'session_count', (select count(*) from hermes_os.photo_sessions s
                         where s.tenant_id = v_t and s.client_id = c.id),
      'last_session_at', (select max(s.scheduled_at) from hermes_os.photo_sessions s
                           where s.tenant_id = v_t and s.client_id = c.id),
      'member_count', (select count(*) from hermes_os.photo_client_members m
                        where m.tenant_id = v_t and m.client_id = c.id),
      'has_active_consent', exists (
        select 1 from hermes_os.photo_media_consent mc
         where mc.tenant_id = v_t and mc.client_id = c.id and mc.status = 'GRANTED'
           and mc.revoked_at is null and (mc.expires_at is null or mc.expires_at > now()))) obj,
      lower(c.display_name) n
      from hermes_os.photo_clients c
     where c.tenant_id = v_t
     order by lower(c.display_name)
     limit v_lim) x;

  return jsonb_build_object('resolution_status', 'OK', 'tenant_id', v_t,
    'clients', v_rows, 'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_clients(integer) from public;
grant execute on function public.get_photo_clients(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. LECTURE — consentements d'un client (sans la preuve brute).
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_consent(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'consents', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'consent_id', c.id, 'status', c.status,
           'use_cases_granted', to_jsonb(c.use_cases_granted),
           'media_types_granted', to_jsonb(c.media_types_granted),
           'identity_scope', c.identity_scope, 'location_scope', c.location_scope,
           'includes_minors', c.includes_minors, 'guardian_consent', c.guardian_consent,
           'consent_text_version', c.consent_text_version,
           'granted_at', c.granted_at, 'revoked_at', c.revoked_at, 'expires_at', c.expires_at
         ) order by c.granted_at desc), '[]'::jsonb)
    into v_rows
    from hermes_os.photo_media_consent c
   where c.tenant_id = v_t and c.client_id = p_client_id;

  return jsonb_build_object('resolution_status', 'OK', 'consents', v_rows, 'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_photo_consent(uuid) from public;
grant execute on function public.get_photo_consent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. LECTURE — instantané de valeur (SW19). Honnête par construction :
--    sans baseline mesurée, `time_saved_minutes` est NULL et l'UI affiche
--    « Non mesuré » — jamais un chiffre fabriqué.
-- ---------------------------------------------------------------------------
create or replace function public.get_photo_value_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text;
  v_baseline numeric; v_baseline_unit text;
  v_reviewed int; v_sessions_done int; v_supervision_s numeric;
  v_saved numeric := null;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  -- Baseline réelle de tri (minutes / 100 photos), mesurée en semaine 1.
  select b.baseline_value, b.baseline_unit into v_baseline, v_baseline_unit
    from hermes_os.sw19_baselines b
   where b.tenant_id = v_t and b.metric_key = 'PHOTO_CULL_MINUTES_PER_100'
   order by b.created_at desc limit 1;

  select count(*) into v_reviewed
    from hermes_os.photo_culling_verdicts v
   where v.tenant_id = v_t and v.human_decision is not null;

  select count(*) into v_sessions_done
    from hermes_os.photo_sessions s
   where s.tenant_id = v_t
     and hermes_os.photo_session_status_rank(s.status) >= 7;

  select coalesce(sum(h.duration_seconds), 0) into v_supervision_s
    from hermes_os.sw19_human_interventions h
   where h.tenant_id = v_t;

  if v_baseline is not null and v_reviewed > 0 then
    v_saved := round((v_baseline * v_reviewed / 100.0)::numeric, 2);
  end if;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_t,
    'baseline', case when v_baseline is null
                     then jsonb_build_object('provenance', 'NOT_MEASURED')
                     else jsonb_build_object('provenance', 'REAL',
                            'metric_key', 'PHOTO_CULL_MINUTES_PER_100',
                            'value', v_baseline, 'unit', coalesce(v_baseline_unit, 'minutes')) end,
    'photos_reviewed', v_reviewed,
    'sessions_processed', v_sessions_done,
    'gross_time_saved_minutes', v_saved,
    'supervision_minutes', round((v_supervision_s / 60.0)::numeric, 2),
    -- Net = brut − supervision. Sans baseline, tout reste NULL (honnête).
    'net_time_saved_minutes', case when v_saved is null then null
                                   else round((v_saved - v_supervision_s / 60.0)::numeric, 2) end,
    'provenance', case when v_baseline is null then 'UNAVAILABLE' else 'DERIVED' end);
end;
$function$;

revoke all on function public.get_photo_value_snapshot() from public;
grant execute on function public.get_photo_value_snapshot() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. ÉCRITURE — créer/mettre à jour une séance (+ le client au besoin).
--    Idempotent sur (tenant, client, type, date).
-- ---------------------------------------------------------------------------
create or replace function public.upsert_photo_session(
  p_client_name  text,
  p_session_type text,
  p_scheduled_at timestamptz default null,
  p_title        text default null,
  p_location     text default null,
  p_session_id   uuid default null,
  p_status       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_client uuid; v_id uuid; v_name text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_status is not null and hermes_os.photo_session_status_rank(p_status) is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  end if;

  -- MISE À JOUR d'une séance existante : ni le client ni le type ne sont touchés,
  -- et surtout AUCUN client n'est créé au passage (sinon un simple changement de
  -- statut fabriquerait une fiche client fantôme).
  if p_session_id is not null then
    update hermes_os.photo_sessions s
       set title = coalesce(p_title, s.title),
           scheduled_at = coalesce(p_scheduled_at, s.scheduled_at),
           location_label = coalesce(p_location, s.location_label),
           status = coalesce(p_status, s.status),
           shot_at = case when coalesce(p_status, s.status) = 'SHOT' and s.shot_at is null
                          then now() else s.shot_at end,
           updated_at = now()
     where s.id = p_session_id and s.tenant_id = v_t
     returning s.id, s.client_id into v_id, v_client;
    if v_id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    return jsonb_build_object('ok', true, 'code', 'UPDATED', 'session_id', v_id, 'client_id', v_client);
  end if;

  -- CRÉATION : le nom du client et le type sont alors obligatoires.
  v_name := btrim(coalesce(p_client_name, ''));
  if v_name = '' or length(v_name) > 200 then
    return jsonb_build_object('ok', false, 'code', 'BAD_CLIENT_NAME');
  end if;
  if p_session_type is null or p_session_type not in
     ('MARIAGE','FAMILLE','GROSSESSE','NAISSANCE','PORTRAIT','EVENEMENT','ENTREPRISE','AUTRE') then
    return jsonb_build_object('ok', false, 'code', 'BAD_SESSION_TYPE');
  end if;

  -- Client : réutilisé s'il existe (clé naturelle), créé sinon.
  select c.id into v_client from hermes_os.photo_clients c
   where c.tenant_id = v_t and lower(btrim(c.display_name)) = lower(v_name)
   limit 1;
  if v_client is null then
    insert into hermes_os.photo_clients (tenant_id, display_name)
    values (v_t, v_name)
    returning id into v_client;
  end if;

  insert into hermes_os.photo_sessions
    (tenant_id, client_id, session_type, title, scheduled_at, location_label, status)
  values
    (v_t, v_client, p_session_type, p_title, p_scheduled_at, p_location, coalesce(p_status, 'DRAFT'))
  on conflict (tenant_id, client_id, session_type, coalesce(scheduled_at, 'epoch'::timestamptz))
  do update set title = coalesce(excluded.title, hermes_os.photo_sessions.title),
                updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'UPSERTED', 'session_id', v_id, 'client_id', v_client);
end;
$function$;

revoke all on function public.upsert_photo_session(text, text, timestamptz, text, text, uuid, text) from public;
grant execute on function public.upsert_photo_session(text, text, timestamptz, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. ÉCRITURE — enregistrer un lot d'import (RÉFÉRENCES seulement).
--     `p_assets` = [{source_reference, original_filename, file_sha256,
--                    captured_at, camera_model, iso, width, height}, …]
--     Idempotent par (session, sha256) : rejouer le même lot ne duplique rien.
--     Borné à 2000 éléments par appel.
-- ---------------------------------------------------------------------------
create or replace function public.register_photo_import(
  p_session_id uuid,
  p_assets     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_exists boolean; v_n int; v_inserted int := 0; v_map jsonb := '[]'::jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_assets is null or jsonb_typeof(p_assets) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'BAD_PAYLOAD');
  end if;
  v_n := jsonb_array_length(p_assets);
  if v_n = 0 then
    return jsonb_build_object('ok', true, 'code', 'OK', 'inserted', 0, 'requested', 0);
  end if;
  if v_n > 2000 then
    return jsonb_build_object('ok', false, 'code', 'BATCH_TOO_LARGE', 'requested', v_n);
  end if;

  select exists (select 1 from hermes_os.photo_sessions
                  where id = p_session_id and tenant_id = v_t) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  with src as (
    select e ->> 'source_reference'  as source_reference,
           e ->> 'original_filename' as original_filename,
           lower(e ->> 'file_sha256') as file_sha256,
           nullif(e ->> 'captured_at', '')::timestamptz as captured_at,
           nullif(e ->> 'camera_model', '') as camera_model,
           nullif(e ->> 'lens_model', '') as lens_model,
           nullif(e ->> 'iso', '')::int as iso,
           nullif(e ->> 'width', '')::int as width,
           nullif(e ->> 'height', '')::int as height
      from jsonb_array_elements(p_assets) e
  ), valid as (
    select * from src
     where source_reference is not null and length(source_reference) between 1 and 1024
       and original_filename is not null and length(original_filename) between 1 and 512
       and file_sha256 ~ '^[0-9a-f]{64}$'
  ), ins as (
    insert into hermes_os.photo_session_assets
      (tenant_id, session_id, source_reference, original_filename, file_sha256,
       captured_at, camera_model, lens_model, iso, width, height)
    select v_t, p_session_id, v.source_reference, v.original_filename, v.file_sha256,
           v.captured_at, v.camera_model, v.lens_model, v.iso, v.width, v.height
      from valid v
    on conflict (tenant_id, session_id, file_sha256) do nothing
    returning 1)
  select count(*) into v_inserted from ins;

  update hermes_os.photo_sessions
     set status = case when hermes_os.photo_session_status_rank(status) < 5 then 'IMPORTED' else status end,
         imported_at = coalesce(imported_at, now()),
         updated_at = now()
   where id = p_session_id and tenant_id = v_t;

  -- Correspondance sha256 → asset_id pour que le navigateur sache où téléverser
  -- les proxies. Bornée à la séance ET au tenant : aucune fuite d'identifiant.
  select coalesce(jsonb_agg(jsonb_build_object('file_sha256', a.file_sha256, 'asset_id', a.id)), '[]'::jsonb)
    into v_map
    from hermes_os.photo_session_assets a
   where a.tenant_id = v_t and a.session_id = p_session_id
     and a.file_sha256 in (
       select lower(e ->> 'file_sha256') from jsonb_array_elements(p_assets) e);

  return jsonb_build_object('ok', true, 'code', 'OK',
    'requested', v_n, 'inserted', v_inserted, 'skipped', v_n - v_inserted,
    'assets', v_map);
end;
$function$;

revoke all on function public.register_photo_import(uuid, jsonb) from public;
grant execute on function public.register_photo_import(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. ÉCRITURE — mesures de la passe 1 (calculées dans le navigateur), puis
--     dérivation des verdicts par l'UNIQUE service métier. Le client n'envoie
--     que des MESURES : aucun seuil, aucun verdict ne vient du client.
--     `p_signals` = [{asset_id, sharpness, clip_low, clip_high, brightness,
--                     ahash, dhash}, …]
-- ---------------------------------------------------------------------------
create or replace function public.record_photo_culling_signals(
  p_session_id uuid,
  p_signals    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_exists boolean; v_n int; v_written int := 0; v_derived jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_signals is null or jsonb_typeof(p_signals) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'BAD_PAYLOAD');
  end if;
  v_n := jsonb_array_length(p_signals);
  if v_n > 2000 then
    return jsonb_build_object('ok', false, 'code', 'BATCH_TOO_LARGE', 'requested', v_n);
  end if;

  select exists (select 1 from hermes_os.photo_sessions
                  where id = p_session_id and tenant_id = v_t) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_n > 0 then
    with src as (
      select (e ->> 'asset_id')::uuid as asset_id,
             least(greatest((e ->> 'sharpness')::numeric, 0), 1) as sharpness,
             least(greatest((e ->> 'clip_low')::numeric, 0), 1) as clip_low,
             least(greatest((e ->> 'clip_high')::numeric, 0), 1) as clip_high,
             least(greatest((e ->> 'brightness')::numeric, 0), 1) as brightness,
             lower(e ->> 'ahash') as ahash,
             lower(e ->> 'dhash') as dhash
        from jsonb_array_elements(p_signals) e
    ), valid as (
      -- L'asset DOIT appartenir à cette séance ET à ce tenant : un asset_id forgé
      -- pointant ailleurs est simplement ignoré (fail-closed, sans fuite).
      select s.* from src s
       join hermes_os.photo_session_assets a
         on a.id = s.asset_id and a.tenant_id = v_t and a.session_id = p_session_id
       where s.ahash ~ '^[0-9a-f]{16}$' and s.dhash ~ '^[0-9a-f]{16}$'
    ), ins as (
      insert into hermes_os.photo_culling_signals
        (asset_id, tenant_id, session_id, sharpness, clip_low, clip_high, brightness, ahash, dhash)
      select v.asset_id, v_t, p_session_id, v.sharpness, v.clip_low, v.clip_high,
             v.brightness, v.ahash, v.dhash
        from valid v
      on conflict (asset_id) do update
        set sharpness = excluded.sharpness, clip_low = excluded.clip_low,
            clip_high = excluded.clip_high, brightness = excluded.brightness,
            ahash = excluded.ahash, dhash = excluded.dhash, computed_at = now()
      returning 1)
    select count(*) into v_written from ins;
  end if;

  v_derived := hermes_os.derive_photo_culling_verdicts(v_t, p_session_id);

  update hermes_os.photo_sessions
     set status = case when hermes_os.photo_session_status_rank(status) < 6 then 'CULLED' else status end,
         culled_at = coalesce(culled_at, now()),
         updated_at = now()
   where id = p_session_id and tenant_id = v_t
     and exists (select 1 from hermes_os.photo_culling_verdicts v
                  where v.tenant_id = v_t and v.session_id = p_session_id);

  return jsonb_build_object('ok', true, 'code', 'OK',
    'requested', v_n, 'signals_written', v_written, 'verdicts', v_derived);
end;
$function$;

revoke all on function public.record_photo_culling_signals(uuid, jsonb) from public;
grant execute on function public.record_photo_culling_signals(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. ÉCRITURE — décisions humaines de tri.
--     `p_decisions` = [{asset_id, decision:'KEEP'|'DISCARD'}, …]
--     `DISCARD` = hors sélection. AUCUNE suppression de fichier n'est déclenchée
--     ici, ni ailleurs : il n'existe aucun DELETE sur `photo_session_assets`.
--     `p_approve_selection` fait passer la séance en SELECTION_APPROVED, mais
--     seulement quand plus aucune photo n'est indécise.
-- ---------------------------------------------------------------------------
create or replace function public.apply_photo_culling_review(
  p_session_id        uuid,
  p_decisions         jsonb,
  p_approve_selection boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_exists boolean; v_n int; v_applied int := 0; v_undecided int;
  v_approved boolean := false;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'BAD_PAYLOAD');
  end if;
  v_n := jsonb_array_length(p_decisions);
  if v_n > 2000 then
    return jsonb_build_object('ok', false, 'code', 'BATCH_TOO_LARGE', 'requested', v_n);
  end if;

  select exists (select 1 from hermes_os.photo_sessions
                  where id = p_session_id and tenant_id = v_t) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_n > 0 then
    with src as (
      select (e ->> 'asset_id')::uuid as asset_id, upper(e ->> 'decision') as decision
        from jsonb_array_elements(p_decisions) e
    ), upd as (
      update hermes_os.photo_culling_verdicts v
         set human_decision = s.decision, decided_at = now()
        from src s
       where v.asset_id = s.asset_id
         and v.tenant_id = v_t
         and v.session_id = p_session_id
         and v.pass_no = 1
         and s.decision in ('KEEP', 'DISCARD')
      returning 1)
    select count(*) into v_applied from upd;
  end if;

  select count(*) into v_undecided
    from hermes_os.photo_culling_verdicts v
   where v.tenant_id = v_t and v.session_id = p_session_id
     and v.pass_no = 1 and v.human_decision is null;

  if p_approve_selection and v_undecided = 0 then
    update hermes_os.photo_sessions
       set status = case when hermes_os.photo_session_status_rank(status) < 7
                         then 'SELECTION_APPROVED' else status end,
           selection_approved_at = coalesce(selection_approved_at, now()),
           updated_at = now()
     where id = p_session_id and tenant_id = v_t;
    v_approved := true;
  end if;

  return jsonb_build_object('ok', true, 'code', 'OK',
    'requested', v_n, 'applied', v_applied,
    'undecided_remaining', v_undecided, 'selection_approved', v_approved);
end;
$function$;

revoke all on function public.apply_photo_culling_review(uuid, jsonb, boolean) from public;
grant execute on function public.apply_photo_culling_review(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. ÉCRITURE — consigne de tri en langage naturel.
--     La façade est l'AUTORITÉ sur ce qui est stocké : le `kind` est re-validé,
--     le mot-clé borné. Une consigne PROTECT ne peut jamais produire un rejet
--     (garanti par `derive_photo_culling_verdicts`).
-- ---------------------------------------------------------------------------
create or replace function public.record_photo_culling_instruction(
  p_session_id  uuid,
  p_instruction text,
  p_kind        text,
  p_keyword     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_exists boolean; v_id uuid; v_fp text; v_kw text; v_txt text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  v_txt := btrim(coalesce(p_instruction, ''));
  v_kw := btrim(coalesce(p_keyword, ''));
  if v_txt = '' or length(v_txt) > 500 then
    return jsonb_build_object('ok', false, 'code', 'BAD_INSTRUCTION');
  end if;
  if v_kw = '' or length(v_kw) > 100 then
    return jsonb_build_object('ok', false, 'code', 'BAD_KEYWORD');
  end if;
  if p_kind is null or p_kind not in ('PROTECT', 'PREFER', 'EXCLUDE') then
    return jsonb_build_object('ok', false, 'code', 'BAD_KIND');
  end if;

  if p_session_id is not null then
    select exists (select 1 from hermes_os.photo_sessions
                    where id = p_session_id and tenant_id = v_t) into v_exists;
    if not v_exists then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  end if;

  v_fp := encode(sha256(convert_to(p_kind || '|' || lower(v_kw), 'UTF8')), 'hex');

  insert into hermes_os.photo_culling_instructions
    (tenant_id, session_id, instruction, kind, keyword, fingerprint)
  values (v_t, p_session_id, v_txt, p_kind, v_kw, v_fp)
  on conflict (tenant_id, session_id, fingerprint) do update
    set instruction = excluded.instruction
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'OK', 'instruction_id', v_id);
end;
$function$;

revoke all on function public.record_photo_culling_instruction(uuid, text, text, text) from public;
grant execute on function public.record_photo_culling_instruction(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. ÉCRITURE — enregistrer un consentement média.
--     Verrou mineurs re-vérifié ici EN PLUS de la contrainte de table.
-- ---------------------------------------------------------------------------
create or replace function public.record_photo_consent(
  p_client_id            uuid,
  p_use_cases            text[],
  p_media_types          text[],
  p_identity_scope       text,
  p_location_scope       text,
  p_includes_minors      boolean,
  p_guardian_consent     boolean,
  p_consent_text_version text,
  p_session_id           uuid default null,
  p_expires_at           timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.photo_guard();
  v_t text; v_exists boolean; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select exists (select 1 from hermes_os.photo_clients
                  where id = p_client_id and tenant_id = v_t) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p_identity_scope is null or p_identity_scope not in ('NONE', 'SILHOUETTE', 'FACE') then
    return jsonb_build_object('ok', false, 'code', 'BAD_IDENTITY_SCOPE');
  end if;
  if p_location_scope is null or p_location_scope not in ('NONE', 'CITY', 'EXACT') then
    return jsonb_build_object('ok', false, 'code', 'BAD_LOCATION_SCOPE');
  end if;
  if coalesce(p_includes_minors, false) and not coalesce(p_guardian_consent, false) then
    return jsonb_build_object('ok', false, 'code', 'MINOR_WITHOUT_GUARDIAN');
  end if;
  if p_consent_text_version is null or length(btrim(p_consent_text_version)) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'code', 'BAD_CONSENT_VERSION');
  end if;

  insert into hermes_os.photo_media_consent
    (tenant_id, client_id, session_id, use_cases_granted, media_types_granted,
     identity_scope, location_scope, includes_minors, guardian_consent,
     consent_text_version, expires_at, proof)
  values
    (v_t, p_client_id, p_session_id,
     coalesce(p_use_cases, '{}'), coalesce(p_media_types, '{}'),
     p_identity_scope, p_location_scope,
     coalesce(p_includes_minors, false), coalesce(p_guardian_consent, false),
     btrim(p_consent_text_version), p_expires_at,
     jsonb_build_object('recorded_by', (v_g->>'uid'), 'recorded_at', now()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'OK', 'consent_id', v_id);
end;
$function$;

revoke all on function public.record_photo_consent(uuid, text[], text[], text, text, boolean, boolean, text, uuid, timestamptz) from public;
grant execute on function public.record_photo_consent(uuid, text[], text[], text, text, boolean, boolean, text, uuid, timestamptz) to authenticated;

commit;
