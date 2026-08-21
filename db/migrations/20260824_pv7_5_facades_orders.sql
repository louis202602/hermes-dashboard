-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 5 — Façades : besoins, plan matériel,
-- commandes, réceptions.
-- (project smubxqorirlfldatzmym)
--
-- Mêmes règles que le fichier précédent : `pv_guard()`, `search_path` verrouillé,
-- aucun paramètre de tenant ni d'acteur, `authenticated` seul destinataire.

begin;

-- ---------------------------------------------------------------------------
-- 1. BESOINS.
-- ---------------------------------------------------------------------------
create or replace function public.add_pv_material_requirement(
  p_prospect_id uuid,
  p_quantity numeric,
  p_material_id uuid default null,
  p_free_designation text default null,
  p_unit text default 'U',
  p_is_mandatory boolean default true,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_p from hermes_os.pv_prospects p where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  -- Site principal : le PLUS ANCIEN du prospect. Même règle déterministe qu'en
  -- PV-4, PV-5 et PV-6 — quatre règles différentes désigneraient quatre sites.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;
  if v_site.id is null then return jsonb_build_object('ok', false, 'code', 'NO_SITE'); end if;

  if num_nonnulls(p_material_id, nullif(btrim(coalesce(p_free_designation,'')), '')) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUIREMENT');
  end if;

  begin
    insert into hermes_os.pv_material_requirements
      (tenant_id, prospect_id, site_id, material_id, free_designation,
       quantity_required, unit, origin, is_mandatory,
       -- Saisi à la main SUR le catalogue : consolidable tel quel. Saisi en
       -- texte libre : le besoin existe, mais ce qu'il représente reste à dire.
       needs_confirmation, comment, created_by, updated_by)
    values (v_t, v_p.id, v_site.id, p_material_id,
            nullif(btrim(coalesce(p_free_designation,'')), ''),
            p_quantity, coalesce(p_unit,'U'), 'MANUAL', coalesce(p_is_mandatory, true),
            p_material_id is null, p_comment, v_uid, v_uid)
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REQUIREMENT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'ADDED', 'requirement_id', v_id);
end;
$function$;

revoke all on function public.add_pv_material_requirement(uuid,numeric,uuid,text,text,boolean,text) from public;
grant execute on function public.add_pv_material_requirement(uuid,numeric,uuid,text,text,boolean,text) to authenticated;

