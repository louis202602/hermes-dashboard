-- PHOTO-P0 / 2 — Services métier canoniques (schéma privé `hermes_os`).
-- (project smubxqorirlfldatzmym)
--
-- ✅ APPLIQUÉE en production le 2026-08-18 (migration `photo_studio_2_services`,
--    version 20260818210410). GO_LIVE = NO — la verticale reste DORMANTE.
--    Vérifié après application : 6 fonctions, owner postgres, 0 EXECUTE pour
--    `authenticated`/`anon`, trigger marketing en place.
--
-- UNE seule implémentation métier par règle, exactement comme
-- `hermes_os.record_btp_suivi_progress` : les façades du lot 3, et plus tard les
-- consumers n8n, appellent CES fonctions — il n'existe pas de second moteur.
--
-- Toutes sont DÉTERMINISTES : aucun LLM, aucun appel externe, aucune écriture.
-- Le « Studio Director » du rapport est exactement `compute_photo_session_state` :
-- une projection SQL, pas un second orchestrateur.

begin;

-- ---------------------------------------------------------------------------
-- 1. Rang canonique d'un statut de séance (machine à états linéaire).
--    CANCELLED = -1 (hors ligne de progression). Immutable ⇒ indexable.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_session_status_rank(p_status text)
returns integer
language sql
immutable
as $function$
  select case p_status
    when 'DRAFT'              then 0
    when 'QUALIFIED'          then 1
    when 'QUOTED'             then 2
    when 'BOOKED'             then 3
    when 'SHOT'               then 4
    when 'IMPORTED'           then 5
    when 'CULLED'             then 6
    when 'SELECTION_APPROVED' then 7
    when 'EDIT_PREPARED'      then 8
    when 'EDIT_APPROVED'      then 9
    when 'EXPORTED'           then 10
    when 'GALLERY_DRAFT'      then 11
    when 'DELIVERED'          then 12
    when 'CLOSED'             then 13
    when 'CANCELLED'          then -1
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. STUDIO DIRECTOR — état complet d'une séance + prochaine action.
--
--    Entièrement dérivé de lignes réelles. `next_action` est un CODE stable
--    (l'UI le traduit), jamais une phrase générée. `blocked_by` dit honnêtement
--    quand l'étape suivante dépend d'un consumer n8n encore indisponible —
--    l'UI n'affiche donc jamais une action qu'Hermès ne peut pas exécuter.
--
--    Le tenant est TOUJOURS passé par l'appelant (façade) qui l'a résolu
--    server-side ; cette fonction ne fait jamais confiance à un id client.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.compute_photo_session_state(
  p_tenant     text,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_s            hermes_os.photo_sessions%rowtype;
  v_assets       int := 0;
  v_proxy_ready  int := 0;
  v_proxy_failed int := 0;
  v_signals      int := 0;
  v_verdicts     int := 0;
  v_undecided    int := 0;
  v_kept         int := 0;
  v_discarded    int := 0;
  v_protected    int := 0;
  v_best         int := 0;
  v_instructions int := 0;
  v_rank         int;
  v_next         text;
  v_blocked      text := null;
begin
  if p_tenant is null or p_session_id is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  select * into v_s
    from hermes_os.photo_sessions
   where id = p_session_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select count(*),
         count(*) filter (where proxy_status = 'READY'),
         count(*) filter (where proxy_status = 'FAILED')
    into v_assets, v_proxy_ready, v_proxy_failed
    from hermes_os.photo_session_assets
   where tenant_id = p_tenant and session_id = p_session_id;

  select count(*) into v_signals
    from hermes_os.photo_culling_signals
   where tenant_id = p_tenant and session_id = p_session_id;

  select count(*),
         count(*) filter (where human_decision is null),
         count(*) filter (where human_decision = 'KEEP'),
         count(*) filter (where human_decision = 'DISCARD'),
         count(*) filter (where is_protected),
         count(*) filter (where verdict = 'BEST_OF_SERIES')
    into v_verdicts, v_undecided, v_kept, v_discarded, v_protected, v_best
    from hermes_os.photo_culling_verdicts
   where tenant_id = p_tenant and session_id = p_session_id and pass_no = 1;

  select count(*) into v_instructions
    from hermes_os.photo_culling_instructions
   where tenant_id = p_tenant and (session_id = p_session_id or session_id is null);

  v_rank := hermes_os.photo_session_status_rank(v_s.status);

  -- Prochaine action : première condition vraie gagne (ordre = ordre du workflow).
  if v_s.status = 'CANCELLED' then
    v_next := 'NONE';
  elsif v_rank < 4 then
    v_next := 'MARK_SHOT';
  elsif v_assets = 0 then
    v_next := 'IMPORT_ASSETS';
  elsif v_proxy_ready < v_assets - v_proxy_failed then
    v_next := 'FINISH_IMPORT';
  elsif v_signals < v_proxy_ready then
    v_next := 'RUN_CULLING_PASS1';
  elsif v_verdicts = 0 then
    v_next := 'RUN_CULLING_PASS1';
  elsif v_undecided > 0 then
    v_next := 'REVIEW_CULLING';
  elsif v_rank < 7 then
    v_next := 'APPROVE_SELECTION';
  else
    -- Au-delà de la sélection validée, chaque étape a besoin d'un runner n8n.
    v_next := case v_rank
      when 7 then 'PREPARE_EDIT'
      when 8 then 'APPROVE_EDIT'
      when 9 then 'EXPORT'
      when 10 then 'PREPARE_GALLERY'
      when 11 then 'PUBLISH_GALLERY'
      when 12 then 'CLOSE_SESSION'
      else 'NONE'
    end;
    if v_next <> 'NONE' and v_next <> 'CLOSE_SESSION' then
      v_blocked := 'N8N_CONSUMER_REQUIRED';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_s.id,
    'status', v_s.status,
    'status_rank', v_rank,
    'session_type', v_s.session_type,
    'scheduled_at', v_s.scheduled_at,
    'next_action', v_next,
    'blocked_by', v_blocked,
    'counters', jsonb_build_object(
      'assets', v_assets,
      'proxy_ready', v_proxy_ready,
      'proxy_failed', v_proxy_failed,
      'signals', v_signals,
      'verdicts', v_verdicts,
      'undecided', v_undecided,
      'kept', v_kept,
      'discarded', v_discarded,
      'protected', v_protected,
      'best_of_series', v_best,
      'instructions', v_instructions
    ),
    'provenance', 'REAL'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. GATE CONSENTEMENT — fail-closed. Copie du contrat
--    `peinture_verifier_consentement_media`, adaptée au client photo.
--
--    Renvoie allowed=true UNIQUEMENT si un consentement GRANTED, non révoqué,
--    non expiré, couvre à la fois le use_case, le type de média ET une portée
--    d'identité au moins aussi large que celle demandée. Toute absence, tout
--    doute, toute erreur ⇒ allowed=false. Aucun appelant ne peut « forcer ».
-- ---------------------------------------------------------------------------
create or replace function hermes_os.verifier_consentement_photo(
  p_tenant         text,
  p_client_id      uuid,
  p_use_case       text,
  p_media_type     text,
  p_identity_scope text default 'NONE',
  p_at             timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_c        hermes_os.photo_media_consent%rowtype;
  v_want     int;
  v_have     int;
begin
  if p_tenant is null or p_client_id is null or p_use_case is null or p_media_type is null then
    return jsonb_build_object('allowed', false, 'code', 'BAD_ARGUMENTS');
  end if;

  v_want := case upper(coalesce(p_identity_scope, 'NONE'))
              when 'NONE' then 0 when 'SILHOUETTE' then 1 when 'FACE' then 2 else null end;
  if v_want is null then
    return jsonb_build_object('allowed', false, 'code', 'BAD_IDENTITY_SCOPE');
  end if;

  select * into v_c
    from hermes_os.photo_media_consent c
   where c.tenant_id = p_tenant
     and c.client_id = p_client_id
     and c.status = 'GRANTED'
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > p_at)
     and p_use_case = any (c.use_cases_granted)
     and p_media_type = any (c.media_types_granted)
   order by c.granted_at desc
   limit 1;

  if not found then
    return jsonb_build_object('allowed', false, 'code', 'NO_CONSENT');
  end if;

  v_have := case v_c.identity_scope when 'NONE' then 0 when 'SILHOUETTE' then 1 when 'FACE' then 2 end;
  if v_have < v_want then
    return jsonb_build_object('allowed', false, 'code', 'IDENTITY_SCOPE_EXCEEDED',
      'granted_identity_scope', v_c.identity_scope);
  end if;

  -- Verrou mineurs : redondant avec la contrainte de table, conservé ici pour que
  -- le refus soit explicite côté appelant.
  if v_c.includes_minors and not v_c.guardian_consent then
    return jsonb_build_object('allowed', false, 'code', 'MINOR_WITHOUT_GUARDIAN');
  end if;

  return jsonb_build_object(
    'allowed', true,
    'code', 'OK',
    'consent_id', v_c.id,
    'identity_scope', v_c.identity_scope,
    'location_scope', v_c.location_scope,
    'includes_minors', v_c.includes_minors,
    'expires_at', v_c.expires_at);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. DÉTECTION D'OPPORTUNITÉS — SQL pur, LECTURE SEULE, 0 LLM.
--
--    Renvoie des candidats ; n'écrit rien. La transformation en proposition
--    (`photo.upsell.propose`) et l'envoi (`photo.upsell.send`, approbation SW15)
--    sont des actions distinctes du lot P2, portées par un consumer n8n.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.detect_photo_upsell_opportunities(
  p_tenant text,
  p_as_of  date default current_date
)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_part jsonb;
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS', 'opportunities', '[]'::jsonb);
  end if;

  -- (a) Séance naissance il y a 10 à 13 mois ⇒ séance « premier anniversaire ».
  select coalesce(jsonb_agg(x.obj order by x.d), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'SEANCE_ANNIVERSAIRE',
      'trigger_code', 'NAISSANCE_PLUS_11M',
      'client_id', s.client_id,
      'session_id', s.id,
      'score', 0.800,
      'due_date', (s.scheduled_at::date + interval '12 months')::date,
      'evidence', jsonb_build_object('source', 'photo_sessions', 'source_id', s.id::text)) obj,
      s.scheduled_at d
      from hermes_os.photo_sessions s
     where s.tenant_id = p_tenant
       and s.session_type = 'NAISSANCE'
       and s.status not in ('CANCELLED', 'DRAFT')
       and s.scheduled_at is not null
       and s.scheduled_at::date between (p_as_of - interval '13 months')::date
                                    and (p_as_of - interval '10 months')::date
     order by s.scheduled_at limit 200) x;
  v_out := v_out || v_part;

  -- (b) Séance grossesse récente sans séance naissance qui suit ⇒ séance naissance.
  select coalesce(jsonb_agg(x.obj order by x.d), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'SEANCE_NAISSANCE',
      'trigger_code', 'GROSSESSE_SANS_NAISSANCE',
      'client_id', s.client_id,
      'session_id', s.id,
      'score', 0.700,
      'due_date', (s.scheduled_at::date + interval '3 months')::date,
      'evidence', jsonb_build_object('source', 'photo_sessions', 'source_id', s.id::text)) obj,
      s.scheduled_at d
      from hermes_os.photo_sessions s
     where s.tenant_id = p_tenant
       and s.session_type = 'GROSSESSE'
       and s.status not in ('CANCELLED', 'DRAFT')
       and s.scheduled_at is not null
       and s.scheduled_at::date between (p_as_of - interval '9 months')::date and p_as_of
       and not exists (
         select 1 from hermes_os.photo_sessions n
          where n.tenant_id = s.tenant_id and n.client_id = s.client_id
            and n.session_type = 'NAISSANCE' and n.scheduled_at > s.scheduled_at)
     order by s.scheduled_at limit 200) x;
  v_out := v_out || v_part;

  -- (c) Séance livrée, galerie consultée, aucun album acheté ⇒ proposition album.
  select coalesce(jsonb_agg(x.obj order by x.d), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'ALBUM',
      'trigger_code', 'GALERIE_CONSULTEE_SANS_COMMANDE',
      'client_id', s.client_id,
      'session_id', s.id,
      'score', 0.600,
      'due_date', (coalesce(s.delivered_at, now())::date + interval '21 days')::date,
      'evidence', jsonb_build_object('source', 'photo_galleries', 'source_id', g.id::text)) obj,
      s.delivered_at d
      from hermes_os.photo_sessions s
      join hermes_os.photo_galleries g
        on g.tenant_id = s.tenant_id and g.session_id = s.id
     where s.tenant_id = p_tenant
       and s.status in ('DELIVERED', 'CLOSED')
       and g.status = 'PUBLISHED'
       and g.viewed_count > 0
       and g.order_count = 0
     order by s.delivered_at nulls last limit 200) x;
  v_out := v_out || v_part;

  -- (d) Client sans séance depuis > 18 mois ⇒ reprise de contact.
  select coalesce(jsonb_agg(x.obj order by x.d), '[]'::jsonb) into v_part from (
    select jsonb_build_object(
      'kind', 'SEANCE_FAMILLE',
      'trigger_code', 'CLIENT_DORMANT_18M',
      'client_id', c.id,
      'session_id', null,
      'score', 0.400,
      'due_date', p_as_of,
      'evidence', jsonb_build_object('source', 'photo_clients', 'source_id', c.id::text)) obj,
      max(s.scheduled_at) d
      from hermes_os.photo_clients c
      left join hermes_os.photo_sessions s
        on s.tenant_id = c.tenant_id and s.client_id = c.id and s.status not in ('CANCELLED', 'DRAFT')
     where c.tenant_id = p_tenant and c.status <> 'ARCHIVED'
     group by c.id
    having max(s.scheduled_at) is not null
       and max(s.scheduled_at)::date < (p_as_of - interval '18 months')::date
     order by 2 limit 200) x;
  v_out := v_out || v_part;

  return jsonb_build_object(
    'ok', true,
    'as_of', p_as_of,
    'opportunities', v_out,
    'total', jsonb_array_length(v_out),
    'provenance', 'DERIVED');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. DÉRIVATION DES VERDICTS DE TRI — l'UNIQUE implémentation métier du tri.
