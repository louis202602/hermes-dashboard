-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 4 — Écart matériel, readiness, coûts, façades.
-- (project smubxqorirlfldatzmym)
--
-- Même contrat que PV-1 à PV-6 : tables en deny-all, accès par façades
-- `SECURITY DEFINER` accordées au seul rôle `authenticated`, tenant résolu
-- SERVEUR, `search_path` verrouillé, aucun paramètre de tenant ni d'acteur.
--
-- PERMISSIONS — décision documentée. Commander du matériel est un geste
-- d'exploitation, pas d'administration : un conducteur de travaux doit pouvoir
-- préparer et passer une commande sans compte administrateur. Toutes les façades
-- de ce lot passent donc par `pv_guard()` (membre du tenant), comme la visite en
-- PV-6 et la validation d'étude en PV-3. La seule irréversibilité du Pack PV, la
-- purge d'octets, reste réservée à `tenant.admin` (PV-4).

begin;

-- ---------------------------------------------------------------------------
-- 1. L'ÉCART MATÉRIEL — même philosophie que PV-6, appliquée au matériel.
--
--    Trois grandeurs distinctes, jamais confondues : BESOIN, COMMANDÉ, REÇU.
--    Les additionner ou n'en montrer qu'une reviendrait à cacher l'écart.
--
--    « COMMANDÉ » ne compte que les commandes RÉELLEMENT passées — `ORDERED`,
--    `PARTIALLY_RECEIVED`, `RECEIVED`. Un brouillon n'est pas une commande, et
--    le faire compter donnerait l'illusion d'un approvisionnement lancé.
--
--    ORDRE DE PRIORITÉ des statuts, déterministe et documenté :
--      1. reçu > besoin                       → OVER_ORDERED
--      2. reçu = besoin                       → RECEIVED
--      3. plus rien en attente, et il manque  → SHORTAGE
--      4. reçu > 0                            → PARTIALLY_RECEIVED
--      5. rien de commandé                    → NOT_ORDERED
--      6. commandé >= besoin                  → ORDERED
--      7. sinon                               → PARTIALLY_ORDERED
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_material_balance(p_tenant text, p_site_id uuid)
returns table (
  material_id       uuid,
  designation       text,
  unit              text,
  qty_required      numeric,
  qty_ordered       numeric,
  qty_received      numeric,
  qty_open          numeric,
  gap               numeric,
  status            text,
  is_mandatory      boolean,
  needs_confirmation boolean,
  origins           text[]
)
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
with req as (
  select r.material_id,
         coalesce(c.designation, r.free_designation) as designation,
         r.unit,
         sum(r.quantity_required)                                as qty_required,
         bool_or(r.is_mandatory)                                 as is_mandatory,
         bool_or(r.needs_confirmation and r.confirmed_at is null) as needs_confirmation,
         array_agg(distinct r.origin order by r.origin)          as origins
    from hermes_os.pv_material_requirements r
    left join hermes_os.pv_material_catalog c
           on c.id = r.material_id and c.tenant_id = r.tenant_id
   where r.tenant_id = p_tenant and r.site_id = p_site_id and r.status = 'ACTIVE'
   group by r.material_id, coalesce(c.designation, r.free_designation), r.unit
),
ord as (
  select l.material_id,
         lower(btrim(l.designation)) as key,
         sum(case when o.status in ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
                  then l.quantity else 0 end)            as qty_ordered,
         sum(l.quantity_received)                        as qty_received,
         sum(case when o.status in ('ORDERED','PARTIALLY_RECEIVED')
                  then greatest(l.quantity - l.quantity_received, 0) else 0 end) as qty_open
    from hermes_os.pv_purchase_order_lines l
    join hermes_os.pv_purchase_orders o
      on o.id = l.order_id and o.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant and o.site_id = p_site_id and o.status <> 'CANCELLED'
   group by l.material_id, lower(btrim(l.designation))
)
select
  req.material_id,
  req.designation,
  req.unit,
  req.qty_required,
  coalesce(o.qty_ordered, 0)  as qty_ordered,
  coalesce(o.qty_received, 0) as qty_received,
  coalesce(o.qty_open, 0)     as qty_open,
  req.qty_required - coalesce(o.qty_received, 0) as gap,
  case
    when coalesce(o.qty_received, 0) > req.qty_required            then 'OVER_ORDERED'
    when coalesce(o.qty_received, 0) = req.qty_required            then 'RECEIVED'
    when coalesce(o.qty_open, 0) = 0 and coalesce(o.qty_ordered, 0) = 0 then 'NOT_ORDERED'
    when coalesce(o.qty_open, 0) = 0                               then 'SHORTAGE'
    when coalesce(o.qty_received, 0) > 0                           then 'PARTIALLY_RECEIVED'
    when coalesce(o.qty_ordered, 0) >= req.qty_required            then 'ORDERED'
    else 'PARTIALLY_ORDERED'
  end as status,
  req.is_mandatory,
  req.needs_confirmation,
  req.origins
  from req
  -- Rapprochement : par ARTICLE quand il est catalogué, par désignation exacte
  -- sinon. Aucune correspondance approximative — deux libellés différents
  -- restent deux lignes, et l'écran le montre plutôt que de les fondre.
  left join ord o
    on (req.material_id is not null and o.material_id = req.material_id)
    or (req.material_id is null and o.material_id is null
        and o.key = lower(btrim(req.designation)))
 order by req.is_mandatory desc, req.designation;
