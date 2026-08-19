-- HERMÈS / INTÉGRATIONS 2 — Provisionnement téléphonique géré par Hermès.
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO. RETELL_CREDENTIAL_ADDED = NO.
--
-- ═══ RÈGLE DÉFINITIVE : RETELL_OWNERSHIP = HERMES_MANAGED ═══
--
--   Le compte et les clés Retell appartiennent à HERMÈS. Un tenant :
--     · n'ouvre pas de compte Retell ;      · ne fournit aucun credential ;
--     · ne voit jamais la clé ;             · ne peut ni lire ni écrire ici.
--
--   D'où la SÉPARATION en deux tables, qui est le cœur de cette migration :
--
--     hermes_os.photo_phone_config   ← LE TENANT configure (numéro entrant,
--       (migration photo_studio_7)     horaires, accueil, sujets, règles…).
--                                      Aucune référence fournisseur.
--
--     hermes_os.phone_provisioning   ← HERMÈS provisionne (agent Retell,
--       (ci-dessous)                   numéro acheté, webhook). Aucune façade
--                                      `authenticated` : le tenant n'y touche
--                                      pas, et n'en voit qu'un statut agrégé.
--
--   `external_agent_ref` est un IDENTIFIANT (ex. « agent_abc123 »), pas un
--   secret : il ne permet aucun appel sans la clé, qui reste dans Vault côté
--   infrastructure. Aucune colonne de clé n'existe ici — c'est le contrat.
--
-- Réversible : 20260819_hermes_integrations_9_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Provisionnement — TABLE D'INFRASTRUCTURE. Aucun accès tenant.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.phone_provisioning (
  tenant_id           text primary key,
  provider            text not null default 'retell'
                        check (provider in ('retell', 'twilio', 'other')),
  -- Identifiant public de l'agent chez le fournisseur. PAS une clé.
  external_agent_ref  text check (external_agent_ref is null or length(external_agent_ref) <= 120),
  -- Numéro E.164 rattaché, acheté et détenu par Hermès.
  number_e164         text check (number_e164 is null or number_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Le webhook d'appel est-il configuré chez le fournisseur ?
  webhook_configured  boolean not null default false,
  status              text not null default 'NOT_PROVISIONED'
                        check (status in ('NOT_PROVISIONED', 'PROVISIONING', 'READY',
                                          'SUSPENDED', 'ERROR')),
  -- Pointeur Vault vers la clé Retell d'Hermès (partagée, pas par tenant).
  -- Nullable : tant qu'il est NULL, rien ne peut appeler le fournisseur.
  vault_secret_id     uuid,
  last_error_code     text check (last_error_code is null or length(last_error_code) <= 60),
  provisioned_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Un provisionnement READY sans agent ni numéro serait inexploitable.
  constraint phone_provisioning_ready_complete
    check (status <> 'READY'
           or (external_agent_ref is not null and number_e164 is not null
               and webhook_configured and vault_secret_id is not null))
);
alter table hermes_os.phone_provisioning enable row level security;

comment on table hermes_os.phone_provisioning is
  'Infrastructure téléphonique gérée par HERMÈS. Aucune façade authenticated : '
  'le tenant ne lit ni n''écrit cette table. Aucune clé fournisseur ici.';

-- ---------------------------------------------------------------------------
-- 2. Le standard est-il RÉELLEMENT opérationnel pour ce tenant ?
--
--    Exige les DEUX faces : la configuration métier du tenant (activée) ET le
--    provisionnement Hermès (READY). L'une sans l'autre ⇒ faux. Fail-closed.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.phone_is_operational(p_tenant text)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_cfg boolean := false; v_prov boolean := false; v_reason text;
begin
  select coalesce(c.enabled, false) into v_cfg
    from hermes_os.photo_phone_config c where c.tenant_id = p_tenant;
  select (p.status = 'READY') into v_prov
    from hermes_os.phone_provisioning p where p.tenant_id = p_tenant;

  v_reason := case
                when not coalesce(v_prov, false) then 'NOT_PROVISIONED_BY_HERMES'
                when not coalesce(v_cfg, false)  then 'TENANT_PHONE_DISABLED'
                else 'OK' end;

  return jsonb_build_object(
    'ok', true,
    'operational', coalesce(v_cfg, false) and coalesce(v_prov, false),
    'tenant_configured', coalesce(v_cfg, false),
    'hermes_provisioned', coalesce(v_prov, false),
    'code', v_reason);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. COÛTS RÉELS par tenant — jamais une estimation.
