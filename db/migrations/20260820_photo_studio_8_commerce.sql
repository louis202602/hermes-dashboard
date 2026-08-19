-- ---------------------------------------------------------------------------
-- HERMÈS STUDIO — LOT 8 : commerce, portail client, fidélisation.
--
-- ⚠️ NON APPLIQUÉE. Fichier préparatoire. `GO_LIVE = NO`.
--
-- Couvre les 5 briques prioritaires :
--   1. Devis → contrat → acompte → réservation      (photo_quotes, _lines,
--                                                    photo_contracts, photo_payments)
--   2. Relance & récupération d'appel manqué        (photo_followup_config
--                                                    + motif MISSED_CALL au lot 6)
--   3. Portail client                                (photo_portal_access)
--   4. Upsell & parrainage                           (photo_upsell_rules,
--                                                    photo_referrals,
--                                                    + offering_id sur l'existant)
--   5. Cycle de vie client                           (photo_lifecycle_rules)
--
-- CE QUI N'EST PAS RECRÉÉ, parce que ça existe déjà :
--   * photo_upsell_opportunities  → étendue, pas remplacée
--   * photo_service_offerings     → LE catalogue ; les prix ne viennent que d'ici
--   * photo_clients / _sessions / _client_members / _media_consent / _galleries
--   * sw15_*  (approbations)      * sw19_cost_events  (coûts)
--   * hermes_messages             * photo_leads / photo_lead_events (lot 6)
--
-- ISOLATION : `tenant_id` en tête de chaque table, RLS activée SANS politique
-- (deny-all). Toute lecture passe par une façade qui résout le tenant
-- server-side via `resolve_active_tenant`. Aucune table n'est jamais lue en
-- direct par PostgREST.
--
-- Dépend de : lot 1 (schéma photo), lot 6 (acquisition). Les deux doivent être
-- appliqués avant celui-ci.
-- Réversible : 20260820_photo_studio_9_rollback_p2.sql
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. DEVIS — la machine d'états vit ici, pas dans l'application.
--
--    `state` reprend EXACTEMENT le vocabulaire de lib/photo/booking.ts. Une
--    divergence entre les deux serait un bug invisible : la contrainte CHECK
--    ci-dessous est donc la copie de `BOOKING_STATES`, et un test le vérifie.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_quotes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null,
  lead_id             uuid references hermes_os.photo_leads(id) on delete set null,
  client_id           uuid references hermes_os.photo_clients(id) on delete set null,
  session_id          uuid references hermes_os.photo_sessions(id) on delete set null,
  quote_number        text not null check (length(btrim(quote_number)) between 1 and 40),
  state               text not null default 'QUOTE_DRAFT'
                        check (state in ('QUOTE_DRAFT','QUOTE_SENT','QUOTE_ACCEPTED',
                                         'QUOTE_EXPIRED','CONTRACT_PENDING','CONTRACT_SIGNED',
                                         'DEPOSIT_PENDING','DEPOSIT_PAID','BOOKING_CONFIRMED',
                                         'CANCELLED')),
  service_type        text not null
                        check (service_type in ('MARIAGE','GROSSESSE','NAISSANCE','FAMILLE',
                                                'PORTRAIT','EVENEMENT','MINI_SEANCE','AUTRE')),
  total_eur           numeric(12,2) check (total_eur is null or total_eur >= 0),
  -- Acompte EXIGÉ, calculé par `computeDeposit`. NULL = non déterminé, ce qui
  -- BLOQUE la confirmation. Jamais 0 par défaut : un 0 confirmerait gratuitement.
  deposit_expected_eur numeric(12,2) check (deposit_expected_eur is null or deposit_expected_eur >= 0),
  requested_date      date,
  issued_at           timestamptz,
  sent_at             timestamptz,
  accepted_at         timestamptz,
  expires_at          timestamptz,
  cancelled_at        timestamptz,
  booking_confirmed_at timestamptz,
  -- Nombre de relances déjà émises pour CE devis (cadence de la brique 2).
  reminders_sent      integer not null default 0 check (reminders_sent >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Un devis envoyé porte forcément sa date d'envoi : sinon la relance
  -- calculerait un délai depuis rien.
  constraint photo_quote_sent_dated
    check (state = 'QUOTE_DRAFT' or state = 'CANCELLED' or sent_at is not null),
  -- Une réservation confirmée est datée ET chiffrée. C'est la trace comptable.
  constraint photo_quote_booking_complete
    check (state <> 'BOOKING_CONFIRMED'
           or (booking_confirmed_at is not null and total_eur is not null)),
  constraint photo_quote_cancel_dated
    check (state <> 'CANCELLED' or cancelled_at is not null)
);
alter table hermes_os.photo_quotes enable row level security;
create unique index if not exists photo_quotes_number_unique
  on hermes_os.photo_quotes (tenant_id, quote_number);
create index if not exists photo_quotes_by_state
  on hermes_os.photo_quotes (tenant_id, state, created_at desc);
create index if not exists photo_quotes_followup
  on hermes_os.photo_quotes (tenant_id, sent_at, expires_at)
  where state in ('QUOTE_SENT','CONTRACT_PENDING','DEPOSIT_PENDING');

comment on column hermes_os.photo_quotes.deposit_expected_eur is
  'Acompte exigé. NULL = non déterminé ⇒ la réservation NE PEUT PAS être confirmée.';

-- Lignes de devis. Le prix vient du catalogue : `offering_id` est la preuve
-- que le montant n'a pas été inventé, et `unit_price_eur` en fige la valeur au
-- moment de l'émission (un tarif révisé plus tard ne réécrit pas un devis émis).
create table if not exists hermes_os.photo_quote_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null,
  quote_id       uuid not null references hermes_os.photo_quotes(id) on delete cascade,
  offering_id    uuid references hermes_os.photo_service_offerings(id) on delete restrict,
  label          text not null check (length(btrim(label)) between 1 and 200),
  quantity       numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_eur numeric(12,2) check (unit_price_eur is null or unit_price_eur >= 0),
  line_total_eur numeric(12,2) check (line_total_eur is null or line_total_eur >= 0),
  sort_order     integer not null default 100,
  created_at     timestamptz not null default now()
);
alter table hermes_os.photo_quote_lines enable row level security;
create index if not exists photo_quote_lines_by_quote
  on hermes_os.photo_quote_lines (tenant_id, quote_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. CONTRAT + SIGNATURE — la traçabilité est une CONTRAINTE, pas une intention.
--
--    `signature_reference` est la référence opposable du prestataire de
--    signature. La contrainte `photo_contract_signature_traceable` interdit
--    qu'un contrat soit « signé » sans elle : une signature non traçable ne
--    peut donc pas exister en base, même si un appelant l'affirme.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_contracts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null,
  quote_id            uuid not null references hermes_os.photo_quotes(id) on delete cascade,
  contract_number     text not null check (length(btrim(contract_number)) between 1 and 40),
  -- Modèle de contrat, configurable PAR PRESTATION (exigence du brief).
  template_key        text check (template_key is null or length(template_key) <= 80),
  template_version    text check (template_version is null or length(template_version) <= 40),
  status              text not null default 'PENDING'
                        check (status in ('PENDING','SIGNED','DECLINED','EXPIRED','CANCELLED')),
  document_url        text check (document_url is null or length(document_url) <= 2000),
  signer_name         text check (signer_name is null or length(signer_name) <= 200),
  signed_at           timestamptz,
  signature_method    text check (signature_method is null
                                  or signature_method in ('ELECTRONIC','HANDWRITTEN','CLICKWRAP')),
  signature_reference text check (signature_reference is null or length(signature_reference) <= 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint photo_contract_signature_traceable
    check (status <> 'SIGNED'
           or (signed_at is not null
               and signature_method is not null
               and signature_reference is not null
               and length(btrim(signature_reference)) > 0))
);
alter table hermes_os.photo_contracts enable row level security;
create unique index if not exists photo_contracts_number_unique
  on hermes_os.photo_contracts (tenant_id, contract_number);
create index if not exists photo_contracts_by_quote
  on hermes_os.photo_contracts (tenant_id, quote_id);

comment on constraint photo_contract_signature_traceable on hermes_os.photo_contracts is
  'Un contrat SIGNÉ porte obligatoirement date, méthode et référence opposable.';

-- ---------------------------------------------------------------------------
-- 3. PAIEMENTS — « payé » ne veut rien dire sans vérification externe.
--
--    `verified_at` + `provider_reference` sont exigés pour tout paiement PAID :
--    c'est ce qui distingue un encaissement d'une affirmation. La brique 1 ne
--    confirme une réservation que sur des faits portant ces deux champs.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_payments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null,
  quote_id           uuid references hermes_os.photo_quotes(id) on delete set null,
  session_id         uuid references hermes_os.photo_sessions(id) on delete set null,
  client_id          uuid references hermes_os.photo_clients(id) on delete set null,
  kind               text not null
                       check (kind in ('DEPOSIT','BALANCE','UPSELL','REFUND','OTHER')),
  amount_eur         numeric(12,2) not null check (amount_eur >= 0),
  currency           text not null default 'EUR' check (length(currency) = 3),
  status             text not null default 'PENDING'
                       check (status in ('PENDING','PAID','FAILED','REFUNDED','CANCELLED')),
  method             text check (method is null
                                 or method in ('CARD','TRANSFER','CASH','CHEQUE','OTHER')),
  provider           text check (provider is null or length(provider) <= 40),
  -- Référence opposable du prestataire de paiement. Sans elle, pas de PAID.
  provider_reference text check (provider_reference is null or length(provider_reference) <= 200),
  -- Horodatage de la VÉRIFICATION externe, pas de la saisie.
  verified_at        timestamptz,
  due_at             timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint photo_payment_paid_is_verified
    check (status <> 'PAID'
           or (verified_at is not null
               and provider_reference is not null
               and length(btrim(provider_reference)) > 0)),
  constraint photo_payment_refund_dated
    check (status <> 'REFUNDED' or paid_at is not null)
);
alter table hermes_os.photo_payments enable row level security;
create unique index if not exists photo_payments_provider_ref_unique
  on hermes_os.photo_payments (tenant_id, provider, provider_reference)
  where provider_reference is not null;
