-- PACK PHOTOVOLTAÏQUE — LOT PV-5 / 2 — Machine à états du devis, immutabilité,
-- et fermeture du trou commercial de la machine prospect.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- Même forme que PV-1 (prospect, 33 chemins) et PV-3 (étude/chiffrage, 31
-- chemins) : les transitions sont des DONNÉES. Ajouter un chemin demain =
-- insérer une ligne, jamais modifier une fonction.

begin;

-- ---------------------------------------------------------------------------
-- 1. LES CHEMINS DU DEVIS.
--
--    Ce que la table interdit, et pourquoi :
--      DRAFT -> ACCEPTED   : un devis jamais transmis ne peut pas être accepté.
--      DRAFT -> SENT       : on passe par READY, qui est le point de contrôle
--                            de complétude. Sans lui, « prêt » ne veut rien dire.
--      ACCEPTED -> quoi que ce soit : un engagement accepté ne se rétracte pas
--                            par un changement de statut. On l'annule par un
--                            autre acte, pas en réécrivant l'histoire.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.pv_quote_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);

comment on table hermes_os.pv_quote_transitions is
  'PV-5 — chemins de statut autorisés pour un devis. Données de référence, pas du métier.';

alter table hermes_os.pv_quote_transitions enable row level security;
revoke all on table hermes_os.pv_quote_transitions from anon, authenticated;

insert into hermes_os.pv_quote_transitions (from_status, to_status) values
  -- Un brouillon : on le prépare, on l'abandonne, ou une révision le remplace.
  ('DRAFT',     'READY'),
  ('DRAFT',     'CANCELLED'),
  ('DRAFT',     'SUPERSEDED'),
  -- Prêt : on peut revenir en arrière pour corriger tant que rien n'est parti.
  ('READY',     'DRAFT'),
  ('READY',     'SENT'),
  ('READY',     'CANCELLED'),
  ('READY',     'SUPERSEDED'),
  -- Transmis : la balle est chez le client. Quatre issues, plus la révision.
  ('SENT',      'ACCEPTED'),
  ('SENT',      'REFUSED'),
  ('SENT',      'EXPIRED'),
  ('SENT',      'CANCELLED'),
  ('SENT',      'SUPERSEDED'),
  -- Refusé ou périmé : seule une nouvelle version peut reprendre le fil.
  ('REFUSED',   'SUPERSEDED'),
  ('EXPIRED',   'SUPERSEDED'),
  ('CANCELLED', 'SUPERSEDED')
on conflict (from_status, to_status) do nothing;

