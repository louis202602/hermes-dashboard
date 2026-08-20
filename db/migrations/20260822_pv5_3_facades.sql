-- PACK PHOTOVOLTAÏQUE — LOT PV-5 / 3 — Façades du devis.
-- (project smubxqorirlfldatzmym)
--
-- Même contrat que PV-1 à PV-4 : tables en deny-all, accès par façades
-- `SECURITY DEFINER` accordées au seul rôle `authenticated`, tenant résolu
-- SERVEUR par `pv_guard()`, `search_path` verrouillé. AUCUNE façade n'accepte
-- de `tenant_id` ni d'acteur : le navigateur ne choisit ni qui il est ni pour
-- quel tenant il agit.

begin;

-- ---------------------------------------------------------------------------
-- 0. UN AGENT N'ACCEPTE PAS UN DEVIS.
--
--    On RÉUTILISE la garde de validation humaine de PV-1, paramétrée. Elle
--    refuse quand `auth.uid()` est NULL (un runner, un `service_role`), quand
--    l'acteur ou l'horodatage manque, ou quand l'acteur déclaré n'est pas
--    l'appelant. `SECURITY DEFINER` ne la contourne pas : `auth.uid()` lit le
--    jeton de la requête, pas le propriétaire de la fonction.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_quotes_human_acceptance on hermes_os.pv_quotes;
create trigger trg_pv_quotes_human_acceptance
  before insert or update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'ACCEPTED', 'accepted_by', 'accepted_at');

-- ---------------------------------------------------------------------------
-- 1. LES BLOCAGES D'UN DEVIS — une liste de RAISONS, pas un booléen.
--
--    Même principe que le moteur d'état de PV-4 : un écran doit pouvoir dire
--    CE QUI manque. « Non prêt » n'aide personne.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_quote_blockers(p_quote_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_q hermes_os.pv_quotes; v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_out text[] := '{}'; v_lines int;
begin
  select * into v_q from hermes_os.pv_quotes where id = p_quote_id;
  if v_q.id is null then return array['QUOTE_NOT_FOUND']; end if;

  select * into v_study from hermes_os.pv_studies where id = v_q.study_id;
  select * into v_econ  from hermes_os.pv_economics where id = v_q.economics_id;
  select * into v_p     from hermes_os.pv_prospects where id = v_q.prospect_id;
  select * into v_site  from hermes_os.pv_sites where id = v_q.site_id;
  select count(*) into v_lines from hermes_os.pv_quote_lines where quote_id = p_quote_id;

  if v_study.id is null or v_study.status is distinct from 'VALIDATED' then
    v_out := v_out || 'STUDY_NOT_VALIDATED';
  end if;
  if v_econ.id is null or v_econ.status is distinct from 'VERIFIED' then
    v_out := v_out || 'ECONOMICS_NOT_VERIFIED';
  end if;
  if v_lines = 0 then
    v_out := v_out || 'NO_LINE';
  end if;
  if v_q.total_ttc_eur is null or v_q.total_ttc_eur <= 0 then
    v_out := v_out || 'TOTAL_NOT_POSITIVE';
  end if;
  -- Identité client MINIMALE : un devis adressé à personne n'est pas un devis.
  if v_p.id is null
     or (coalesce(btrim(v_p.company_name), '') = ''
         and coalesce(btrim(v_p.last_name), '') = '') then
    v_out := v_out || 'CLIENT_IDENTITY_MISSING';
  end if;
  if v_site.id is null or coalesce(btrim(v_site.address_line1), '') = '' then
    v_out := v_out || 'SITE_MISSING';
  end if;
  if v_q.valid_until is null then
    v_out := v_out || 'VALIDITY_DATE_MISSING';
  end if;
  if v_p.opted_out then
    v_out := v_out || 'PROSPECT_OPTED_OUT';
  end if;

  return v_out;
end;
$function$;