create index if not exists photo_payments_by_quote
  on hermes_os.photo_payments (tenant_id, quote_id, kind);

comment on constraint photo_payment_paid_is_verified on hermes_os.photo_payments is
  'Un paiement PAID exige une vérification externe datée et référencée. Une '
  'affirmation d''agent ne suffit jamais.';

-- ---------------------------------------------------------------------------
-- 4. CADENCE DE RELANCE — configurable par tenant, mais BORNÉE.
--
--    Les CHECK reprennent les plafonds absolus du lot 6 : la configuration peut
--    resserrer (délai plus long, plafond plus bas), jamais desserrer. Une valeur
--    plus permissive est rejetée par la base, pas seulement par l'application.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_followup_config (
  tenant_id             text primary key,
  min_hours_between_any integer not null default 72  check (min_hours_between_any >= 72),
  max_total_per_lead    integer not null default 3   check (max_total_per_lead between 0 and 3),
  max_per_reason        integer not null default 1   check (max_per_reason between 0 and 1),
  days_before_giving_up integer not null default 45  check (days_before_giving_up between 1 and 45),
  -- Envoi automatique de SMS après un appel manqué. FAUX par défaut : aucun
  -- message ne part tant que la photographe ne l'a pas décidé.
  missed_call_sms_allowed boolean not null default false,
  missed_call_template  text check (missed_call_template is null or length(missed_call_template) <= 600),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table hermes_os.photo_followup_config enable row level security;

