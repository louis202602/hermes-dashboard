-- PHOTO-P1 / 6 — Acquisition : leads, campagnes, prestations configurables.
-- (project smubxqorirlfldatzmym)
--
-- ⚠️ NON APPLIQUÉE. GO_LIVE = NO. À examiner avant toute migration réelle.
--
-- POURQUOI CES TABLES ET PAS « UN DEUXIÈME CRM » — état constaté en base :
--   * Hermès n'a AUCUNE table de leads générique. L'« Agent 2 — CRM Notion IA »
--     est un connecteur vers un CRM EXTERNE (Notion) ; côté Postgres il ne
--     possède que des verrous et un journal (`agent2_contact_lock`,
--     `agent2_request_lock`, `agent2_update_lock`, `agent2_audit_log`).
--   * Le patron réel du dépôt est UNE TABLE PROSPECTS PAR VERTICALE :
--     `peinture_prospects` (21 colonnes) et `immo_prospects` (12 colonnes).
--   `photo_leads` suit donc exactement ce patron établi. Ce n'est pas un second
--   CRM : c'est la même brique, déclinée pour la verticale photo — et elle
--   délègue au même Agent 2 pour la synchronisation externe (`crm_external_id`,
--   miroir de `peinture_prospects.crm_notion_page_id`).
--
-- RGPD — minimisation :
--   * `last_name` est NULLABLE et n'est jamais requis pour qualifier ;
--   * `location_label` est un secteur libre (« Aix-en-Provence »), PAS une
--     adresse postale ; aucune latitude/longitude, aucune donnée sensible ;
--   * `opted_out` porte l'opposition, honorée par le service de relance.
--
-- Réversible : 20260819_photo_studio_9_rollback_p1.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Prestations CONFIGURABLES par tenant.
--    Ajouter « mini-séance Halloween » ne doit exiger AUCUNE migration : le
--    type technique reste borné (photo_leads.service_type), le libellé métier
--    et le tarif indicatif vivent ici, modifiables par la photographe.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_service_offerings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null,
  service_type      text not null
                      check (service_type in ('MARIAGE','GROSSESSE','NAISSANCE','FAMILLE',
                                              'PORTRAIT','EVENEMENT','MINI_SEANCE','AUTRE')),
  label             text not null check (length(btrim(label)) between 1 and 120),
  -- Fourchette AFFICHABLE par le standard téléphonique. NULL = « je ne peux pas
  -- annoncer de tarif » : c'est ce qui empêche l'agent vocal d'inventer un prix.
  price_from_eur    numeric(10,2) check (price_from_eur is null or price_from_eur >= 0),
  price_to_eur      numeric(10,2) check (price_to_eur is null or price_to_eur >= 0),
  duration_minutes  integer check (duration_minutes is null or duration_minutes > 0),
  -- Le standard a-t-il le droit de citer cette fourchette au téléphone ?
  quotable_by_phone boolean not null default false,
  active            boolean not null default true,
  sort_order        integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint photo_offering_price_range check
    (price_from_eur is null or price_to_eur is null or price_to_eur >= price_from_eur)
);
alter table hermes_os.photo_service_offerings enable row level security;
create unique index if not exists photo_offerings_unique
  on hermes_os.photo_service_offerings (tenant_id, lower(btrim(label)));

