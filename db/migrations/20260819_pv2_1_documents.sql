-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / 1 — Référence documentaire PV.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- PV-1 a posé le CONTRAT DE COLONNES d'un document sur `pv_energy_bills`
-- (`document_bucket`, `document_path`, `document_sha256`, `document_mime`,
-- `document_bytes`) avec un CHECK qui refuse toute URL `http(s)://`. Ce lot pose
-- la table qui MANQUAIT : un document PV qui n'est pas une facture (relevé de
-- toiture, photo de comble, plan, note technique) n'avait nulle part où exister.
--
-- Ce que cette table N'EST PAS : un moteur documentaire. Pas de versions, pas de
-- partage, pas de signature, pas d'OCR. Une ligne = un objet dans un bucket
-- PRIVÉ, rattaché à un site, avec de quoi le retrouver et le tracer.
--
-- ISOLATION — mêmes défenses que PV-1, sans exception :
--   * `tenant_id` NOT NULL, FK vers `tenants`, IMMUABLE par déclencheur ;
--   * FK COMPOSITE `(tenant_id, site_id)` → `pv_sites (tenant_id, id)`. Une FK
--     sur `site_id` seul aurait laissé un document pointer le site d'un AUTRE
--     tenant : l'isolation aurait été fausse au niveau du schéma, quelles que
--     soient les façades au-dessus ;
--   * RLS activée, ZÉRO policy (deny-all) ; `revoke all … from anon, authenticated` ;
--   * aucune URL publique stockable : `storage_path` refuse `http(s)://`, et le
--     bucket est contraint par CHECK à la liste des buckets privés Hermès.
--
-- SUPPRESSION LOGIQUE : `deleted_at` + `deleted_by`. On ne supprime jamais la
-- ligne — un document retiré de l'UI reste traçable, et l'objet Storage est
-- purgé par un geste serveur explicite (lot PV-3), jamais par le navigateur.

begin;

create table if not exists hermes_os.pv_documents (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null references hermes_os.tenants(tenant_id)
                      on update cascade on delete restrict,

  -- Rattachement au site. FK COMPOSITE : le tenant du document et celui du site
  -- sont le MÊME, garanti par la base et non par la façade.
  site_id           uuid not null,
  constraint pv_documents_site_fk foreign key (tenant_id, site_id)
    references hermes_os.pv_sites (tenant_id, id) on update cascade on delete restrict,

  -- Rattachement OPTIONNEL à une facture énergie, même défense composite.
  bill_id           uuid,
  constraint pv_documents_bill_fk foreign key (tenant_id, bill_id)
    references hermes_os.pv_energy_bills (tenant_id, id) on update cascade on delete set null,

  doc_type          text not null
                      check (doc_type in ('FACTURE_ENERGIE','RELEVE_TOITURE','PHOTO_SITE',
                                          'PLAN','SCHEMA_ELECTRIQUE','NOTE_TECHNIQUE',
                                          'ATTESTATION','AUTRE')),

  -- Emplacement PRIVÉ. Jamais une URL : seulement (bucket, chemin).
  storage_bucket    text not null default 'hermes-pv-documents'
                      check (storage_bucket in ('hermes-pv-documents','hermes-chat-attachments')),
  storage_path      text not null check (
                      length(storage_path) between 1 and 400
                      and storage_path !~* '^https?://'),
  mime_type         text not null
                      check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256            text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  original_filename text check (original_filename is null or length(original_filename) <= 260),

  status            text not null default 'UPLOADED'
                      check (status in ('UPLOADED','LINKED','REJECTED','SUPERSEDED')),

  uploaded_by       uuid references auth.users(id) on delete set null,
  uploaded_at       timestamptz not null default now(),

  -- Suppression LOGIQUE uniquement.
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users(id) on delete set null,
  constraint pv_documents_suppression_coherente check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  ),

  notes             text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un même objet ne peut pas être référencé deux fois pour un tenant.
  constraint pv_documents_objet_unique unique (tenant_id, storage_bucket, storage_path),
  -- Clé candidate composite, pour que PV-3 puisse s'y adosser sans re-migrer.
  constraint pv_documents_tenant_id_key unique (tenant_id, id)
);

comment on table hermes_os.pv_documents is
  'PV-2 — référence documentaire photovoltaïque. (bucket privé, chemin), jamais une URL publique. RLS deny-all.';
comment on column hermes_os.pv_documents.storage_path is
  'Chemin dans le bucket privé : <tenant_id>/<site_id>/<document_id>/<fichier>. Une URL http(s) est refusée par CHECK.';
comment on column hermes_os.pv_documents.deleted_at is
  'Suppression LOGIQUE. La ligne n''est jamais retirée : un document effacé de l''UI reste traçable.';

-- ---------------------------------------------------------------------------
-- Index — TOUS préfixés par tenant_id : aucun plan ne peut balayer un autre tenant.
-- ---------------------------------------------------------------------------
create index if not exists idx_pv_documents_tenant_site
  on hermes_os.pv_documents (tenant_id, site_id, uploaded_at desc);
create index if not exists idx_pv_documents_tenant_bill
  on hermes_os.pv_documents (tenant_id, bill_id) where bill_id is not null;
create index if not exists idx_pv_documents_tenant_actifs
  on hermes_os.pv_documents (tenant_id, doc_type, uploaded_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RLS deny-all + révocation. Identique à PV-1 : l'accès applicatif passe
-- EXCLUSIVEMENT par les façades `public.*` du lot PV-2/2 et PV-2/3.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents enable row level security;
revoke all on table hermes_os.pv_documents from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Déclencheurs — RÉUTILISATION intégrale des fonctions PV-1. Aucune nouvelle
-- mécanique : `set_updated_at`, `pv_tenant_immutable`, `_pv_audit`.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pv_documents_updated_at on hermes_os.pv_documents;
create trigger trg_pv_documents_updated_at
  before update on hermes_os.pv_documents
  for each row execute function hermes_os.set_updated_at();

drop trigger if exists trg_pv_documents_tenant_immutable on hermes_os.pv_documents;
create trigger trg_pv_documents_tenant_immutable
  before update on hermes_os.pv_documents
  for each row execute function hermes_os.pv_tenant_immutable();

-- Audit : `_pv_audit` est une fonction ORDINAIRE à 6 arguments (PV-1), pas une
-- fonction de déclencheur. On lui adosse donc un déclencheur dédié plutôt que de
-- la réécrire — la brique d'audit existante reste la seule.
create or replace function hermes_os.pv_document_audit()
returns trigger
language plpgsql
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_old jsonb := '{}'::jsonb;
  v_from text := 'CREATION';
begin
  -- `old` n'existe pas sur INSERT : on ne le lit que sous `tg_op = 'UPDATE'`.
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status
       and new.deleted_at is not distinct from old.deleted_at then
      return new;  -- rien de traçable n'a changé
    end if;
    v_old := jsonb_build_object('status', old.status, 'deleted_at', old.deleted_at);
    v_from := old.status;
  end if;

  perform hermes_os._pv_audit(
    new.tenant_id, 'pv_documents', new.id, v_old,
    jsonb_build_object('status', new.status, 'deleted_at', new.deleted_at),
    case when new.deleted_at is not null then 'document PV supprime (logique)'
         else format('document PV %s -> %s', v_from, new.status) end);
  return new;
end;
$function$;

drop trigger if exists trg_pv_documents_audit on hermes_os.pv_documents;
create trigger trg_pv_documents_audit
  after insert or update on hermes_os.pv_documents
  for each row execute function hermes_os.pv_document_audit();

commit;
