-- PACK PHOTOVOLTAÏQUE — LOT PV-2 / 2 — Façades de LECTURE (`public.*`).
-- (project smubxqorirlfldatzmym)
--
-- Contrat IDENTIQUE à toutes les façades Hermès existantes (photo, chantiers,
-- préférences, pièces jointes) — aucune convention nouvelle :
--   * `SECURITY DEFINER`, `search_path` VERROUILLÉ ;
--   * `REVOKE ALL … FROM public` puis `GRANT EXECUTE … TO authenticated` ;
--     ⇒ aucun `GRANT` à `anon`, jamais ;
--   * tenant résolu SERVER-SIDE par `hermes_os.resolve_active_tenant(null)` :
--     AUCUNE façade n'accepte de `tenant_id`, sur aucun paramètre. Le navigateur
--     n'a donc aucun chemin pour en proposer un ;
--   * FAIL-CLOSED : non authentifié / sans tenant ⇒ enveloppe vide + code,
--     jamais une fuite ni une erreur qui révèle une structure ;
--   * résultats BORNÉS (`LIMIT` plafonné) ⇒ aucun payload non borné.
--
-- DÉCISION EXPLICITE — pas de table `pv_module_activation`.
-- La verticale photo possède `photo_studio_activation` parce qu'elle devait
-- rester DORMANTE. PV-2 a l'objectif inverse : rendre PV-1 réellement utilisable.
-- Le portillon d'AFFICHAGE est donc le moteur de verticales existant
-- (`lib/verticals/*` : le module `solar.studies` n'est accordé qu'à un tenant
-- solaire), et le portillon de DONNÉES est le tenant résolu server-side.
-- Ajouter un troisième registre d'activation aurait créé une deuxième vérité à
-- synchroniser — exactement ce que le moteur de verticales a supprimé.
-- Conséquence assumée et testée : un tenant photo qui appellerait ces façades en
-- direct n'obtient QUE son propre espace PV, vide. Aucune fuite inter-tenant.
--
-- NOTE — pourquoi une seule enveloppe `jsonb` : identique aux façades photo.
-- Un `returns table` obligerait à exposer un type SQL par lecture et à le
-- re-migrer à chaque colonne ajoutée ; l'enveloppe porte en plus le CODE
-- (`UNAUTHENTICATED`, `NO_TENANT`, `NOT_FOUND`) que le client doit distinguer.

begin;

-- ---------------------------------------------------------------------------
-- 0. Garde commune. UNE implémentation, appelée par TOUTES les façades PV.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.pv_guard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  -- `null` en argument : le tenant n'est JAMAIS proposé par l'appelant.
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' or v_tenant is null then
    return jsonb_build_object('ok', false, 'code', coalesce(v_status, 'NO_TENANT'));
  end if;
  return jsonb_build_object('ok', true, 'code', 'OK', 'tenant', v_tenant, 'uid', v_uid);
end;
$function$;

revoke all on function hermes_os.pv_guard() from public;

comment on function hermes_os.pv_guard() is
  'PV-2 — garde commune des façades PV : authentifié + tenant résolu server-side. Aucun tenant_id client.';

-- ---------------------------------------------------------------------------
-- 1. LECTURE — liste des prospects PV (recherche + filtres statut/type).
--    La recherche est appliquée EN BASE, sur le tenant déjà borné : elle ne peut
--    donc pas servir de sonde inter-tenant.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_prospects(
  p_search text default null,
  p_status text default null,
  p_type   text default null,
  p_limit  integer default 50
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
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total int;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb, 'total', 0);
  end if;
  v_t := v_g->>'tenant';

  select count(*) into v_total from hermes_os.pv_prospects p where p.tenant_id = v_t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'prospect_type', x.prospect_type,
           'first_name', x.first_name,
           'last_name', x.last_name,
           'company_name', x.company_name,
           'phone', x.phone,
           'email', x.email,
           'source', x.source,
           'status', x.status,
           'qualification_score', x.qualification_score,
           'contact_consent', x.contact_consent,
           'opted_out', x.opted_out,
           'site_count', x.site_count,
           'created_at', x.created_at,
           'updated_at', x.updated_at) order by x.updated_at desc), '[]'::jsonb)
    into v_rows
    from (
      select p.*,
             (select count(*) from hermes_os.pv_sites s
               where s.tenant_id = p.tenant_id and s.prospect_id = p.id) as site_count
        from hermes_os.pv_prospects p
       where p.tenant_id = v_t
         and (p_status is null or p.status = p_status)
         and (p_type is null or p.prospect_type = p_type)
         and (v_q is null or (
              coalesce(p.last_name, '')    ilike '%' || v_q || '%'
           or coalesce(p.first_name, '')   ilike '%' || v_q || '%'
           or coalesce(p.company_name, '') ilike '%' || v_q || '%'
           or coalesce(p.email, '')        ilike '%' || v_q || '%'
           or coalesce(p.phone, '')        ilike '%' || v_q || '%'))
       order by p.updated_at desc
       limit v_lim
    ) x;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows, 'total', v_total);