-- ---------------------------------------------------------------------------
-- 2. Campagnes — porteuses du COÛT RÉEL, seule source possible du CAC/ROAS.
--    `spend_eur` est NULLABLE À DESSEIN : sans dépense saisie, le CAC vaut NULL
--    (« non mesuré ») et jamais 0 €, qui serait un chiffre faux.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_campaigns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null,
  campaign_key  text not null check (length(btrim(campaign_key)) between 1 and 80),
  label         text not null check (length(btrim(label)) between 1 and 200),
  source        text not null
                  check (source in ('WEBSITE','LANDING_PAGE','INSTAGRAM','FACEBOOK','GOOGLE',
                                    'FORM','INBOUND_CALL','REFERRAL','MANUAL_IMPORT','OTHER')),
  spend_eur     numeric(12,2) check (spend_eur is null or spend_eur >= 0),
  starts_on     date,
  ends_on       date,
  active        boolean not null default false,
  notes         text check (notes is null or length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint photo_campaign_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
alter table hermes_os.photo_campaigns enable row level security;
create unique index if not exists photo_campaigns_unique
  on hermes_os.photo_campaigns (tenant_id, campaign_key);

-- ---------------------------------------------------------------------------
-- 3. LEADS — le cycle Source → Lead → Qualification → Devis → Relance →
--    Réservation → Paiement → Attribution du CA.
--
--    `client_id` / `session_id` reprennent le lead une fois converti : le lead
--    n'est pas dupliqué en client, il est RATTACHÉ. C'est ce lien qui rend
--    l'attribution du CA vérifiable plutôt que déclarative.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_leads (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              text not null,
  source                 text not null
                           check (source in ('WEBSITE','LANDING_PAGE','INSTAGRAM','FACEBOOK','GOOGLE',
                                             'FORM','INBOUND_CALL','REFERRAL','MANUAL_IMPORT','OTHER')),
  campaign_key           text,
  service_type           text not null
                           check (service_type in ('MARIAGE','GROSSESSE','NAISSANCE','FAMILLE',
                                                   'PORTRAIT','EVENEMENT','MINI_SEANCE','AUTRE')),
  first_name             text check (first_name is null or length(first_name) <= 100),
  -- RGPD : facultatif, jamais exigé pour qualifier un prospect.
  last_name              text check (last_name is null or length(last_name) <= 100),
  phone                  text check (phone is null or length(phone) <= 40),
  email                  text check (email is null or length(email) <= 320),
  requested_date         date,
  -- Secteur libre, PAS une adresse postale.
  location_label         text check (location_label is null or length(location_label) <= 200),
  budget_eur             numeric(12,2) check (budget_eur is null or budget_eur >= 0),
  status                 text not null default 'NEW'
                           check (status in ('NEW','QUALIFYING','QUALIFIED','QUOTED','FOLLOW_UP',
                                             'BOOKED','PAID','LOST','UNQUALIFIED')),
  lead_score             integer not null default 0 check (lead_score between 0 and 100),
  score_factors          jsonb not null default '[]'::jsonb,
  next_action            text not null default 'QUALIFY',
  conversion_status      text not null default 'OPEN'
                           check (conversion_status in ('OPEN','WON','LOST','EXPIRED')),
  revenue_attributed_eur numeric(12,2) not null default 0 check (revenue_attributed_eur >= 0),
  -- Jalons commerciaux, base des relances et de l'entonnoir.
  quote_sent_at          timestamptz,
  quote_expires_at       timestamptz,
  last_outbound_at       timestamptz,
  last_inbound_at        timestamptz,
  callback_requested_at  timestamptz,
  booking_confirmed_at   timestamptz,
  -- Opposition : honorée par le service de relance, fail-closed.
  opted_out              boolean not null default false,
  opted_out_at           timestamptz,
  -- Rattachement une fois converti (pas de duplication).
  client_id              uuid references hermes_os.photo_clients(id) on delete set null,
  session_id             uuid references hermes_os.photo_sessions(id) on delete set null,
  -- Miroir de `peinture_prospects.crm_notion_page_id` : délégation à l'Agent 2.
  crm_external_id        text check (crm_external_id is null or length(crm_external_id) <= 200),
  -- Déduplication : téléphone normalisé, sinon e-mail, sinon empreinte.
  identifier_normalized  text not null check (length(identifier_normalized) between 1 and 320),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Un lead PAYÉ doit porter un CA : sinon l'attribution SW19 serait fictive.
  constraint photo_lead_paid_has_revenue
    check (status <> 'PAID' or revenue_attributed_eur > 0),
  -- Une opposition doit être datée (preuve RGPD).
  constraint photo_lead_optout_dated
    check (opted_out = false or opted_out_at is not null)
);
alter table hermes_os.photo_leads enable row level security;

create unique index if not exists photo_leads_dedupe
  on hermes_os.photo_leads (tenant_id, identifier_normalized, service_type);
