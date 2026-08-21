-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 1 — Catalogue matériel, fournisseurs, tarifs.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- LE TROU, MESURÉ AVANT D'ÊTRE TRAITÉ :
--
--   select count(*) from information_schema.tables where table_schema='hermes_os'
--    and (table_name like '%fournisseur%' or table_name like '%supplier%'
--         or table_name like '%material%' or table_name like '%commande%');
--   -- → 0 pour le Pack PV
--
-- Après PV-6, la chaîne s'arrête net : un devis peut être ACCEPTED, le prospect
-- passer OFFER_ACCEPTED puis WON, et plus RIEN n'existe. Aucun artefact
-- d'exécution. Les conséquences matérielles de la visite technique — longueur de
-- câble relevée, modules libres au tableau, moyen d'accès, reprise de couverture
-- — sont constatées puis PERDUES.
--
-- CE LOT NE COMMANDE RIEN CHEZ PERSONNE. Aucun e-mail, aucune API fournisseur,
-- aucun navigateur, aucun webhook, aucun n8n. `ORDERED` signifie exactement une
-- chose : un humain déclare avoir passé la commande. Même contrat que
-- « Marquer comme envoyé » en PV-5.

begin;

-- ---------------------------------------------------------------------------
-- 1. LE CATALOGUE MATÉRIEL.
--
--    Volontairement PLAT : catégorie + sous-catégorie libre, pas d'ontologie à
--    trois niveaux avec héritage d'attributs. Un installateur doit pouvoir créer
--    un article en dix secondes ; une taxonomie riche que personne ne remplit ne
--    vaut pas mieux qu'un champ texte.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_material_catalog (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,

  category            text not null check (category in (
                        'PANNEAU','ONDULEUR','MICRO_ONDULEUR','BATTERIE',
                        'STRUCTURE','RAIL','CROCHET','BAC_LESTE',
                        'PROTECTION_DC','PROTECTION_AC','CABLE_DC','CABLE_AC',
                        'CONNECTIQUE','COFFRET','MONITORING','MISE_A_LA_TERRE',
                        'CONSOMMABLE','ACCES_SECURITE','AUTRE')),
  subcategory         text,

  -- SKU : référence INTERNE au tenant. Unique par tenant, jamais globalement —
  -- deux entreprises peuvent légitimement utiliser « PAN-400 ».
  sku                 text not null check (length(btrim(sku)) between 1 and 64),
  brand               text,
  manufacturer_ref    text,
  designation         text not null check (length(btrim(designation)) between 2 and 200),
  description         text,

  unit                text not null default 'U' check (unit in
                        ('U','M','ML','M2','KG','L','LOT','H','FORFAIT')),

  is_active           boolean not null default true,

  -- Coût INDICATIF de référence. Le prix qui fait foi pour une commande est
  -- celui du tarif fournisseur retenu (`pv_supplier_prices`) : celui-ci sert de
  -- repère quand aucun tarif daté n'existe encore.
  unit_cost_ht_eur    numeric(12,4) check (unit_cost_ht_eur is null or unit_cost_ht_eur >= 0),
  currency            text not null default 'EUR' check (currency in ('EUR')),

  preferred_supplier_id uuid,

  notes               text,
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_material_catalog_tenant_id_key unique (tenant_id, id),
  constraint pv_material_catalog_sku_unique unique (tenant_id, sku)
);

alter table hermes_os.pv_material_catalog enable row level security;
revoke all on table hermes_os.pv_material_catalog from anon, authenticated;

create index if not exists idx_pv_material_catalog_tenant_cat
  on hermes_os.pv_material_catalog (tenant_id, category, is_active);

comment on table hermes_os.pv_material_catalog is
  'PV-7 — référentiel matériel par tenant. SKU unique PAR TENANT, jamais globalement.';
comment on column hermes_os.pv_material_catalog.unit_cost_ht_eur is
  'PV-7 — coût INDICATIF. Le prix qui engage est celui du tarif fournisseur daté.';

