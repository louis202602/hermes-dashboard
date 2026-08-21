-- LOT PV-8 / 1 — PREUVE D'ACCEPTATION CLIENT
--
-- CE QUE CE N'EST PAS. Hermes ne fournit AUCUN service de confiance : pas de
-- signature electronique qualifiee, pas de cachet eIDAS, pas de prestataire
-- externe (Yousign, DocuSign ou autre). Le vocabulaire de ce lot est donc
-- volontairement modeste : on enregistre une PREUVE D'ACCEPTATION, c'est-a-dire
-- la trace de ce qu'un humain a constate. Ni les libelles d'ecran, ni les
-- documents, ni ce SQL ne doivent laisser croire autre chose.
--
-- LE TROU QUE CE LOT FERME. Depuis PV-5, `pv_quotes.status = 'ACCEPTED'` est une
-- declaration humaine — rien de plus. PV-7 a rendu cette declaration couteuse :
-- elle ouvre `set_pv_purchase_order_ready` et donc l'engagement d'argent reel
-- chez un fournisseur. Entre les deux, il n'existait ni preuve opposable ni
-- avance encaissee. PV-8 met quelque chose derriere le mot ACCEPTED.
--
-- LA REGLE STRUCTURANTE : UNE PREUVE COUVRE UNE VERSION EXACTE.
-- Une acceptation ne dit pas << le devis DEV-2026-000001 est accepte >>. Elle
-- fige le triplet (quote_id, quote_version, quote_pdf_sha256). Si le devis change
-- de version, l'ancienne preuve ne couvre plus rien : il en faut une nouvelle.
-- C'est la seule facon d'eviter qu'un client se retrouve engage sur un document
-- qu'il n'a jamais vu.

begin;

-- ---------------------------------------------------------------------------
-- 1. Les preuves d'acceptation
-- ---------------------------------------------------------------------------

create table if not exists hermes_os.pv_quote_acceptances (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null references hermes_os.tenants (tenant_id),
  quote_id           uuid not null,
  prospect_id        uuid not null,
  site_id            uuid not null,

  -- La version EXACTE couverte. Figee a la creation, jamais recalculee.
  quote_version      integer not null check (quote_version >= 1),
  -- Empreinte du PDF FINAL reellement accepte. Nullable : une acceptation par
  -- reference externe (bon de commande client, courrier) peut exister sans que
  -- le PDF Hermes ait ete genere. Mais quand elle est presente, elle est figee.
  quote_pdf_sha256   text check (quote_pdf_sha256 is null or quote_pdf_sha256 ~ '^[a-f0-9]{64}$'),
  quote_document_id  uuid,

  -- Comment l'acceptation a ete constatee. Liste FERMEE, et aucun de ces mots
  -- ne promet un service de confiance.
  --   SIGNED_DOCUMENT     : le client a signe un document, televerse ensuite
  --   EXTERNAL_REFERENCE  : accord materialise ailleurs (bon de commande, courrier, mail)
  --   MANUAL_CONFIRMATION : un humain de l'entreprise constate l'accord (telephone, visite)
  method             text not null
    check (method in ('SIGNED_DOCUMENT','EXTERNAL_REFERENCE','MANUAL_CONFIRMATION')),

  accepted_on        date not null,
  signatory_name     text check (signatory_name is null or length(btrim(signatory_name)) between 1 and 160),
  signatory_role     text check (signatory_role is null or length(btrim(signatory_role)) between 1 and 120),
  external_reference text check (external_reference is null or length(btrim(external_reference)) between 1 and 200),
  proof_document_id  uuid,
  comment            text check (comment is null or length(comment) <= 2000),

  -- Statut : une preuve reste, on ne la reecrit pas. Une correction cree une
  -- nouvelle preuve et marque l'ancienne SUPERSEDED, avec sa raison.
  status             text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUPERSEDED')),
  superseded_by      uuid references hermes_os.pv_quote_acceptances (id),
  superseded_at      timestamptz,
  supersede_reason   text,

  -- Geste humain. Ces deux colonnes sont exigees par la garde de PV-1.
  recorded_by        uuid not null,
  recorded_at        timestamptz not null default now(),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,

  unique (tenant_id, id),

  -- SIGNED_DOCUMENT sans document televerse serait un mensonge : la methode dit
  -- << il existe un document signe >>, il doit donc exister.
  constraint pv_quote_acceptances_document_coherent check (
    method <> 'SIGNED_DOCUMENT' or proof_document_id is not null
  ),
  -- EXTERNAL_REFERENCE sans reference ne prouve rien non plus.
  constraint pv_quote_acceptances_reference_coherente check (
    method <> 'EXTERNAL_REFERENCE' or (external_reference is not null and btrim(external_reference) <> '')
  ),
  -- Une supersession se justifie ou n'a pas lieu.
  constraint pv_quote_acceptances_supersession_coherente check (
    (status = 'ACTIVE'     and superseded_by is null and superseded_at is null and supersede_reason is null)
    or
    (status = 'SUPERSEDED' and superseded_at is not null
                           and supersede_reason is not null and btrim(supersede_reason) <> '')
  )
);