revoke all on function hermes_os.pv_quote_blockers(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. CRÉER UN DEVIS. Uniquement depuis un dossier réellement prêt.
-- ---------------------------------------------------------------------------
create or replace function public.create_pv_quote(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_id uuid; v_num text; v_missing text[] := '{}';
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_p.opted_out then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(array['PROSPECT_OPTED_OUT']));
  end if;

  -- Site principal : le plus ancien du prospect. Même règle déterministe que
  -- la vue Affaire de PV-4 — deux règles différentes finiraient par diverger.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;
  if v_site.id is null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(array['NO_SITE']));
  end if;

  -- Étude RETENUE et chiffrage RETENU : exactement la règle de PV-4.
  select * into v_study from hermes_os.pv_studies s
   where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
   order by s.version desc limit 1;
  if v_study.id is null then
    v_missing := v_missing || 'STUDY_NOT_VALIDATED';
  else
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;
    if v_econ.id is null then
      v_missing := v_missing || 'ECONOMICS_NOT_VERIFIED';
    end if;
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(v_missing));
  end if;

  v_num := hermes_os.next_pv_quote_number(v_t, extract(year from now())::integer);

  insert into hermes_os.pv_quotes
    (tenant_id, prospect_id, site_id, study_id, economics_id, quote_number, version,
     status, valid_until, created_by, updated_by)
  values
    (v_t, v_p.id, v_site.id, v_study.id, v_econ.id, v_num, 1,
     'DRAFT', (now() + interval '30 days')::date, v_uid, v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'CREATED',
    'quote_id', v_id, 'quote_number', v_num, 'version', 1);
end;
$function$;

revoke all on function public.create_pv_quote(uuid) from public;
grant execute on function public.create_pv_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. LIGNES — ajout, modification, suppression.
--    Le total de ligne n'est PAS un paramètre : il est calculé par la colonne
--    générée. Il n'existe aucun endroit où poser un total envoyé par le client.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_quote_line(
  p_line_id      uuid,
  p_quote_id     uuid,
  p_category     text,
  p_designation  text,
  p_quantity     numeric,
  p_unit         text default 'U',
  p_unit_price_ht_eur numeric default 0,
  p_vat_rate_pct numeric default 20,
  p_discount_pct numeric default 0,
  p_description  text default null,
  p_position     integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_q hermes_os.pv_quotes; v_id uuid; v_pos integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status not in ('DRAFT', 'READY') then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_LOCKED', 'status', v_q.status);
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_QUANTITY');
  end if;
  if coalesce(p_unit_price_ht_eur, -1) < 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_PRICE');
  end if;

  if p_line_id is not null then
    update hermes_os.pv_quote_lines
       set category = coalesce(p_category, category),
           designation = coalesce(btrim(p_designation), designation),
           description = p_description,
           quantity = p_quantity,
           unit = coalesce(p_unit, unit),
           unit_price_ht_eur = p_unit_price_ht_eur,
           vat_rate_pct = coalesce(p_vat_rate_pct, vat_rate_pct),
           discount_pct = coalesce(p_discount_pct, 0),
           position = coalesce(p_position, position),
           updated_at = now()
     where id = p_line_id and tenant_id = v_t and quote_id = p_quote_id
     returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'code', 'LINE_NOT_FOUND'); end if;
  else
    select coalesce(max(position), -1) + 1 into v_pos
      from hermes_os.pv_quote_lines where quote_id = p_quote_id and tenant_id = v_t;
    insert into hermes_os.pv_quote_lines
      (tenant_id, quote_id, position, category, designation, description,
       quantity, unit, unit_price_ht_eur, vat_rate_pct, discount_pct)
    values
      (v_t, p_quote_id, coalesce(p_position, v_pos), coalesce(p_category, 'AUTRE'),
       btrim(p_designation), p_description, p_quantity, coalesce(p_unit, 'U'),
       p_unit_price_ht_eur, coalesce(p_vat_rate_pct, 20), coalesce(p_discount_pct, 0))
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'code', 'SAVED', 'line_id', v_id,
    'total_ttc_eur', (select total_ttc_eur from hermes_os.pv_quotes where id = p_quote_id));
exception
  when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_LINE');
end;
$function$;