create index if not exists photo_leads_by_status
  on hermes_os.photo_leads (tenant_id, status, created_at desc);
create index if not exists photo_leads_by_campaign
  on hermes_os.photo_leads (tenant_id, campaign_key) where campaign_key is not null;
create index if not exists photo_leads_followup
  on hermes_os.photo_leads (tenant_id, next_action, last_outbound_at)
  where conversion_status = 'OPEN' and opted_out = false;

comment on column hermes_os.photo_leads.revenue_attributed_eur is
  'CA réellement encaissé et rattaché. Jamais une projection ni une estimation.';

-- ---------------------------------------------------------------------------
-- 4. Journal du lead — chronologie factuelle. Sert AUSSI de compteur
--    anti-spam : le nombre de relances par motif s'y lit, il n'est pas
--    dupliqué dans une colonne qu'on pourrait oublier de mettre à jour.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_lead_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null,
  lead_id      uuid not null references hermes_os.photo_leads(id) on delete cascade,
  event_type   text not null
                 check (event_type in ('CREATED','QUALIFIED','QUOTE_SENT','FOLLOW_UP_SENT',
                                       'INBOUND_REPLY','CALLBACK_REQUESTED','BOOKED','PAID',
                                       'LOST','OPTED_OUT','NOTE')),
  -- Motif, pour les relances : c'est la clé du plafond « 1 relance par motif ».
  reason       text check (reason is null or reason in
                 ('NEW_REQUEST','NO_REPLY','QUOTE_SENT','QUOTE_UNSIGNED',
                  'CALLBACK_REQUESTED','OFFER_EXPIRING','BOOKING_TO_CONFIRM',
                  'MISSED_CALL')),
  channel      text check (channel is null or channel in ('EMAIL','SMS','WHATSAPP','PHONE','NONE')),
  amount_eur   numeric(12,2) check (amount_eur is null or amount_eur >= 0),
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table hermes_os.photo_lead_events enable row level security;
create index if not exists photo_lead_events_by_lead
  on hermes_os.photo_lead_events (tenant_id, lead_id, occurred_at desc);
create index if not exists photo_lead_events_followups
  on hermes_os.photo_lead_events (tenant_id, lead_id, reason)
  where event_type = 'FOLLOW_UP_SENT';

-- ---------------------------------------------------------------------------
-- 5. SCORING DÉTERMINISTE — l'UNIQUE implémentation métier du barème.
--    Miroir exact de `lib/photo/leadScore.ts` (testé côté application).
--    Aucun LLM : un score commercial doit être reproductible et contestable.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.derive_photo_lead_score(p_lead_id uuid, p_tenant text)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_l hermes_os.photo_leads%rowtype;
  v_f jsonb := '[]'::jsonb;
  v_score int := 0;
  v_days int;
begin
  select * into v_l from hermes_os.photo_leads where id = p_lead_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_l.phone is not null and btrim(v_l.phone) <> '' then
    v_score := v_score + 20;
    v_f := v_f || jsonb_build_object('code','HAS_PHONE','points',20,'label','Un numéro permet de rappeler');
  end if;
  if v_l.email is not null and btrim(v_l.email) <> '' then
    v_score := v_score + 10;
    v_f := v_f || jsonb_build_object('code','HAS_EMAIL','points',10,'label','Une adresse e-mail permet d’envoyer un devis');
  end if;
  if v_l.requested_date is not null then
    v_score := v_score + 25;
    v_f := v_f || jsonb_build_object('code','HAS_REQUESTED_DATE','points',25,'label','Une date est demandée');
    v_days := v_l.requested_date - current_date;
    -- Une date PASSÉE ne vaut pas le bonus de proximité.
    if v_days >= 0 and v_days <= 120 then
      v_score := v_score + 10;
      v_f := v_f || jsonb_build_object('code','DATE_WITHIN_120_DAYS','points',10,'label','La date est proche (moins de 4 mois)');
    end if;
  end if;
  if v_l.location_label is not null and btrim(v_l.location_label) <> '' then
    v_score := v_score + 10;
    v_f := v_f || jsonb_build_object('code','HAS_LOCATION','points',10,'label','Le lieu est connu');
  end if;
  if v_l.budget_eur is not null and v_l.budget_eur > 0 then
    v_score := v_score + 15;
    v_f := v_f || jsonb_build_object('code','HAS_BUDGET','points',15,'label','Le prospect a annoncé un budget');
  end if;
  if v_l.service_type in ('MARIAGE','EVENEMENT') then
    v_score := v_score + 10;
    v_f := v_f || jsonb_build_object('code','HIGH_VALUE_SERVICE','points',10,'label','Prestation à forte valeur');
  end if;
  if v_l.source = 'REFERRAL' then
    v_score := v_score + 10;
    v_f := v_f || jsonb_build_object('code','REFERRAL_SOURCE','points',10,'label','Vient d’une recommandation');
  end if;

  return jsonb_build_object('ok', true, 'score', least(100, greatest(0, v_score)), 'factors', v_f);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. RELANCES DUES — lecture seule. N'ENVOIE RIEN.