-- ---------------------------------------------------------------------------
-- 5. PORTAIL CLIENT — un jeton de PORTÉE, pas une identité.
--
--    Le jeton n'est jamais stocké en clair : seule son empreinte SHA-256 l'est,
--    comme le `state` OAuth. Un accès en base ne permet donc pas de fabriquer
--    un lien de portail.
--
--    `expires_at` est NOT NULL : un lien de portail éternel finit par circuler.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_portal_access (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null,
  client_id      uuid not null references hermes_os.photo_clients(id) on delete cascade,
  session_id     uuid references hermes_os.photo_sessions(id) on delete set null,
  token_hash     text not null check (length(token_hash) = 64),
  -- Sections ouvertes à CE client. Liste blanche, miroir de PORTAL_SECTIONS.
  sections       text[] not null default '{}',
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  last_seen_at   timestamptz,
  view_count     integer not null default 0 check (view_count >= 0),
  created_at     timestamptz not null default now(),
  constraint photo_portal_sections_known
    check (sections <@ array['session','booking','quote','contract','signature','payments',
                             'questionnaire','messages','gallery','documents','invoices',
                             'next_steps']::text[])
);
alter table hermes_os.photo_portal_access enable row level security;
create unique index if not exists photo_portal_token_unique
  on hermes_os.photo_portal_access (token_hash);