create or replace function hermes_os.pv_quote_status_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not exists (
    select 1 from hermes_os.pv_quote_transitions t
     where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'PV_DEVIS_TRANSITION_INTERDITE: % -> % n''est pas une transition declaree',
      old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_quotes_status_guard on hermes_os.pv_quotes;
create trigger trg_pv_quotes_status_guard
  before update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_quote_status_guard();

-- ---------------------------------------------------------------------------
-- 2. IMMUTABILITÉ APRÈS ENVOI.
--
--    Une fois `SENT`, le CONTENU COMMERCIAL est gelé. Ce n'est pas une
--    politesse : un devis transmis est une offre datée, et la modifier sous le
--    même identifiant transformerait rétroactivement ce que le client a reçu.
--    Le chemin propre est la RÉVISION — nouvelle version, ancienne intacte.
--
--    Ce qui reste modifiable après envoi : le STATUT et les traces d'issue
--    (accepté, refusé, périmé, annulé). Rien de ce qui engage un prix.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_quote_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
begin
  if old.status in ('DRAFT', 'READY') then
    return new;  -- tant que rien n'est parti, tout se corrige
  end if;

  if new.prospect_id  is distinct from old.prospect_id
     or new.site_id      is distinct from old.site_id
     or new.study_id     is distinct from old.study_id
     or new.economics_id is distinct from old.economics_id
     or new.quote_number is distinct from old.quote_number
     or new.version      is distinct from old.version
     or new.currency     is distinct from old.currency
     or new.discount_pct is distinct from old.discount_pct
     or new.issued_on    is distinct from old.issued_on
     or new.valid_until  is distinct from old.valid_until
     or new.terms        is distinct from old.terms
     or new.subtotal_ht_eur is distinct from old.subtotal_ht_eur
     or new.total_ht_eur    is distinct from old.total_ht_eur
     or new.total_vat_eur   is distinct from old.total_vat_eur
     or new.total_ttc_eur   is distinct from old.total_ttc_eur
  then
    raise exception
      'PV_DEVIS_FIGE: le contenu commercial d''un devis % ne peut plus etre modifie. Creez une nouvelle version.',
      old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_pv_quotes_immutable on hermes_os.pv_quotes;
create trigger trg_pv_quotes_immutable
  before update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_quote_immutable_guard();

-- Les LIGNES d'un devis transmis sont gelées elles aussi — sans quoi le gel du
-- devis serait une porte fermée à côté d'une fenêtre ouverte.
create or replace function hermes_os.pv_quote_lines_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_status text; v_quote uuid;
begin
  v_quote := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
  select status into v_status from hermes_os.pv_quotes where id = v_quote;
  if v_status is null or v_status in ('DRAFT', 'READY') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception
    'PV_DEVIS_FIGE: les lignes d''un devis % ne peuvent plus etre modifiees. Creez une nouvelle version.',
    v_status using errcode = 'check_violation';
end;
$function$;

drop trigger if exists trg_pv_quote_lines_immutable on hermes_os.pv_quote_lines;
create trigger trg_pv_quote_lines_immutable
  before insert or update or delete on hermes_os.pv_quote_lines
  for each row execute function hermes_os.pv_quote_lines_immutable_guard();

-- Le tenant d'une ligne ne bouge jamais : garde G1 de PV-1, réutilisée telle
-- quelle. Sans elle, un `update … set tenant_id = …` déplacerait un devis entier
-- d'un tenant à l'autre, FK composites comprises.
drop trigger if exists trg_pv_quotes_tenant_immutable on hermes_os.pv_quotes;
create trigger trg_pv_quotes_tenant_immutable
  before update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_tenant_immutable();

drop trigger if exists trg_pv_quote_lines_tenant_immutable on hermes_os.pv_quote_lines;
create trigger trg_pv_quote_lines_tenant_immutable
  before update on hermes_os.pv_quote_lines
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 3. AUDIT. Réutilise `entity_audit_log` via `_pv_audit`, comme tout le Pack PV.
--    AUCUN journal parallèle : un second registre finirait par diverger du
--    premier, et personne ne saurait lequel fait foi.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_quote_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_summary text; v_old jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_summary := format('devis %s v%s cree (statut %s)',
      new.quote_number, new.version, new.status);
  elsif old.status is distinct from new.status then
    v_old := jsonb_build_object('status', old.status);
    v_summary := format('devis %s v%s : statut %s -> %s',
      new.quote_number, new.version, old.status, new.status);
  elsif to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
    v_old := jsonb_build_object('total_ttc_eur', old.total_ttc_eur);
    v_summary := format('devis %s v%s modifie (total TTC %s -> %s)',
      new.quote_number, new.version, old.total_ttc_eur, new.total_ttc_eur);
  else
    return null;
  end if;

  perform hermes_os._pv_audit(new.tenant_id, 'pv_quotes', new.id, v_old,
    jsonb_build_object('status', new.status, 'total_ttc_eur', new.total_ttc_eur), v_summary);
  return null;
end;
$function$;

drop trigger if exists trg_pv_quotes_audit on hermes_os.pv_quotes;
create trigger trg_pv_quotes_audit
  after insert or update on hermes_os.pv_quotes
  for each row execute function hermes_os.pv_quote_audit();

create or replace function hermes_os.pv_quote_line_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare v_row hermes_os.pv_quote_lines := case when tg_op = 'DELETE' then old else new end;
begin
  perform hermes_os._pv_audit(v_row.tenant_id, 'pv_quotes', v_row.quote_id,
    case when tg_op = 'DELETE'
         then jsonb_build_object('designation', old.designation, 'total', old.line_total_ht_eur)
         else '{}'::jsonb end,
    jsonb_build_object('designation', v_row.designation, 'total', v_row.line_total_ht_eur),
    format('ligne de devis %s : %s',
      case tg_op when 'INSERT' then 'ajoutee' when 'UPDATE' then 'modifiee' else 'supprimee' end,
      v_row.designation));
  return null;
end;
$function$;

drop trigger if exists trg_pv_quote_lines_audit on hermes_os.pv_quote_lines;
create trigger trg_pv_quote_lines_audit
  after insert or update or delete on hermes_os.pv_quote_lines
  for each row execute function hermes_os.pv_quote_line_audit();

-- ---------------------------------------------------------------------------
-- 4. LE TROU COMMERCIAL DE LA MACHINE PROSPECT.
--
--    Avant PV-5 : `STUDY_DELIVERED -> WON` était un chemin DIRECT. Un prospect
--    passait donc de « étude livrée » à « gagné » sans qu'aucun artefact ne
--    justifie le passage — mesuré, pas supposé.
--
--    Après : trois états commerciaux explicites, et `WON` n'est plus atteignable
--    QUE depuis `OFFER_ACCEPTED`. Gagner une affaire suppose désormais qu'une
--    acceptation a été réellement enregistrée.
--
--    ⚠️ CHANGEMENT DE COMPORTEMENT ASSUMÉ : le chemin direct est RETIRÉ. Les
--    prospects DÉJÀ en `WON` ne bougent pas — seule la route future change.
--    Contrôle préalable, non destructif :
--      select count(*) from hermes_os.pv_prospects where status = 'STUDY_DELIVERED';
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_prospects drop constraint if exists pv_prospects_status_check;
alter table hermes_os.pv_prospects add constraint pv_prospects_status_check check (
  status in ('NEW','CONTACTED','QUALIFYING','QUALIFIED','UNQUALIFIED',
             'STUDY_REQUESTED','STUDY_DELIVERED',
             'OFFER_PREPARED','OFFER_SENT','OFFER_ACCEPTED',
             'WON','LOST','ON_HOLD','ARCHIVED'));

insert into hermes_os.pv_prospect_transitions (from_status, to_status) values
  ('STUDY_DELIVERED', 'OFFER_PREPARED'),
  ('OFFER_PREPARED',  'OFFER_SENT'),
  ('OFFER_PREPARED',  'STUDY_DELIVERED'),
  ('OFFER_PREPARED',  'LOST'),
  ('OFFER_PREPARED',  'ON_HOLD'),
  ('OFFER_SENT',      'OFFER_ACCEPTED'),
  ('OFFER_SENT',      'OFFER_PREPARED'),
  ('OFFER_SENT',      'LOST'),
  ('OFFER_SENT',      'ON_HOLD'),
  ('OFFER_ACCEPTED',  'WON'),
  ('OFFER_ACCEPTED',  'LOST'),
  ('OFFER_ACCEPTED',  'ON_HOLD'),
  ('ON_HOLD',         'OFFER_PREPARED'),
  ('ON_HOLD',         'OFFER_SENT')
on conflict (from_status, to_status) do nothing;

-- Le raccourci qui laissait « gagner » sans offre enregistrée.
delete from hermes_os.pv_prospect_transitions
 where from_status = 'STUDY_DELIVERED' and to_status = 'WON';

commit;