revoke all on function public.upsert_pv_quote_line(uuid,uuid,text,text,numeric,text,numeric,numeric,numeric,text,integer) from public;
grant execute on function public.upsert_pv_quote_line(uuid,uuid,text,text,numeric,text,numeric,numeric,numeric,text,integer) to authenticated;

create or replace function public.delete_pv_quote_line(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_quote uuid; v_status text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select l.quote_id, q.status into v_quote, v_status
    from hermes_os.pv_quote_lines l
    join hermes_os.pv_quotes q on q.id = l.quote_id and q.tenant_id = l.tenant_id
   where l.id = p_line_id and l.tenant_id = v_t;
  if v_quote is null then return jsonb_build_object('ok', false, 'code', 'LINE_NOT_FOUND'); end if;
  if v_status not in ('DRAFT', 'READY') then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_LOCKED', 'status', v_status);
  end if;

  delete from hermes_os.pv_quote_lines where id = p_line_id and tenant_id = v_t;
  return jsonb_build_object('ok', true, 'code', 'DELETED',
    'total_ttc_eur', (select total_ttc_eur from hermes_os.pv_quotes where id = v_quote));
end;
$function$;

revoke all on function public.delete_pv_quote_line(uuid) from public;
grant execute on function public.delete_pv_quote_line(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. EN-TÊTE DU DEVIS — remise globale, validité, observations, conditions.
-- ---------------------------------------------------------------------------
create or replace function public.update_pv_quote(
  p_quote_id     uuid,
  p_discount_pct numeric default null,
  p_valid_until  date default null,
  p_observations text default null,
  p_terms        text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_q hermes_os.pv_quotes;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status not in ('DRAFT', 'READY') then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_LOCKED', 'status', v_q.status);
  end if;
  if p_discount_pct is not null and (p_discount_pct < 0 or p_discount_pct > 100) then
    return jsonb_build_object('ok', false, 'code', 'BAD_DISCOUNT');
  end if;

  update hermes_os.pv_quotes
     set discount_pct = coalesce(p_discount_pct, discount_pct),
         valid_until  = coalesce(p_valid_until, valid_until),
         observations = coalesce(p_observations, observations),
         terms        = coalesce(p_terms, terms),
         updated_by   = v_uid,
         updated_at   = now()
   where id = p_quote_id and tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'SAVED',
    'total_ttc_eur', (select total_ttc_eur from hermes_os.pv_quotes where id = p_quote_id));
end;
$function$;

revoke all on function public.update_pv_quote(uuid, numeric, date, text, text) from public;
grant execute on function public.update_pv_quote(uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. CHANGEMENTS D'ÉTAT — un acte humain par façade, jamais un `set status`.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_quote_ready(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_blockers text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_q.status);
  end if;

  v_blockers := hermes_os.pv_quote_blockers(p_quote_id);
  if array_length(v_blockers, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(v_blockers));
  end if;

  update hermes_os.pv_quotes
     set status = 'READY', updated_by = v_uid, updated_at = now()
   where id = p_quote_id and tenant_id = v_t;

  -- Le prospect suit l'affaire : une offre préparée, ça se voit dans le pipeline.
  update hermes_os.pv_prospects
     set status = 'OFFER_PREPARED', updated_at = now()
   where id = v_q.prospect_id and tenant_id = v_t and status = 'STUDY_DELIVERED';

  return jsonb_build_object('ok', true, 'code', 'READY');
end;
$function$;

revoke all on function public.set_pv_quote_ready(uuid) from public;
grant execute on function public.set_pv_quote_ready(uuid) to authenticated;

-- « Marquer comme envoyé » est l'ENREGISTREMENT D'UN GESTE HUMAIN, pas la preuve
-- qu'un courriel est parti. PV-5 n'envoie aucun message : le dire autrement
-- serait mentir sur ce que le système sait.
create or replace function public.send_pv_quote(p_quote_id uuid, p_issued_on date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_blockers text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status <> 'READY' then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_q.status);
  end if;

  -- Revérifiée au moment de l'envoi : le devis a pu être préparé hier, et une
  -- étude peut avoir changé de statut depuis.
  v_blockers := hermes_os.pv_quote_blockers(p_quote_id);
  if array_length(v_blockers, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(v_blockers));
  end if;

  update hermes_os.pv_quotes
     set status = 'SENT', sent_by = v_uid, sent_at = now(),
         issued_on = coalesce(p_issued_on, current_date),
         updated_by = v_uid, updated_at = now()
   where id = p_quote_id and tenant_id = v_t;

  update hermes_os.pv_prospects
     set status = 'OFFER_SENT', updated_at = now()
   where id = v_q.prospect_id and tenant_id = v_t
     and status in ('STUDY_DELIVERED', 'OFFER_PREPARED');

  return jsonb_build_object('ok', true, 'code', 'SENT');
end;
$function$;

revoke all on function public.send_pv_quote(uuid, date) from public;
grant execute on function public.send_pv_quote(uuid, date) to authenticated;

-- ACCEPTATION. Pas de signature électronique dans ce lot : on ENREGISTRE une
-- acceptation constatée, avec sa date et, si elle existe, sa preuve documentaire.
-- Le prospect passe à OFFER_ACCEPTED — PAS à WON. Gagner l'affaire reste un
-- second geste délibéré : une offre acceptée n'est pas encore un chantier.
create or replace function public.accept_pv_quote(
  p_quote_id    uuid,
  p_accepted_on date default null,
  p_reference   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_q hermes_os.pv_quotes;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_q.status);
  end if;

  update hermes_os.pv_quotes
     set status = 'ACCEPTED', accepted_by = v_uid, accepted_at = now(),
         accepted_on = coalesce(p_accepted_on, current_date),
         acceptance_reference = nullif(btrim(coalesce(p_reference, '')), ''),
         updated_by = v_uid, updated_at = now()
   where id = p_quote_id and tenant_id = v_t;

  update hermes_os.pv_prospects
     set status = 'OFFER_ACCEPTED', updated_at = now()
   where id = v_q.prospect_id and tenant_id = v_t and status = 'OFFER_SENT';

  return jsonb_build_object('ok', true, 'code', 'ACCEPTED');
end;
$function$;

revoke all on function public.accept_pv_quote(uuid, date, text) from public;
grant execute on function public.accept_pv_quote(uuid, date, text) to authenticated;

create or replace function public.refuse_pv_quote(p_quote_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_q hermes_os.pv_quotes;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_q.status);
  end if;

  update hermes_os.pv_quotes
     set status = 'REFUSED', refused_at = now(),
         refusal_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_by = v_uid, updated_at = now()
   where id = p_quote_id and tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'REFUSED');
end;
$function$;

revoke all on function public.refuse_pv_quote(uuid, text) from public;
grant execute on function public.refuse_pv_quote(uuid, text) to authenticated;

create or replace function public.cancel_pv_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_q hermes_os.pv_quotes;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status not in ('DRAFT', 'READY', 'SENT') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_q.status);
  end if;

  update hermes_os.pv_quotes
     set status = 'CANCELLED', cancelled_at = now(), updated_by = v_uid, updated_at = now()
   where id = p_quote_id and tenant_id = v_t;
  return jsonb_build_object('ok', true, 'code', 'CANCELLED');
end;
$function$;

revoke all on function public.cancel_pv_quote(uuid) from public;
grant execute on function public.cancel_pv_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RÉVISION — la SEULE façon de modifier un devis déjà transmis.
--
--    Le numéro commercial est CONSERVÉ, la version s'incrémente, les lignes sont
--    recopiées, et l'ancienne version passe à SUPERSEDED sans être touchée
--    autrement. Ce que le client a reçu reste exactement ce qu'il a reçu.
-- ---------------------------------------------------------------------------
create or replace function public.revise_pv_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_new uuid; v_version integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_q.status = 'ACCEPTED' then
    -- Un engagement accepté ne se révise pas : il se renégocie ailleurs.
    return jsonb_build_object('ok', false, 'code', 'QUOTE_ACCEPTED_IMMUTABLE');
  end if;
  if v_q.status = 'SUPERSEDED' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SUPERSEDED');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from hermes_os.pv_quotes
   where tenant_id = v_t and quote_number = v_q.quote_number;

  insert into hermes_os.pv_quotes
    (tenant_id, prospect_id, site_id, study_id, economics_id, quote_number, version,
     supersedes_quote_id, status, currency, discount_pct, valid_until,
     observations, terms, created_by, updated_by)
  values
    (v_t, v_q.prospect_id, v_q.site_id, v_q.study_id, v_q.economics_id,
     v_q.quote_number, v_version, v_q.id, 'DRAFT', v_q.currency, v_q.discount_pct,
     v_q.valid_until, v_q.observations, v_q.terms, v_uid, v_uid)
  returning id into v_new;

  insert into hermes_os.pv_quote_lines
    (tenant_id, quote_id, position, category, designation, description,
     quantity, unit, unit_price_ht_eur, vat_rate_pct, discount_pct, metadata)
  select v_t, v_new, position, category, designation, description,
         quantity, unit, unit_price_ht_eur, vat_rate_pct, discount_pct, metadata
    from hermes_os.pv_quote_lines
   where tenant_id = v_t and quote_id = v_q.id
   order by position;

  update hermes_os.pv_quotes
     set status = 'SUPERSEDED', updated_at = now()
   where id = v_q.id and tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'REVISED',
    'quote_id', v_new, 'quote_number', v_q.quote_number, 'version', v_version);