--
--    Le navigateur ne produit QUE des MESURES (netteté, écrêtage, luminosité,
--    empreintes perceptuelles). Tous les SEUILS, le regroupement en rafales, la
--    détection de quasi-doublons, le choix du meilleur de série et l'application
--    des consignes de protection vivent ICI — un seul endroit, testable, auditable.
--    Un client ne peut donc pas « négocier » un verdict en trafiquant des seuils.
--
--    Garanties dures :
--      * une photo couverte par une consigne PROTECT n'est JAMAIS
--        `REJECTED_SUGGESTION` (elle devient `KEEP_SUGGESTION`, is_protected=true) ;
--      * une décision humaine déjà prise n'est jamais écrasée ;
--      * aucun asset n'est supprimé — la fonction n'écrit que dans la table des
--        verdicts.
--
--    Rafale = photos consécutives (par `captured_at`) espacées de ≤ 2 s.
--
--    ⚠️ SEUILS NON CALIBRÉS. 0.35 (rejet), 0.55 (plus faible d'une rafale), 2 s
--    (fenêtre de rafale) et `SHARPNESS_REFERENCE` côté navigateur sont des points
--    de départ RAISONNÉS, jamais mesurés sur de vraies séances. Ils ne doivent
--    pas être présentés comme des seuils de qualité validés tant que le
--    shadow-mode SW17 n'a pas comparé ce tri au tri manuel de la photographe.
--    Conséquence de conception : ils ne peuvent produire qu'une SUGGESTION.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.derive_photo_culling_verdicts(
  p_tenant     text,
  p_session_id uuid
)
returns jsonb
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_written int := 0;
  v_kept    int := 0;
  v_rejected int := 0;
  v_best    int := 0;
  v_protected int := 0;
