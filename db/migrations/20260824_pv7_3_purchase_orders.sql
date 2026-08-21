-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 3 — Commandes fournisseurs, lignes,
-- réceptions, machine à états et moteur d'écart matériel.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- ⚠️ `ORDERED` NE COMMANDE RIEN. Il signifie : « un humain déclare avoir passé
-- cette commande ». Aucun e-mail, aucune API fournisseur, aucun navigateur,
-- aucun webhook, aucun n8n. Exactement le contrat de « Marquer comme envoyé »
-- en PV-5, et il est dit ici pour qu'aucune lecture rapide ne s'y trompe.

begin;

-- ---------------------------------------------------------------------------
-- 1. NUMÉROTATION — même patron que le devis (PV-5).
--    Atomique par (tenant, année) : `on conflict do update … returning` prend un
--    verrou de ligne, donc aucune course possible. Jamais côté navigateur.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_purchase_order_sequences (
  tenant_id   text not null references hermes_os.tenants(tenant_id) on delete cascade,
  year        integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (tenant_id, year)
);

alter table hermes_os.pv_purchase_order_sequences enable row level security;
revoke all on table hermes_os.pv_purchase_order_sequences from anon, authenticated;

create or replace function hermes_os.next_pv_purchase_order_number(p_tenant text, p_year integer)
returns text
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_n integer;
begin
  insert into hermes_os.pv_purchase_order_sequences (tenant_id, year, last_number)
  values (p_tenant, p_year, 1)
  on conflict (tenant_id, year)
    do update set last_number = hermes_os.pv_purchase_order_sequences.last_number + 1
  returning last_number into v_n;

  return 'CMD-' || p_year::text || '-' || lpad(v_n::text, 6, '0');
end;
$function$;

revoke all on function hermes_os.next_pv_purchase_order_number(text, integer) from public;

-- ---------------------------------------------------------------------------
-- 2. LA COMMANDE.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  supplier_id         uuid not null,
  prospect_id         uuid not null,
  site_id             uuid not null,

  order_number        text not null,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','READY','ORDERED',
                                          'PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  currency            text not null default 'EUR' check (currency in ('EUR')),

  expected_delivery_on date,
  ordered_on           date,
  received_on          date,

  -- Totaux CALCULÉS par déclencheur depuis les lignes. Aucune façade ne les
  -- accepte : il n'existe aucun chemin pour poser un total envoyé par le client.
  subtotal_ht_eur     numeric(14,2) not null default 0,
  total_vat_eur       numeric(14,2) not null default 0,
  total_ttc_eur       numeric(14,2) not null default 0,

  notes               text,
  metadata            jsonb not null default '{}'::jsonb,

  -- Gestes HUMAINS, chacun horodaté avec son acteur.
  approved_by         uuid references auth.users(id) on delete set null,
  approved_at         timestamptz,
  constraint pv_purchase_orders_approbation_coherente
    check ((approved_at is null) = (approved_by is null)),
  ordered_by          uuid references auth.users(id) on delete set null,
  ordered_at          timestamptz,
  constraint pv_purchase_orders_commande_coherente
    check ((ordered_at is null) = (ordered_by is null)),

  cancelled_at        timestamptz,
  cancellation_reason text,
  constraint pv_purchase_orders_annulation_coherente
    check ((cancelled_at is null) = (cancellation_reason is null)),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_purchase_orders_tenant_id_key unique (tenant_id, id),
  constraint pv_purchase_orders_numero_unique unique (tenant_id, order_number)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_purchase_orders_supplier_fk') then
    alter table hermes_os.pv_purchase_orders add constraint pv_purchase_orders_supplier_fk
      foreign key (tenant_id, supplier_id) references hermes_os.pv_suppliers (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_purchase_orders_prospect_fk') then
    alter table hermes_os.pv_purchase_orders add constraint pv_purchase_orders_prospect_fk
      foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_purchase_orders_site_fk') then
    alter table hermes_os.pv_purchase_orders add constraint pv_purchase_orders_site_fk
      foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id)
      on update cascade on delete restrict;
  end if;
end;
$$;

alter table hermes_os.pv_purchase_orders enable row level security;
revoke all on table hermes_os.pv_purchase_orders from anon, authenticated;

create index if not exists idx_pv_purchase_orders_site
  on hermes_os.pv_purchase_orders (tenant_id, site_id, status);
