-- PACK PHOTOVOLTAÏQUE — LOT PV-3 / 4 — Instantané de pilotage des widgets PV.
-- (project smubxqorirlfldatzmym)
--
-- Fichier DÉCLARANT de la migration appliquée sous le nom `pv3_4_pilot_snapshot`
-- (version 20260820064138). Extrait de `20260820_pv3_3_documents_purge.sql`, où
-- il n'aurait pas dû se trouver : le garde-fou de dérive introduit par la PR #66
-- exige qu'un nom de migration appliqué corresponde EXACTEMENT au nom d'un
-- fichier. Deux préoccupations, deux migrations, deux fichiers.

begin;

-- ---------------------------------------------------------------------------
-- 4. INSTANTANÉ DE PILOTAGE — un seul appel pour les TROIS widgets PV.
--
--    COST-FIRST, comme la verticale photo : trois widgets ne font jamais trois
--    lectures. Cette façade rend les trois compteurs ET un extrait borné de
--    chaque liste, en une passe.
--
--    Les trois questions posées sont volontairement celles d'un opérateur :
--      * quelles études attendent un geste humain (CALCULATED / NEEDS_REVIEW) ;
--      * quelles factures attendent une vérification (EXTRACTED / NEEDS_REVIEW) ;
--      * quels prospects vivants n'ont encore aucun site — donc aucune étude
--        possible. Les prospects perdus, archivés ou non qualifiés sont exclus :
--        les compter serait un chiffre juste mais inutile.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_pilot_snapshot(p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text;
  v_lim int := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_studies int; v_bills int; v_prospects int;
  v_studies_list jsonb; v_bills_list jsonb; v_prospects_list jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code',
      'studies_to_validate', 0, 'bills_to_verify', 0, 'prospects_without_site', 0,
      'studies', '[]'::jsonb, 'bills', '[]'::jsonb, 'prospects', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select count(*) into v_studies from hermes_os.pv_studies s
   where s.tenant_id = v_t and s.status in ('CALCULATED', 'NEEDS_REVIEW');
  select count(*) into v_bills from hermes_os.pv_energy_bills b
   where b.tenant_id = v_t and b.status in ('EXTRACTED', 'NEEDS_REVIEW');
  select count(*) into v_prospects from hermes_os.pv_prospects p
   where p.tenant_id = v_t
     and p.status not in ('LOST', 'ARCHIVED', 'UNQUALIFIED')
     and not exists (select 1 from hermes_os.pv_sites s
                      where s.tenant_id = p.tenant_id and s.prospect_id = p.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'site_id', x.site_id, 'version', x.version,
           'status', x.status, 'prepared_by', x.prepared_by,
           'target_power_kwc', x.target_power_kwc) order by x.updated_at desc), '[]'::jsonb)
    into v_studies_list
    from (select * from hermes_os.pv_studies s
           where s.tenant_id = v_t and s.status in ('CALCULATED','NEEDS_REVIEW')
           order by s.updated_at desc limit v_lim) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'site_id', x.site_id, 'supplier', x.supplier,
           'status', x.status, 'consumption_kwh', x.consumption_kwh) order by x.created_at desc), '[]'::jsonb)
    into v_bills_list
    from (select * from hermes_os.pv_energy_bills b
           where b.tenant_id = v_t and b.status in ('EXTRACTED','NEEDS_REVIEW')
           order by b.created_at desc limit v_lim) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'first_name', x.first_name, 'last_name', x.last_name,
           'company_name', x.company_name, 'status', x.status) order by x.updated_at desc), '[]'::jsonb)
    into v_prospects_list
    from (select * from hermes_os.pv_prospects p
           where p.tenant_id = v_t
             and p.status not in ('LOST','ARCHIVED','UNQUALIFIED')
             and not exists (select 1 from hermes_os.pv_sites s
                              where s.tenant_id = p.tenant_id and s.prospect_id = p.id)
           order by p.updated_at desc limit v_lim) x;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'studies_to_validate', v_studies,
    'bills_to_verify', v_bills,
    'prospects_without_site', v_prospects,
    'studies', v_studies_list,
    'bills', v_bills_list,
    'prospects', v_prospects_list);
end;
$function$;

revoke all on function public.get_pv_pilot_snapshot(integer) from public;
grant execute on function public.get_pv_pilot_snapshot(integer) to authenticated;

commit;
