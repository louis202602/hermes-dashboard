-- PACK PHOTOVOLTAÏQUE — LOT PV-5 / 1 — Le devis : schéma, lignes, totaux, numérotation.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- PV-4 a produit un état terminal, `READY_FOR_OFFER`, que RIEN ne consommait :
-- le moteur s'arrêtait sur une promesse sans destinataire. Et la machine à états
-- du prospect n'avait AUCUN état entre `STUDY_DELIVERED` et `WON` — un dossier
-- passait donc de « étude livrée » à « gagné » sans qu'aucun artefact ne
-- justifie le passage. PV-5 pose cet artefact.
--
-- TOUT EST MANUEL. Aucune capacité IA n'est créée, aucun agent n'intervient,
-- aucun workflow n'est appelé. Un humain crée, modifie, prépare, émet et
-- enregistre l'acceptation. C'est un lot de schéma et de règles, pas d'automatisme.
--
-- LES TOTAUX NE VIENNENT JAMAIS DU NAVIGATEUR. Le total d'une ligne est une
-- colonne GÉNÉRÉE — PostgreSQL la calcule, personne ne l'écrit. Les totaux du
-- devis sont recalculés par déclencheur à chaque mouvement de ligne. Un total
-- envoyé par un client n'a aucun point d'entrée : il n'existe pas de colonne
-- où le poser.

begin;

-- ---------------------------------------------------------------------------
-- 1. LE DEVIS.
--
--    NUMÉRO vs VERSION, et pourquoi les deux : `quote_number` est la référence
--    COMMERCIALE, celle que le client cite au téléphone ; elle ne bouge pas
--    quand on corrige le devis. `version` distingue les révisions successives
--    de cette même offre. Un devis émis reste donc citable même après révision,
--    ce qu'un simple numéro incrémenté rendrait impossible.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_quotes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,

  prospect_id         uuid not null,
  site_id             uuid not null,
  study_id            uuid not null,
  economics_id        uuid,

  quote_number        text not null check (length(quote_number) between 3 and 40),
  version             integer not null default 1 check (version >= 1),
  supersedes_quote_id uuid,

  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','READY','SENT','ACCEPTED','REFUSED',
                                          'EXPIRED','CANCELLED','SUPERSEDED')),

  currency            text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),

  -- Remise GLOBALE, en pourcentage. Appliquée proportionnellement à chaque
  -- ligne AVANT la TVA — sans quoi, avec plusieurs taux, la remise fausserait
  -- la répartition de TVA.
  discount_pct        numeric(5,2) not null default 0
                        check (discount_pct >= 0 and discount_pct <= 100),

  -- Totaux RECALCULÉS. Jamais écrits par une façade, jamais reçus du client.
  subtotal_ht_eur     numeric(14,2) not null default 0,
  discount_amount_eur numeric(14,2) not null default 0,
  total_ht_eur        numeric(14,2) not null default 0,
  total_vat_eur       numeric(14,2) not null default 0,
  total_ttc_eur       numeric(14,2) not null default 0,

  issued_on           date,
  valid_until         date,
  constraint pv_quotes_validite_coherente
    check (valid_until is null or issued_on is null or valid_until >= issued_on),

  observations        text,
  terms               text,

  sent_by             uuid references auth.users(id) on delete set null,
  sent_at             timestamptz,
  constraint pv_quotes_envoi_coherent check ((sent_at is null) = (sent_by is null)),

  accepted_by         uuid references auth.users(id) on delete set null,
  accepted_at         timestamptz,
  accepted_on         date,
  acceptance_reference text check (acceptance_reference is null or length(acceptance_reference) <= 200),
  constraint pv_quotes_acceptation_coherente check ((accepted_at is null) = (accepted_by is null)),

  refused_at          timestamptz,
  refusal_reason      text,
  expired_at          timestamptz,
  cancelled_at        timestamptz,

  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  -- Clé candidate COMPOSITE, pour que les lignes ne puissent pas pointer le
  -- devis d'un AUTRE tenant. Même raison qu'en PV-1 pour les sites.
  constraint pv_quotes_tenant_id_key unique (tenant_id, id),

  -- Un numéro + une version = un devis, par tenant. C'est la garantie
  -- structurelle contre le doublon de numérotation.
  constraint pv_quotes_numero_version_unique unique (tenant_id, quote_number, version)
);

