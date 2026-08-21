-- PACK PHOTOVOLTAÏQUE — LOT PV-7 / 2 — Besoin matériel d'une affaire, et sa
-- consolidation déterministe.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- LA QUESTION À LAQUELLE CETTE MIGRATION RÉPOND :
--   « De quoi ai-je réellement besoin pour cette affaire ? »
--
-- ET LA RÈGLE QUI LA REND HONNÊTE :
--   structuré → consolidable ; texte libre → confirmation humaine.
--
-- Une ligne de devis « Pose de panneaux — forfait » ne dit PAS qu'il faut 24
-- panneaux. Deviner l'aurait fait dire au système une chose que personne n'a
-- écrite. On enregistre donc le besoin AVEC son origine, et un besoin issu de
-- texte libre est marqué `needs_confirmation` : il apparaît, il alerte, mais il
-- ne compte pas comme couvert tant qu'un humain ne l'a pas confirmé.

begin;

-- ---------------------------------------------------------------------------
-- 1. LE BESOIN.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_material_requirements (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references hermes_os.tenants(tenant_id) on delete cascade,
  prospect_id         uuid not null,
  site_id             uuid not null,

  -- Les trois artefacts RETENUS qui justifient le besoin. Nullables : un besoin
  -- saisi à la main avant toute étude reste légitime.
  quote_id            uuid,
  study_id            uuid,
  survey_id           uuid,

  -- Article catalogué OU désignation libre. Jamais ni l'un ni l'autre.
  material_id         uuid,
  free_designation    text,
  constraint pv_material_requirements_article_ou_texte
    check (num_nonnulls(material_id, free_designation) = 1),

  quantity_required   numeric(12,3) not null check (quantity_required > 0),
  unit                text not null default 'U' check (unit in
                        ('U','M','ML','M2','KG','L','LOT','H','FORFAIT')),

  -- D'OÙ VIENT LE BESOIN. Conservé tel quel : c'est ce qui permet de dire
  -- « la visite a imposé 30 m de câble de plus », et non « le système a décidé ».
  origin              text not null check (origin in ('QUOTE','STUDY','SURVEY','MANUAL')),
  source_entity_id    uuid,

  is_mandatory        boolean not null default true,

  -- LE GARDE-FOU CONTRE L'INTERPRÉTATION. Vrai quand le besoin dérive de texte
  -- libre : il est affiché, il compte dans les écarts, mais il ne peut pas
  -- rendre une affaire « prête » sans qu'un humain l'ait confirmé.
  needs_confirmation  boolean not null default false,
  confirmed_by        uuid references auth.users(id) on delete set null,
  confirmed_at        timestamptz,
  constraint pv_material_requirements_confirmation_coherente
    check ((confirmed_at is null) = (confirmed_by is null)),

  status              text not null default 'ACTIVE'
                        check (status in ('ACTIVE','DISMISSED')),
  dismissal_reason    text,
  constraint pv_material_requirements_motif_rejet
    check (status <> 'DISMISSED' or dismissal_reason is not null),

  comment             text,
  metadata            jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,

  constraint pv_material_requirements_tenant_id_key unique (tenant_id, id)
);

-- FK COMPOSITES sur les six rattachements. Sans elles, un besoin pourrait citer
-- l'article, le devis ou la visite d'un AUTRE tenant.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_prospect_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_prospect_fk
      foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_site_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_site_fk
      foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_quote_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_quote_fk
      foreign key (tenant_id, quote_id) references hermes_os.pv_quotes (tenant_id, id)
      on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_study_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_study_fk
      foreign key (tenant_id, study_id) references hermes_os.pv_studies (tenant_id, id)
      on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_survey_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_survey_fk
      foreign key (tenant_id, survey_id) references hermes_os.pv_site_surveys (tenant_id, id)
      on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pv_material_req_material_fk') then
    alter table hermes_os.pv_material_requirements add constraint pv_material_req_material_fk
      foreign key (tenant_id, material_id) references hermes_os.pv_material_catalog (tenant_id, id)
      on update cascade on delete restrict;
  end if;
end;
$$;

alter table hermes_os.pv_material_requirements enable row level security;
revoke all on table hermes_os.pv_material_requirements from anon, authenticated;

create index if not exists idx_pv_material_req_site
  on hermes_os.pv_material_requirements (tenant_id, site_id, status);
create index if not exists idx_pv_material_req_material
  on hermes_os.pv_material_requirements (tenant_id, material_id) where material_id is not null;