-- ---------------------------------------------------------------------------
-- 2. LES FOURNISSEURS.
--
--    Table PROPRE au Pack PV. `btp_fournisseurs` existe déjà dans une autre
--    verticale : s'y brancher créerait un couplage entre deux métiers qui n'ont
--    ni le même cycle, ni les mêmes champs, ni la même gouvernance. On s'en
--    inspire, on ne s'y accroche pas.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_suppliers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,

  name                text not null check (length(btrim(name)) between 2 and 200),
  contact_name        text,
  email               text,
  phone               text,
  address_line1       text,
  postal_code         text,
  city                text,
  country_code        text not null default 'FR' check (length(country_code) = 2),

  is_active           boolean not null default true,

  -- INDICATIF, saisi à la main. Ce n'est pas un engagement du fournisseur, et le
  -- nom du champ le dit.
  lead_time_days      integer check (lead_time_days is null or lead_time_days >= 0),
  payment_terms       text,
  free_shipping_ht_eur numeric(12,2) check (free_shipping_ht_eur is null or free_shipping_ht_eur >= 0),
  currency            text not null default 'EUR' check (currency in ('EUR')),

  notes               text,
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_suppliers_tenant_id_key unique (tenant_id, id),
  constraint pv_suppliers_name_unique unique (tenant_id, name)
);

alter table hermes_os.pv_suppliers enable row level security;
revoke all on table hermes_os.pv_suppliers from anon, authenticated;

create index if not exists idx_pv_suppliers_tenant_active
  on hermes_os.pv_suppliers (tenant_id, is_active);

comment on table hermes_os.pv_suppliers is
  'PV-7 — fournisseurs du Pack PV. Table dédiée : btp_fournisseurs appartient à une autre verticale.';
comment on column hermes_os.pv_suppliers.lead_time_days is
  'PV-7 — délai INDICATIF saisi à la main, jamais un engagement du fournisseur.';

-- FK COMPOSITE sur le fournisseur préféré du catalogue : sans elle, un article
-- pourrait désigner le fournisseur d'un AUTRE tenant.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_material_preferred_supplier_fk') then
    alter table hermes_os.pv_material_catalog add constraint pv_material_preferred_supplier_fk
      foreign key (tenant_id, preferred_supplier_id)
      references hermes_os.pv_suppliers (tenant_id, id)
      on update cascade on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. LES TARIFS FOURNISSEURS.