-- FK COMPOSITES. Une FK sur `study_id` seul laisserait un devis pointer l'étude
-- d'un AUTRE tenant — exactement la faille que PV-1 avait fermée sur les sites,
-- et qu'il serait absurde de rouvrir sur un document contractuel.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_quotes_prospect_fk') then
    alter table hermes_os.pv_quotes add constraint pv_quotes_prospect_fk
      foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_quotes_site_fk') then
    alter table hermes_os.pv_quotes add constraint pv_quotes_site_fk
      foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_quotes_study_fk') then
    alter table hermes_os.pv_quotes add constraint pv_quotes_study_fk
      foreign key (tenant_id, study_id) references hermes_os.pv_studies (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_quotes_economics_fk') then
    alter table hermes_os.pv_quotes add constraint pv_quotes_economics_fk
      foreign key (tenant_id, economics_id) references hermes_os.pv_economics (tenant_id, id)
      on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_quotes_supersedes_fk') then
    alter table hermes_os.pv_quotes add constraint pv_quotes_supersedes_fk
      foreign key (tenant_id, supersedes_quote_id) references hermes_os.pv_quotes (tenant_id, id)
      on update cascade on delete set null;
  end if;
end;
$$;

alter table hermes_os.pv_quotes enable row level security;
revoke all on table hermes_os.pv_quotes from anon, authenticated;

create index if not exists idx_pv_quotes_tenant_prospect
  on hermes_os.pv_quotes (tenant_id, prospect_id, created_at desc);
create index if not exists idx_pv_quotes_tenant_status
  on hermes_os.pv_quotes (tenant_id, status, valid_until);

comment on table hermes_os.pv_quotes is
  'PV-5 — devis photovoltaïque. Totaux recalculés en base, jamais reçus du client.';
comment on column hermes_os.pv_quotes.quote_number is
  'PV-5 — référence COMMERCIALE, stable à travers les versions.';
comment on column hermes_os.pv_quotes.version is
  'PV-5 — révision de cette offre. Un devis SENT modifié donne une NOUVELLE version.';

-- ---------------------------------------------------------------------------
-- 2. LES LIGNES.
--
--    `line_total_ht_eur` est une colonne GÉNÉRÉE. C'est le point : il n'existe
--    aucun chemin — façade, SQL direct, déclencheur — par lequel écrire un total
--    de ligne faux. PostgreSQL le calcule ou refuse l'écriture.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_quote_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null references hermes_os.tenants(tenant_id) on delete cascade,
  quote_id          uuid not null,

  position          integer not null check (position >= 0),
  category          text not null default 'AUTRE'
                      check (category in ('PANNEAUX','ONDULEUR','BATTERIE','STRUCTURE',
                                          'PROTECTIONS','CABLAGE','POSE','MISE_EN_SERVICE',
                                          'ETUDES_ADMINISTRATIF','OPTION','AUTRE')),
  designation       text not null check (length(btrim(designation)) between 1 and 300),
  description       text,

  quantity          numeric(12,3) not null check (quantity > 0),
  unit              text not null default 'U' check (length(unit) between 1 and 16),
  unit_price_ht_eur numeric(12,2) not null check (unit_price_ht_eur >= 0),

  -- Le taux est PORTÉ, pas déduit. Hermès ne promet aucune conformité fiscale
  -- automatique : la réglementation dépend du contexte (puissance, logement,
  -- rénovation) et change. L'application peut PROPOSER un taux par défaut ;
  -- c'est une aide de saisie, pas une règle métier.
  vat_rate_pct      numeric(5,2) not null default 20 check (vat_rate_pct >= 0 and vat_rate_pct <= 100),
  discount_pct      numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),

  line_total_ht_eur numeric(14,2) not null
                      generated always as
                        (round(quantity * unit_price_ht_eur * (1 - discount_pct / 100), 2)) stored,

  metadata          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint pv_quote_lines_tenant_id_key unique (tenant_id, id),
  constraint pv_quote_lines_position_unique unique (tenant_id, quote_id, position)
    deferrable initially deferred
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_quote_lines_quote_fk') then
    alter table hermes_os.pv_quote_lines add constraint pv_quote_lines_quote_fk
      foreign key (tenant_id, quote_id) references hermes_os.pv_quotes (tenant_id, id)
      on update cascade on delete cascade;
  end if;