begin
  if p_tenant is null or p_session_id is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  -- Deux passes de fenêtrage : Postgres interdit d'imbriquer une fonction de
  -- fenêtre dans une autre, on calcule donc d'abord le cliché précédent, puis la
  -- somme cumulée qui numérote les rafales. Les deux fenêtres partagent
  -- EXACTEMENT le même tri, sinon la numérotation serait incohérente.
  with base as (
    select g.asset_id, g.sharpness, g.clip_low, g.clip_high, g.brightness, g.dhash,
           a.captured_at, a.original_filename, a.source_reference,
           lag(a.captured_at) over (order by a.captured_at nulls last, a.id) as prev_captured_at
      from hermes_os.photo_culling_signals g
      join hermes_os.photo_session_assets a
        on a.id = g.asset_id and a.tenant_id = g.tenant_id
     where g.tenant_id = p_tenant and g.session_id = p_session_id
  ),
  sig as (
    -- Nouvelle rafale dès que l'écart au cliché précédent dépasse 2 s (ou qu'aucune
    -- date de prise de vue n'est disponible : on ne devine pas un regroupement).
    select b.*,
           sum(case when b.captured_at is null
                     or b.prev_captured_at is null
                     or b.captured_at - b.prev_captured_at > interval '2 seconds'
                    then 1 else 0 end)
             over (order by b.captured_at nulls last, b.asset_id) as burst_no
      from base b
  ),
  scored as (
    -- Score qualité déterministe, borné [0..1] :
    --   netteté 60 % · exposition (1 − écrêtage) 30 % · luminosité centrée 10 %.
    select s.*,
           round(least(1.0, greatest(0.0,
                 0.60 * s.sharpness
               + 0.30 * (1.0 - least(1.0, (s.clip_low + s.clip_high) * 4))
               + 0.10 * (1.0 - abs(s.brightness - 0.5) * 2)
           ))::numeric, 5) as quality
      from sig s
  ),
  ranked as (
    select sc.*,
           row_number() over (partition by sc.burst_no order by sc.quality desc, sc.asset_id) as rk_in_burst,
           count(*) over (partition by sc.burst_no) as burst_size
      from scored sc
  ),
  protect as (
    select distinct r.asset_id
      from ranked r
      join hermes_os.photo_culling_instructions i
        on i.tenant_id = p_tenant
       and (i.session_id = p_session_id or i.session_id is null)
       and i.kind = 'PROTECT'
       -- La consigne s'applique par correspondance textuelle sur le nom de fichier
       -- ou la référence source. Aucune reconnaissance faciale, aucune biométrie.
       and (r.original_filename ilike '%' || i.keyword || '%'
         or r.source_reference  ilike '%' || i.keyword || '%')
  ),
  decided as (
    select r.asset_id,
           r.quality,
           (r.asset_id in (select asset_id from protect)) as is_protected,
           case
             when r.asset_id in (select asset_id from protect) then 'KEEP_SUGGESTION'
             when r.quality < 0.35 then 'REJECTED_SUGGESTION'
             when r.burst_size > 1 and r.rk_in_burst = 1 then 'BEST_OF_SERIES'
             when r.burst_size > 1 and r.rk_in_burst > 1 and r.quality < 0.55 then 'REJECTED_SUGGESTION'
             else 'KEEP_SUGGESTION'
           end as verdict,
           case
             when r.asset_id in (select asset_id from protect) then 'PROTECTED_BY_INSTRUCTION'
             when r.quality < 0.35 then 'LOW_QUALITY'
             when r.burst_size > 1 and r.rk_in_burst = 1 then 'BEST_OF_BURST'
             when r.burst_size > 1 and r.rk_in_burst > 1 and r.quality < 0.55 then 'WEAKER_IN_BURST'
             else 'QUALITY_OK'
           end as reason_code
      from ranked r
  ),
  ins as (
    insert into hermes_os.photo_culling_verdicts
      (tenant_id, session_id, asset_id, pass_no, verdict, score, reason_code, is_protected)
    select p_tenant, p_session_id, d.asset_id, 1, d.verdict, d.quality, d.reason_code, d.is_protected
      from decided d
    on conflict (tenant_id, asset_id, pass_no) do update
      set verdict     = excluded.verdict,
          score       = excluded.score,
          reason_code = excluded.reason_code,
          is_protected = excluded.is_protected
      -- Une décision humaine gèle la ligne : la ré-exécution ne la touche pas.
      where hermes_os.photo_culling_verdicts.human_decision is null
    returning verdict, is_protected)
  select count(*),
         count(*) filter (where verdict = 'KEEP_SUGGESTION'),
         count(*) filter (where verdict = 'REJECTED_SUGGESTION'),
         count(*) filter (where verdict = 'BEST_OF_SERIES'),
         count(*) filter (where is_protected)
    into v_written, v_kept, v_rejected, v_best, v_protected
    from ins;

  return jsonb_build_object(
    'ok', true, 'written', v_written, 'kept', v_kept,
    'rejected', v_rejected, 'best_of_series', v_best, 'protected', v_protected);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. VERROU DE PUBLICATION MARKETING — structurel, pas déclaratif.