create index if not exists photo_portal_by_client
  on hermes_os.photo_portal_access (tenant_id, client_id, expires_at desc);

comment on column hermes_os.photo_portal_access.token_hash is
  'Empreinte SHA-256 du jeton. Le jeton en clair n''est JAMAIS stocké.';

-- ---------------------------------------------------------------------------
-- 6. UPSELL — on ÉTEND l'existant, on ne le remplace pas.
--
--    `photo_upsell_opportunities` existe déjà et porte kind/status/score/
--    revenue_generated_eur. Il lui manquait le lien vers le catalogue réel :
--    sans `offering_id`, rien n'empêchait un montant inventé. Avec lui, le
--    prix a une origine vérifiable.
-- ---------------------------------------------------------------------------
alter table hermes_os.photo_upsell_opportunities
  add column if not exists offering_id uuid
    references hermes_os.photo_service_offerings(id) on delete set null;
alter table hermes_os.photo_upsell_opportunities
  add column if not exists moment text
    check (moment is null or moment in ('AFTER_BOOKING','AFTER_DELIVERY'));
alter table hermes_os.photo_upsell_opportunities
  add column if not exists proposed_at timestamptz;

comment on column hermes_os.photo_upsell_opportunities.offering_id is
  'Origine du prix. Une opportunité PROPOSÉE sans offering_id n''est pas chiffrable.';

-- Règles d'upsell configurées par la photographe.
create table if not exists hermes_os.photo_upsell_rules (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null,
  moment        text not null check (moment in ('AFTER_BOOKING','AFTER_DELIVERY')),
  -- Vide = toutes les prestations.
  session_types text[] not null default '{}',
  offering_id   uuid not null references hermes_os.photo_service_offerings(id) on delete cascade,
  priority      integer not null default 100,
  active        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table hermes_os.photo_upsell_rules enable row level security;
create index if not exists photo_upsell_rules_active
  on hermes_os.photo_upsell_rules (tenant_id, moment, priority) where active;

-- ---------------------------------------------------------------------------
-- 7. PARRAINAGE — le lien est toujours écrit, la récompense est conditionnelle.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_referrals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null,
  -- Le parrain : un client existant.
  referrer_client_id uuid not null references hermes_os.photo_clients(id) on delete cascade,
  -- Le filleul : d'abord un lead, puis éventuellement un client.
  referee_lead_id    uuid references hermes_os.photo_leads(id) on delete set null,
  referee_client_id  uuid references hermes_os.photo_clients(id) on delete set null,
  state          text not null default 'REFERRED'
                   check (state in ('REFERRED','LEAD_CREATED','CONVERTED',
                                    'REWARD_DUE','REWARD_GRANTED','EXPIRED')),
  -- NULL = aucune récompense configurée. Jamais 0 par défaut.
  reward_eur     numeric(12,2) check (reward_eur is null or reward_eur >= 0),
  granted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- On ne se parraine pas soi-même.
  constraint photo_referral_not_self
    check (referee_client_id is null or referee_client_id <> referrer_client_id),
  constraint photo_referral_granted_complete
    check (state <> 'REWARD_GRANTED' or (granted_at is not null and reward_eur is not null))
);
alter table hermes_os.photo_referrals enable row level security;
create index if not exists photo_referrals_by_referrer
  on hermes_os.photo_referrals (tenant_id, referrer_client_id, state);