-- Dérivation depuis les artefacts RETENUS de l'affaire. Idempotente : relancer
-- ne redouble aucun besoin déjà dérivé (clé = ligne de devis ou écart de visite).
create or replace function public.derive_pv_material_requirements(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_quote uuid; v_survey uuid; v_from_quote int := 0; v_from_survey int := 0;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id order by s.created_at, s.id limit 1;
  if v_site.id is null then return jsonb_build_object('ok', false, 'code', 'NO_SITE'); end if;

  -- Devis RETENU : l'ACCEPTÉ. À défaut, le dernier SENT. Jamais un brouillon —
  -- approvisionner d'après un brouillon reviendrait à commander d'après une idée.
  select q.id into v_quote from hermes_os.pv_quotes q
   where q.tenant_id = v_t and q.site_id = v_site.id and q.status = 'ACCEPTED'
   order by q.accepted_at desc nulls last, q.created_at desc limit 1;
  if v_quote is null then
    select q.id into v_quote from hermes_os.pv_quotes q
     where q.tenant_id = v_t and q.site_id = v_site.id and q.status = 'SENT'
     order by q.created_at desc limit 1;
  end if;

  select v.id into v_survey from hermes_os.pv_site_surveys v
   where v.tenant_id = v_t and v.site_id = v_site.id and v.status = 'VALIDATED'
   order by v.validated_at desc limit 1;

  if v_quote is not null then
    v_from_quote := hermes_os.pv_derive_requirements_from_quote(v_quote);
  end if;
  if v_survey is not null then
    v_from_survey := hermes_os.pv_derive_requirements_from_survey(v_survey);
  end if;

  return jsonb_build_object('ok', true, 'code', 'DERIVED',
    'from_quote', v_from_quote, 'from_survey', v_from_survey,
    'quote_id', v_quote, 'survey_id', v_survey);
end;
$function$;

revoke all on function public.derive_pv_material_requirements(uuid) from public;
grant execute on function public.derive_pv_material_requirements(uuid) to authenticated;

-- CONFIRMER un besoin issu de texte libre. Geste humain : la base refuse un
-- appelant non authentifié, et c'est ce geste qui autorise le besoin à compter
-- dans la readiness matériel.
create or replace function public.confirm_pv_material_requirement(
  p_requirement_id uuid, p_material_id uuid default null, p_quantity numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED'); end if;

  begin
    update hermes_os.pv_material_requirements
       set material_id = coalesce(p_material_id, material_id),
           free_designation = case when coalesce(p_material_id, material_id) is not null
                                   then null else free_designation end,
           quantity_required = coalesce(p_quantity, quantity_required),
           confirmed_by = v_uid, confirmed_at = now(),
           updated_by = v_uid, updated_at = now()
     where id = p_requirement_id and tenant_id = v_t and status = 'ACTIVE'
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REQUIREMENT');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'code', 'CONFIRMED', 'requirement_id', v_id);
end;
$function$;

revoke all on function public.confirm_pv_material_requirement(uuid, uuid, numeric) from public;
grant execute on function public.confirm_pv_material_requirement(uuid, uuid, numeric) to authenticated;

create or replace function public.dismiss_pv_material_requirement(p_requirement_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  update hermes_os.pv_material_requirements
     set status = 'DISMISSED', dismissal_reason = btrim(p_reason),
         updated_by = v_uid, updated_at = now()
   where id = p_requirement_id and tenant_id = v_t
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'code', 'DISMISSED');
end;
$function$;

revoke all on function public.dismiss_pv_material_requirement(uuid, text) from public;
grant execute on function public.dismiss_pv_material_requirement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. LE PLAN MATÉRIEL — une lecture, toute la réponse.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_material_plan(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_reqs jsonb; v_balance jsonb; v_orders jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id order by s.created_at, s.id limit 1;
  if v_site.id is null then
    return jsonb_build_object('ok', true, 'code', 'NO_SITE', 'requirements', '[]'::jsonb,
      'balance', '[]'::jsonb, 'orders', '[]'::jsonb, 'readiness', 'NOT_READY',
      'costs', jsonb_build_object('margin_reliable', false));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'material_id', r.material_id,
           'designation', coalesce(c.designation, r.free_designation),
           'sku', c.sku, 'quantity_required', r.quantity_required, 'unit', r.unit,
           'origin', r.origin, 'source_entity_id', r.source_entity_id,
           'is_mandatory', r.is_mandatory, 'needs_confirmation', r.needs_confirmation,
           'confirmed_at', r.confirmed_at, 'status', r.status,
           'dismissal_reason', r.dismissal_reason, 'comment', r.comment)
           order by r.is_mandatory desc, r.origin, r.created_at), '[]'::jsonb)
    into v_reqs
    from hermes_os.pv_material_requirements r
    left join hermes_os.pv_material_catalog c on c.id = r.material_id and c.tenant_id = r.tenant_id
   where r.tenant_id = v_t and r.site_id = v_site.id;

  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into v_balance
    from hermes_os.pv_material_balance(v_t, v_site.id) b;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'status', o.status,
           'supplier_id', o.supplier_id, 'supplier_name', s.name,
           'subtotal_ht_eur', o.subtotal_ht_eur, 'total_ttc_eur', o.total_ttc_eur,
           'ordered_on', o.ordered_on, 'expected_delivery_on', o.expected_delivery_on,
           'received_on', o.received_on,
           'line_count', (select count(*) from hermes_os.pv_purchase_order_lines l
                           where l.tenant_id = v_t and l.order_id = o.id))
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from hermes_os.pv_purchase_orders o
    join hermes_os.pv_suppliers s on s.id = o.supplier_id and s.tenant_id = o.tenant_id
   where o.tenant_id = v_t and o.site_id = v_site.id;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'site_id', v_site.id,
    'requirements', v_reqs,
    'balance', v_balance,
    'orders', v_orders,
    'readiness', hermes_os.pv_material_readiness(v_t, v_site.id),
    'costs', hermes_os.pv_material_costs(v_t, v_site.id));
end;
$function$;