create index if not exists idx_pv_purchase_orders_supplier
  on hermes_os.pv_purchase_orders (tenant_id, supplier_id, status);

comment on table hermes_os.pv_purchase_orders is
  'PV-7 — commande fournisseur. ORDERED = un humain DECLARE avoir commande. Aucun envoi reel.';

-- ---------------------------------------------------------------------------
-- 3. LES LIGNES.
--
--    `line_total_ht_eur` est une COLONNE GÉNÉRÉE, comme en PV-5 : il n'existe
--    aucun point d'écriture d'un total. `quantity_received` est maintenue par
--    déclencheur depuis les réceptions — jamais saisie directement.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_purchase_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  order_id            uuid not null,

  position            integer not null default 0 check (position >= 0),

  material_id         uuid,
  designation         text not null check (length(btrim(designation)) between 1 and 300),
  supplier_ref        text,

  quantity            numeric(12,3) not null check (quantity > 0),
  unit                text not null default 'U' check (unit in
                        ('U','M','ML','M2','KG','L','LOT','H','FORFAIT')),
  unit_price_ht_eur   numeric(12,4) not null default 0 check (unit_price_ht_eur >= 0),
  vat_rate_pct        numeric(5,2) not null default 20 check (vat_rate_pct >= 0 and vat_rate_pct <= 100),

  line_total_ht_eur   numeric(14,2) not null
                        generated always as (round(quantity * unit_price_ht_eur, 2)) stored,

  expected_delivery_on date,

  -- Maintenue par déclencheur depuis `pv_purchase_receipts`. Redondante par
  -- construction, et c'est voulu : la lire ne doit pas coûter une agrégation.
  quantity_received   numeric(12,3) not null default 0 check (quantity_received >= 0),

  requirement_id      uuid,

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint pv_purchase_order_lines_tenant_id_key unique (tenant_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_po_lines_order_fk') then
    alter table hermes_os.pv_purchase_order_lines add constraint pv_po_lines_order_fk
      foreign key (tenant_id, order_id) references hermes_os.pv_purchase_orders (tenant_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_po_lines_material_fk') then
    alter table hermes_os.pv_purchase_order_lines add constraint pv_po_lines_material_fk
      foreign key (tenant_id, material_id) references hermes_os.pv_material_catalog (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_po_lines_requirement_fk') then
    alter table hermes_os.pv_purchase_order_lines add constraint pv_po_lines_requirement_fk
      foreign key (tenant_id, requirement_id) references hermes_os.pv_material_requirements (tenant_id, id)
      on update cascade on delete set null;
  end if;
end;
$$;

alter table hermes_os.pv_purchase_order_lines enable row level security;
revoke all on table hermes_os.pv_purchase_order_lines from anon, authenticated;

create index if not exists idx_pv_po_lines_order
  on hermes_os.pv_purchase_order_lines (tenant_id, order_id, position);
create index if not exists idx_pv_po_lines_material
  on hermes_os.pv_purchase_order_lines (tenant_id, material_id) where material_id is not null;

-- ---------------------------------------------------------------------------
-- 4. LES RÉCEPTIONS.
--
--    Une réception est un ÉVÉNEMENT, pas un champ. Trois livraisons partielles
--    donnent trois lignes datées, avec leur bon de livraison et leur état — et
--    non un compteur écrasé trois fois dont on ne saurait plus rien reconstruire.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_purchase_receipts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  order_id            uuid not null,
  line_id             uuid not null,

  quantity_received   numeric(12,3) not null check (quantity_received > 0),
  received_on         date not null default current_date,
  delivery_note_ref   text,
  condition           text not null default 'CONFORME' check (condition in
                        ('CONFORME','ENDOMMAGE','NON_CONFORME','INCOMPLET')),
  comment             text,
  constraint pv_purchase_receipts_motif_non_conforme
    check (condition = 'CONFORME' or comment is not null),

  received_by         uuid not null references auth.users(id) on delete restrict,
  created_at          timestamptz not null default now(),

  constraint pv_purchase_receipts_tenant_id_key unique (tenant_id, id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_receipts_order_fk') then
    alter table hermes_os.pv_purchase_receipts add constraint pv_receipts_order_fk
      foreign key (tenant_id, order_id) references hermes_os.pv_purchase_orders (tenant_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_receipts_line_fk') then
    alter table hermes_os.pv_purchase_receipts add constraint pv_receipts_line_fk
      foreign key (tenant_id, line_id) references hermes_os.pv_purchase_order_lines (tenant_id, id)
      on update cascade on delete cascade;
  end if;
end;
$$;

alter table hermes_os.pv_purchase_receipts enable row level security;
revoke all on table hermes_os.pv_purchase_receipts from anon, authenticated;

create index if not exists idx_pv_receipts_line
  on hermes_os.pv_purchase_receipts (tenant_id, line_id, received_on);

comment on table hermes_os.pv_purchase_receipts is
  'PV-7 — reception EVENEMENTIELLE. Reception partielle native : trois livraisons = trois lignes datees.';

-- ---------------------------------------------------------------------------
-- 5. ENREGISTRER UNE RÉCEPTION EST UN GESTE HUMAIN.
--
--    `pv_human_validation_guard` est paramétrée sur une COLONNE DE STATUT ; une
--    réception n'en a pas — elle n'est pas une transition, c'est un fait. On
--    pose donc une garde minimale de six lignes, qui applique exactement la même
--    règle : appelant authentifié, et acteur = appelant. Ce n'est pas un nouveau
--    moteur d'autorisation, c'est la même règle sur une forme différente.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_purchase_receipt_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'PV_RECEPTION_NON_HUMAINE: une reception exige un utilisateur authentifie (auth.uid() est NULL — un runner ou service_role ne receptionne pas)'
      using errcode = 'insufficient_privilege';
  end if;
  if new.received_by is distinct from v_uid then
    raise exception 'PV_RECEPTION_USURPEE: received_by doit etre l''utilisateur authentifie appelant (% attendu, % fourni)', v_uid, new.received_by
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_receipts_human on hermes_os.pv_purchase_receipts;
create trigger trg_pv_receipts_human
  before insert or update on hermes_os.pv_purchase_receipts
  for each row execute function hermes_os.pv_purchase_receipt_guard();

-- ---------------------------------------------------------------------------
-- 6. UNE RÉCEPTION NE PEUT PAS DÉPASSER LA COMMANDE.
--
--    Refus explicite plutôt que tolérance silencieuse : recevoir 34 panneaux sur
--    une commande de 30 est soit une erreur de saisie, soit une sur-livraison
--    réelle qu'il faut d'abord constater en modifiant la commande. Les deux
--    demandent un geste ; aucun ne demande que la base ferme les yeux.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_receipt_quantity_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_line hermes_os.pv_purchase_order_lines; v_already numeric;
begin
  select * into v_line from hermes_os.pv_purchase_order_lines
   where id = new.line_id and tenant_id = new.tenant_id;
  if v_line.id is null then
    raise exception 'PV_RECEPTION_LIGNE_INTROUVABLE' using errcode = 'foreign_key_violation';
  end if;
  if v_line.order_id is distinct from new.order_id then
    raise exception 'PV_RECEPTION_LIGNE_ETRANGERE: la ligne n''appartient pas a cette commande'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(r.quantity_received), 0) into v_already
    from hermes_os.pv_purchase_receipts r
   where r.tenant_id = new.tenant_id and r.line_id = new.line_id
     and (tg_op = 'INSERT' or r.id <> new.id);

  if v_already + new.quantity_received > v_line.quantity then
    raise exception 'PV_RECEPTION_EXCEDENTAIRE: % deja recu + % recu > % commande. Corrigez la commande avant de receptionner davantage.',
      v_already, new.quantity_received, v_line.quantity
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_receipts_quantity on hermes_os.pv_purchase_receipts;
create trigger trg_pv_receipts_quantity
  before insert or update on hermes_os.pv_purchase_receipts
  for each row execute function hermes_os.pv_receipt_quantity_guard();

-- ---------------------------------------------------------------------------
-- 7. REPORT DES RÉCEPTIONS SUR LA LIGNE, ET AVANCEMENT DE LA COMMANDE.
--
--    La commande passe d'elle-même en PARTIALLY_RECEIVED puis RECEIVED — mais
--    JAMAIS depuis un état qui n'a pas été commandé : une commande DRAFT n'a rien
--    à recevoir, et la machine à états le refuserait de toute façon.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_receipt_rollup()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_line uuid := coalesce(new.line_id, old.line_id);
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_tenant text := coalesce(new.tenant_id, old.tenant_id);
  v_total integer; v_full integer; v_any numeric; v_status text;
begin
  update hermes_os.pv_purchase_order_lines l
     set quantity_received = (select coalesce(sum(r.quantity_received), 0)
                                from hermes_os.pv_purchase_receipts r
                               where r.tenant_id = v_tenant and r.line_id = l.id),
         updated_at = now()
   where l.id = v_line and l.tenant_id = v_tenant;

  select count(*), count(*) filter (where l.quantity_received >= l.quantity),
         coalesce(sum(l.quantity_received), 0)
    into v_total, v_full, v_any
    from hermes_os.pv_purchase_order_lines l
   where l.tenant_id = v_tenant and l.order_id = v_order;

  select o.status into v_status from hermes_os.pv_purchase_orders o
   where o.id = v_order and o.tenant_id = v_tenant;

  if v_status in ('ORDERED', 'PARTIALLY_RECEIVED') then
    if v_total > 0 and v_full = v_total then
      update hermes_os.pv_purchase_orders
         set status = 'RECEIVED', received_on = coalesce(received_on, current_date), updated_at = now()
       where id = v_order and tenant_id = v_tenant;
    elsif v_any > 0 and v_status = 'ORDERED' then
      update hermes_os.pv_purchase_orders
         set status = 'PARTIALLY_RECEIVED', updated_at = now()
       where id = v_order and tenant_id = v_tenant;
    end if;
  end if;

  return null;
end;
$function$;

drop trigger if exists trg_pv_receipts_rollup on hermes_os.pv_purchase_receipts;
create trigger trg_pv_receipts_rollup
  after insert or update or delete on hermes_os.pv_purchase_receipts
  for each row execute function hermes_os.pv_receipt_rollup();

-- ---------------------------------------------------------------------------
-- 8. TOTAUX DE COMMANDE — recalculés, jamais reçus du navigateur.
--    TVA arrondie UNE FOIS PAR TAUX, comme en PV-5 : arrondir par ligne
--    accumulerait l'erreur.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.recompute_pv_purchase_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_ht numeric(14,2); v_vat numeric(14,2);
begin
  select coalesce(sum(line_total_ht_eur), 0) into v_ht
    from hermes_os.pv_purchase_order_lines where order_id = p_order_id;

  select coalesce(sum(round(base * rate / 100, 2)), 0) into v_vat
    from (select vat_rate_pct as rate, sum(line_total_ht_eur) as base
            from hermes_os.pv_purchase_order_lines
           where order_id = p_order_id
           group by vat_rate_pct) t;

  update hermes_os.pv_purchase_orders
     set subtotal_ht_eur = v_ht, total_vat_eur = v_vat, total_ttc_eur = v_ht + v_vat,
         updated_at = now()
   where id = p_order_id;
end;
$function$;

revoke all on function hermes_os.recompute_pv_purchase_order_totals(uuid) from public;

create or replace function hermes_os.pv_po_line_totals_trigger()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hermes_os.recompute_pv_purchase_order_totals(coalesce(new.order_id, old.order_id));
  return null;
end;
$function$;

drop trigger if exists trg_pv_po_lines_totals on hermes_os.pv_purchase_order_lines;
create trigger trg_pv_po_lines_totals
  after insert or update or delete on hermes_os.pv_purchase_order_lines
  for each row execute function hermes_os.pv_po_line_totals_trigger();

-- ---------------------------------------------------------------------------
-- 9. LA MACHINE À ÉTATS — EN DONNÉES.
--
--    Ce qu'elle interdit, et pourquoi :
--      DRAFT -> RECEIVED            on ne reçoit pas ce qu'on n'a pas commandé
--      DRAFT -> PARTIALLY_RECEIVED  idem
--      READY -> RECEIVED            « prête » n'est pas « passée »
--      RECEIVED -> *                terminal ; une correction passe par une
--                                   nouvelle commande, l'historique reste entier
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_purchase_order_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

alter table hermes_os.pv_purchase_order_transitions enable row level security;
revoke all on table hermes_os.pv_purchase_order_transitions from anon, authenticated;

insert into hermes_os.pv_purchase_order_transitions (from_status, to_status) values
  ('DRAFT',              'READY'),
  ('DRAFT',              'CANCELLED'),
  ('READY',              'DRAFT'),
  ('READY',              'ORDERED'),
  ('READY',              'CANCELLED'),
  ('ORDERED',            'PARTIALLY_RECEIVED'),
  ('ORDERED',            'RECEIVED'),
  ('ORDERED',            'CANCELLED'),
  ('PARTIALLY_RECEIVED', 'RECEIVED'),
  ('PARTIALLY_RECEIVED', 'CANCELLED')
on conflict (from_status, to_status) do nothing;

comment on table hermes_os.pv_purchase_order_transitions is
  'PV-7 — chemins autorises d''une commande fournisseur. Donnees de reference.';

create or replace function hermes_os.pv_purchase_order_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from hermes_os.pv_purchase_order_transitions t
     where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'PV_COMMANDE_TRANSITION_INTERDITE: % -> % n''est pas une transition declaree',
      old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_purchase_orders_status_guard on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_status_guard
  before update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_purchase_order_status_guard();

-- Deux gestes ENGAGEANTS, deux gardes humaines paramétrées — celles de PV-1,
-- réutilisées telles quelles. Un agent ne prépare ni ne passe une commande.
drop trigger if exists trg_pv_purchase_orders_human_ready on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_human_ready
  before insert or update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'READY', 'approved_by', 'approved_at');

drop trigger if exists trg_pv_purchase_orders_human_ordered on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_human_ordered
  before insert or update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'ORDERED', 'ordered_by', 'ordered_at');

drop trigger if exists trg_pv_purchase_orders_tenant_immutable on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_tenant_immutable
  before update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_po_lines_tenant_immutable on hermes_os.pv_purchase_order_lines;
create trigger trg_pv_po_lines_tenant_immutable
  before update on hermes_os.pv_purchase_order_lines
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 10. UNE COMMANDE PASSÉE NE SE MODIFIE PLUS SILENCIEUSEMENT.
--
--     Après `ORDERED`, le contenu commercial est figé : article, quantité, prix,
--     TVA, fournisseur. Seule la réalité de la livraison peut encore bouger —
--     `quantity_received`, la date attendue — et le statut. Modifier le prix
--     d'une commande déjà passée réécrirait un engagement pris ailleurs.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_purchase_order_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if old.status not in ('ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') then
    return new;
  end if;
  if new.supplier_id is distinct from old.supplier_id
     or new.site_id is distinct from old.site_id
     or new.prospect_id is distinct from old.prospect_id
     or new.order_number is distinct from old.order_number
     or new.currency is distinct from old.currency then
    raise exception 'PV_COMMANDE_FIGEE: une commande passee ne change ni de fournisseur, ni d''affaire, ni de numero. Creez une nouvelle commande.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_purchase_orders_immutable on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_immutable
  before update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_purchase_order_immutable_guard();

create or replace function hermes_os.pv_po_line_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_status text;
begin
  select o.status into v_status from hermes_os.pv_purchase_orders o
   where o.id = coalesce(new.order_id, old.order_id) and o.tenant_id = coalesce(new.tenant_id, old.tenant_id);

  if v_status is null or v_status in ('DRAFT','READY') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: une ligne de commande passee ne se supprime pas.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: aucune ligne ne s''ajoute a une commande deja passee.'
      using errcode = 'check_violation';
  end if;

  -- Seules la réception et la date attendue peuvent encore bouger.
  if to_jsonb(new) - 'quantity_received' - 'expected_delivery_on' - 'updated_at'
     is distinct from
     to_jsonb(old) - 'quantity_received' - 'expected_delivery_on' - 'updated_at'
  then
    raise exception 'PV_LIGNE_COMMANDE_FIGEE: le contenu commercial d''une commande passee est fige (article, quantite, prix, TVA).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_po_lines_immutable on hermes_os.pv_purchase_order_lines;
create trigger trg_pv_po_lines_immutable
  before insert or update or delete on hermes_os.pv_purchase_order_lines
  for each row execute function hermes_os.pv_po_line_immutable_guard();

-- ---------------------------------------------------------------------------
-- 11. AUDIT.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_purchase_order_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_summary text; v_old jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_summary := format('commande fournisseur creee : %s', new.order_number);
  elsif old.status is distinct from new.status then
    v_old := jsonb_build_object('status', old.status);
    v_summary := format('commande %s : statut %s -> %s', new.order_number, old.status, new.status);
  elsif to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    v_summary := format('commande %s modifiee', new.order_number);
  else
    return null;
  end if;
  perform hermes_os._pv_audit(new.tenant_id, 'pv_purchase_orders', new.id, v_old,
    jsonb_build_object('status', new.status, 'total_ht', new.subtotal_ht_eur), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_purchase_orders_audit on hermes_os.pv_purchase_orders;
create trigger trg_pv_purchase_orders_audit
  after insert or update on hermes_os.pv_purchase_orders
  for each row execute function hermes_os.pv_purchase_order_audit();

create or replace function hermes_os.pv_po_line_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_row hermes_os.pv_purchase_order_lines := case when tg_op='DELETE' then old else new end;
begin
  perform hermes_os._pv_audit(v_row.tenant_id, 'pv_purchase_orders', v_row.order_id, '{}'::jsonb,
    jsonb_build_object('designation', v_row.designation, 'quantity', v_row.quantity),
    format('ligne de commande %s : %s x %s',
           case tg_op when 'INSERT' then 'ajoutee' when 'DELETE' then 'retiree' else 'modifiee' end,
           v_row.quantity, v_row.designation));
  return null;
end;
$function$;

drop trigger if exists trg_pv_po_lines_audit on hermes_os.pv_purchase_order_lines;
create trigger trg_pv_po_lines_audit
  after insert or update or delete on hermes_os.pv_purchase_order_lines
  for each row execute function hermes_os.pv_po_line_audit();

create or replace function hermes_os.pv_receipt_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hermes_os._pv_audit(new.tenant_id, 'pv_purchase_orders', new.order_id, '{}'::jsonb,
    jsonb_build_object('quantity_received', new.quantity_received, 'condition', new.condition),
    format('reception enregistree : %s (BL %s, etat %s)',
           new.quantity_received, coalesce(new.delivery_note_ref, 'non renseigne'), new.condition));
  return null;
end;
$function$;

drop trigger if exists trg_pv_receipts_audit on hermes_os.pv_purchase_receipts;
create trigger trg_pv_receipts_audit
  after insert on hermes_os.pv_purchase_receipts
  for each row execute function hermes_os.pv_receipt_audit();

-- ---------------------------------------------------------------------------
-- 12. RATTACHEMENT DOCUMENTAIRE — `pv_documents`, AUCUN nouveau bucket.
--
--     ⚠️ Ce qui N'EST PAS fait, et pourquoi : la fiche technique d'un article de
--     CATALOGUE n'est pas rattachable ici. `pv_documents.site_id` est NOT NULL
--     depuis PV-2, et un article de catalogue n'appartient à aucun site. Rendre
--     cette colonne nullable changerait une contrainte partagée par tout le Pack
--     PV pour un besoin secondaire. La référence fabricant reste notée sur
--     l'article ; le rattachement de fiche technique attendra un lot qui traite
--     la question de front.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents add column if not exists purchase_order_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_documents_purchase_order_fk') then
    alter table hermes_os.pv_documents add constraint pv_documents_purchase_order_fk
      foreign key (tenant_id, purchase_order_id)
      references hermes_os.pv_purchase_orders (tenant_id, id)
      on update cascade on delete set null;
  end if;

  alter table hermes_os.pv_documents drop constraint if exists pv_documents_doc_type_check;
  alter table hermes_os.pv_documents add constraint pv_documents_doc_type_check check (
    doc_type in ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
                 'NOTE_TECHNIQUE','ATTESTATION',
                 'PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES','PHOTO_OBSTACLE','FICHE_VISITE',
                 'DEVIS_FOURNISSEUR','BON_COMMANDE','ACCUSE_RECEPTION','BON_LIVRAISON',
                 'FICHE_TECHNIQUE','FACTURE_FOURNISSEUR',
                 'AUTRE'));

  alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
  alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
    document_stage in ('SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL',
                       'QUOTE_DRAFT','QUOTE_FINAL','SURVEY_REPORT','PURCHASE_ORDER'));

  alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
  alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
    document_stage = 'SOURCE'
    or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
    or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null)
    or (document_stage = 'SURVEY_REPORT' and survey_id is not null)
    or (document_stage = 'PURCHASE_ORDER' and purchase_order_id is not null));
end;
$$;

create index if not exists idx_pv_documents_tenant_po
  on hermes_os.pv_documents (tenant_id, purchase_order_id) where purchase_order_id is not null;

commit;