--
--    Seuls les appels dont le fournisseur a RAPPORTÉ le coût
--    (`cost_reported = true`) alimentent les montants. Les autres sont comptés
--    à part (`calls_without_cost`) pour que l'écart soit visible plutôt que
--    silencieusement absorbé dans un total trop bas.
--
--    Les montants valent NULL — et non 0 — quand aucun appel n'a été facturé.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.compute_phone_costs(
  p_tenant text,
  p_from   date default (current_date - 30),
  p_to     date default current_date
)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_calls int; v_no_cost int; v_seconds bigint;
  v_retell numeric; v_tel numeric; v_llm numeric; v_total numeric;
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  select count(*),
         count(*) filter (where not cost_reported),
         coalesce(sum(duration_seconds), 0),
         sum(retell_cost_usd)    filter (where cost_reported),
         sum(telephony_cost_usd) filter (where cost_reported),
         sum(llm_cost_usd)       filter (where cost_reported),
         sum(cost_usd)           filter (where cost_reported)
    into v_calls, v_no_cost, v_seconds, v_retell, v_tel, v_llm, v_total
    from hermes_os.photo_calls
   where tenant_id = p_tenant and started_at::date between p_from and p_to;

  return jsonb_build_object(
    'ok', true, 'tenant_id', p_tenant, 'period_from', p_from, 'period_to', p_to,
    'call_count', v_calls,
    'call_minutes', round((v_seconds / 60.0)::numeric, 2),
    'calls_without_reported_cost', v_no_cost,
    'retell_cost_usd', v_retell,
    'telephony_cost_usd', v_tel,
    'llm_cost_usd', v_llm,
    'total_call_cost_usd', v_total,
    -- Provenance honnête : REAL seulement si TOUS les appels ont un coût
    -- rapporté ; PARTIAL s'il en manque ; UNAVAILABLE si aucun.
    'provenance', case
                    when v_calls = 0 then 'UNAVAILABLE'
                    when v_no_cost = 0 then 'REAL'
                    when v_no_cost < v_calls then 'PARTIAL'
                    else 'UNAVAILABLE' end);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Façade de lecture pour le tenant — statut opérationnel + coûts.
--    Ne renvoie NI `external_agent_ref`, NI `vault_secret_id`, NI le
--    fournisseur : ce sont des détails d'infrastructure Hermès.
-- ---------------------------------------------------------------------------
create or replace function public.get_phone_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.integration_guard();
  v_t text; v_op jsonb; v_number text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('resolution_status', v_g->>'code', 'operational', false);
  end if;
  v_t := v_g->>'tenant';
  v_op := hermes_os.phone_is_operational(v_t);

  -- Son propre numéro entrant lui est utile ; l'agent et la clé ne le sont pas.
  select number_e164 into v_number
    from hermes_os.phone_provisioning where tenant_id = v_t;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'operational', (v_op->>'operational')::boolean,
    'tenant_configured', (v_op->>'tenant_configured')::boolean,
    'hermes_provisioned', (v_op->>'hermes_provisioned')::boolean,
    'code', v_op->>'code',
    'incoming_number', v_number,
    'calendar_usable', hermes_os.integration_is_usable(v_t, 'google_calendar'),
    'costs', hermes_os.compute_phone_costs(v_t),
    'provenance', 'REAL');
end;
$function$;

revoke all on function public.get_phone_status() from public;
grant execute on function public.get_phone_status() to authenticated;

revoke all on function hermes_os.phone_is_operational(text) from public;
revoke all on function hermes_os.compute_phone_costs(text, date, date) from public;

commit;