comment on table hermes_os.pv_quote_acceptances is
  'PV-8 : preuve d''acceptation client d''un devis, dans sa VERSION EXACTE. '
  'Ce n''est PAS une signature electronique certifiee ni un service de confiance : '
  'Hermes enregistre ce qu''un humain a constate, rien de plus.';
comment on column hermes_os.pv_quote_acceptances.quote_version is
  'Version du devis couverte. FIGEE : une nouvelle version exige une nouvelle preuve.';
comment on column hermes_os.pv_quote_acceptances.quote_pdf_sha256 is
  'Empreinte SHA-256 du PDF FINAL reellement accepte. Figee, jamais recalculee.';

-- FK composites : la parente et le tenant voyagent ensemble. Un devis d'un autre
-- tenant ne peut pas etre reference, meme par erreur de saisie d'uuid.
alter table hermes_os.pv_quote_acceptances
  drop constraint if exists pv_quote_acceptances_quote_fk,
  add  constraint pv_quote_acceptances_quote_fk
       foreign key (tenant_id, quote_id) references hermes_os.pv_quotes (tenant_id, id) on delete cascade;
alter table hermes_os.pv_quote_acceptances
  drop constraint if exists pv_quote_acceptances_prospect_fk,
  add  constraint pv_quote_acceptances_prospect_fk
       foreign key (tenant_id, prospect_id) references hermes_os.pv_prospects (tenant_id, id) on delete cascade;
alter table hermes_os.pv_quote_acceptances
  drop constraint if exists pv_quote_acceptances_site_fk,
  add  constraint pv_quote_acceptances_site_fk
       foreign key (tenant_id, site_id) references hermes_os.pv_sites (tenant_id, id) on delete cascade;
alter table hermes_os.pv_quote_acceptances
  drop constraint if exists pv_quote_acceptances_proof_doc_fk,
  add  constraint pv_quote_acceptances_proof_doc_fk
       foreign key (tenant_id, proof_document_id) references hermes_os.pv_documents (tenant_id, id) on delete set null;
alter table hermes_os.pv_quote_acceptances
  drop constraint if exists pv_quote_acceptances_quote_doc_fk,
  add  constraint pv_quote_acceptances_quote_doc_fk
       foreign key (tenant_id, quote_document_id) references hermes_os.pv_documents (tenant_id, id) on delete set null;

-- Une seule preuve ACTIVE par (devis, version). Deux preuves actives sur la meme
-- version seraient deux verites contradictoires.
create unique index if not exists pv_quote_acceptances_active_unique
  on hermes_os.pv_quote_acceptances (tenant_id, quote_id, quote_version)
  where status = 'ACTIVE';

create index if not exists pv_quote_acceptances_quote_idx
  on hermes_os.pv_quote_acceptances (tenant_id, quote_id, status);
create index if not exists pv_quote_acceptances_site_idx
  on hermes_os.pv_quote_acceptances (tenant_id, site_id, status);