comment on table hermes_os.pv_material_requirements is
  'PV-7 — besoin matériel d''une affaire. L''ORIGINE est conservée : QUOTE / STUDY / SURVEY / MANUAL.';
comment on column hermes_os.pv_material_requirements.needs_confirmation is
  'PV-7 — vrai quand le besoin derive de TEXTE LIBRE. Il alerte, mais ne rend jamais une affaire prete sans confirmation humaine.';

drop trigger if exists trg_pv_material_req_tenant_immutable on hermes_os.pv_material_requirements;
create trigger trg_pv_material_req_tenant_immutable
  before update on hermes_os.pv_material_requirements
  for each row execute function hermes_os.pv_tenant_immutable();

create or replace function hermes_os.pv_material_requirement_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_row hermes_os.pv_material_requirements := case when tg_op='DELETE' then old else new end;
        v_label text; v_summary text;
begin
  v_label := coalesce(v_row.free_designation,
    (select c.sku from hermes_os.pv_material_catalog c where c.id = v_row.material_id), '?');
  if tg_op = 'INSERT' then
    v_summary := format('besoin materiel ajoute (%s) : %s x %s', v_row.origin, v_row.quantity_required, v_label);
  elsif tg_op = 'DELETE' then
    v_summary := format('besoin materiel retire : %s', v_label);
  elsif old.status is distinct from new.status then
    v_summary := format('besoin materiel %s : %s', lower(new.status), v_label);
  elsif old.confirmed_at is distinct from new.confirmed_at then
    v_summary := format('besoin materiel confirme par un humain : %s', v_label);
  else
    v_summary := format('besoin materiel modifie : %s', v_label);
  end if;
  perform hermes_os._pv_audit(v_row.tenant_id, 'pv_material_requirements', v_row.id, '{}'::jsonb,
    jsonb_build_object('origin', v_row.origin, 'quantity', v_row.quantity_required), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_material_req_audit on hermes_os.pv_material_requirements;
create trigger trg_pv_material_req_audit
  after insert or update or delete on hermes_os.pv_material_requirements
  for each row execute function hermes_os.pv_material_requirement_audit();

-- ---------------------------------------------------------------------------
-- 2. DÉRIVATION DEPUIS LE DEVIS — et ce qu'elle refuse de deviner.
--
--    Une ligne de devis devient un besoin STRUCTURÉ quand, et seulement quand,
--    elle porte un article du catalogue reconnaissable. La reconnaissance est
--    faite sur la DÉSIGNATION EXACTE ou le SKU exact — pas de correspondance
--    approximative, pas de distance de Levenshtein, pas d'IA.
--
--    Tout le reste devient un besoin `needs_confirmation = true`, avec la
--    désignation libre recopiée telle quelle. Le système dit alors « voici ce
--    que j'ai lu, confirmez ce que cela représente », ce qui est la vérité.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_derive_requirements_from_quote(p_quote_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  q hermes_os.pv_quotes; l record; v_material uuid; v_n integer := 0; v_uid uuid := auth.uid();
begin
  select * into q from hermes_os.pv_quotes where id = p_quote_id;
  if q.id is null then return 0; end if;

  for l in
    select * from hermes_os.pv_quote_lines
     where quote_id = p_quote_id and tenant_id = q.tenant_id
     order by position nulls last, created_at
  loop
    -- Reconnaissance EXACTE uniquement.
    select c.id into v_material
      from hermes_os.pv_material_catalog c
     where c.tenant_id = q.tenant_id
       and c.is_active
       and (lower(btrim(c.designation)) = lower(btrim(l.designation))
            or lower(btrim(c.sku)) = lower(btrim(l.designation)))
     order by c.created_at
     limit 1;

    -- Idempotence : un besoin déjà dérivé de CETTE ligne n'est pas redoublé.
    if exists (select 1 from hermes_os.pv_material_requirements r
                where r.tenant_id = q.tenant_id and r.origin = 'QUOTE'
                  and r.source_entity_id = l.id) then
      v_material := null;
      continue;
    end if;

    insert into hermes_os.pv_material_requirements
      (tenant_id, prospect_id, site_id, quote_id, study_id,
       material_id, free_designation, quantity_required, unit,
       origin, source_entity_id, is_mandatory, needs_confirmation, comment,
       created_by, updated_by)
    values
      (q.tenant_id, q.prospect_id, q.site_id, q.id, q.study_id,
       v_material,
       case when v_material is null then l.designation else null end,
       l.quantity,
       -- L'unité d'une ligne de devis est du texte libre borné (PV-5) ; celle
       -- d'un besoin est une liste CLOSE. On ne force pas : ce qui n'appartient
       -- pas au vocabulaire retombe sur 'U' plutôt que de faire échouer la
       -- dérivation entière sur une unité exotique.
       case when upper(btrim(coalesce(l.unit,'U')))
                 in ('U','M','ML','M2','KG','L','LOT','H','FORFAIT')
            then upper(btrim(l.unit)) else 'U' end,
       'QUOTE', l.id, true,
       v_material is null,
       case when v_material is null
            then 'Ligne de devis non rattachee au catalogue : a confirmer par un humain.'
            else null end,
       v_uid, v_uid);
    v_n := v_n + 1;
    v_material := null;
  end loop;

  return v_n;
end;
$function$;

revoke all on function hermes_os.pv_derive_requirements_from_quote(uuid) from public;

comment on function hermes_os.pv_derive_requirements_from_quote(uuid) is
  'PV-7 — derive les besoins d''un devis. Correspondance EXACTE seulement ; tout le reste exige une confirmation humaine.';

-- ---------------------------------------------------------------------------
-- 3. DÉRIVATION DEPUIS LA VISITE TECHNIQUE.
--
--    C'est ici que PV-6 cesse d'être un constat sans suite. Trois écarts ont une
--    conséquence matérielle DÉTERMINISTE et non ambiguë :
--
--      CABLE_ROUTE_ISSUE      → la longueur relevée devient un besoin de câble
--      ELECTRICAL_PANEL_ISSUE → une reprise de tableau est requise
--      HEIGHT_ACCESS_NOTICE   → un moyen d'accès doit être chiffré
--
--    Les autres écarts (surface, azimut, amiante…) n'ont PAS de traduction
--    matérielle univoque : les traduire quand même serait exactement le genre de
--    devinette que ce lot s'interdit.
--
--    Ces besoins sont créés en TEXTE LIBRE et `needs_confirmation` : ils disent
--    « le terrain impose ceci », pas « commandez cette référence ».
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_derive_requirements_from_survey(p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v hermes_os.pv_site_surveys; f record; v_n integer := 0; v_uid uuid := auth.uid();
  v_label text; v_qty numeric; v_unit text;
begin
  select * into v from hermes_os.pv_site_surveys where id = p_survey_id;
  if v.id is null then return 0; end if;

  for f in
    select * from hermes_os.pv_site_survey_findings
     where tenant_id = v.tenant_id and survey_id = v.id
       and code in ('CABLE_ROUTE_ISSUE','ELECTRICAL_PANEL_ISSUE','HEIGHT_ACCESS_NOTICE')
  loop
    if exists (select 1 from hermes_os.pv_material_requirements r
                where r.tenant_id = v.tenant_id and r.origin = 'SURVEY'
                  and r.source_entity_id = f.id) then
      continue;
    end if;

    if f.code = 'CABLE_ROUTE_ISSUE' then
      v_label := 'Cable AC/DC — longueur relevee en visite technique';
      v_qty   := coalesce(v.cable_distance_m, 1);
      v_unit  := 'ML';
    elsif f.code = 'ELECTRICAL_PANEL_ISSUE' then
      v_label := 'Reprise ou extension du tableau electrique (constat de visite)';
      v_qty   := 1;
      v_unit  := 'FORFAIT';
    else
      v_label := 'Moyen d''acces et securite (hauteur relevee en visite technique)';
      v_qty   := 1;
      v_unit  := 'FORFAIT';
    end if;

    insert into hermes_os.pv_material_requirements
      (tenant_id, prospect_id, site_id, survey_id,
       free_designation, quantity_required, unit,
       origin, source_entity_id, is_mandatory, needs_confirmation, comment,
       created_by, updated_by)
    values
      (v.tenant_id, v.prospect_id, v.site_id, v.id,
       v_label, v_qty, v_unit,
       'SURVEY', f.id, f.is_blocking, true,
       format('Derive de l''ecart de visite %s. A confirmer et rattacher au catalogue.', f.code),
       v_uid, v_uid);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

revoke all on function hermes_os.pv_derive_requirements_from_survey(uuid) from public;

comment on function hermes_os.pv_derive_requirements_from_survey(uuid) is
  'PV-7 — traduit en besoin materiel les SEULS ecarts de visite a consequence univoque. Aucune devinette.';

commit;