--    Les plafonds anti-spam sont appliqués ICI, en base : aucun appelant
--    (façade, consumer n8n, opérateur) ne peut les contourner.
--      · opposition honorée ;         · 72 h minimum entre deux relances ;
--      · 1 relance par motif ;        · 3 relances maximum par lead.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_followups_due(p_tenant text, p_limit integer default 50)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_rows jsonb; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS', 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.obj order by x.score desc, x.due_since), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
             'lead_id', l.id, 'first_name', l.first_name, 'service_type', l.service_type,
             'reason', r.reason, 'due_since', r.due_since,
             'already_sent', r.sent_for_reason,
             'channel', case when l.phone is not null then 'SMS'
                             when l.email is not null then 'EMAIL' else 'NONE' end) as obj,
           l.lead_score as score, r.due_since
      from hermes_os.photo_leads l
      cross join lateral (
        select case
                 when l.callback_requested_at is not null then 'CALLBACK_REQUESTED'
                 when l.quote_sent_at is not null and l.quote_expires_at is not null
                      and l.quote_expires_at between now() and now() + interval '7 days'
                                                           then 'OFFER_EXPIRING'
                 when l.quote_sent_at is not null and l.last_inbound_at is null
                                                           then 'QUOTE_UNSIGNED'
                 when l.conversion_status = 'WON' and l.booking_confirmed_at is null
                                                           then 'BOOKING_TO_CONFIRM'
                 when l.last_outbound_at is not null and l.last_inbound_at is null
                                                           then 'NO_REPLY'
                 when l.last_outbound_at is null           then 'NEW_REQUEST'
                 else null
               end as reason,
               coalesce(l.callback_requested_at, l.quote_sent_at, l.last_outbound_at, l.created_at) as due_since
      ) r
      cross join lateral (
        select count(*) filter (where e.reason = r.reason) as sent_for_reason,
               count(*)                                    as sent_total,
               max(e.occurred_at)                          as last_followup_at
          from hermes_os.photo_lead_events e
         where e.tenant_id = l.tenant_id and e.lead_id = l.id and e.event_type = 'FOLLOW_UP_SENT'
      ) c
     where l.tenant_id = p_tenant
       and l.conversion_status = 'OPEN'
       and l.status not in ('LOST','UNQUALIFIED','PAID')
       and l.opted_out = false                                    -- opposition
       and r.reason is not null
       and c.sent_for_reason < 1                                  -- 1 par motif
       and c.sent_total < 3                                       -- 3 par lead
       and (c.last_followup_at is null
            or c.last_followup_at < now() - interval '72 hours')  -- 72 h
       and l.created_at > now() - interval '45 days'              -- abandon
     limit v_lim) x;

  return jsonb_build_object('ok', true, 'items', v_rows, 'provenance', 'DERIVED');
end;
$function$;