-- Règle de récompense, par tenant. Absente ⇒ aucune récompense promise.
create table if not exists hermes_os.photo_referral_config (
  tenant_id                text primary key,
  reward_eur               numeric(12,2) check (reward_eur is null or reward_eur >= 0),
  requires_paid_conversion boolean not null default true,
  active                   boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
alter table hermes_os.photo_referral_config enable row level security;

-- ---------------------------------------------------------------------------
-- 8. CYCLE DE VIE — des règles ÉCRITES par la photographe, jamais déduites.
--
--    `anchor` n'admet que deux valeurs, et c'est le garde-fou principal :
--      SESSION_DELIVERED — une séance réellement livrée ;
--      MEMBER_BIRTH      — une naissance que la cliente a elle-même déclarée.
--    Aucune autre ancre n'est possible ⇒ aucune inférence sur une grossesse,
--    une séparation ou un état de santé ne peut entrer dans le moteur.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.photo_lifecycle_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null,
  anchor              text not null check (anchor in ('SESSION_DELIVERED','MEMBER_BIRTH')),
  anchor_value        text not null check (length(btrim(anchor_value)) between 1 and 40),
  offset_months       integer not null check (offset_months between 0 and 240),
  recommended_service text not null
                        check (recommended_service in ('MARIAGE','GROSSESSE','NAISSANCE','FAMILLE',
                                                       'PORTRAIT','EVENEMENT','MINI_SEANCE','AUTRE')),
  lead_time_days      integer not null default 30 check (lead_time_days between 0 and 365),
  active              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table hermes_os.photo_lifecycle_rules enable row level security;
create unique index if not exists photo_lifecycle_rules_unique
  on hermes_os.photo_lifecycle_rules (tenant_id, anchor, anchor_value, recommended_service);

comment on table hermes_os.photo_lifecycle_rules is
  'Règles de fidélisation ÉCRITES par la photographe. Le moteur ne déduit '
  'jamais un événement de vie : il chaîne depuis un fait déjà posé.';

-- ---------------------------------------------------------------------------
-- 9. LA PORTE DE LA RÉSERVATION — en base, donc incontournable.
--
--    Miroir SQL de `canConfirmBooking`. Pourquoi la dupliquer ici plutôt que
--    faire confiance à l'application : parce qu'un runner n8n, un webhook de
--    paiement ou un futur service appellent la base SANS passer par Next.js.
--    Une règle qui ne vit que dans l'application n'est pas une règle.
--
--    Renvoie TOUS les obstacles, comme la version TypeScript.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_booking_blockers(p_tenant text, p_quote uuid)
returns jsonb
language plpgsql
stable
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_q hermes_os.photo_quotes%rowtype;
  v_signed boolean;
  v_deposit_paid numeric(12,2);
  v_verified boolean;
  v_blockers text[] := '{}';
begin
  if p_tenant is null or p_quote is null then
    return jsonb_build_object('ok', false, 'code', 'BAD_ARGUMENTS', 'blockers', '[]'::jsonb);
  end if;

  select * into v_q from hermes_os.photo_quotes
   where tenant_id = p_tenant and id = p_quote;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'blockers', '[]'::jsonb);
  end if;

  if v_q.state <> 'DEPOSIT_PAID' then
    v_blockers := v_blockers || 'WRONG_STATE';
  end if;

  -- Signature : la contrainte de table garantit déjà qu'un SIGNED est traçable,
  -- donc il suffit ici de constater son existence.
  select exists (
    select 1 from hermes_os.photo_contracts c
     where c.tenant_id = p_tenant and c.quote_id = p_quote and c.status = 'SIGNED'
  ) into v_signed;
  if not v_signed then
    v_blockers := v_blockers || 'CONTRACT_NOT_SIGNED';
  end if;

  -- Acompte : on ne somme QUE les paiements vérifiés. Un PENDING ne compte pas.
  select coalesce(sum(p.amount_eur), 0), count(*) > 0
    into v_deposit_paid, v_verified
    from hermes_os.photo_payments p
   where p.tenant_id = p_tenant and p.quote_id = p_quote
     and p.kind = 'DEPOSIT' and p.status = 'PAID' and p.verified_at is not null;

  if not v_verified then
    v_blockers := v_blockers || 'DEPOSIT_NOT_VERIFIED';
  end if;
  if v_q.deposit_expected_eur is null then
    v_blockers := v_blockers || 'DEPOSIT_AMOUNT_UNKNOWN';
  elsif v_deposit_paid < v_q.deposit_expected_eur then
    v_blockers := v_blockers || 'DEPOSIT_INSUFFICIENT';
  end if;

  return jsonb_build_object(
    'ok', true,
    'allowed', cardinality(v_blockers) = 0,
    'blockers', to_jsonb(v_blockers),
    'deposit_expected_eur', v_q.deposit_expected_eur,
    'deposit_verified_eur', v_deposit_paid);
end;
$function$;

