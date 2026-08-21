-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / 3b — Correctif du délai de grâce de purge.
-- (project smubxqorirlfldatzmym)
--
-- Fichier DÉCLARANT de la migration appliquée sous le nom
-- `pv3_3b_purge_grace_comparator` (version 20260820065133).
--
-- DÉFAUT CORRIGÉ. `list_pv_documents_to_purge` utilisait
-- `deleted_at < now() - délai`. Avec un délai de grâce NUL, un document retiré à
-- l'instant même n'était PAS listé : `<` est faux à l'égalité. Comportement
-- surprenant, constaté par l'assertion T9c de `db/tests/pv3_manual.test.sql`,
-- qui a échoué à sa première exécution.
--
-- `<=` signifie « au moins N de délai », et non « strictement plus ». Le délai
-- de grâce de 7 jours reste vérifié séparément (assertion T9d).

begin;

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
commit;
