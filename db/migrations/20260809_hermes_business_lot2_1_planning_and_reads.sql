-- Migration: hermes_business_lot2_planning_and_reads (project smubxqorirlfldatzmym)
-- =====================================================================
-- Hermès Business Capabilities — lot 2
-- (a) btp.planning.phase.add : WRITE capability wired to the REAL Agent
--     BTP-Planning (reuses its validation + idempotence). Sensitive → SW15.
--     Multi-param (chantier_name + phase_name) → routed via the semantic model
--     (empty nl_keywords so the deterministic single-slot path never matches it).
-- (b) Read-only consultation added for planning and devis. Reversible.
-- =====================================================================

insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id,
   required_permission, required_payload_keys, enabled, is_sensitive,
   nl_enabled, nl_keywords, nl_primary_slot)
values
  ('btp.planning.phase.add',
   'Planifier une phase de chantier (BTP)',
   'Ajoute une phase de planning à un chantier existant via l''agent BTP-Planning (nom du chantier + nom de la phase). Action sensible : soumise à la politique SW15.',
   'N8N_WORKFLOW', '2MMvwJ8zb3jBftDi',
   'tenant.member', array['chantier_name','phase_name']::text[], true, true,
   true, '{}'::text[], null)
on conflict (action_key) do update
  set display_name = excluded.display_name, description = excluded.description,
      target_kind = excluded.target_kind, target_workflow_id = excluded.target_workflow_id,
      required_permission = excluded.required_permission, required_payload_keys = excluded.required_payload_keys,
      enabled = true, is_sensitive = true, nl_enabled = true, nl_keywords = '{}'::text[], nl_primary_slot = null,
      updated_at = now();

create or replace function hermes_os._hermes_informational(p_uid uuid, p_tenant text, p_message text)
returns text
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_low text := lower(coalesce(p_message,''));
  v_j jsonb; v_n int; v_list text; r record;
  v_total int; v_bystatus text; v_recent text; v_val text;
  v_a bigint; v_m bigint; v_s bigint; v_ca bigint; v_ct bigint; v_rate numeric;