--
--    UN PRIX FOURNISSEUR EST UNE DONNÉE DATÉE. C'est la propriété structurante
--    de cette table : on n'écrase pas le prix de mars quand celui d'octobre
--    arrive, on ouvre une nouvelle période. Sans cela, une commande passée en
--    mars deviendrait incompréhensible six mois plus tard, et toute analyse de
--    dérive des coûts serait impossible.
--
--    Un même article peut être tarifé par PLUSIEURS fournisseurs.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_supplier_prices (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  material_id         uuid not null,
  supplier_id         uuid not null,

  supplier_ref        text,
  price_ht_eur        numeric(12,4) not null check (price_ht_eur >= 0),
  currency            text not null default 'EUR' check (currency in ('EUR')),
  min_quantity        numeric(12,3) not null default 1 check (min_quantity > 0),
  pack_size           numeric(12,3) check (pack_size is null or pack_size > 0),

  valid_from          date not null default current_date,
  valid_until         date,
  constraint pv_supplier_prices_periode
    check (valid_until is null or valid_until >= valid_from),

  lead_time_days      integer check (lead_time_days is null or lead_time_days >= 0),
  availability        text check (availability is null or availability in
                        ('EN_STOCK','SUR_COMMANDE','RUPTURE','INCONNU')),

  -- D'où vient ce prix, et quand l'a-t-on vérifié pour la dernière fois. Un prix
  -- sans provenance ni date de contrôle est une rumeur.
  source              text not null default 'MANUAL' check (source in
                        ('MANUAL','SUPPLIER_QUOTE','CATALOG','INVOICE')),
  last_checked_at     timestamptz,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_supplier_prices_tenant_id_key unique (tenant_id, id),
  -- Une seule ligne par (article, fournisseur, début de validité) : ré-enregistrer
  -- le même jour MET À JOUR, changer de jour OUVRE une période.
  constraint pv_supplier_prices_periode_unique unique (tenant_id, material_id, supplier_id, valid_from)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_supplier_prices_material_fk') then
    alter table hermes_os.pv_supplier_prices add constraint pv_supplier_prices_material_fk
      foreign key (tenant_id, material_id) references hermes_os.pv_material_catalog (tenant_id, id)
      on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_supplier_prices_supplier_fk') then
    alter table hermes_os.pv_supplier_prices add constraint pv_supplier_prices_supplier_fk
      foreign key (tenant_id, supplier_id) references hermes_os.pv_suppliers (tenant_id, id)
      on update cascade on delete cascade;
  end if;
end;
$$;

alter table hermes_os.pv_supplier_prices enable row level security;
revoke all on table hermes_os.pv_supplier_prices from anon, authenticated;

create index if not exists idx_pv_supplier_prices_lookup
  on hermes_os.pv_supplier_prices (tenant_id, material_id, valid_from desc);

comment on table hermes_os.pv_supplier_prices is
  'PV-7 — tarifs fournisseurs DATÉS. On ouvre une période, on n''écrase pas l''historique.';

-- Le prix applicable à une date : la période la plus récemment ouverte qui
-- couvre la date demandée. Déterministe, et testable sans jeu d'essai piégeux.
create or replace function hermes_os.pv_supplier_price_at(
  p_tenant text, p_material_id uuid, p_supplier_id uuid, p_on date default null
)
returns numeric
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
  select p.price_ht_eur
    from hermes_os.pv_supplier_prices p
   where p.tenant_id = p_tenant
     and p.material_id = p_material_id
     and p.supplier_id = p_supplier_id
     and p.valid_from <= coalesce(p_on, current_date)
     and (p.valid_until is null or p.valid_until >= coalesce(p_on, current_date))
   order by p.valid_from desc
   limit 1;
$function$;

revoke all on function hermes_os.pv_supplier_price_at(text, uuid, uuid, date) from public;

-- ---------------------------------------------------------------------------
-- 4. TENANT IMMUABLE — garde G1 de PV-1, réutilisée sur les trois tables.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_material_catalog_tenant_immutable on hermes_os.pv_material_catalog;
create trigger trg_pv_material_catalog_tenant_immutable
  before update on hermes_os.pv_material_catalog
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_suppliers_tenant_immutable on hermes_os.pv_suppliers;
create trigger trg_pv_suppliers_tenant_immutable
  before update on hermes_os.pv_suppliers
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_supplier_prices_tenant_immutable on hermes_os.pv_supplier_prices;
create trigger trg_pv_supplier_prices_tenant_immutable
  before update on hermes_os.pv_supplier_prices
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 5. AUDIT — `entity_audit_log` via `_pv_audit`. Aucun journal parallèle.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_catalog_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_summary text;
begin
  if tg_op = 'INSERT' then
    v_summary := format('article catalogue cree : %s (%s)', new.sku, new.category);
  elsif old.is_active is distinct from new.is_active then
    v_summary := format('article catalogue %s : %s', new.sku,
      case when new.is_active then 'reactive' else 'desactive' end);
  elsif to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    v_summary := format('article catalogue modifie : %s', new.sku);
  else
    return null;
  end if;
  perform hermes_os._pv_audit(new.tenant_id, 'pv_material_catalog', new.id, '{}'::jsonb,
    jsonb_build_object('sku', new.sku, 'is_active', new.is_active), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_material_catalog_audit on hermes_os.pv_material_catalog;
create trigger trg_pv_material_catalog_audit
  after insert or update on hermes_os.pv_material_catalog
  for each row execute function hermes_os.pv_catalog_audit();

create or replace function hermes_os.pv_supplier_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_summary text;
begin
  if tg_op = 'INSERT' then
    v_summary := format('fournisseur cree : %s', new.name);
  elsif to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    v_summary := format('fournisseur modifie : %s', new.name);
  else
    return null;
  end if;
  perform hermes_os._pv_audit(new.tenant_id, 'pv_suppliers', new.id, '{}'::jsonb,
    jsonb_build_object('name', new.name, 'is_active', new.is_active), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_suppliers_audit on hermes_os.pv_suppliers;
create trigger trg_pv_suppliers_audit
  after insert or update on hermes_os.pv_suppliers
  for each row execute function hermes_os.pv_supplier_audit();

create or replace function hermes_os.pv_supplier_price_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hermes_os._pv_audit(new.tenant_id, 'pv_supplier_prices', new.id, '{}'::jsonb,
    jsonb_build_object('price_ht_eur', new.price_ht_eur, 'valid_from', new.valid_from),
    format('tarif fournisseur %s au %s : %s EUR HT',
           case when tg_op = 'INSERT' then 'enregistre' else 'modifie' end,
           new.valid_from, new.price_ht_eur));
  return null;
end;
$function$;

drop trigger if exists trg_pv_supplier_prices_audit on hermes_os.pv_supplier_prices;
create trigger trg_pv_supplier_prices_audit
  after insert or update on hermes_os.pv_supplier_prices
  for each row execute function hermes_os.pv_supplier_price_audit();

commit;
