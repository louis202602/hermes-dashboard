-- PHOTO-P1 / 7 — Standard téléphonique : profil « studio photographe ».
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO. Aucun appel réel n'est possible depuis ce lot.
--
-- VERTICALISATION DE L'AGENT 10, PAS NOUVEL AGENT — état constaté au registre :
--   `agent_10_telephonie_entrant` (AGENT_IA, n8n_active=true) :
--     « Telephonie IA, flux ENTRANT (pendant de Agent 9 qui gere le sortant).
--       Brouillon V1: identification appelant uniquement.
--       Blocage externe: credential Retell et Google Calendar absents. »
--   Il possède déjà `hermes_os.agent10_call_index` (call_id, tenant_id,
--   request_id, status, contact_known, crm_handoff_status).
--
--   Ce lot N'INTRODUIT PAS un second agent vocal. Il ajoute :
--     · la CONFIGURATION du profil studio (ce que l'agent a le droit de dire) ;
--     · le DÉTAIL métier de l'appel (créneaux extraits, issue, résumé), que
--       l'index minimal de l'Agent 10 ne porte pas.
--   L'index `agent10_call_index` reste la clé d'entrée : `photo_calls.call_id`
--   le référence, il n'est pas dupliqué.
--
-- CE QUI EST DÉLIBÉRÉMENT ABSENT :
--   * aucun enregistrement audio, aucun verbatim intégral — seulement un résumé
--     factuel et des créneaux structurés (minimisation RGPD) ;
--   * aucun secret fournisseur : les credentials vivent côté n8n/Retell, jamais
--     dans Postgres ni dans l'application Next.js.
--
-- PROPRIÉTÉ DES OUTILS — deux régimes, à ne jamais confondre :
--
--   ① INFRASTRUCTURE FOURNIE PAR HERMÈS (Retell, STT, TTS, routage LLM)
--      RETELL_PROVIDER = HERMES_MANAGED. Le compte et les clés appartiennent à
--      HERMÈS. La photographe ne voit jamais de clé API, n'en saisit aucune, et
--      n'a pas besoin d'ouvrir un compte Retell. C'est pourquoi cette table ne
--      porte AUCUNE colonne de secret : ce n'est pas un oubli, c'est le contrat.
--      Un credential Retell manquant est un blocage d'infrastructure HERMÈS —
--      jamais une information à réclamer au tenant.
--
--   ② OUTILS PERSONNELS DU TENANT (Google Calendar, Gmail, Meta…)
--      Régime TENANT_SELF_SERVICE_OAUTH : la photographe clique « Connecter »,
--      est redirigée chez le fournisseur, s'authentifie elle-même, et Hermès ne
--      reçoit qu'une autorisation déléguée. Hermès ne connaît ni ne stocke
--      JAMAIS son mot de passe. `calendar_connected` ci-dessous n'est donc
--      qu'un ÉTAT observé, pas un endroit où loger un secret.
--
-- Réversible : 20260819_photo_studio_9_rollback_p1.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Configuration du standard, par tenant. DÉSACTIVÉ par défaut.
--
--    C'est la SOURCE D'AUTORITÉ de l'anti-hallucination : tout ce que l'agent
--    peut affirmer vient d'ici ou de la base. Un champ NULL n'est pas un vide
--    à combler par le modèle, c'est une interdiction de répondre.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_phone_config (
  tenant_id                 text primary key,
  enabled                   boolean not null default false,
  studio_name               text check (studio_name is null or length(studio_name) <= 120),
  greeting                  text check (greeting is null or length(greeting) <= 500),
  -- Sans numéro, un transfert direct est IMPOSSIBLE : la façade dégrade alors
  -- honnêtement en rappel plutôt que de promettre un transfert qui échouerait.
  transfer_number           text check (transfer_number is null or length(transfer_number) <= 40),
  -- Plages d'ouverture : [{weekday:1..7, from_minutes:540, to_minutes:1080}, …]
  office_hours              jsonb not null default '[]'::jsonb,
  -- AUTORISATION donnée par la photographe : l'agent a-t-il le droit de lire
  -- l'agenda ? Distinct de la connexion effective ci-dessous.
  agenda_lookup_allowed     boolean not null default false,
  -- ÉTAT de la connexion OAuth de SON agenda (régime ② ci-dessus). Aucun jeton,
  -- aucun secret ici : uniquement le fait qu'une connexion existe. Tant que ce
  -- drapeau est faux, l'agent ne peut ni annoncer une disponibilité ni
  -- confirmer un créneau — il enregistre la demande et propose un rappel.
  calendar_connected        boolean not null default false,
  confirmation_send_allowed boolean not null default false,
  -- Sujets autorisés. Vide = l'agent ne s'engage sur RIEN de commercial.
  allowed_topics            text[] not null default '{}',
  -- Plafond de sécurité : au-delà, l'appel est clos et un rappel est proposé.
  max_call_seconds          integer not null default 420
                              check (max_call_seconds between 60 and 1800),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
alter table hermes_os.photo_phone_config enable row level security;

comment on table hermes_os.photo_phone_config is
  'Profil studio du standard IA. enabled=false par défaut. Aucun secret fournisseur ici.';

-- ---------------------------------------------------------------------------
-- 2. Appels — détail métier. `call_id` est celui de l'Agent 10 (réutilisé).
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_calls (
  call_id            text primary key,
  tenant_id          text not null,
  direction          text not null default 'INBOUND' check (direction in ('INBOUND','OUTBOUND')),
  status             text not null default 'RINGING'
                       check (status in ('RINGING','IN_PROGRESS','COMPLETED','FAILED','ABANDONED')),
  intent             text not null default 'UNKNOWN'
                       check (intent in ('NEW_ENQUIRY','EXISTING_CLIENT','PRICING_QUESTION',
                                         'AVAILABILITY_QUESTION','RESCHEDULE','COMPLAINT','OTHER','UNKNOWN')),
  disposition        text not null default 'AI_HANDLED'
                       check (disposition in ('AI_HANDLED','CALLBACK_REQUESTED',
                                              'LIVE_TRANSFER_REQUESTED','HUMAN_REQUIRED','EMERGENCY_STOP')),
  handoff_reason     text not null default 'NONE'
                       check (handoff_reason in ('CLIENT_ASKED','COMPLAINT','CONFLICT','COMPLEX_CONTRACT',
                                                 'EMOTIONALLY_SENSITIVE','OUT_OF_CATALOG','LOW_CONFIDENCE',
                                                 'BOOKING_NEEDS_HUMAN','NONE')),
  -- Créneaux extraits au fil de la conversation (jamais un formulaire).
  slots              jsonb not null default '{}'::jsonb,
  -- Résumé FACTUEL de fin d'appel. Jamais l'audio, jamais le verbatim intégral.
  summary            text check (summary is null or length(summary) <= 2000),
  -- Numéro appelant, conservé pour rappeler. Effaçable sans casser l'appel.
  caller_phone       text check (caller_phone is null or length(caller_phone) <= 40),
  lead_id            uuid references hermes_os.photo_leads(id) on delete set null,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  duration_seconds   integer check (duration_seconds is null or duration_seconds >= 0),
  cost_usd           numeric(10,4) check (cost_usd is null or cost_usd >= 0),
  provider           text check (provider is null or length(provider) <= 40),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Un transfert annoncé DOIT avoir un motif : sinon l'audit est ininterprétable.
  constraint photo_call_handoff_has_reason
    check (disposition = 'AI_HANDLED' or handoff_reason <> 'NONE'),
  -- Un appel terminé doit être daté.
  constraint photo_call_completed_dated
    check (status <> 'COMPLETED' or ended_at is not null)
);
alter table hermes_os.photo_calls enable row level security;
create index if not exists photo_calls_by_tenant
  on hermes_os.photo_calls (tenant_id, started_at desc);
create index if not exists photo_calls_needing_human
  on hermes_os.photo_calls (tenant_id, disposition, started_at desc)
  where disposition <> 'AI_HANDLED';

comment on column hermes_os.photo_calls.summary is
  'Résumé factuel. Aucun enregistrement audio n''est stocké par Hermès.';

-- ---------------------------------------------------------------------------
-- 3. Ce que l'agent a le DROIT de dire — fonction unique, fail-closed.
--
--    Renvoie les prestations citables au téléphone. Une prestation sans
--    fourchette de prix ou non marquée `quotable_by_phone` n'est PAS citable :
--    c'est ce qui empêche structurellement l'invention d'un tarif.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_phone_quotable_offerings(p_tenant text)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_rows jsonb;
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS', 'offerings', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'service_type', o.service_type, 'label', o.label,
           'price_from_eur', o.price_from_eur, 'price_to_eur', o.price_to_eur,
           'duration_minutes', o.duration_minutes) order by o.sort_order, o.label), '[]'::jsonb)
    into v_rows
    from hermes_os.photo_service_offerings o
   where o.tenant_id = p_tenant and o.active
     and o.quotable_by_phone
     and o.price_from_eur is not null;   -- sans prix réel, rien à annoncer
  return jsonb_build_object('ok', true, 'offerings', v_rows, 'provenance', 'REAL');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Le standard est-il joignable MAINTENANT ? Hors plage ⇒ pas d'improvisation :
--    message + proposition de rappel.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_phone_is_open(p_tenant text, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_cfg hermes_os.photo_phone_config%rowtype;
  v_wd int; v_minutes int; v_open boolean := false;
begin
  select * into v_cfg from hermes_os.photo_phone_config where tenant_id = p_tenant;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', true, 'enabled', false, 'open', false, 'code', 'PHONE_DISABLED');
  end if;

  v_wd := extract(isodow from p_at)::int;
  v_minutes := (extract(hour from p_at)::int * 60) + extract(minute from p_at)::int;

  select exists (
    select 1 from jsonb_array_elements(v_cfg.office_hours) h
     where (h->>'weekday')::int = v_wd
       and v_minutes >= (h->>'from_minutes')::int
       and v_minutes <  (h->>'to_minutes')::int
  ) into v_open;

  return jsonb_build_object('ok', true, 'enabled', true, 'open', v_open,
    'code', case when v_open then 'OPEN' else 'CLOSED' end,
    'transfer_available', v_cfg.transfer_number is not null);
end;
$function$;

revoke all on function hermes_os.photo_phone_quotable_offerings(text) from public;
revoke all on function hermes_os.photo_phone_is_open(text, timestamptz) from public;

commit;