end;
$function$;

revoke all on function public.revise_pv_quote(uuid) from public;
grant execute on function public.revise_pv_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. EXPIRATION — déterministe, appelée, jamais planifiée.
--    AUCUN cron, AUCUN scheduler : n8n est hors périmètre et le rester est une
--    contrainte, pas un oubli. La péremption est aussi calculée à la LECTURE,
--    pour qu'un devis périmé se voie même si personne n'a appelé la fonction.
-- ---------------------------------------------------------------------------
create or replace function public.expire_pv_quotes()
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_n integer;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  with expired as (
    update hermes_os.pv_quotes
       set status = 'EXPIRED', expired_at = now(), updated_at = now()
     where tenant_id = v_t and status = 'SENT'
       and valid_until is not null and valid_until < current_date
    returning id)
  select count(*) into v_n from expired;

  return jsonb_build_object('ok', true, 'code', 'OK', 'expired', v_n);
end;
$function$;

revoke all on function public.expire_pv_quotes() from public;
grant execute on function public.expire_pv_quotes() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. LECTURES.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_quote(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_q hermes_os.pv_quotes;
  v_lines jsonb; v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites; v_study hermes_os.pv_studies;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  select * into v_p from hermes_os.pv_prospects where id = v_q.prospect_id and tenant_id = v_t;
  select * into v_site from hermes_os.pv_sites where id = v_q.site_id and tenant_id = v_t;
  select * into v_study from hermes_os.pv_studies where id = v_q.study_id and tenant_id = v_t;

  select coalesce(jsonb_agg(to_jsonb(l) - 'tenant_id' order by l.position), '[]'::jsonb)
    into v_lines
    from hermes_os.pv_quote_lines l
   where l.tenant_id = v_t and l.quote_id = v_q.id;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'quote', to_jsonb(v_q) - 'tenant_id',
    'lines', v_lines,
    'prospect', case when v_p.id is null then 'null'::jsonb else to_jsonb(v_p) - 'tenant_id' end,
    'site', case when v_site.id is null then 'null'::jsonb else to_jsonb(v_site) - 'tenant_id' end,
    'study', case when v_study.id is null then 'null'::jsonb else to_jsonb(v_study) - 'tenant_id' end,
    'blockers', to_jsonb(hermes_os.pv_quote_blockers(v_q.id)),
    -- Péremption CALCULÉE : visible même sans passage de `expire_pv_quotes()`.
    'is_expired', (v_q.status = 'SENT' and v_q.valid_until is not null
                   and v_q.valid_until < current_date));