revoke all on function public.get_pv_material_plan(uuid) from public;
grant execute on function public.get_pv_material_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. COMMANDES.
-- ---------------------------------------------------------------------------
create or replace function public.create_pv_purchase_order(
  p_prospect_id uuid, p_supplier_id uuid, p_expected_delivery_on date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites; v_id uuid; v_num text;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_p from hermes_os.pv_prospects p where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id order by s.created_at, s.id limit 1;
  if v_site.id is null then return jsonb_build_object('ok', false, 'code', 'NO_SITE'); end if;

  if not exists (select 1 from hermes_os.pv_suppliers s
                  where s.id = p_supplier_id and s.tenant_id = v_t) then
    return jsonb_build_object('ok', false, 'code', 'SUPPLIER_NOT_FOUND');
  end if;

  v_num := hermes_os.next_pv_purchase_order_number(v_t, extract(year from now())::integer);

  insert into hermes_os.pv_purchase_orders
    (tenant_id, supplier_id, prospect_id, site_id, order_number, status,
     expected_delivery_on, created_by, updated_by)
  values (v_t, p_supplier_id, v_p.id, v_site.id, v_num, 'DRAFT',
          p_expected_delivery_on, v_uid, v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'CREATED', 'order_id', v_id, 'order_number', v_num);
end;
$function$;

revoke all on function public.create_pv_purchase_order(uuid, uuid, date) from public;
grant execute on function public.create_pv_purchase_order(uuid, uuid, date) to authenticated;

-- Aucun total n'est paramètre : il vient de la colonne générée et du déclencheur.
create or replace function public.upsert_pv_purchase_order_line(
  p_line_id uuid,
  p_order_id uuid,
  p_designation text,
  p_quantity numeric,
  p_unit text default 'U',
  p_unit_price_ht_eur numeric default 0,
  p_vat_rate_pct numeric default 20,
  p_material_id uuid default null,
  p_supplier_ref text default null,
  p_expected_delivery_on date default null,
  p_requirement_id uuid default null,
  p_position integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_o hermes_os.pv_purchase_orders; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_o from hermes_os.pv_purchase_orders o where o.id = p_order_id and o.tenant_id = v_t;
  if v_o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_o.status not in ('DRAFT','READY') then
    return jsonb_build_object('ok', false, 'code', 'ORDER_LOCKED', 'status', v_o.status);
  end if;

  begin
    if p_line_id is null then
      insert into hermes_os.pv_purchase_order_lines
        (tenant_id, order_id, position, material_id, designation, supplier_ref,
         quantity, unit, unit_price_ht_eur, vat_rate_pct, expected_delivery_on, requirement_id)
      values (v_t, p_order_id,
              coalesce(p_position, (select coalesce(max(position), -1) + 1
                                      from hermes_os.pv_purchase_order_lines
                                     where order_id = p_order_id and tenant_id = v_t)),
              p_material_id, p_designation, p_supplier_ref, p_quantity, coalesce(p_unit,'U'),
              coalesce(p_unit_price_ht_eur, 0), coalesce(p_vat_rate_pct, 20),
              p_expected_delivery_on, p_requirement_id)
      returning id into v_id;
    else
      update hermes_os.pv_purchase_order_lines
         set material_id = coalesce(p_material_id, material_id),
             designation = coalesce(p_designation, designation),
             supplier_ref = coalesce(p_supplier_ref, supplier_ref),
             quantity = coalesce(p_quantity, quantity),
             unit = coalesce(p_unit, unit),
             unit_price_ht_eur = coalesce(p_unit_price_ht_eur, unit_price_ht_eur),
             vat_rate_pct = coalesce(p_vat_rate_pct, vat_rate_pct),
             expected_delivery_on = coalesce(p_expected_delivery_on, expected_delivery_on),
             requirement_id = coalesce(p_requirement_id, requirement_id),
             updated_at = now()
       where id = p_line_id and tenant_id = v_t and order_id = p_order_id
      returning id into v_id;
      if v_id is null then return jsonb_build_object('ok', false, 'code', 'LINE_NOT_FOUND'); end if;
    end if;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_LINE');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'SAVED', 'line_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_purchase_order_line(uuid,uuid,text,numeric,text,numeric,numeric,uuid,text,date,uuid,integer) from public;
grant execute on function public.upsert_pv_purchase_order_line(uuid,uuid,text,numeric,text,numeric,numeric,uuid,text,date,uuid,integer) to authenticated;

create or replace function public.delete_pv_purchase_order_line(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';
  begin
    delete from hermes_os.pv_purchase_order_lines
     where id = p_line_id and tenant_id = v_t
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'ORDER_LOCKED');
  end;
  if v_id is null then return jsonb_build_object('ok', false, 'code', 'LINE_NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'code', 'DELETED');
end;
$function$;

revoke all on function public.delete_pv_purchase_order_line(uuid) from public;
grant execute on function public.delete_pv_purchase_order_line(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. LES DEUX GESTES ENGAGEANTS.
-- ---------------------------------------------------------------------------
create or replace function public.set_pv_purchase_order_ready(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
        v_o hermes_os.pv_purchase_orders; v_block text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_o from hermes_os.pv_purchase_orders o where o.id = p_order_id and o.tenant_id = v_t;
  if v_o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_o.status = 'READY' then return jsonb_build_object('ok', true, 'code', 'ALREADY_READY'); end if;

  v_block := hermes_os.pv_purchase_blockers(p_order_id);
  if array_length(v_block, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_READY',
      'missing_requirements', to_jsonb(v_block));
  end if;

  begin
    update hermes_os.pv_purchase_orders
       set status = 'READY', approved_by = v_uid, approved_at = now(),
           updated_by = v_uid, updated_at = now()
     where id = p_order_id and tenant_id = v_t;
  exception
    when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_o.status);
  end;

  return jsonb_build_object('ok', true, 'code', 'READY');
end;
$function$;

revoke all on function public.set_pv_purchase_order_ready(uuid) from public;
grant execute on function public.set_pv_purchase_order_ready(uuid) to authenticated;

-- ⚠️ NE COMMANDE RIEN CHEZ PERSONNE. Enregistre qu'un humain déclare l'avoir fait.
create or replace function public.mark_pv_purchase_order_ordered(
  p_order_id uuid, p_ordered_on date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
        v_o hermes_os.pv_purchase_orders; v_block text[];
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_o from hermes_os.pv_purchase_orders o where o.id = p_order_id and o.tenant_id = v_t;
  if v_o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_o.status = 'ORDERED' then return jsonb_build_object('ok', true, 'code', 'ALREADY_ORDERED'); end if;

  v_block := hermes_os.pv_purchase_blockers(p_order_id);
  if array_length(v_block, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_READY',
      'missing_requirements', to_jsonb(v_block));
  end if;

  begin
    update hermes_os.pv_purchase_orders
       set status = 'ORDERED', ordered_by = v_uid, ordered_at = now(),
           ordered_on = coalesce(p_ordered_on, current_date),
           updated_by = v_uid, updated_at = now()
     where id = p_order_id and tenant_id = v_t;
  exception
    when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_o.status);
  end;

  return jsonb_build_object('ok', true, 'code', 'ORDERED');
end;
$function$;

revoke all on function public.mark_pv_purchase_order_ordered(uuid, date) from public;
grant execute on function public.mark_pv_purchase_order_ordered(uuid, date) to authenticated;

create or replace function public.cancel_pv_purchase_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_o hermes_os.pv_purchase_orders;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_o from hermes_os.pv_purchase_orders o where o.id = p_order_id and o.tenant_id = v_t;
  if v_o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  begin
    update hermes_os.pv_purchase_orders
       set status = 'CANCELLED', cancelled_at = now(), cancellation_reason = btrim(p_reason),
           updated_by = v_uid, updated_at = now()
     where id = p_order_id and tenant_id = v_t;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'TRANSITION_REFUSED', 'from', v_o.status);
  end;

  return jsonb_build_object('ok', true, 'code', 'CANCELLED');
end;
$function$;

revoke all on function public.cancel_pv_purchase_order(uuid, text) from public;
grant execute on function public.cancel_pv_purchase_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RÉCEPTION — partielle par nature.
-- ---------------------------------------------------------------------------
create or replace function public.record_pv_purchase_receipt(
  p_line_id uuid,
  p_quantity numeric,
  p_received_on date default null,
  p_delivery_note_ref text default null,
  p_condition text default 'CONFORME',
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid;
  v_line hermes_os.pv_purchase_order_lines; v_o hermes_os.pv_purchase_orders; v_id uuid;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_line from hermes_os.pv_purchase_order_lines l
   where l.id = p_line_id and l.tenant_id = v_t;
  if v_line.id is null then return jsonb_build_object('ok', false, 'code', 'LINE_NOT_FOUND'); end if;

  select * into v_o from hermes_os.pv_purchase_orders o
   where o.id = v_line.order_id and o.tenant_id = v_t;
  -- On ne reçoit QUE ce qui a été commandé. Une commande DRAFT ou READY n'a
  -- jamais été passée : il n'y a rien à réceptionner.
  if v_o.status not in ('ORDERED', 'PARTIALLY_RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_ORDERED', 'status', v_o.status);
  end if;

  begin
    insert into hermes_os.pv_purchase_receipts
      (tenant_id, order_id, line_id, quantity_received, received_on,
       delivery_note_ref, condition, comment, received_by)
    values (v_t, v_line.order_id, p_line_id, p_quantity,
            coalesce(p_received_on, current_date), p_delivery_note_ref,
            coalesce(p_condition, 'CONFORME'), p_comment, v_uid)
    returning id into v_id;
  exception
    when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'VALIDATION_REFUSED');
    when check_violation then
      return jsonb_build_object('ok', false, 'code',
        case when sqlerrm like 'PV_RECEPTION_EXCEDENTAIRE%' then 'OVER_RECEIPT'
             else 'INVALID_RECEIPT' end,
        'detail', sqlerrm);
  end;

  select * into v_line from hermes_os.pv_purchase_order_lines l where l.id = p_line_id and l.tenant_id = v_t;
  select * into v_o from hermes_os.pv_purchase_orders o where o.id = v_line.order_id and o.tenant_id = v_t;

  return jsonb_build_object('ok', true, 'code', 'RECEIVED',
    'receipt_id', v_id,
    'line_received', v_line.quantity_received,
    'line_ordered', v_line.quantity,
    'line_missing', greatest(v_line.quantity - v_line.quantity_received, 0),
    'order_status', v_o.status);
end;
$function$;

revoke all on function public.record_pv_purchase_receipt(uuid,numeric,date,text,text,text) from public;
grant execute on function public.record_pv_purchase_receipt(uuid,numeric,date,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. LECTURES DES COMMANDES.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_purchase_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard(); v_t text;
  o hermes_os.pv_purchase_orders; s hermes_os.pv_suppliers; p hermes_os.pv_prospects;
  v_lines jsonb; v_receipts jsonb; v_docs jsonb; v_next jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into o from hermes_os.pv_purchase_orders x where x.id = p_order_id and x.tenant_id = v_t;
  if o.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  select * into s from hermes_os.pv_suppliers where id = o.supplier_id and tenant_id = v_t;
  select * into p from hermes_os.pv_prospects where id = o.prospect_id and tenant_id = v_t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'position', l.position, 'material_id', l.material_id,
           'sku', c.sku, 'designation', l.designation, 'supplier_ref', l.supplier_ref,
           'quantity', l.quantity, 'unit', l.unit,
           'unit_price_ht_eur', l.unit_price_ht_eur, 'vat_rate_pct', l.vat_rate_pct,
           'line_total_ht_eur', l.line_total_ht_eur,
           'quantity_received', l.quantity_received,
           'quantity_missing', greatest(l.quantity - l.quantity_received, 0),
           'expected_delivery_on', l.expected_delivery_on,
           'requirement_id', l.requirement_id)
           order by l.position, l.created_at), '[]'::jsonb)
    into v_lines
    from hermes_os.pv_purchase_order_lines l
    left join hermes_os.pv_material_catalog c on c.id = l.material_id and c.tenant_id = l.tenant_id
   where l.tenant_id = v_t and l.order_id = o.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'line_id', r.line_id, 'quantity_received', r.quantity_received,
           'received_on', r.received_on, 'delivery_note_ref', r.delivery_note_ref,
           'condition', r.condition, 'comment', r.comment, 'created_at', r.created_at)
           order by r.received_on desc, r.created_at desc), '[]'::jsonb)
    into v_receipts
    from hermes_os.pv_purchase_receipts r
   where r.tenant_id = v_t and r.order_id = o.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
           'original_filename', d.original_filename, 'mime_type', d.mime_type,
           'size_bytes', d.size_bytes, 'storage_path', d.storage_path,
           'uploaded_at', d.uploaded_at) order by d.uploaded_at desc), '[]'::jsonb)
    into v_docs
    from hermes_os.pv_documents d
   where d.tenant_id = v_t and d.purchase_order_id = o.id and d.deleted_at is null;

  -- Suites possibles, LUES dans la table de transitions : l'écran ne redéclare
  -- pas la machine à états. `READY` et `ORDERED` en sont retirés — ils ont leurs
  -- façades, qui portent les gardes humaines et la porte de commande.
  select coalesce(jsonb_agg(t.to_status order by t.to_status), '[]'::jsonb)
    into v_next
    from hermes_os.pv_purchase_order_transitions t
   where t.from_status = o.status and t.to_status not in ('READY','ORDERED');

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'order', to_jsonb(o) - 'tenant_id',
    'supplier', case when s.id is null then 'null'::jsonb else to_jsonb(s) - 'tenant_id' end,
    'prospect', case when p.id is null then 'null'::jsonb else to_jsonb(p) - 'tenant_id' end,
    'lines', v_lines,
    'receipts', v_receipts,
    'documents', v_docs,
    'next_statuses', v_next,
    'blockers', to_jsonb(hermes_os.pv_purchase_blockers(o.id)));