-- Rang du cycle commercial, déclaré AVANT son appelant (§7) pour que l'ordre de
-- lecture du fichier suive l'ordre de dépendance.
create or replace function hermes_os.photo_lead_stage_rank(p_status text)
returns integer
language sql
immutable
as $function$
  select case p_status
    when 'NEW' then 0 when 'QUALIFYING' then 1 when 'QUALIFIED' then 2
    when 'QUOTED' then 3 when 'FOLLOW_UP' then 3 when 'BOOKED' then 4
    when 'PAID' then 5 when 'LOST' then -1 when 'UNQUALIFIED' then -1
    else null end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. ENTONNOIR MESURÉ — leads / qualifiés / devis / réservations / CA / coût /
--    CAC / ROAS / taux. Tout dérive de lignes réelles.
--    `cost`, `cac` et `roas` valent NULL quand la dépense n'est pas renseignée :
--    un CAC de 0 € serait un chiffre faux, pas une absence de mesure.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.compute_photo_funnel(
  p_tenant text,
  p_from   date default (current_date - 90),
  p_to     date default current_date
)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_leads int; v_qual int; v_quotes int; v_book int; v_rev numeric; v_cost numeric;
  v_by jsonb;
begin
  if p_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS');
  end if;

  select count(*),
         count(*) filter (where hermes_os.photo_lead_stage_rank(status) >= 2),
         count(*) filter (where quote_sent_at is not null),
         count(*) filter (where conversion_status = 'WON'),
         coalesce(sum(revenue_attributed_eur), 0)
    into v_leads, v_qual, v_quotes, v_book, v_rev
    from hermes_os.photo_leads
   where tenant_id = p_tenant and created_at::date between p_from and p_to;

  -- Coût = somme des dépenses RENSEIGNÉES. Aucune campagne renseignée ⇒ NULL.
  select sum(spend_eur) into v_cost
    from hermes_os.photo_campaigns
   where tenant_id = p_tenant and spend_eur is not null
     and (starts_on is null or starts_on <= p_to)
     and (ends_on is null or ends_on >= p_from);

  select coalesce(jsonb_agg(jsonb_build_object(
           'source', s.source, 'leads', s.leads, 'bookings', s.bookings,
           'revenue_eur', s.revenue,
           'cost_eur', s.cost,
           'cac_eur', case when s.cost is not null and s.bookings > 0
                           then round(s.cost / s.bookings, 2) else null end,
           'roas', case when s.cost is not null and s.cost > 0
                        then round(s.revenue / s.cost, 2) else null end) order by s.leads desc), '[]'::jsonb)
    into v_by
    from (
      select l.source,
             count(*) as leads,
             count(*) filter (where l.conversion_status = 'WON') as bookings,
             coalesce(sum(l.revenue_attributed_eur), 0) as revenue,
             (select sum(c.spend_eur) from hermes_os.photo_campaigns c
               where c.tenant_id = p_tenant and c.source = l.source and c.spend_eur is not null
                 and (c.starts_on is null or c.starts_on <= p_to)
                 and (c.ends_on is null or c.ends_on >= p_from)) as cost
        from hermes_os.photo_leads l
       where l.tenant_id = p_tenant and l.created_at::date between p_from and p_to
       group by l.source) s;

  return jsonb_build_object(
    'ok', true, 'period_from', p_from, 'period_to', p_to,
    'leads', v_leads, 'qualified_leads', v_qual, 'quotes', v_quotes,
    'bookings', v_book, 'revenue_eur', v_rev,
    'cost_eur', v_cost,
    'cac_eur', case when v_cost is not null and v_book > 0 then round(v_cost / v_book, 2) else null end,
    'roas',    case when v_cost is not null and v_cost > 0 then round(v_rev / v_cost, 2) else null end,
    'conversion_rate', case when v_leads > 0 then round(v_book::numeric / v_leads, 4) else null end,
    'by_source', v_by,
    'provenance', 'REAL');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. MOINDRE PRIVILÈGE — posture uniforme du schéma (cf. lot 2).
-- ---------------------------------------------------------------------------
revoke all on function hermes_os.derive_photo_lead_score(uuid, text) from public;
revoke all on function hermes_os.photo_followups_due(text, integer) from public;
revoke all on function hermes_os.compute_photo_funnel(text, date, date) from public;
revoke all on function hermes_os.photo_lead_stage_rank(text) from public;

commit;
