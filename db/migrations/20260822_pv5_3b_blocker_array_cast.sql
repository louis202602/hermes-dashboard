-- PACK PHOTOVOLTAÏQUE — LOT PV-5 / 3b — Correctif : `text[] || 'chaîne'` est ambigu.
-- (project smubxqorirlfldatzmym)
--
-- ERREUR RÉELLE, trouvée par la suite d'assertions et corrigée avant livraison :
--
--   ERROR: 22P02: malformed array literal: "STUDY_NOT_VALIDATED"
--   DETAIL: Array value must start with "{" or dimension information.
--   QUERY: v_missing := v_missing || 'STUDY_NOT_VALIDATED'
--
-- En PL/pgSQL, `text[] || <littéral non typé>` ne choisit PAS l'opérateur
-- « ajouter un élément » : PostgreSQL essaie d'interpréter la chaîne comme un
-- ARRAY et échoue. Les deux fonctions qui construisent une liste de raisons
-- étaient donc cassées dès le premier blocage rencontré — c'est-à-dire
-- exactement dans le cas qu'elles servent à décrire.
--
-- `array_append()` est explicite et ne peut pas être mal résolu. On le préfère à
-- un `|| 'x'::text` : le lecteur suivant n'aura pas à se rappeler pourquoi le
-- cast est là.
--
-- Ce fichier existe SÉPARÉMENT de `20260822_pv5_3_facades.sql` : ce dernier
-- enregistre ce qui a réellement été appliqué sous le nom `pv5_3_facades`, et le
-- réécrire créerait une dérive dépôt/base. Gouvernance de migrations, PR #66.

begin;

create or replace function hermes_os.pv_quote_blockers(p_quote_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_q hermes_os.pv_quotes; v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_out text[] := '{}'; v_lines int;
begin
  select * into v_q from hermes_os.pv_quotes where id = p_quote_id;
  if v_q.id is null then return array['QUOTE_NOT_FOUND']; end if;

  select * into v_study from hermes_os.pv_studies where id = v_q.study_id;
  select * into v_econ  from hermes_os.pv_economics where id = v_q.economics_id;
  select * into v_p     from hermes_os.pv_prospects where id = v_q.prospect_id;
  select * into v_site  from hermes_os.pv_sites where id = v_q.site_id;
  select count(*) into v_lines from hermes_os.pv_quote_lines where quote_id = p_quote_id;

  if v_study.id is null or v_study.status is distinct from 'VALIDATED' then
    v_out := array_append(v_out, 'STUDY_NOT_VALIDATED');
  end if;
  if v_econ.id is null or v_econ.status is distinct from 'VERIFIED' then
    v_out := array_append(v_out, 'ECONOMICS_NOT_VERIFIED');
  end if;
  if v_lines = 0 then
    v_out := array_append(v_out, 'NO_LINE');
  end if;
  if v_q.total_ttc_eur is null or v_q.total_ttc_eur <= 0 then
    v_out := array_append(v_out, 'TOTAL_NOT_POSITIVE');
  end if;
  -- Identité client MINIMALE : un devis adressé à personne n'est pas un devis.
  if v_p.id is null
     or (coalesce(btrim(v_p.company_name), '') = ''
         and coalesce(btrim(v_p.last_name), '') = '') then
    v_out := array_append(v_out, 'CLIENT_IDENTITY_MISSING');
  end if;
  if v_site.id is null or coalesce(btrim(v_site.address_line1), '') = '' then
    v_out := array_append(v_out, 'SITE_MISSING');
  end if;
  if v_q.valid_until is null then
    v_out := array_append(v_out, 'VALIDITY_DATE_MISSING');
  end if;
  if v_p.opted_out then
    v_out := array_append(v_out, 'PROSPECT_OPTED_OUT');
  end if;

  return v_out;
end;
$function$;

revoke all on function hermes_os.pv_quote_blockers(uuid) from public;

create or replace function public.create_pv_quote(p_prospect_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_g jsonb := hermes_os.pv_guard();
  v_t text; v_uid uuid; v_p hermes_os.pv_prospects; v_site hermes_os.pv_sites;
  v_study hermes_os.pv_studies; v_econ hermes_os.pv_economics;
  v_id uuid; v_num text; v_missing text[] := '{}';
begin
  if not (v_g->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_g->>'code');
  end if;
  v_t := v_g->>'tenant'; v_uid := (v_g->>'uid')::uuid;

  select * into v_p from hermes_os.pv_prospects p
   where p.id = p_prospect_id and p.tenant_id = v_t;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_p.opted_out then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(array['PROSPECT_OPTED_OUT']));
  end if;

  -- Site principal : le plus ancien du prospect. Même règle déterministe que la
  -- vue Affaire de PV-4 — deux règles différentes finiraient par diverger.
  select * into v_site from hermes_os.pv_sites s
   where s.tenant_id = v_t and s.prospect_id = v_p.id
   order by s.created_at, s.id limit 1;
  if v_site.id is null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(array['NO_SITE']));
  end if;

  -- Étude RETENUE et chiffrage RETENU : exactement la règle de PV-4.
  select * into v_study from hermes_os.pv_studies s
   where s.tenant_id = v_t and s.site_id = v_site.id and s.status = 'VALIDATED'
   order by s.version desc limit 1;
  if v_study.id is null then
    v_missing := array_append(v_missing, 'STUDY_NOT_VALIDATED');
  else
    select * into v_econ from hermes_os.pv_economics e
     where e.tenant_id = v_t and e.study_id = v_study.id and e.status = 'VERIFIED'
     order by e.created_at desc limit 1;
    if v_econ.id is null then
      v_missing := array_append(v_missing, 'ECONOMICS_NOT_VERIFIED');
    end if;
  end if;

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_NOT_READY',
      'missing_requirements', to_jsonb(v_missing));
  end if;

  v_num := hermes_os.next_pv_quote_number(v_t, extract(year from now())::integer);

  insert into hermes_os.pv_quotes
    (tenant_id, prospect_id, site_id, study_id, economics_id, quote_number, version,
     status, valid_until, created_by, updated_by)
  values
    (v_t, v_p.id, v_site.id, v_study.id, v_econ.id, v_num, 1,
     'DRAFT', (now() + interval '30 days')::date, v_uid, v_uid)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'code', 'CREATED',
    'quote_id', v_id, 'quote_number', v_num, 'version', 1);
end;
$function$;

revoke all on function public.create_pv_quote(uuid) from public;
grant execute on function public.create_pv_quote(uuid) to authenticated;

commit;