end;
$$;

alter table hermes_os.pv_quote_lines enable row level security;
revoke all on table hermes_os.pv_quote_lines from anon, authenticated;

create index if not exists idx_pv_quote_lines_quote
  on hermes_os.pv_quote_lines (tenant_id, quote_id, position);

comment on column hermes_os.pv_quote_lines.line_total_ht_eur is
  'PV-5 — colonne GÉNÉRÉE. Aucun chemin d''écriture : impossible de poser un total faux.';
comment on column hermes_os.pv_quote_lines.vat_rate_pct is
  'PV-5 — taux APPLIQUÉ, stocké tel quel. Hermès ne promet aucune conformité fiscale automatique.';

-- ---------------------------------------------------------------------------
-- 3. NUMÉROTATION — atomique, tenant-scopée, sans doublon possible.
--
--    L'`insert … on conflict do update … returning` prend un VERROU DE LIGNE :
--    deux transactions concurrentes sur le même (tenant, année) s'attendent, et
--    la seconde lit la valeur déjà incrémentée. Aucune lecture-puis-écriture,
--    donc aucune fenêtre de course.
--
--    La contrainte d'unicité `(tenant_id, quote_number, version)` est la
--    garantie de dernier recours : même si un jour quelqu'un contourne cette
--    fonction, la base refusera le doublon.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_quote_sequences (
  tenant_id   text not null references hermes_os.tenants(tenant_id) on delete cascade,
  year        integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (tenant_id, year)
);

alter table hermes_os.pv_quote_sequences enable row level security;
revoke all on table hermes_os.pv_quote_sequences from anon, authenticated;

create or replace function hermes_os.next_pv_quote_number(p_tenant text, p_year integer)
returns text
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_n integer;
begin
  insert into hermes_os.pv_quote_sequences (tenant_id, year, last_number)
  values (p_tenant, p_year, 1)
  on conflict (tenant_id, year)
    do update set last_number = hermes_os.pv_quote_sequences.last_number + 1
  returning last_number into v_n;

  return 'DEV-' || p_year::text || '-' || lpad(v_n::text, 6, '0');
end;
$function$;

revoke all on function hermes_os.next_pv_quote_number(text, integer) from public;

comment on function hermes_os.next_pv_quote_number(text, integer) is
  'PV-5 — numéro de devis atomique par (tenant, année). Verrou de ligne, aucune course possible.';

-- ---------------------------------------------------------------------------
-- 4. RECALCUL DES TOTAUX.
--
--    TVA arrondie PAR TAUX, pas par ligne : c'est la pratique comptable
--    française, et cela évite d'accumuler l'erreur d'arrondi ligne à ligne.
--    Sur 20 lignes à 19,99 €, l'écart entre les deux méthodes est visible.
--
--    La remise globale est répartie PROPORTIONNELLEMENT sur chaque ligne avant
--    la TVA : sinon, avec deux taux, la remise avantagerait arbitrairement l'un.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.recompute_pv_quote_totals(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_sub numeric(14,2);
  v_disc_pct numeric(5,2);
  v_disc numeric(14,2);
  v_factor numeric;
  v_vat numeric(14,2);