end;
$function$;

revoke all on function public.get_pv_quote(uuid) from public;
grant execute on function public.get_pv_quote(uuid) to authenticated;

create or replace function public.get_pv_quotes(p_prospect_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'quote_number', q.quote_number, 'version', q.version,
           'status', q.status, 'total_ht_eur', q.total_ht_eur,
           'total_vat_eur', q.total_vat_eur, 'total_ttc_eur', q.total_ttc_eur,
           'currency', q.currency, 'issued_on', q.issued_on, 'valid_until', q.valid_until,
           'accepted_on', q.accepted_on, 'created_at', q.created_at,
           'is_expired', (q.status = 'SENT' and q.valid_until is not null
                          and q.valid_until < current_date))
           order by q.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_quotes q
           where q.tenant_id = v_t and (p_prospect_id is null or q.prospect_id = p_prospect_id)
           order by q.created_at desc limit v_lim) q;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_quotes(uuid, integer) from public;
grant execute on function public.get_pv_quotes(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. ENREGISTRER LE PDF DU DEVIS. Même contrat que `register_pv_study_summary`
--    en PV-4 : idempotence par demande, stade revérifié EN BASE, périmètre de
--    chemin, empreinte, taille.
-- ---------------------------------------------------------------------------
create or replace function public.register_pv_quote_pdf(
  p_request_id text,
  p_quote_id   uuid,
  p_stage      text,
  p_path       text,
  p_bytes      bigint,
  p_sha256     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_q hermes_os.pv_quotes; v_id uuid; v_existing uuid; v_prefix text; v_blockers text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  if p_request_id is null or length(btrim(p_request_id)) not between 8 and 200 then
    return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST_ID');
  end if;
  if p_stage not in ('QUOTE_DRAFT', 'QUOTE_FINAL') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STAGE');
  end if;

  select d.id into v_existing from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
  end if;

  select * into v_q from hermes_os.pv_quotes q where q.id = p_quote_id and q.tenant_id = v_t;
  if v_q.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  if p_stage = 'QUOTE_FINAL' then
    v_blockers := hermes_os.pv_quote_blockers(p_quote_id);
    if array_length(v_blockers, 1) is not null then
      return jsonb_build_object('ok', false, 'code', 'QUOTE_PDF_NOT_READY',
        'missing_requirements', to_jsonb(v_blockers));
    end if;
    if v_q.status = 'DRAFT' then
      return jsonb_build_object('ok', false, 'code', 'QUOTE_PDF_NOT_READY',
        'missing_requirements', to_jsonb(array['QUOTE_NOT_READY']));
    end if;
  end if;

  v_prefix := v_t || '/' || v_q.site_id::text || '/';
  if p_path is null or left(p_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 26214400 then
    return jsonb_build_object('ok', false, 'code', 'BAD_SIZE');
  end if;
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'BAD_HASH');
  end if;

  begin
    insert into hermes_os.pv_documents
      (tenant_id, site_id, study_id, economics_id, quote_id, doc_type, document_stage,
       generation_request_id, storage_bucket, storage_path, mime_type, size_bytes,
       sha256, original_filename, status, uploaded_by)
    values
      (v_t, v_q.site_id, v_q.study_id, v_q.economics_id, v_q.id, 'AUTRE', p_stage,
       btrim(p_request_id), 'hermes-pv-documents', p_path, 'application/pdf', p_bytes,
       p_sha256,
       'devis-' || v_q.quote_number || '-v' || v_q.version::text ||
         case when p_stage = 'QUOTE_DRAFT' then '-brouillon' else '' end || '.pdf',
       'LINKED', v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      select d.id into v_existing from hermes_os.pv_documents d
       where d.tenant_id = v_t and d.generation_request_id = btrim(p_request_id);
      if v_existing is not null then
        return jsonb_build_object('ok', true, 'code', 'ALREADY_GENERATED', 'document_id', v_existing);
      end if;
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OBJECT');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_DOCUMENT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'GENERATED',
    'document_id', v_id, 'stage', p_stage, 'path', p_path);
end;
$function$;

revoke all on function public.register_pv_quote_pdf(text, uuid, text, text, bigint, text) from public;
grant execute on function public.register_pv_quote_pdf(text, uuid, text, text, bigint, text) to authenticated;

commit;
