-- LOT PV-8 / 2 — ACOMPTE ATTENDU, ACOMPTE CONSTATE
--
-- CE QUE CE N'EST PAS. Hermes ne debite aucune carte, n'envoie aucun lien de
-- paiement, n'appelle ni Stripe ni aucune banque, et ne confirme jamais tout
-- seul qu'un virement est arrive. Rien ici ne touche a de l'argent : PV-8
-- enregistre des FAITS DECLARES PAR UN HUMAIN. C'est exactement le contrat de
-- << devis marque envoye >> (PV-5) et de << commande passee >> (PV-7).
--
-- LE MODELE. Deux objets, pas un :
--   * `pv_deposits`         : ce qui est ATTENDU (montant, base, echeance, statut)
--   * `pv_deposit_payments` : ce qui est CONSTATE, evenement par evenement
-- Le total recu n'est jamais saisi : il est agrege depuis les evenements par un
-- declencheur. `PAID` n'est donc pas une case a cocher envoyee par le navigateur,
-- c'est une consequence arithmetique. Meme principe que la reception en PV-7.
--
-- L'ECHEANCIER (section 8 de la mission). Le modele porte deja `sequence` et
-- `kind` : representer plus tard << acompte a la commande / 2e echeance / solde >>
-- ne demandera aucune migration structurelle. PV-8 reste focalise sur le premier
-- acompte et ne construit aucune facturation client.

begin;

-- ---------------------------------------------------------------------------
-- 1. Politique commerciale du tenant
-- ---------------------------------------------------------------------------
--
-- POURQUOI CETTE TABLE. La mission interdit deux choses a la fois : coder
-- << acompte obligatoire universel >> (certaines entreprises commandent sans
-- acompte) ET tolerer un contournement silencieux. Une politique explicite,
-- par tenant, auditee, resout les deux : ne pas exiger d'acompte devient une
-- DECISION ecrite quelque part, pas l'absence d'une ligne que personne n'a creee.

create table if not exists hermes_os.pv_commercial_policies (
  tenant_id            text primary key references hermes_os.tenants (tenant_id),
  -- Defaut VOLONTAIREMENT strict : qui ne configure rien est protege.
  deposit_required     boolean not null default true,
  default_deposit_pct  numeric(5,2) check (default_deposit_pct is null
                                           or (default_deposit_pct > 0 and default_deposit_pct <= 100)),
  policy_note          text check (policy_note is null or length(policy_note) <= 1000),
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Desactiver l'exigence d'acompte se justifie par ecrit.
  constraint pv_commercial_policies_desactivation_justifiee check (
    deposit_required or (policy_note is not null and btrim(policy_note) <> '')
  )
);

comment on table hermes_os.pv_commercial_policies is
  'PV-8 : politique commerciale par tenant. `deposit_required` vaut true par defaut : '
  'une entreprise qui ne configure rien reste protegee. La desactiver exige une note ecrite.';

alter table hermes_os.pv_commercial_policies enable row level security;
revoke all on hermes_os.pv_commercial_policies from anon, authenticated;

create or replace function hermes_os.pv_deposit_required(p_tenant text)
returns boolean
language sql
stable security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
  -- Absence de ligne = politique par defaut = acompte exige.
  select coalesce((select p.deposit_required from hermes_os.pv_commercial_policies p
                    where p.tenant_id = p_tenant), true);
$$;

-- ---------------------------------------------------------------------------
-- 2. Machine a etats de l'acompte — EN DONNEES
-- ---------------------------------------------------------------------------

create table if not exists hermes_os.pv_deposit_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

alter table hermes_os.pv_deposit_transitions enable row level security;
revoke all on hermes_os.pv_deposit_transitions from anon, authenticated;

-- Ce qui NE figure PAS ici compte autant que ce qui y figure :
--   * EXPECTED -> PAID en un saut : absent. On y arrive par le rollup, jamais a la main.
--   * PAID -> quoi que ce soit : absent. PAID est TERMINAL.
--   * WAIVED -> PAID : absent. Un acompte renonce ne se reencaisse pas ; on annule
--     la renonciation en revenant a EXPECTED, ce qui laisse une trace.
insert into hermes_os.pv_deposit_transitions (from_status, to_status) values
  ('EXPECTED','PARTIALLY_PAID'),
  ('EXPECTED','PAID'),
  ('EXPECTED','WAIVED'),
  ('EXPECTED','CANCELLED'),
  ('PARTIALLY_PAID','PAID'),
  ('PARTIALLY_PAID','OVERPAID'),
  ('PARTIALLY_PAID','EXPECTED'),
  ('PARTIALLY_PAID','CANCELLED'),
  ('PAID','OVERPAID'),
  ('WAIVED','EXPECTED'),
  ('WAIVED','CANCELLED')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. L'acompte attendu