begin
  select coalesce(discount_pct, 0) into v_disc_pct
    from hermes_os.pv_quotes where id = p_quote_id;
  if not found then return; end if;

  select coalesce(sum(line_total_ht_eur), 0) into v_sub
    from hermes_os.pv_quote_lines where quote_id = p_quote_id;

  v_disc := round(v_sub * v_disc_pct / 100, 2);
  v_factor := 1 - v_disc_pct / 100;

  select coalesce(sum(round(base * vat_rate_pct / 100, 2)), 0) into v_vat
    from (select vat_rate_pct, sum(line_total_ht_eur) * v_factor as base
            from hermes_os.pv_quote_lines
           where quote_id = p_quote_id
           group by vat_rate_pct) t;

  update hermes_os.pv_quotes
     set subtotal_ht_eur     = v_sub,
         discount_amount_eur = v_disc,
         total_ht_eur        = v_sub - v_disc,
         total_vat_eur       = v_vat,
         total_ttc_eur       = (v_sub - v_disc) + v_vat,
         updated_at          = now()
   where id = p_quote_id;
end;
$function$;

revoke all on function hermes_os.recompute_pv_quote_totals(uuid) from public;

create or replace function hermes_os.pv_quote_lines_recompute()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  perform hermes_os.recompute_pv_quote_totals(
    case when tg_op = 'DELETE' then old.quote_id else new.quote_id end);
  -- Une ligne DÉPLACÉE d'un devis à l'autre laisserait l'ancien faux.
  if tg_op = 'UPDATE' and old.quote_id is distinct from new.quote_id then
    perform hermes_os.recompute_pv_quote_totals(old.quote_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_pv_quote_lines_recompute on hermes_os.pv_quote_lines;
create trigger trg_pv_quote_lines_recompute
  after insert or update or delete on hermes_os.pv_quote_lines
  for each row execute function hermes_os.pv_quote_lines_recompute();

-- La remise globale change les totaux sans qu'aucune ligne ne bouge.
create or replace function hermes_os.pv_quote_discount_recompute()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.discount_pct is distinct from old.discount_pct then
    perform hermes_os.recompute_pv_quote_totals(new.id);
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_pv_quote_discount_recompute on hermes_os.pv_quotes;
create trigger trg_pv_quote_discount_recompute
  after update of discount_pct on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_quote_discount_recompute();

-- ---------------------------------------------------------------------------
-- 5. RATTACHEMENT DOCUMENTAIRE. Le PDF de devis rejoint `pv_documents`, comme
--    la synthèse d'étude en PV-4 : un seul inventaire de documents, pas deux.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents add column if not exists quote_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_documents_quote_fk') then
    alter table hermes_os.pv_documents add constraint pv_documents_quote_fk
      foreign key (tenant_id, quote_id) references hermes_os.pv_quotes (tenant_id, id)
      on update cascade on delete set null;
  end if;

  -- Le stade accepte deux valeurs de plus. On REMPLACE la contrainte plutôt que
  -- d'en ajouter une seconde : deux CHECK sur la même colonne se contredisent
  -- un jour, et personne ne sait plus laquelle fait foi.
  alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
  alter table hermes_os.pv_documents add constraint pv_documents_stage_valide check (
    document_stage in ('SOURCE', 'STUDY_SUMMARY_DRAFT', 'STUDY_SUMMARY_FINAL',
                       'QUOTE_DRAFT', 'QUOTE_FINAL'));

  -- Un PDF de devis rend compte d'un DEVIS ; une synthèse, d'une ÉTUDE.
  alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
  alter table hermes_os.pv_documents add constraint pv_documents_synthese_rattachee check (
    document_stage = 'SOURCE'
    or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
    or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL') and quote_id is not null));
end;
$$;

create index if not exists idx_pv_documents_tenant_quote
  on hermes_os.pv_documents (tenant_id, quote_id) where quote_id is not null;

commit;