--
--    La contrainte de table n'exige qu'un `consent_id` NON NUL : un consentement
--    RÉVOQUÉ ou EXPIRÉ la satisfait. Ce déclencheur ferme le trou pour de bon en
--    revalidant, à l'instant de la publication, LE consentement référencé —
--    pas « un » consentement du client.
--
--    Portée : tout écrivain, présent ou futur — façade, consumer n8n, opérateur
--    en SQL direct. Aucun module marketing ne pourra contourner la règle, même
--    en n'appelant pas la façade prévue.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_marketing_publish_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_c        hermes_os.photo_media_consent%rowtype;
  v_session_client uuid;
  v_want int; v_have int;
begin
  if new.status is distinct from 'PUBLISHED' then
    return new;
  end if;

  if new.consent_id is null then
    raise exception 'PHOTO_MARKETING_NO_CONSENT' using errcode = 'check_violation';
  end if;

  select c.* into v_c
    from hermes_os.photo_media_consent c
   where c.id = new.consent_id and c.tenant_id = new.tenant_id;
  if not found then
    raise exception 'PHOTO_MARKETING_CONSENT_NOT_FOUND' using errcode = 'check_violation';
  end if;

  -- Le consentement doit porter sur le client DE CETTE séance.
  select s.client_id into v_session_client
    from hermes_os.photo_sessions s
   where s.id = new.session_id and s.tenant_id = new.tenant_id;
  if v_session_client is null or v_session_client is distinct from v_c.client_id then
    raise exception 'PHOTO_MARKETING_CONSENT_CLIENT_MISMATCH' using errcode = 'check_violation';
  end if;

  if v_c.status <> 'GRANTED' or v_c.revoked_at is not null then
    raise exception 'PHOTO_MARKETING_CONSENT_REVOKED' using errcode = 'check_violation';
  end if;
  if v_c.expires_at is not null and v_c.expires_at <= now() then
    raise exception 'PHOTO_MARKETING_CONSENT_EXPIRED' using errcode = 'check_violation';
  end if;
  if not (new.use_case = any (v_c.use_cases_granted)) then
    raise exception 'PHOTO_MARKETING_USE_CASE_NOT_GRANTED' using errcode = 'check_violation';
  end if;
  if v_c.includes_minors and not v_c.guardian_consent then
    raise exception 'PHOTO_MARKETING_MINOR_WITHOUT_GUARDIAN' using errcode = 'check_violation';
  end if;

  v_want := case new.identity_scope when 'NONE' then 0 when 'SILHOUETTE' then 1 when 'FACE' then 2 end;
  v_have := case v_c.identity_scope when 'NONE' then 0 when 'SILHOUETTE' then 1 when 'FACE' then 2 end;
  if v_want is null or v_have is null or v_want > v_have then
    raise exception 'PHOTO_MARKETING_IDENTITY_SCOPE_EXCEEDED' using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