-- ---------------------------------------------------------------------------

create table if not exists hermes_os.pv_deposits (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references hermes_os.tenants (tenant_id),
  quote_id           uuid not null,
  prospect_id        uuid not null,
  site_id            uuid not null,
  acceptance_id      uuid,

  -- Prevu pour l'echeancier futur sans migration structurelle.
  sequence           integer not null default 1 check (sequence >= 1),
  kind               text not null default 'DEPOSIT'
    check (kind in ('DEPOSIT','MILESTONE','BALANCE')),

  amount_expected_eur numeric(14,2) not null check (amount_expected_eur > 0),
  percentage_pct      numeric(5,2) check (percentage_pct is null
                                          or (percentage_pct > 0 and percentage_pct <= 100)),
  -- Sur quoi le pourcentage a ete calcule. On l'ecrit plutot que de le deviner
  -- plus tard : le total du devis peut changer de version.
  basis               text not null default 'QUOTE_TOTAL_TTC'
    check (basis in ('QUOTE_TOTAL_TTC','QUOTE_TOTAL_HT','FIXED_AMOUNT')),
  basis_amount_eur    numeric(14,2) check (basis_amount_eur is null or basis_amount_eur >= 0),
  currency            text not null default 'EUR' check (currency = 'EUR'),
  due_on              date,

  status             text not null default 'EXPECTED'
    check (status in ('EXPECTED','PARTIALLY_PAID','PAID','OVERPAID','WAIVED','CANCELLED')),

  -- MAINTENU PAR DECLENCHEUR depuis pv_deposit_payments. Jamais saisi.
  amount_received_eur numeric(14,2) not null default 0 check (amount_received_eur >= 0),
  first_payment_on    date,
  last_payment_on     date,

  -- Renonciation explicite et auditee (section 10 de la mission).
  waiver_reason      text,
  waived_by          uuid,
  waived_at          timestamptz,

  cancelled_at       timestamptz,
  cancellation_reason text,
  comment            text check (comment is null or length(comment) <= 2000),

  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,

  unique (tenant_id, id),
  unique (tenant_id, quote_id, sequence),

  -- Un pourcentage sans base de calcul serait un chiffre orphelin.
  constraint pv_deposits_pourcentage_coherent check (
    percentage_pct is null or basis <> 'FIXED_AMOUNT'
  ),
  -- WAIVED exige une raison ET un acteur : c'est l'exception, elle se justifie.
  constraint pv_deposits_waiver_coherent check (
    (status <> 'WAIVED')
    or (waiver_reason is not null and btrim(waiver_reason) <> ''
        and waived_by is not null and waived_at is not null)
  ),
  constraint pv_deposits_annulation_coherente check (
    (status <> 'CANCELLED')
    or (cancelled_at is not null and cancellation_reason is not null
        and btrim(cancellation_reason) <> '')
  )
);

comment on table hermes_os.pv_deposits is
  'PV-8 : acompte ATTENDU sur un devis. `amount_received_eur` est agrege depuis '
  'pv_deposit_payments par declencheur, jamais saisi. Hermes n''encaisse rien : '
  'un humain declare ce qu''il a constate.';

alter table hermes_os.pv_deposits
  drop constraint if exists pv_deposits_quote_fk,
  add  constraint pv_deposits_quote_fk
       foreign key (tenant_id, quote_id) references hermes_os.pv_quotes (tenant_id, id) on delete cascade;
alter table hermes_os.pv_deposits
  drop constraint if exists pv_deposits_prospect_fk,
  add  constraint pv_deposits_prospect_fk
       foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id) on delete cascade;
alter table hermes_os.pv_deposits
  drop constraint if exists pv_deposits_site_fk,
  add  constraint pv_deposits_site_fk
       foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id) on delete cascade;
alter table hermes_os.pv_deposits
  drop constraint if exists pv_deposits_acceptance_fk,
  add  constraint pv_deposits_acceptance_fk
       foreign key (tenant_id, acceptance_id)
       references hermes_os.pv_quote_acceptances (tenant_id, id) on delete set null;

create index if not exists pv_deposits_quote_idx on hermes_os.pv_deposits (tenant_id, quote_id, status);
create index if not exists pv_deposits_site_idx  on hermes_os.pv_deposits (tenant_id, site_id, status);

alter table hermes_os.pv_deposits enable row level security;
revoke all on hermes_os.pv_deposits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Les paiements CONSTATES — des evenements, pas un compteur
-- ---------------------------------------------------------------------------

