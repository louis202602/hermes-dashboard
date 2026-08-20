-- PACK PHOTOVOLTAÏQUE — LOT PV-4 / 2 — Rattachement des documents GÉNÉRÉS.
-- (project smubxqorirlfldatzmym, schéma hermes_os)
--
-- Jusqu'ici, un document PV était toujours DÉPOSÉ par un humain : une facture,
-- une photo, un plan. PV-4 introduit un document PRODUIT par Hermès — la
-- synthèse d'étude en PDF. Trois choses le distinguent, et le schéma doit les
-- porter, sinon on ne saura plus de quoi un fichier parle :
--
--   * de QUELLE étude et de QUEL chiffrage il rend compte (`study_id`, `economics_id`) ;
--   * s'il est un BROUILLON interne ou un document FINAL (`document_stage`) ;
--   * sous quelle demande il a été produit (`generation_request_id`), pour qu'une
--     génération rejouée ne fabrique pas un second fichier.
--
-- ÉVOLUTION MINIMALE, et tenant-safe : les deux rattachements sont des FK
-- COMPOSITES `(tenant_id, …)`. Une FK sur `study_id` seul aurait laissé un PDF
-- pointer l'étude d'un AUTRE tenant — la même faille que PV-1 avait fermée sur
-- les sites, et qu'il serait absurde de rouvrir ici.

begin;

alter table hermes_os.pv_documents
  add column if not exists study_id              uuid,
  add column if not exists economics_id          uuid,
  add column if not exists generation_request_id text,
  add column if not exists document_stage        text not null default 'SOURCE';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pv_documents_study_fk'
                    and conrelid = 'hermes_os.pv_documents'::regclass) then
    alter table hermes_os.pv_documents
      add constraint pv_documents_study_fk foreign key (tenant_id, study_id)
        references hermes_os.pv_studies (tenant_id, id) on update cascade on delete set null;
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'pv_documents_economics_fk'
                    and conrelid = 'hermes_os.pv_documents'::regclass) then
    -- `pv_economics` n'avait pas de clé candidate composite : PV-1 ne l'avait pas
    -- prévue parce que rien ne la référençait. On la pose ici, additive et sans
    -- effet sur les lignes existantes.
    if not exists (select 1 from pg_constraint
                    where conname = 'pv_economics_tenant_id_key'
                      and conrelid = 'hermes_os.pv_economics'::regclass) then
      alter table hermes_os.pv_economics
        add constraint pv_economics_tenant_id_key unique (tenant_id, id);
    end if;
    alter table hermes_os.pv_documents
      add constraint pv_documents_economics_fk foreign key (tenant_id, economics_id)
        references hermes_os.pv_economics (tenant_id, id) on update cascade on delete set null;
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'pv_documents_stage_valide'
                    and conrelid = 'hermes_os.pv_documents'::regclass) then
    alter table hermes_os.pv_documents
      add constraint pv_documents_stage_valide check (
        document_stage in ('SOURCE', 'STUDY_SUMMARY_DRAFT', 'STUDY_SUMMARY_FINAL'));
  end if;

  -- Un document GÉNÉRÉ rend compte d'une étude : sans elle, il ne dit rien.
  -- Un document DÉPOSÉ, lui, n'en a pas — d'où la contrainte conditionnelle.
  if not exists (select 1 from pg_constraint
                  where conname = 'pv_documents_synthese_rattachee'
                    and conrelid = 'hermes_os.pv_documents'::regclass) then
    alter table hermes_os.pv_documents
      add constraint pv_documents_synthese_rattachee check (
        document_stage = 'SOURCE' or study_id is not null);
  end if;
end;
$$;

-- IDEMPOTENCE DE GÉNÉRATION. Deux clics, un double envoi, une reprise réseau :
-- la même demande ne doit pas produire deux fichiers. L'unicité est PARTIELLE —
-- les documents déposés n'ont pas de `generation_request_id` et ne doivent pas
-- se gêner entre eux.
create unique index if not exists idx_pv_documents_generation_request
  on hermes_os.pv_documents (tenant_id, generation_request_id)
  where generation_request_id is not null;

create index if not exists idx_pv_documents_tenant_stage
  on hermes_os.pv_documents (tenant_id, document_stage, uploaded_at desc)
  where deleted_at is null;

create index if not exists idx_pv_documents_tenant_study
  on hermes_os.pv_documents (tenant_id, study_id)
  where study_id is not null;

comment on column hermes_os.pv_documents.document_stage is
  'PV-4 — SOURCE (déposé par un humain) | STUDY_SUMMARY_DRAFT (brouillon interne) | STUDY_SUMMARY_FINAL (synthèse validée).';
comment on column hermes_os.pv_documents.generation_request_id is
  'PV-4 — clé d''idempotence de génération. Unique par tenant. NULL pour un document déposé.';

commit;