end;
$function$;

revoke all on function public.get_pv_prospects(text, text, text, integer) from public;
grant execute on function public.get_pv_prospects(text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. LECTURE — détail d'un prospect + ses sites + son historique de statut.
--    Un identifiant d'un AUTRE tenant renvoie `NOT_FOUND`, exactement comme un
--    identifiant inexistant : l'existence de la ressource n'est pas révélée.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_prospect(p_prospect_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_p hermes_os.pv_prospects; v_sites jsonb; v_hist jsonb; v_next jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'label', s.label, 'address_line1', s.address_line1,
           'postal_code', s.postal_code, 'city', s.city,
           'building_type', s.building_type, 'roof_type', s.roof_type,
           'roof_area_usable_m2', s.roof_area_usable_m2,
           'azimuth_deg', s.azimuth_deg, 'tilt_deg', s.tilt_deg,
           'shading_level', s.shading_level,
           'created_at', s.created_at) order by s.created_at), '[]'::jsonb)
    into v_sites
    from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id;

  -- Historique : brique d'audit EXISTANTE, jamais un second journal.
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', a.timestamp, 'summary', a.change_summary,
           'old', a.old_values, 'new', a.new_values,
           'by', a.changed_by) order by a.timestamp desc), '[]'::jsonb)
    into v_hist
    from (select * from hermes_os.entity_audit_log l
           where l.tenant_id = v_t and l.entity_type = 'pv_prospects' and l.entity_id = v_p.id
           order by l.timestamp desc limit 50) a;

  -- Transitions RÉELLEMENT possibles depuis l'état courant : l'UI n'a pas à
  -- redéclarer la machine à états, elle la lit.
  select coalesce(jsonb_agg(t.to_status order by t.to_status), '[]'::jsonb)
    into v_next
    from hermes_os.pv_prospect_transitions t where t.from_status = v_p.status;

  return jsonb_build_object(
    'ok', true, 'code', 'OK',
    'prospect', jsonb_build_object(
      'id', v_p.id, 'prospect_type', v_p.prospect_type,
      'first_name', v_p.first_name, 'last_name', v_p.last_name,
      'company_name', v_p.company_name, 'phone', v_p.phone, 'email', v_p.email,
      'source', v_p.source, 'source_detail', v_p.source_detail,
      'campaign_ref', v_p.campaign_ref,
      'contact_consent', v_p.contact_consent, 'contact_consent_at', v_p.contact_consent_at,
      'opted_out', v_p.opted_out, 'opted_out_at', v_p.opted_out_at,
      'status', v_p.status, 'qualification_score', v_p.qualification_score,
      'owner_user_id', v_p.owner_user_id, 'crm_external_id', v_p.crm_external_id,
      'notes', v_p.notes,
      'created_at', v_p.created_at, 'updated_at', v_p.updated_at),
    'sites', v_sites, 'history', v_hist, 'next_statuses', v_next);
end;
$function$;

revoke all on function public.get_pv_prospect(uuid) from public;
grant execute on function public.get_pv_prospect(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. LECTURE — sites (tous, ou ceux d'un prospect).
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_sites(
  p_prospect_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 100), 1), 200); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'prospect_id', s.prospect_id, 'label', s.label,
           'address_line1', s.address_line1, 'postal_code', s.postal_code, 'city', s.city,
           'building_type', s.building_type, 'building_use', s.building_use,
           'roof_type', s.roof_type, 'roof_material', s.roof_material,
           'roof_condition', s.roof_condition,
           'roof_area_total_m2', s.roof_area_total_m2,
           'roof_area_usable_m2', s.roof_area_usable_m2,
           'azimuth_deg', s.azimuth_deg, 'tilt_deg', s.tilt_deg,
           'shading_level', s.shading_level, 'shading_loss_pct', s.shading_loss_pct,
           'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_sites s
           where s.tenant_id = v_t
             and (p_prospect_id is null or s.prospect_id = p_prospect_id)
           order by s.created_at desc limit v_lim) s;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_sites(uuid, integer) from public;
