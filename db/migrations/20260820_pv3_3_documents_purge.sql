-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / 3 — Purge des documents supprimés logiquement.
-- (project smubxqorirlfldatzmym)
--
-- PV-2 savait marquer un document supprimé (`deleted_at`) mais pas retirer les
-- OCTETS. Tant que le bucket était vide le sujet restait théorique ; PV-3 ouvre
-- le téléversement réel, il devient concret.
--
-- ⚠️ POURQUOI AUCUN `DELETE FROM storage.objects` ICI — mesuré, pas supposé :
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--                Use the Storage API instead.   (trigger `storage.protect_delete()`)
-- La suppression physique passe donc OBLIGATOIREMENT par l'API Storage, côté
-- serveur applicatif (`services/hermes/pv.ts`). Ces deux façades n'effacent rien :
-- l'une DIT quoi effacer, l'autre ENREGISTRE que ç'a été fait.
--
-- ORDRE OBLIGATOIRE, et il n'est pas interchangeable :
--   1. `list_pv_documents_to_purge()`  — lister
--   2. suppression via l'API Storage   — effacer les octets
--   3. `mark_pv_document_purged()`     — enregistrer
-- Marquer AVANT d'effacer rendrait l'objet définitivement orphelin : plus aucune
-- ligne ne porterait son chemin, donc plus personne ne saurait qu'il existe.
--
-- IDEMPOTENCE : rejouer la séquence est sans effet. `list` ne renvoie que les
-- documents encore porteurs d'un chemin ; `mark` efface le chemin et pose
-- `purged_at`. Un second passage ne voit donc plus rien, et un second `mark`
-- répond `ALREADY_PURGED` — jamais une erreur.

begin;

-- ---------------------------------------------------------------------------
-- 1. Traçabilité de la purge. Deux colonnes, pas une table de plus.
--    `storage_path` devient nullable : après purge, il n'y a plus de chemin —
--    prétendre le contraire serait un mensonge de schéma. `purged_path` garde
--    l'ancien chemin pour l'audit, sans qu'il soit encore résolvable.
-- ---------------------------------------------------------------------------
alter table hermes_os.pv_documents
  add column if not exists purged_at   timestamptz,
  add column if not exists purged_path text;

alter table hermes_os.pv_documents alter column storage_path drop not null;

do $$
begin
  -- Un document PURGÉ n'a plus de chemin ; un document VIVANT en a un.
  -- Contrainte posée seulement si elle n'existe pas (migration rejouable).
  if not exists (
    select 1 from pg_constraint
     where conname = 'pv_documents_purge_coherente'
       and conrelid = 'hermes_os.pv_documents'::regclass
  ) then
    alter table hermes_os.pv_documents add constraint pv_documents_purge_coherente check (
      (purged_at is null and storage_path is not null)
      or (purged_at is not null and storage_path is null and deleted_at is not null)
    );
  end if;
end;
$$;

comment on column hermes_os.pv_documents.purged_at is
  'PV-3 — horodatage de la suppression PHYSIQUE des octets (API Storage). NULL = objet encore présent.';
comment on column hermes_os.pv_documents.purged_path is
  'PV-3 — chemin AVANT purge, conservé pour l''audit. N''est plus résolvable.';

create index if not exists idx_pv_documents_tenant_a_purger
  on hermes_os.pv_documents (tenant_id, deleted_at)
  where deleted_at is not null and purged_at is null;

-- ---------------------------------------------------------------------------
-- 2. LISTER ce qui est purgeable. Borné, tenant-scopé, et volontairement
--    conservateur : seuls les documents SUPPRIMÉS LOGIQUEMENT, pas encore
--    purgés, et encore porteurs d'un chemin.
--
--    `p_older_than` : délai de grâce. Purger dans la seconde qui suit une
--    suppression accidentelle ne laisserait aucune fenêtre de rattrapage.
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
             -- ⚠️ `<` : comparateur tel qu'APPLIQUÉ sous ce nom de migration.
             -- Corrigé en `<=` par `20260820_pv3_3b_purge_grace_comparator.sql`
             -- — le fichier enregistre ce qui a été appliqué, pas ce qu'on
             -- aurait voulu appliquer.
             and d.deleted_at < now() - v_age
           order by d.deleted_at limit v_lim) d;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.list_pv_documents_to_purge(interval, integer) from public;
grant execute on function public.list_pv_documents_to_purge(interval, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ENREGISTRER qu'un document a été purgé.
--
--    Trois refus, et chacun ferme un chemin précis :
--      * document d'un AUTRE tenant           -> NOT_FOUND (existence non révélée)
--      * document NON supprimé logiquement    -> NOT_DELETED (on ne purge pas un
--        document vivant, même par erreur d'appel)
--      * déjà purgé                            -> ALREADY_PURGED (idempotence)
-- ---------------------------------------------------------------------------
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
         -- `status` n'est PAS touché : une purge d'octets ne dit rien de la
         -- nature du document. Le confondre avec `REJECTED` réécrirait l'histoire.
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

commit;
