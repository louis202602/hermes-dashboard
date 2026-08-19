-- ---------------------------------------------------------------------------
-- HERMÈS STUDIO — LOT 10 : les coûts téléphoniques rejoignent SW19 et SW23.
--
-- ⚠️ NON APPLIQUÉE. Fichier préparatoire. `GO_LIVE = NO`.
--
-- LE TROU CORRIGÉ. `photo_calls` portait ses coûts dans SES PROPRES colonnes et
-- n'alimentait pas `sw19_cost_events`. Conséquence concrète : les appels
-- téléphoniques étaient invisibles pour SW23 — donc hors budget journalier, hors
-- budget mensuel, hors plafond par appel, hors alertes et hors kill-switch. Un
-- standard qui s'emballe aurait pu coûter sans jamais rien déclencher.
--
-- RIEN N'EST RÉÉCRIT. Tout existe déjà et est réutilisé tel quel :
--   * `sw19_cost_events`     journal générique, tenant_id NOT NULL, `source`
--                            accepte déjà TELEPHONY / AI_MODEL / SMS ;
--   * `sw23_tenant_budget_config`  daily / monthly / per_request / hard_stop ;
--   * `sw23_reserve_budget` · `sw23_commit_budget` · `sw23_release_budget`
--                            le cycle réserver → engager → libérer, déjà
--                            idempotent sur (tenant, request_id, période) ;
--   * `sw23_set_session_tenant`    verrou de tenant de session exigé par SW23.
--
-- LA RÈGLE QUI GOUVERNE TOUT CE FICHIER :
--   AUCUN COÛT ESTIMÉ N'EST ENREGISTRÉ COMME RÉEL.
--   Seules les composantes que le FOURNISSEUR a réellement facturées produisent
--   un événement, et toujours en `measurement_status = 'MEASURED'`. Une
--   composante non rapportée ne produit RIEN — l'écart reste visible via
--   `calls_without_reported_cost`, au lieu d'être comblé par une estimation qui
--   se mettrait ensuite à circuler comme un chiffre réel.
--
-- Dépend de : lot 7 (photo_calls, avec `request_id`).
-- Réversible : 20260820_photo_studio_10_rollback.sql
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Identifiant de requête déterministe.
--
--    SW23 s'appuie sur `request_id` pour son idempotence. Le dériver du
--    `call_id` plutôt que d'en tirer un au hasard rend le rejeu inoffensif :
--    deux traitements du même appel réservent le même budget, pas deux fois.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_call_request_id(p_call_id text)
returns text
language sql
immutable
as $function$
  select 'photo_call:' || coalesce(p_call_id, '');
$function$;

-- ---------------------------------------------------------------------------
-- 2. Journalisation des coûts RÉELLEMENT facturés.
--
--    Trois composantes possibles, trois lignes indépendantes : le fournisseur
--    d'agent conversationnel, la téléphonie et le modèle de langage ne sont ni
--    la même facture ni le même prestataire. Les fondre en un total unique
--    rendrait impossible de savoir lequel dérape.
--
--    `quantity` = minutes réelles ; `unit_cost` = coût par minute DÉDUIT du
--    total facturé, jamais un tarif catalogue supposé. Durée nulle ou inconnue
--    ⇒ `unit_cost` NULL plutôt qu'une division hasardeuse.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.record_photo_call_costs(p_tenant text, p_call_id text)
returns jsonb
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_call hermes_os.photo_calls%rowtype;
  v_req text;
  v_minutes numeric;
  v_written int := 0;
  v_skipped text[] := '{}';

  procedure_component text;