grant execute on function public.get_pv_sites(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. LECTURE — détail d'un site (toutes les caractéristiques techniques).
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_site(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_s hermes_os.pv_sites;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_s from hermes_os.pv_sites s
   where s.id = p_site_id and s.tenant_id = v_t;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'code', 'OK', 'site', to_jsonb(v_s) - 'tenant_id');
end;
$function$;

revoke all on function public.get_pv_site(uuid) from public;
grant execute on function public.get_pv_site(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. LECTURE — profils de consommation d'un site.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_consumption_profiles(
  p_site_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(to_jsonb(c) - 'tenant_id' order by c.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_consumption_profiles c
           where c.tenant_id = v_t and c.site_id = p_site_id
           order by c.created_at desc limit v_lim) c;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_consumption_profiles(uuid, integer) from public;
grant execute on function public.get_pv_consumption_profiles(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. LECTURE — factures énergie d'un site. On expose les VALEURS RETENUES et le
--    nombre d'extractions IA rattachées — jamais les deux mélangées.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_energy_bills(
  p_site_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'site_id', b.site_id,
           'supplier', b.supplier, 'period_start', b.period_start, 'period_end', b.period_end,
           'issued_on', b.issued_on,
           'amount_ht_eur', b.amount_ht_eur, 'amount_ttc_eur', b.amount_ttc_eur,
           'consumption_kwh', b.consumption_kwh,
           'subscribed_power_kva', b.subscribed_power_kva,
           'tariff_option', b.tariff_option, 'delivery_point_ref', b.delivery_point_ref,
           'status', b.status, 'verified_by', b.verified_by, 'verified_at', b.verified_at,
           'rejection_reason', b.rejection_reason,
           'document_bucket', b.document_bucket, 'document_path', b.document_path,
           'document_mime', b.document_mime, 'document_bytes', b.document_bytes,
           'original_filename', b.original_filename,
           'extraction_count', b.extraction_count,
           'created_at', b.created_at) order by b.created_at desc), '[]'::jsonb)
    into v_rows
    from (select b.*,
                 (select count(*) from hermes_os.pv_energy_bill_extractions e
                   where e.tenant_id = b.tenant_id and e.bill_id = b.id) as extraction_count
            from hermes_os.pv_energy_bills b
           where b.tenant_id = v_t and b.site_id = p_site_id
           order by b.created_at desc limit v_lim) b;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_energy_bills(uuid, integer) from public;
grant execute on function public.get_pv_energy_bills(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. LECTURE — extractions IA d'une facture. Façade SÉPARÉE, volontairement :
--    « ce que l'IA a lu » et « ce qui est retenu » ne partagent pas un objet.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_bill_extractions(
  p_bill_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(to_jsonb(e) - 'tenant_id' order by e.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_energy_bill_extractions e
           where e.tenant_id = v_t and e.bill_id = p_bill_id
           order by e.created_at desc limit v_lim) e;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_bill_extractions(uuid, integer) from public;
grant execute on function public.get_pv_bill_extractions(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. LECTURE — études d'un site, avec leur statut de validation humaine.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_studies(
  p_site_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(to_jsonb(s) - 'tenant_id' order by s.version desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_studies s
           where s.tenant_id = v_t and s.site_id = p_site_id
           order by s.version desc limit v_lim) s;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_studies(uuid, integer) from public;
grant execute on function public.get_pv_studies(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. LECTURE — hypothèses d'une étude (colonnes TYPÉES de PV-1).
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_study_assumptions(p_study_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_a hermes_os.pv_study_assumptions;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant';

  select * into v_a from hermes_os.pv_study_assumptions a
   where a.study_id = p_study_id and a.tenant_id = v_t;
  if v_a.study_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true, 'code', 'OK',
    'assumptions', to_jsonb(v_a) - 'tenant_id');
end;
$function$;

revoke all on function public.get_pv_study_assumptions(uuid) from public;
grant execute on function public.get_pv_study_assumptions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. LECTURE — chiffrages économiques d'une étude.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_economics(
  p_study_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 100); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(to_jsonb(e) - 'tenant_id' order by e.created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_economics e
           where e.tenant_id = v_t and e.study_id = p_study_id
           order by e.created_at desc limit v_lim) e;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_economics(uuid, integer) from public;
grant execute on function public.get_pv_economics(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. LECTURE — documents PV d'un site (suppressions logiques exclues).
--     Renvoie (bucket, chemin) — JAMAIS d'URL. La signature d'URL est un geste
--     serveur à TTL court, côté application, jamais une valeur persistée.
-- ---------------------------------------------------------------------------
create or replace function public.get_pv_documents(
  p_site_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_rows jsonb;
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code', 'items', '[]'::jsonb);
  end if;
  v_t := v_g->>'tenant';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'site_id', d.site_id, 'bill_id', d.bill_id,
           'doc_type', d.doc_type, 'storage_bucket', d.storage_bucket,
           'storage_path', d.storage_path, 'mime_type', d.mime_type,
           'size_bytes', d.size_bytes, 'sha256', d.sha256,
           'original_filename', d.original_filename, 'status', d.status,
           'uploaded_by', d.uploaded_by, 'uploaded_at', d.uploaded_at)
           order by d.uploaded_at desc), '[]'::jsonb)
    into v_rows
    from (select * from hermes_os.pv_documents d
           where d.tenant_id = v_t and d.site_id = p_site_id and d.deleted_at is null
           order by d.uploaded_at desc limit v_lim) d;

  return jsonb_build_object('ok', true, 'code', 'OK', 'items', v_rows);
end;
$function$;

revoke all on function public.get_pv_documents(uuid, integer) from public;
grant execute on function public.get_pv_documents(uuid, integer) to authenticated;

commit;