$function$;

revoke all on function hermes_os.pv_material_balance(text, uuid) from public;

comment on function hermes_os.pv_material_balance(text, uuid) is
  'PV-7 — BESOIN / COMMANDE / RECU, jamais confondus. Un brouillon de commande ne compte pas comme commande.';

-- ---------------------------------------------------------------------------
-- 2. READINESS MATÉRIEL — prépare PV-8, sans construire le planning.
--
--    `READY` exige DEUX choses, et la seconde est le garde-fou de ce lot :
--      1. tout besoin OBLIGATOIRE est couvert par les quantités REÇUES ;
--      2. aucun besoin obligatoire n'attend encore une confirmation humaine.
--
--    Sans (2), un besoin dérivé de texte libre — « Pose de panneaux, forfait » —
--    pourrait faire passer une affaire en « prête » alors que personne n'a jamais
--    dit ce que ce forfait contient.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_material_readiness(p_tenant text, p_site_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_total int; v_covered int; v_pending_confirmation int; v_any_movement numeric;
begin
  select count(*) filter (where b.is_mandatory),
         count(*) filter (where b.is_mandatory and b.qty_received >= b.qty_required),
         count(*) filter (where b.is_mandatory and b.needs_confirmation),
         coalesce(sum(b.qty_ordered + b.qty_received), 0)
    into v_total, v_covered, v_pending_confirmation, v_any_movement
    from hermes_os.pv_material_balance(p_tenant, p_site_id) b;

  if v_total = 0 then return 'NOT_READY'; end if;
  if v_pending_confirmation > 0 then
    -- Un besoin non confirmé peut être couvert « par hasard » : cela ne prouve
    -- rien. Le dossier reste au mieux PARTIEL tant qu'un humain n'a pas tranché.
    return case when v_any_movement > 0 then 'PARTIAL' else 'NOT_READY' end;
  end if;
  if v_covered = v_total then return 'READY'; end if;
  if v_any_movement > 0 then return 'PARTIAL'; end if;
  return 'NOT_READY';
end;
$function$;

revoke all on function hermes_os.pv_material_readiness(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. LA PORTE DE COMMANDE.
--
--    ON NE COMMANDE PAS AVANT QUE LE CLIENT AIT ACCEPTÉ. Une commande engage
--    l'argent de l'entreprise sur une affaire qui peut encore s'évanouir ; et on
--    ne commande pas non plus sur un site dont la visite technique n'a pas
--    confirmé qu'on pourra poser.
--
--    Un BROUILLON reste libre : on prépare son approvisionnement quand on veut.
--    C'est `READY` et `ORDERED` qui exigent la preuve.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_purchase_blockers(p_order_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  o hermes_os.pv_purchase_orders; v_out text[] := '{}'; v_lines int;
  v_gate text; v_accepted int; v_blocking int;
begin
  select * into o from hermes_os.pv_purchase_orders where id = p_order_id;
  if o.id is null then return array['ORDER_NOT_FOUND']; end if;

  select count(*) into v_lines from hermes_os.pv_purchase_order_lines where order_id = p_order_id;
  if v_lines = 0 then v_out := array_append(v_out, 'NO_LINE'); end if;
  if o.subtotal_ht_eur is null or o.subtotal_ht_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;

  if not exists (select 1 from hermes_os.pv_suppliers s
                  where s.id = o.supplier_id and s.tenant_id = o.tenant_id and s.is_active) then
    v_out := array_append(v_out, 'SUPPLIER_INACTIVE');
  end if;

  -- Preuve commerciale : un devis ACCEPTÉ sur cette affaire.
  select count(*) into v_accepted from hermes_os.pv_quotes q
   where q.tenant_id = o.tenant_id and q.site_id = o.site_id and q.status = 'ACCEPTED';
  if v_accepted = 0 then v_out := array_append(v_out, 'QUOTE_NOT_ACCEPTED'); end if;

  -- Preuve terrain : la porte de visite de PV-6, réutilisée telle quelle.
  v_gate := hermes_os.pv_survey_gate(o.tenant_id, o.site_id);
  if v_gate = 'BLOCKING' then
    v_out := array_append(v_out, 'SITE_SURVEY_BLOCKING');
  elsif v_gate <> 'OK' then
    v_out := array_append(v_out, 'SITE_SURVEY_NOT_VALIDATED');
  end if;

  select count(*) into v_blocking
    from hermes_os.pv_site_survey_findings f
    join hermes_os.pv_site_surveys v on v.id = f.survey_id and v.tenant_id = f.tenant_id
   where f.tenant_id = o.tenant_id and v.site_id = o.site_id
     and f.is_blocking and f.resolution is null
     and v.status <> 'CANCELLED';
  if v_blocking > 0 then v_out := array_append(v_out, 'SURVEY_FINDINGS_UNRESOLVED'); end if;

  return v_out;
end;
$function$;

revoke all on function hermes_os.pv_purchase_blockers(uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. COÛTS — et le refus d'annoncer une marge qu'on ne connaît pas.
--
--    Le prix de VENTE vit dans `pv_quote_lines`. Le COÛT D'ACHAT vit ici. Ils ne
--    se remplacent jamais l'un l'autre — aucune fonction de ce lot n'écrit dans
--    `pv_quote_lines`.
--
--    `margin_reliable` est faux dès qu'un besoin obligatoire attend une
--    confirmation, ou qu'un besoin n'a pas de coût connu. L'écran affiche alors
--    « MARGE MATÉRIELLE INDICATIVE — incomplète » plutôt qu'un chiffre faux.
--    Et le libellé dit MATÉRIELLE : la main-d'œuvre n'est pas séparée dans
--    `pv_quote_lines`, donc ce n'est PAS une marge d'affaire.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_material_costs(p_tenant text, p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_planned numeric := 0; v_ordered numeric := 0; v_received numeric := 0;
  v_unknown int := 0; v_pending int := 0; v_quote_ht numeric; v_reliable boolean;
begin
  select coalesce(sum(b.qty_required * coalesce(c.unit_cost_ht_eur, 0)), 0),
         count(*) filter (where c.unit_cost_ht_eur is null),
         count(*) filter (where b.needs_confirmation)
    into v_planned, v_unknown, v_pending
    from hermes_os.pv_material_balance(p_tenant, p_site_id) b
    left join hermes_os.pv_material_catalog c
           on c.id = b.material_id and c.tenant_id = p_tenant;

  select coalesce(sum(case when o.status in ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
                           then l.line_total_ht_eur else 0 end), 0),
         coalesce(sum(round(l.quantity_received * l.unit_price_ht_eur, 2)), 0)
    into v_ordered, v_received
    from hermes_os.pv_purchase_order_lines l
    join hermes_os.pv_purchase_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant and o.site_id = p_site_id and o.status <> 'CANCELLED';

  select q.total_ht_eur into v_quote_ht
    from hermes_os.pv_quotes q
   where q.tenant_id = p_tenant and q.site_id = p_site_id and q.status = 'ACCEPTED'
   order by q.accepted_at desc nulls last, q.created_at desc
   limit 1;

  v_reliable := (v_unknown = 0 and v_pending = 0 and v_quote_ht is not null);

  return jsonb_build_object(
    'planned_cost_ht_eur',  round(v_planned, 2),
    'ordered_cost_ht_eur',  round(v_ordered, 2),
    'received_cost_ht_eur', round(v_received, 2),
    'quote_total_ht_eur',   v_quote_ht,
    'materials_without_cost', v_unknown,
    'requirements_pending_confirmation', v_pending,
    -- Faux = le chiffre ci-dessous ne doit PAS être présenté comme une marge.
    'margin_reliable', v_reliable,
    'indicative_material_margin_ht_eur',
      case when v_quote_ht is null then null else round(v_quote_ht - v_planned, 2) end);
end;
$function$;

revoke all on function hermes_os.pv_material_costs(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. FAÇADES — CATALOGUE.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_material(
  p_id uuid default null,
  p_category text default null,
  p_sku text default null,
  p_designation text default null,
  p_subcategory text default null,
  p_brand text default null,
  p_manufacturer_ref text default null,
  p_description text default null,
  p_unit text default 'U',
  p_unit_cost_ht_eur numeric default null,
  p_preferred_supplier_id uuid default null,
  p_notes text default null
)
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

  begin
    if p_id is null then
      if p_category is null or p_sku is null or p_designation is null then
        return jsonb_build_object('ok', false, 'code', 'INVALID_MATERIAL');
      end if;
      insert into hermes_os.pv_material_catalog
        (tenant_id, category, subcategory, sku, brand, manufacturer_ref, designation,
         description, unit, unit_cost_ht_eur, preferred_supplier_id, notes, created_by, updated_by)
      values (v_t, p_category, p_subcategory, btrim(p_sku), p_brand, p_manufacturer_ref,
              p_designation, p_description, coalesce(p_unit,'U'), p_unit_cost_ht_eur,
              p_preferred_supplier_id, p_notes, v_uid, v_uid)
      returning id into v_id;
    else
      update hermes_os.pv_material_catalog
         set category = coalesce(p_category, category),
             subcategory = coalesce(p_subcategory, subcategory),
             sku = coalesce(btrim(p_sku), sku),
             brand = coalesce(p_brand, brand),
             manufacturer_ref = coalesce(p_manufacturer_ref, manufacturer_ref),
             designation = coalesce(p_designation, designation),
             description = coalesce(p_description, description),
             unit = coalesce(p_unit, unit),
             unit_cost_ht_eur = coalesce(p_unit_cost_ht_eur, unit_cost_ht_eur),
             preferred_supplier_id = coalesce(p_preferred_supplier_id, preferred_supplier_id),
             notes = coalesce(p_notes, notes),
             updated_by = v_uid, updated_at = now()
       where id = p_id and tenant_id = v_t
      returning id into v_id;
      if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    end if;
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE_SKU');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_MATERIAL');
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
  end;

  return jsonb_build_object('ok', true, 'code', 'SAVED', 'material_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_material(uuid,text,text,text,text,text,text,text,text,numeric,uuid,text) from public;
grant execute on function public.upsert_pv_material(uuid,text,text,text,text,text,text,text,text,numeric,uuid,text) to authenticated;

create or replace function public.set_pv_material_active(p_material_id uuid, p_active boolean)
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

  update hermes_os.pv_material_catalog
     set is_active = coalesce(p_active, is_active), updated_by = v_uid, updated_at = now()
   where id = p_material_id and tenant_id = v_t
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'code', case when p_active then 'ACTIVATED' else 'DEACTIVATED' end);
end;
$function$;

revoke all on function public.set_pv_material_active(uuid, boolean) from public;
grant execute on function public.set_pv_material_active(uuid, boolean) to authenticated;

-- `p_include_inactive` défaut FAUX : un article désactivé ne se propose plus,
-- mais reste lisible quand on le demande — il figure encore dans l'historique.
create or replace function public.get_pv_materials(
  p_include_inactive boolean default false, p_category text default null, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.category, x.sku), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_material_catalog c
           where c.tenant_id = v_t
             and (coalesce(p_include_inactive, false) or c.is_active)
             and (p_category is null or c.category = p_category)
           order by c.category, c.sku
           limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_materials(boolean, text, integer) from public;
grant execute on function public.get_pv_materials(boolean, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. FAÇADES — FOURNISSEURS ET TARIFS.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_pv_supplier(
  p_id uuid default null,
  p_name text default null,
  p_contact_name text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_postal_code text default null,
  p_city text default null,
  p_lead_time_days integer default null,
  p_payment_terms text default null,
  p_free_shipping_ht_eur numeric default null,
  p_is_active boolean default null,
  p_notes text default null
)
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

  begin
    if p_id is null then
      if p_name is null then return jsonb_build_object('ok', false, 'code', 'INVALID_SUPPLIER'); end if;
      insert into hermes_os.pv_suppliers
        (tenant_id, name, contact_name, email, phone, address_line1, postal_code, city,
         lead_time_days, payment_terms, free_shipping_ht_eur, notes, created_by, updated_by)
      values (v_t, btrim(p_name), p_contact_name, p_email, p_phone, p_address_line1,
              p_postal_code, p_city, p_lead_time_days, p_payment_terms,
              p_free_shipping_ht_eur, p_notes, v_uid, v_uid)
      returning id into v_id;
    else
      update hermes_os.pv_suppliers
         set name = coalesce(btrim(p_name), name),
             contact_name = coalesce(p_contact_name, contact_name),
             email = coalesce(p_email, email),
             phone = coalesce(p_phone, phone),
             address_line1 = coalesce(p_address_line1, address_line1),
             postal_code = coalesce(p_postal_code, postal_code),
             city = coalesce(p_city, city),
             lead_time_days = coalesce(p_lead_time_days, lead_time_days),
             payment_terms = coalesce(p_payment_terms, payment_terms),
             free_shipping_ht_eur = coalesce(p_free_shipping_ht_eur, free_shipping_ht_eur),
             is_active = coalesce(p_is_active, is_active),
             notes = coalesce(p_notes, notes),
             updated_by = v_uid, updated_at = now()
       where id = p_id and tenant_id = v_t
      returning id into v_id;
      if v_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    end if;
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'DUPLICATE_SUPPLIER');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_SUPPLIER');
  end;

  return jsonb_build_object('ok', true, 'code', 'SAVED', 'supplier_id', v_id);
end;
$function$;

revoke all on function public.upsert_pv_supplier(uuid,text,text,text,text,text,text,text,integer,text,numeric,boolean,text) from public;
grant execute on function public.upsert_pv_supplier(uuid,text,text,text,text,text,text,text,integer,text,numeric,boolean,text) to authenticated;

create or replace function public.get_pv_suppliers(p_include_inactive boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';
  select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.name), '[]'::jsonb) into v_rows
    from (select * from hermes_os.pv_suppliers s
           where s.tenant_id = v_t and (coalesce(p_include_inactive,false) or s.is_active)
           order by s.name) x;
  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_suppliers(boolean) from public;
grant execute on function public.get_pv_suppliers(boolean) to authenticated;

-- Un tarif est DATÉ : ré-enregistrer le même `valid_from` met à jour, changer de
-- date ouvre une période et clôt la précédente la veille. L'historique reste.
create or replace function public.upsert_pv_supplier_price(
  p_material_id uuid,
  p_supplier_id uuid,
  p_price_ht_eur numeric,
  p_valid_from date default null,
  p_supplier_ref text default null,
  p_min_quantity numeric default 1,
  p_pack_size numeric default null,
  p_lead_time_days integer default null,
  p_availability text default null,
  p_source text default 'MANUAL',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_uid uuid; v_id uuid; v_from date;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;
  v_from := coalesce(p_valid_from, current_date);

  if p_price_ht_eur is null or p_price_ht_eur < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE');
  end if;

  -- Clôture des périodes ouvertes ANTÉRIEURES : elles restent lisibles, mais ne
  -- se chevauchent plus. Une lecture à une date passée reste exacte.
  update hermes_os.pv_supplier_prices
     set valid_until = v_from - 1, updated_by = v_uid, updated_at = now()
   where tenant_id = v_t and material_id = p_material_id and supplier_id = p_supplier_id
     and valid_from < v_from and valid_until is null;

  begin
    insert into hermes_os.pv_supplier_prices
      (tenant_id, material_id, supplier_id, supplier_ref, price_ht_eur, min_quantity,
       pack_size, valid_from, lead_time_days, availability, source, last_checked_at,
       notes, created_by, updated_by)
    values (v_t, p_material_id, p_supplier_id, p_supplier_ref, p_price_ht_eur,
            coalesce(p_min_quantity, 1), p_pack_size, v_from, p_lead_time_days,
            p_availability, coalesce(p_source,'MANUAL'), now(), p_notes, v_uid, v_uid)
    on conflict (tenant_id, material_id, supplier_id, valid_from) do update
      set price_ht_eur = excluded.price_ht_eur,
          supplier_ref = excluded.supplier_ref,
          min_quantity = excluded.min_quantity,
          pack_size = excluded.pack_size,
          lead_time_days = excluded.lead_time_days,
          availability = excluded.availability,
          source = excluded.source,
          last_checked_at = now(),
          notes = excluded.notes,
          updated_by = v_uid, updated_at = now()
    returning id into v_id;
  exception
    when foreign_key_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE');
  end;

  return jsonb_build_object('ok', true, 'code', 'SAVED', 'price_id', v_id, 'valid_from', v_from);
end;
$function$;

revoke all on function public.upsert_pv_supplier_price(uuid,uuid,numeric,date,text,numeric,numeric,integer,text,text,text) from public;
grant execute on function public.upsert_pv_supplier_price(uuid,uuid,numeric,date,text,numeric,numeric,integer,text,text,text) to authenticated;

create or replace function public.get_pv_supplier_prices(p_material_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_g jsonb := hermes_os.pv_guard(); v_t text; v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'supplier_id', p.supplier_id, 'supplier_name', s.name,
           'supplier_ref', p.supplier_ref, 'price_ht_eur', p.price_ht_eur,
           'min_quantity', p.min_quantity, 'pack_size', p.pack_size,
           'valid_from', p.valid_from, 'valid_until', p.valid_until,
           'lead_time_days', p.lead_time_days, 'availability', p.availability,
           'source', p.source, 'last_checked_at', p.last_checked_at,
           'is_current', p.valid_from <= current_date
                         and (p.valid_until is null or p.valid_until >= current_date))
           order by p.valid_from desc, s.name), '[]'::jsonb)
    into v_rows
    from hermes_os.pv_supplier_prices p
    join hermes_os.pv_suppliers s on s.id = p.supplier_id and s.tenant_id = p.tenant_id
   where p.tenant_id = v_t and p.material_id = p_material_id;
  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_supplier_prices(uuid) from public;
grant execute on function public.get_pv_supplier_prices(uuid) to authenticated;

commit;