begin
  if p_tenant is null or p_call_id is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  select * into v_call
    from hermes_os.photo_calls
   where tenant_id = p_tenant and call_id = p_call_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CALL_NOT_FOUND');
  end if;

  -- La porte : sans confirmation du fournisseur, on n'écrit RIEN.
  if not v_call.cost_reported then
    return jsonb_build_object('ok', false, 'code', 'COST_NOT_REPORTED',
                              'written', 0);
  end if;

  v_req := coalesce(v_call.request_id, hermes_os.photo_call_request_id(p_call_id));
  v_minutes := case
                 when v_call.duration_seconds is null or v_call.duration_seconds <= 0
                 then null
                 else round(v_call.duration_seconds::numeric / 60.0, 4)
               end;

  -- Une composante par prestataire réel. `is not null` est la seule condition :
  -- un 0,00 € facturé est une information (appel gratuit), un NULL n'en est pas.
  foreach procedure_component in array array['retell', 'telephony', 'llm'] loop
    declare
      v_amount numeric;
      v_source text;
      v_service text;
    begin
      v_amount := case procedure_component
                    when 'retell'    then v_call.retell_cost_usd
                    when 'telephony' then v_call.telephony_cost_usd
                    else                  v_call.llm_cost_usd
                  end;
      if v_amount is null then
        v_skipped := v_skipped || procedure_component;
        continue;
      end if;

      v_source  := case procedure_component when 'llm' then 'AI_MODEL' else 'TELEPHONY' end;
      v_service := case procedure_component
                     when 'retell'    then coalesce(v_call.provider, 'voice_agent')
                     when 'telephony' then 'telephony'
                     else                  'llm'
                   end;

      -- Idempotence : le même appel retraité ne double pas les coûts.
      if exists (
        select 1 from hermes_os.sw19_cost_events e
         where e.tenant_id = p_tenant
           and e.request_id = v_req
           and e.model_or_service = v_service
      ) then
        continue;
      end if;

      insert into hermes_os.sw19_cost_events(
        tenant_id, request_id, correlation_id, source, provider, model_or_service,
        quantity, unit, unit_cost, total_cost, currency,
        measurement_status, agent_id, occurred_at, provider_event_id)
      values (
        p_tenant, v_req, p_call_id, v_source,
        coalesce(v_call.provider, 'unknown'), v_service,
        v_minutes, 'minute',
        case when v_minutes is null or v_minutes = 0 then null
             else round(v_amount / v_minutes, 6) end,
        v_amount, 'USD',
        -- MEASURED, et rien d'autre : cette fonction n'écrit que du facturé.
        'MEASURED', 'agent_10_telephonie_entrant',
        coalesce(v_call.ended_at, v_call.started_at, now()),
        p_call_id || ':' || procedure_component);
      v_written := v_written + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'OK',
    'request_id', v_req, 'written', v_written,
    -- Ce qui n'a PAS été facturé est nommé, pas passé sous silence.
    'not_reported', to_jsonb(v_skipped));
end;
$function$;

revoke all on function hermes_os.record_photo_call_costs(text, text) from public;

-- ---------------------------------------------------------------------------
-- 3. Déclenchement automatique — au moment où le coût devient réel.
--
--    AFTER UPDATE, et seulement sur la TRANSITION `false → true` : le webhook
--    du fournisseur bascule `cost_reported`, et c'est cet instant précis qui
--    fait entrer l'appel dans la comptabilité.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_call_cost_sync()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hermes_os.record_photo_call_costs(new.tenant_id, new.call_id);
  return null;
end;
$function$;

drop trigger if exists photo_call_cost_sync_trg on hermes_os.photo_calls;
create trigger photo_call_cost_sync_trg
  after update of cost_reported on hermes_os.photo_calls
  for each row
  when (new.cost_reported and not coalesce(old.cost_reported, false))
  execute function hermes_os.photo_call_cost_sync();

-- ---------------------------------------------------------------------------
-- 4. LA PORTE DE BUDGET — avant de décrocher, pas après avoir payé.
--
--    Réutilise `sw23_reserve_budget` sans le réécrire. Ajoute la seule règle
--    que SW23 ne porte pas lui-même : le PLAFOND PAR APPEL
--    (`per_request_budget_usd`), qui protège du cas « un seul appel de trois
--    heures » — invisible pour un budget journalier encore loin d'être atteint.
--
--    FAIL-CLOSED sur l'estimation : un appel dont on ne sait rien estimer est
--    refusé si un plafond par appel existe. On ne réserve pas « 0 ».
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_phone_budget_gate(
  p_tenant        text,
  p_call_id       text,
  p_estimated_usd numeric
)
returns jsonb
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_req text;
  v_per_call numeric;
  v_hard_stop boolean;
  v_day jsonb;
  v_month jsonb;