end;
$function$;

revoke all on function public.get_pv_purchase_order(uuid) from public;
grant execute on function public.get_pv_purchase_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. LA VUE AFFAIRE apprend l'état du matériel.
--    UN champ ajouté à `get_pv_deal`, lu par la même fonction que l'écran.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_deal(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_p hermes_os.pv_prospects;
  v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies;
  v_latest hermes_os.pv_studies;
  v_econ hermes_os.pv_economics;
  v_cons jsonb; v_bill jsonb; v_assum jsonb; v_docs jsonb; v_studies jsonb;
  v_gate text := 'NONE'; v_material text := 'NOT_READY';
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;

  if v_site.id is not null then
    select coalesce(to_jsonb(c) - 'tenant_id', 'null'::jsonb) into v_cons
      from hermes_os.pv_consumption_profiles c
     where c.tenant_id = v_t and c.site_id = v_site.id
     order by c.created_at desc limit 1;

    select coalesce(to_jsonb(b) - 'tenant_id', 'null'::jsonb) into v_bill
      from hermes_os.pv_energy_bills b
     where b.tenant_id = v_t and b.site_id = v_site.id and b.status = 'VERIFIED'
     order by b.period_end desc nulls last, b.created_at desc limit 1;

    select * into v_study from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
     order by s.version desc limit 1;

    select * into v_latest from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id
     order by s.version desc limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'version', s.version, 'status', s.status,
             'prepared_by', s.prepared_by, 'target_power_kwc', s.target_power_kwc)
             order by s.version desc), '[]'::jsonb)
      into v_studies
      from hermes_os.pv_studies s
     where s.tenant_id = v_t and s.site_id = v_site.id;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'document_stage', d.document_stage,
             'original_filename', d.original_filename, 'mime_type', d.mime_type,
             'size_bytes', d.size_bytes, 'status', d.status,
             'storage_path', d.storage_path, 'uploaded_at', d.uploaded_at)
             order by d.uploaded_at desc), '[]'::jsonb)
      into v_docs
      from hermes_os.pv_documents d
     where d.tenant_id = v_t and d.site_id = v_site.id and d.deleted_at is null;

    v_gate := hermes_os.pv_survey_gate(v_t, v_site.id);
    v_material := hermes_os.pv_material_readiness(v_t, v_site.id);
  end if;

  if v_study.id is not null then
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;

    select coalesce(to_jsonb(a) - 'tenant_id', 'null'::jsonb) into v_assum
      from hermes_os.pv_study_assumptions a
     where a.tenant_id = v_t and a.study_id = v_study.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'prospect', to_jsonb(v_p) - 'tenant_id',
    'site', case when v_site.id is null then 'null'::jsonb else to_jsonb(v_site) - 'tenant_id' end,
    'consumption', coalesce(v_cons, 'null'::jsonb),
    'verified_bill', coalesce(v_bill, 'null'::jsonb),
    'retained_study', case when v_study.id is null then 'null'::jsonb else to_jsonb(v_study) - 'tenant_id' end,
    'latest_study', case when v_latest.id is null then 'null'::jsonb else to_jsonb(v_latest) - 'tenant_id' end,
    'retained_assumptions', coalesce(v_assum, 'null'::jsonb),
    'retained_economics', case when v_econ.id is null then 'null'::jsonb else to_jsonb(v_econ) - 'tenant_id' end,
    'studies', coalesce(v_studies, '[]'::jsonb),
    'documents', coalesce(v_docs, '[]'::jsonb),
    'survey_gate', v_gate,
    'material_readiness', v_material);
end;
$function$;

revoke all on function public.get_pv_deal(uuid) from public;
grant execute on function public.get_pv_deal(uuid) to authenticated;

commit;