-- `create trigger` n'accepte pas `if not exists` : on retire d'abord (idempotence).
drop trigger if exists photo_marketing_publish_guard on hermes_os.photo_marketing_draft;
create trigger photo_marketing_publish_guard
  before insert or update on hermes_os.photo_marketing_draft
  for each row execute function hermes_os.photo_marketing_publish_guard();

-- ---------------------------------------------------------------------------
-- 7. MOINDRE PRIVILÈGE — aucune de ces fonctions internes n'est appelable par un
--    rôle client. `authenticated` DÉTIENT `USAGE` sur le schéma `hermes_os` (état
--    constaté en production) : sans ce REVOKE, `PUBLIC` conserverait EXECUTE et
--    des fonctions qui PRENNENT UN TENANT EN PARAMÈTRE — donc sans contrôle
--    d'appelant — deviendraient un contournement d'isolation dès qu'un chemin
--    d'appel existerait. C'est la posture uniforme du reste du schéma.
--    Elles restent appelables par les façades, qui s'exécutent comme propriétaire.
-- ---------------------------------------------------------------------------
revoke all on function hermes_os.photo_session_status_rank(text) from public;
revoke all on function hermes_os.compute_photo_session_state(text, uuid) from public;
revoke all on function hermes_os.verifier_consentement_photo(text, uuid, text, text, text, timestamptz) from public;
revoke all on function hermes_os.detect_photo_upsell_opportunities(text, date) from public;
revoke all on function hermes_os.derive_photo_culling_verdicts(text, uuid) from public;
revoke all on function hermes_os.photo_marketing_publish_guard() from public;

commit;