revoke all on function hermes_os.photo_booking_blockers(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 10. TRIGGER — la confirmation est IMPOSSIBLE tant qu'un obstacle subsiste.
--
--     La fonction ci-dessus renseigne ; ce trigger empêche. Sans lui, un UPDATE
--     direct passerait outre — et c'est exactement ce qu'un agent trop sûr de
--     lui finirait par tenter.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.photo_quote_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_signed boolean;
  v_deposit_paid numeric(12,2);
  v_verified boolean;
  v_blockers text[] := '{}';
begin
  new.updated_at := now();

  -- (a) LA TABLE DES TRANSITIONS, miroir de BOOKING_TRANSITIONS.
  --     Sans elle, un UPDATE direct sauterait de QUOTE_SENT à BOOKING_CONFIRMED :
  --     la porte de réservation ci-dessous serait alors la SEULE barrière, et
  --     tous les états intermédiaires deviendraient décoratifs. Trou trouvé par
  --     la sonde d'exécution, pas par relecture.
  if tg_op = 'UPDATE' and new.state is distinct from old.state then
    if not (
      (old.state = 'QUOTE_DRAFT'       and new.state in ('QUOTE_SENT','CANCELLED')) or
      (old.state = 'QUOTE_SENT'        and new.state in ('QUOTE_ACCEPTED','QUOTE_EXPIRED','CANCELLED')) or
      (old.state = 'QUOTE_ACCEPTED'    and new.state in ('CONTRACT_PENDING','CANCELLED')) or
      (old.state = 'QUOTE_EXPIRED'     and new.state in ('QUOTE_DRAFT','CANCELLED')) or
      (old.state = 'CONTRACT_PENDING'  and new.state in ('CONTRACT_SIGNED','CANCELLED')) or
      (old.state = 'CONTRACT_SIGNED'   and new.state in ('DEPOSIT_PENDING','CANCELLED')) or
      (old.state = 'DEPOSIT_PENDING'   and new.state in ('DEPOSIT_PAID','CANCELLED')) or
      (old.state = 'DEPOSIT_PAID'      and new.state in ('BOOKING_CONFIRMED','CANCELLED')) or
      (old.state = 'BOOKING_CONFIRMED' and new.state = 'CANCELLED')
    ) then
      raise exception 'ILLEGAL_TRANSITION: % -> %', old.state, new.state
        using errcode = 'check_violation';
    end if;
  end if;

  -- (b) LA PORTE DE RÉSERVATION.
  if new.state is distinct from 'BOOKING_CONFIRMED' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.state = 'BOOKING_CONFIRMED' then
    return new;  -- déjà confirmée : on ne rejoue pas la porte
  end if;

  -- Un devis ne NAÎT jamais confirmé : il n'a ni contrat ni paiement rattaché.
  if tg_op = 'INSERT' then
    raise exception 'BOOKING_NOT_CONFIRMABLE: ["NO_HISTORY"]'
      using errcode = 'check_violation';
  end if;

  -- On lit NEW (et non la ligne stockée) : un UPDATE qui modifie l'acompte
  -- attendu ET confirme dans la même instruction doit être jugé sur la valeur
  -- qu'il écrit, pas sur celle qu'il remplace.
  select exists (
    select 1 from hermes_os.photo_contracts c
     where c.tenant_id = new.tenant_id and c.quote_id = new.id and c.status = 'SIGNED'
  ) into v_signed;
  if not v_signed then
    v_blockers := v_blockers || 'CONTRACT_NOT_SIGNED';
  end if;

  select coalesce(sum(p.amount_eur), 0), count(*) > 0
    into v_deposit_paid, v_verified
    from hermes_os.photo_payments p
   where p.tenant_id = new.tenant_id and p.quote_id = new.id
     and p.kind = 'DEPOSIT' and p.status = 'PAID' and p.verified_at is not null;

  if not v_verified then
    v_blockers := v_blockers || 'DEPOSIT_NOT_VERIFIED';
  end if;
  if new.deposit_expected_eur is null then
    v_blockers := v_blockers || 'DEPOSIT_AMOUNT_UNKNOWN';
  elsif v_deposit_paid < new.deposit_expected_eur then
    v_blockers := v_blockers || 'DEPOSIT_INSUFFICIENT';
  end if;

  if cardinality(v_blockers) > 0 then
    raise exception 'BOOKING_NOT_CONFIRMABLE: %', to_jsonb(v_blockers)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists photo_quote_guard_trg on hermes_os.photo_quotes;
create trigger photo_quote_guard_trg
  before insert or update on hermes_os.photo_quotes
  for each row execute function hermes_os.photo_quote_guard();

commit;
