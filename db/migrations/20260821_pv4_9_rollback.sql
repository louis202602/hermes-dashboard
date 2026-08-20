-- PACK PHOTOVOLTAÏQUE — LOT PV-4 / ROLLBACK COMPLET.
-- (project smubxqorirlfldatzmym)
--
-- Retire exactement ce que les trois migrations PV-4 ont ajouté et REMET les
-- deux façades de purge dans leur état PV-3 — sans quoi le rollback laisserait
-- des fonctions cassées appelant `pv_guard_admin()` disparue.
--
-- ⚠️ CONSÉQUENCE À CONNAÎTRE AVANT D'EXÉCUTER : la purge redevient accessible à
-- TOUT membre du tenant, et le contrôle de délai de grâce côté façade disparaît
-- (la liste le portait déjà en PV-3, mais un appel direct le contournait). Ce
-- rollback DIMINUE donc une protection. Ce n'est pas une raison de ne pas
-- l'écrire — c'en est une de le dire.
--
-- ⚠️ PERTE DE RATTACHEMENT : `study_id`, `economics_id`, `document_stage` et
-- `generation_request_id` disparaissent. Une synthèse PDF déjà générée devient
-- indiscernable d'un document déposé, et l'idempotence de génération est perdue.
-- Contrôle préalable :
--   select count(*) from hermes_os.pv_documents where document_stage <> 'SOURCE';

begin;

-- ---------------------------------------------------------------------------
-- 1. Façades introduites par PV-4.
-- ---------------------------------------------------------------------------
drop function if exists public.get_pv_deal(uuid);
drop function if exists public.register_pv_study_summary(text, uuid, uuid, text, text, bigint, text);
drop function if exists public.get_pv_purge_journal(integer);

-- ---------------------------------------------------------------------------
-- 2. Purge — RETOUR à la version PV-3 (membre, sans garde d'administration).
--    On restaure AVANT de retirer `pv_guard_admin()` : l'ordre inverse laisserait
--    un instant où les façades référencent une fonction absente.
-- ---------------------------------------------------------------------------
create or replace function public.list_pv_documents_to_purge(
  p_older_than interval default '7 days',
  p_limit      integer  default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_lim int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_age interval := greatest(coalesce(p_older_than, interval '7 days'), interval '0');
  v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'document_id', d.id, 'bucket', d.storage_bucket, 'path', d.storage_path,
           'deleted_at', d.deleted_at) order by d.deleted_at), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_documents d
           where d.tenant_id = v_t
             and d.deleted_at is not null
             and d.purged_at is null
             and d.storage_path is not null
             and d.deleted_at <= now() - v_age
           order by d.deleted_at limit v_lim) d;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.list_pv_documents_to_purge(interval, integer) from public;
grant execute on function public.list_pv_documents_to_purge(interval, integer) to authenticated;

create or replace function public.mark_pv_document_purged(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_d hermes_os.pv_documents;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_d from hermes_os.pv_documents d
   where d.id = p_document_id and d.tenant_id = v_t;
  if v_d.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_d.purged_at is not null then
    return jsonb_build_object('ok', true, 'code', 'ALREADY_PURGED', 'document_id', v_d.id);
  end if;
  if v_d.deleted_at is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_DELETED');
  end if;

  update hermes_os.pv_documents
     set purged_at    = now(),
         purged_path  = storage_path,
         storage_path = null,
         updated_at   = now()
   where id = p_document_id and tenant_id = v_t;

  perform hermes_os._pv_audit(
    v_t, 'pv_documents', v_d.id,
    jsonb_build_object('storage_path', v_d.storage_path),
    jsonb_build_object('purged_at', now()),
    'octets du document PV purges via l''API Storage');

  return jsonb_build_object('ok', true, 'code', 'PURGED', 'document_id', v_d.id);
end;
$function$;

revoke all on function public.mark_pv_document_purged(uuid) from public;
grant execute on function public.mark_pv_document_purged(uuid) to authenticated;

drop function if exists public.mark_pv_document_purged(uuid, interval);
drop function if exists hermes_os.pv_guard_admin();

-- ---------------------------------------------------------------------------
-- 3. Rattachement documentaire. Contraintes AVANT colonnes, index compris.
--    `pv_economics_tenant_id_key` est conservée : additive, sans effet de bord,
--    et PV-5 s'y adossera. La retirer casserait la FK si elle survivait.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents drop constraint if exists pv_documents_synthese_rattachee;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_stage_valide;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_economics_fk;
alter table hermes_os.pv_documents drop constraint if exists pv_documents_study_fk;

drop index if exists hermes_os.idx_pv_documents_generation_request;
drop index if exists hermes_os.idx_pv_documents_tenant_stage;
drop index if exists hermes_os.idx_pv_documents_tenant_study;

alter table hermes_os.pv_documents drop column if exists document_stage;
alter table hermes_os.pv_documents drop column if exists generation_request_id;
alter table hermes_os.pv_documents drop column if exists economics_id;
alter table hermes_os.pv_documents drop column if exists study_id;

commit;