create table if not exists hermes_os.pv_deposit_payments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references hermes_os.tenants (tenant_id),
  deposit_id         uuid not null,
  amount_eur         numeric(14,2) not null check (amount_eur > 0),
  received_on        date not null,
  -- Moyen DECLARE. Aucun de ces mots ne signifie qu'Hermes a execute quoi que
  -- ce soit : ce sont des constats.
  method             text not null
    check (method in ('VIREMENT','CHEQUE','ESPECES','CB_TERMINAL','AUTRE')),
  external_reference text check (external_reference is null or length(btrim(external_reference)) between 1 and 200),
  proof_document_id  uuid,
  comment            text check (comment is null or length(comment) <= 2000),
  -- Geste humain obligatoire, NOT NULL au niveau du schema.
  recorded_by        uuid not null,
  recorded_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id)
);

comment on table hermes_os.pv_deposit_payments is
  'PV-8 : paiement d''acompte CONSTATE par un humain. Hermes ne debite rien, '
  'n''appelle aucune banque et ne confirme jamais seul qu''un virement est arrive.';

alter table hermes_os.pv_deposit_payments
  drop constraint if exists pv_deposit_payments_deposit_fk,
  add  constraint pv_deposit_payments_deposit_fk
       foreign key (tenant_id, deposit_id) references hermes_os.pv_deposits (tenant_id, id) on delete cascade;
alter table hermes_os.pv_deposit_payments
  drop constraint if exists pv_deposit_payments_doc_fk,
  add  constraint pv_deposit_payments_doc_fk
       foreign key (tenant_id, proof_document_id) references hermes_os.pv_documents (tenant_id, id) on delete set null;

create index if not exists pv_deposit_payments_deposit_idx
  on hermes_os.pv_deposit_payments (tenant_id, deposit_id, received_on);

alter table hermes_os.pv_deposit_payments enable row level security;
revoke all on hermes_os.pv_deposit_payments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Un paiement est un geste humain
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_deposit_payment_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_d hermes_os.pv_deposits;
begin
  if v_uid is null then
    raise exception 'PV_PAIEMENT_NON_HUMAIN: declarer un acompte recu exige un utilisateur authentifie (auth.uid() est NULL - un runner ou service_role ne constate rien).'
      using errcode = 'insufficient_privilege';
  end if;
  if new.recorded_by <> v_uid then
    raise exception 'PV_PAIEMENT_USURPE: recorded_by doit etre l''utilisateur authentifie appelant (% attendu, % fourni)', v_uid, new.recorded_by
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_d from hermes_os.pv_deposits
   where id = new.deposit_id and tenant_id = new.tenant_id;
  if v_d.id is null then
    raise exception 'PV_ACOMPTE_INTROUVABLE: aucun acompte % dans le tenant %', new.deposit_id, new.tenant_id
      using errcode = 'foreign_key_violation';
  end if;
  -- Encaisser sur un acompte annule ou renonce est une incoherence, pas une
  -- souplesse : si de l'argent arrive, l'acompte doit d'abord etre remis en
  -- EXPECTED, ce qui laisse une trace.
  if v_d.status in ('CANCELLED','WAIVED') then
    raise exception 'PV_ACOMPTE_CLOS: impossible de declarer un paiement sur un acompte %', v_d.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pv_deposit_payments_guard on hermes_os.pv_deposit_payments;
create trigger trg_pv_deposit_payments_guard
  before insert on hermes_os.pv_deposit_payments
  for each row execute function hermes_os.pv_deposit_payment_guard();

-- ---------------------------------------------------------------------------
-- 6. Le rollup : PAID est une consequence, pas une declaration
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_deposit_rollup()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare
  v_deposit_id uuid := coalesce(new.deposit_id, old.deposit_id);
  v_tenant     text := coalesce(new.tenant_id, old.tenant_id);
  v_total      numeric(14,2);
  v_first      date;
  v_last       date;
  v_d          hermes_os.pv_deposits;
  v_next       text;