begin
  -- 1) Pending approvals.
  if v_low ~ 'approb' then
    v_j := hermes_os.list_pending_agent_approvals();
    if coalesce((v_j->>'ok')::boolean,false) then
      v_n := jsonb_array_length(coalesce(v_j->'approvals','[]'::jsonb));
      if v_n = 0 then return 'Aucune approbation en attente pour votre tenant.'; end if;
      select string_agg(coalesce(a->>'summary', a->>'action_key'), ' ; ')
        into v_list from jsonb_array_elements(v_j->'approvals') a;
      return v_n||' demande(s) en attente d''approbation : '||coalesce(v_list,'')||
             '. Traitez-les dans « Approbations en attente » ci-dessous.';
    end if;
    return 'Aucune approbation visible pour votre profil.';
  end if;

  -- 2) Last action status.
  if v_low ~ '(derni[eè]re action|dernier statut|o[uù] en est|statut de (mon|ma)|mon action|ma demande|dernier r[eé]sultat)' then
    select coalesce(c.display_name, r0.action_key) as name, r0.status as st, r0.created_at as ca
      into r
      from hermes_os.agent_action_requests r0
      left join hermes_os.agent_action_catalog c on c.action_key = r0.action_key
      where r0.user_id = p_uid and r0.tenant_id = p_tenant and r0.action_key <> 'hermes.intent.resolve'
      order by r0.created_at desc limit 1;
    if not found then return 'Vous n''avez lancé aucune action récemment.'; end if;
    return 'Votre dernière action : « '||r.name||' » — statut '||r.st||
           ' (le '||to_char(r.ca,'DD/MM/YYYY HH24:MI')||').';
  end if;

  -- 3) Platform KPIs.
  if v_low ~ '(kpi|indicateur|activit[eé] de la plateforme|composants? actifs|tableau de bord plateforme)' then
    select agents_ia_active, modules_sw_active, subworkflows_active, components_active_total, components_registered_total, active_rate
      into v_a, v_m, v_s, v_ca, v_ct, v_rate from public.get_dashboard_public_kpis();
    return 'Indicateurs plateforme : '||coalesce(v_a,0)||' agents IA actifs, '||coalesce(v_m,0)||
           ' modules SW, '||coalesce(v_s,0)||' sous-workflows, '||coalesce(v_ca,0)||'/'||coalesce(v_ct,0)||
           ' composants actifs ('||coalesce(v_rate,0)||' %).';
  end if;

  -- 4) Chantiers / projets consultation. Excludes executable "qualifie ...".
  if v_low !~ 'qualif' and v_low ~ '((montre|affiche|liste|voir|consulte|combien|quels?|quelles?|[eé]tat|donne)[^.]{0,25}(chantiers?|projets?|dossiers?))|(mes (chantiers?|projets?))|((chantiers?|projets?) (en cours|actifs?|en qualification))' then
    v_j := public.get_dashboard_projects(null);
    if coalesce(v_j->>'resolution_status','') <> 'OK' then return 'Impossible de consulter les chantiers pour votre profil.'; end if;
    v_total := coalesce((v_j#>>'{aggregates,total_projects}')::int, 0);
    if v_total = 0 then return 'Aucun chantier en production pour votre tenant.'; end if;
    select string_agg(key||' : '||value, ', ' order by key)
      into v_bystatus from jsonb_each_text(coalesce(v_j#>'{aggregates,by_status}','{}'::jsonb));
    v_val := v_j#>>'{aggregates,total_estimated_value_eur}';
    select string_agg(p->>'chantier_name', ', ')
      into v_recent from (select p from jsonb_array_elements(v_j->'projects') p limit 5) t;
    return v_total||' chantier(s). Répartition : '||coalesce(v_bystatus,'—')||
           '. Valeur estimée totale : '||coalesce(v_val,'—')||' €. Récents : '||coalesce(v_recent,'—')||'.';
  end if;

  -- 4b) Planning consultation (read-only, tenant-scoped). Excludes write "planifie".
  if v_low !~ 'planifie' and v_low ~ 'planning' then
    select count(*) into v_total from hermes_os.btp_planning where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucune phase de planning enregistrée pour votre tenant.'; end if;
    select string_agg(coalesce(c.chantier_name,'?')||' — '||pl.phase_name||' ('||pl.status||')', ' ; ' order by pl.created_at desc)
      into v_list
      from (select * from hermes_os.btp_planning where tenant_id = p_tenant order by created_at desc limit 6) pl
      left join hermes_os.btp_chantiers c on c.id = pl.chantier_id;
    return v_total||' phase(s) de planning. Récentes : '||coalesce(v_list,'—')||'.';
  end if;

  -- 4c) Devis consultation (read-only, tenant-scoped). Read intent only.
  if v_low ~ 'devis' and v_low ~ '(montre|affiche|liste|voir|consulte|combien|quels?|quelles?|mes|les)' then
    select count(*) into v_total from hermes_os.btp_devis where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucun devis enregistré pour votre tenant.'; end if;
    select string_agg(coalesce(c.chantier_name,'?')||' — '||coalesce(d.total_ttc_eur::text,'—')||' € ('||d.status||')', ' ; ' order by d.created_at desc)
      into v_list
      from (select * from hermes_os.btp_devis where tenant_id = p_tenant order by created_at desc limit 6) d
      left join hermes_os.btp_chantiers c on c.id = d.chantier_id;
    return v_total||' devis. Récents : '||coalesce(v_list,'—')||'.';
  end if;

  -- 5) Capability discovery, permission-aware.
  if v_low ~ '(peux[- ]tu faire|que tu peux faire|qu.est[- ]ce que tu peux|que peux[- ]tu|de quoi es[- ]tu capable|quelles? (actions?|capacit)|que sais[- ]tu|tes capacit|liste des actions|actions disponibles|capacit[eé]s? disponibles|disponibles pour moi)' then
    select string_agg(c.display_name||' — '||coalesce(c.description,''), E'\n' order by c.display_name)
      into v_list
      from hermes_os.agent_action_catalog c
      where c.enabled = true and c.nl_enabled = true
        and exists (select 1 from hermes_os.user_tenant_permissions p
                    where p.user_id = p_uid and p.tenant_id = p_tenant and p.permission = c.required_permission);
    if v_list is null then return 'Vous n''avez accès à aucune action pour le moment sur ce tenant.'; end if;
    return 'Voici les actions que vous pouvez lancer : '||E'\n'||v_list||
           E'\n\nDécrivez votre demande en langage naturel.';
  end if;

  return null;
end;
$function$;

revoke all on function hermes_os._hermes_informational(uuid,text,text) from public;