alter table hermes_os.pv_quote_acceptances enable row level security;
revoke all on hermes_os.pv_quote_acceptances from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Immuabilite : une preuve ne se rattache pas ailleurs apres coup
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_acceptance_immutable_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
begin
  -- Ce que PV-8 protege ici n'est pas << la ligne >>, c'est le LIEN. Une preuve
  -- reaffectee a un autre devis, une autre version ou un autre PDF serait une
  -- fausse preuve parfaitement credible : memes signataire, meme date, meme
  -- document televerse, mais couvrant autre chose. On fige donc le lien, pas la
  -- ligne : le commentaire et l'etat de supersession restent modifiables.
  if new.quote_id         is distinct from old.quote_id
  or new.quote_version    is distinct from old.quote_version
  or new.quote_pdf_sha256 is distinct from old.quote_pdf_sha256
  or new.method           is distinct from old.method
  or new.accepted_on      is distinct from old.accepted_on
  or new.recorded_by      is distinct from old.recorded_by
  or new.prospect_id      is distinct from old.prospect_id
  or new.site_id          is distinct from old.site_id
  then
    raise exception 'PV_PREUVE_ACCEPTATION_FIGEE: le lien d''une preuve d''acceptation (devis, version, empreinte, methode, date, constatant) ne peut pas etre modifie. Enregistrer une nouvelle preuve et marquer celle-ci SUPERSEDED avec sa raison.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pv_acceptances_immutable on hermes_os.pv_quote_acceptances;
create trigger trg_pv_acceptances_immutable
  before update on hermes_os.pv_quote_acceptances
  for each row execute function hermes_os.pv_acceptance_immutable_guard();

drop trigger if exists trg_pv_acceptances_tenant_immutable on hermes_os.pv_quote_acceptances;
create trigger trg_pv_acceptances_tenant_immutable
  before update on hermes_os.pv_quote_acceptances
  for each row execute function hermes_os.pv_tenant_immutable();

-- ---------------------------------------------------------------------------
-- 3. Geste humain obligatoire
-- ---------------------------------------------------------------------------
--
-- On REUTILISE la garde de PV-1, parametree : une preuve ACTIVE exige
-- auth.uid() non nul, recorded_by et recorded_at renseignes, et
-- recorded_by = l'appelant. Un agent, un runner ou service_role ne peut pas
-- produire une preuve d'acceptation valable.

drop trigger if exists trg_pv_acceptances_human on hermes_os.pv_quote_acceptances;
create trigger trg_pv_acceptances_human
  before insert or update on hermes_os.pv_quote_acceptances
  for each row execute function hermes_os.pv_human_validation_guard(
    'status', 'ACTIVE', 'recorded_by', 'recorded_at');

-- ---------------------------------------------------------------------------
-- 4. Coherence avec l'etat du devis
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_acceptance_quote_state_guard()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_q hermes_os.pv_quotes;
begin
  select * into v_q from hermes_os.pv_quotes
   where id = new.quote_id and tenant_id = new.tenant_id;

  if v_q.id is null then
    raise exception 'PV_PREUVE_DEVIS_INTROUVABLE: aucun devis % dans le tenant %', new.quote_id, new.tenant_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Un devis DRAFT ou READY n'a pas quitte l'entreprise : le client n'a rien pu
  -- accepter. Accepter un brouillon, c'est accepter un document qui peut encore
  -- changer sous ses pieds.
  if v_q.status not in ('SENT','ACCEPTED') then
    raise exception 'PV_PREUVE_DEVIS_NON_ENVOYE: une preuve d''acceptation exige un devis SENT (ou deja ACCEPTED). Statut actuel : %', v_q.status
      using errcode = 'check_violation';
  end if;

  -- La preuve doit porter la version REELLEMENT en cours. Enregistrer une preuve
  -- sur une version passee serait antidater un accord.
  if new.quote_version <> v_q.version then
    raise exception 'PV_PREUVE_VERSION_INCOHERENTE: la preuve porte la version % alors que le devis est en version %', new.quote_version, v_q.version
      using errcode = 'check_violation';
  end if;

  -- La coherence prospect/site est deduite du devis, jamais saisie librement.
  if new.prospect_id is distinct from v_q.prospect_id
  or new.site_id     is distinct from v_q.site_id then
    raise exception 'PV_PREUVE_RATTACHEMENT_INCOHERENT: prospect/site de la preuve differents de ceux du devis'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pv_acceptances_quote_state on hermes_os.pv_quote_acceptances;