begin
  select coalesce(sum(amount_eur),0), min(received_on), max(received_on)
    into v_total, v_first, v_last
    from hermes_os.pv_deposit_payments
   where tenant_id = v_tenant and deposit_id = v_deposit_id;

  select * into v_d from hermes_os.pv_deposits
   where id = v_deposit_id and tenant_id = v_tenant;
  if v_d.id is null then return null; end if;

  -- Le statut derive du montant. Trois seuils, aucun arbitrage.
  v_next := case
    when v_total = 0                          then 'EXPECTED'
    when v_total <  v_d.amount_expected_eur   then 'PARTIALLY_PAID'
    when v_total =  v_d.amount_expected_eur   then 'PAID'
    else 'OVERPAID'
  end;

  -- Un acompte renonce ou annule garde son statut : le rollup ne le ressuscite
  -- pas dans le dos de l'humain qui a pris la decision.
  if v_d.status in ('WAIVED','CANCELLED') then
    v_next := v_d.status;
  end if;

  update hermes_os.pv_deposits
     set amount_received_eur = v_total,
         first_payment_on    = v_first,
         last_payment_on     = v_last,
         status              = v_next,
         updated_at          = now()
   where id = v_deposit_id and tenant_id = v_tenant;

  return null;
end;
$$;

drop trigger if exists trg_pv_deposit_payments_rollup on hermes_os.pv_deposit_payments;
create trigger trg_pv_deposit_payments_rollup
  after insert or update or delete on hermes_os.pv_deposit_payments
  for each row execute function hermes_os.pv_deposit_rollup();

-- ---------------------------------------------------------------------------
-- 7. Machine a etats + renonciation humaine
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_deposit_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (select 1 from hermes_os.pv_deposit_transitions t
                  where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'PV_ACOMPTE_TRANSITION_INTERDITE: % -> % n''est pas une transition declaree', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pv_deposits_status_guard on hermes_os.pv_deposits;
create trigger trg_pv_deposits_status_guard
  before update on hermes_os.pv_deposits
  for each row execute function hermes_os.pv_deposit_status_guard();

-- Renoncer a un acompte est un geste HUMAIN, comme valider une visite ou
-- declarer une commande passee. La garde de PV-1 est reutilisee, parametree.
drop trigger if exists trg_pv_deposits_human_waiver on hermes_os.pv_deposits;
create trigger trg_pv_deposits_human_waiver
  before insert or update on hermes_os.pv_deposits
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'WAIVED', 'waived_by', 'waived_at');

drop trigger if exists trg_pv_deposits_tenant_immutable on hermes_os.pv_deposits;
create trigger trg_pv_deposits_tenant_immutable
  before update on hermes_os.pv_deposits
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_deposit_payments_tenant_immutable on hermes_os.pv_deposit_payments;
create trigger trg_pv_deposit_payments_tenant_immutable
  before update on hermes_os.pv_deposit_payments
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 8. Audit — entity_audit_log, aucun journal parallele
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_deposit_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_summary text; v_old jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_summary := format('acompte attendu cree : %s EUR (echeance %s)',
      new.amount_expected_eur, coalesce(new.due_on::text, 'non fixee'));
  elsif old.status is distinct from new.status then
    v_old := jsonb_build_object('status', old.status, 'amount_received_eur', old.amount_received_eur);
    v_summary := format('acompte %s -> %s (%s / %s EUR)',
      old.status, new.status, new.amount_received_eur, new.amount_expected_eur);
  elsif old.amount_received_eur is distinct from new.amount_received_eur then
    v_old := jsonb_build_object('amount_received_eur', old.amount_received_eur);
    v_summary := format('acompte : montant recu %s -> %s EUR',
      old.amount_received_eur, new.amount_received_eur);
  else
    return null;
  end if;

  perform hermes_os._pv_audit(new.tenant_id, 'pv_deposits', new.id, v_old,
    jsonb_build_object('status', new.status,
                       'amount_expected_eur', new.amount_expected_eur,
                       'amount_received_eur', new.amount_received_eur,
                       'quote_id', new.quote_id),
    v_summary);
  return null;
end;
$$;

drop trigger if exists trg_pv_deposits_audit on hermes_os.pv_deposits;
create trigger trg_pv_deposits_audit
  after insert or update on hermes_os.pv_deposits
  for each row execute function hermes_os.pv_deposit_audit();

create or replace function hermes_os.pv_deposit_payment_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
begin
  perform hermes_os._pv_audit(new.tenant_id, 'pv_deposit_payments', new.id, '{}'::jsonb,
    jsonb_build_object('deposit_id', new.deposit_id, 'amount_eur', new.amount_eur,
                       'method', new.method, 'received_on', new.received_on),
    format('paiement d''acompte declare : %s EUR le %s (%s)',
           new.amount_eur, new.received_on, new.method));
  return null;
end;
$$;

drop trigger if exists trg_pv_deposit_payments_audit on hermes_os.pv_deposit_payments;
create trigger trg_pv_deposit_payments_audit
  after insert on hermes_os.pv_deposit_payments
  for each row execute function hermes_os.pv_deposit_payment_audit();

commit;