begin
  if p_tenant is null or p_call_id is null then
    return jsonb_build_object('allowed', false, 'code', 'BAD_ARGUMENTS');
  end if;
  v_req := hermes_os.photo_call_request_id(p_call_id);

  select per_request_budget_usd, hard_stop
    into v_per_call, v_hard_stop
    from hermes_os.sw23_tenant_budget_config
   where tenant_id = p_tenant;

  -- Plafond par appel : appliqué AVANT toute réservation.
  if v_per_call is not null then
    if p_estimated_usd is null then
      return jsonb_build_object('allowed', false, 'code', 'ESTIMATE_REQUIRED',
        'per_call_limit_usd', v_per_call);
    end if;
    if p_estimated_usd > v_per_call and coalesce(v_hard_stop, true) then
      return jsonb_build_object('allowed', false, 'code', 'PER_CALL_LIMIT_EXCEEDED',
        'per_call_limit_usd', v_per_call, 'estimated_usd', p_estimated_usd);
    end if;
  end if;

  -- SW23 exige que le tenant de session soit verrouillé : c'est sa protection
  -- contre un appel croisé entre tenants. On l'honore, on ne la contourne pas.
  perform hermes_os.sw23_set_session_tenant(p_tenant);

  v_day := hermes_os.sw23_reserve_budget(
             p_tenant, v_req, 'agent_10_telephonie_entrant',
             coalesce(p_estimated_usd, 0), 'day');
  if (v_day->>'status') = 'rejected' then
    return jsonb_build_object('allowed', false, 'code', 'DAILY_BUDGET_EXCEEDED', 'day', v_day);
  end if;

  v_month := hermes_os.sw23_reserve_budget(
               p_tenant, v_req, 'agent_10_telephonie_entrant',
               coalesce(p_estimated_usd, 0), 'month');
  if (v_month->>'status') = 'rejected' then
    -- Le jour a été réservé juste avant : on le relâche, sinon un refus mensuel
    -- consommerait tout de même du budget journalier.
    perform hermes_os.sw23_release_budget(p_tenant, v_req, 'day');
    return jsonb_build_object('allowed', false, 'code', 'MONTHLY_BUDGET_EXCEEDED',
      'month', v_month);
  end if;

  return jsonb_build_object('allowed', true, 'code', 'OK',
    'request_id', v_req, 'day', v_day, 'month', v_month);
end;
$function$;

revoke all on function hermes_os.photo_phone_budget_gate(text, text, numeric) from public;

-- ---------------------------------------------------------------------------
-- 5. ENGAGEMENT — la réservation devient une dépense réelle.
--
--    Appelé après `record_photo_call_costs`, avec le total RÉELLEMENT facturé.
--    Sans coût rapporté, on LIBÈRE la réservation au lieu de l'engager : un
--    appel jamais facturé ne doit pas grever le budget indéfiniment.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_phone_settle_budget(p_tenant text, p_call_id text)
returns jsonb
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_req text := hermes_os.photo_call_request_id(p_call_id);
  v_total numeric;
begin
  perform hermes_os.sw23_set_session_tenant(p_tenant);

  select sum(e.total_cost) into v_total
    from hermes_os.sw19_cost_events e
   where e.tenant_id = p_tenant
     and e.request_id = v_req
     and e.measurement_status = 'MEASURED';

  if v_total is null then
    perform hermes_os.sw23_release_budget(p_tenant, v_req, 'day');
    perform hermes_os.sw23_release_budget(p_tenant, v_req, 'month');
    return jsonb_build_object('ok', true, 'code', 'RELEASED_NO_COST');
  end if;

  perform hermes_os.sw23_commit_budget(p_tenant, v_req, 'day', v_total);
  perform hermes_os.sw23_commit_budget(p_tenant, v_req, 'month', v_total);
  return jsonb_build_object('ok', true, 'code', 'COMMITTED', 'actual_usd', v_total);
end;
$function$;

revoke all on function hermes_os.photo_phone_settle_budget(text, text) from public;

commit;