create trigger trg_pv_acceptances_quote_state
  before insert on hermes_os.pv_quote_acceptances
  for each row execute function hermes_os.pv_acceptance_quote_state_guard();

-- ---------------------------------------------------------------------------
-- 5. Audit : entity_audit_log, aucun journal parallele
-- ---------------------------------------------------------------------------

create or replace function hermes_os.pv_acceptance_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $$
declare v_summary text; v_old jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_summary := format('preuve d''acceptation enregistree (methode %s, devis v%s, %s)',
      new.method, new.quote_version, new.accepted_on);
  elsif old.status is distinct from new.status then
    v_old := jsonb_build_object('status', old.status);
    v_summary := format('preuve d''acceptation %s -> %s (%s)',
      old.status, new.status, coalesce(new.supersede_reason, 'sans raison'));
  else
    return null;
  end if;

  perform hermes_os._pv_audit(new.tenant_id, 'pv_quote_acceptances', new.id, v_old,
    jsonb_build_object('status', new.status, 'method', new.method,
                       'quote_id', new.quote_id, 'quote_version', new.quote_version),
    v_summary);
  return null;
end;
$$;

drop trigger if exists trg_pv_acceptances_audit on hermes_os.pv_quote_acceptances;
create trigger trg_pv_acceptances_audit
  after insert or update on hermes_os.pv_quote_acceptances
  for each row execute function hermes_os.pv_acceptance_audit();

-- ---------------------------------------------------------------------------
-- 6. Documents : on REUTILISE pv_documents et le bucket existant
-- ---------------------------------------------------------------------------
--
-- Aucun nouveau bucket, aucune URL publique. Deux types et un stade suffisent.

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_doc_type_check;
alter table hermes_os.pv_documents
  add constraint pv_documents_doc_type_check check (doc_type in (
    'FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE','PLAN','SCHEMA_ELECTRIQUE',
    'NOTE_TECHNIQUE','ATTESTATION','PHOTO_TOITURE','PHOTO_TABLEAU','PHOTO_ACCES',
    'PHOTO_OBSTACLE','FICHE_VISITE','DEVIS_FOURNISSEUR','BON_COMMANDE',
    'ACCUSE_RECEPTION','BON_LIVRAISON','FICHE_TECHNIQUE','FACTURE_FOURNISSEUR',
    -- PV-8 :
    'DEVIS_SIGNE','PREUVE_ACCEPTATION','PREUVE_ACOMPTE',
    'AUTRE'));

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_stage_valide;
alter table hermes_os.pv_documents
  add constraint pv_documents_stage_valide check (document_stage in (
    'SOURCE','STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL','QUOTE_DRAFT','QUOTE_FINAL',
    'SURVEY_REPORT','PURCHASE_ORDER',
    -- PV-8 : la preuve d'acceptation et le justificatif d'acompte se rattachent
    -- au DEVIS, qui porte deja le site. Aucune colonne de rattachement nouvelle.
    'QUOTE_ACCEPTANCE'));

alter table hermes_os.pv_documents
  drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents
  add constraint pv_documents_synthese_rattachee check (
    document_stage = 'SOURCE'
    or (document_stage in ('STUDY_SUMMARY_DRAFT','STUDY_SUMMARY_FINAL') and study_id is not null)
    or (document_stage in ('QUOTE_DRAFT','QUOTE_FINAL','QUOTE_ACCEPTANCE') and quote_id is not null)
    or (document_stage = 'SURVEY_REPORT' and survey_id is not null)
    or (document_stage = 'PURCHASE_ORDER' and purchase_order_id is not null));

commit;
