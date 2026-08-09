-- Migration: hermes_capability_expansion_consultation_and_diag (project smubxqorirlfldatzmym)
-- Hermès Capability Expansion (first lot):
-- (a) diag.echo linked to its real runner (GW Consumer — Diag Echo, n8n
--     6687hzOPQ27an2J6) — fixes the "action sans agent réel" inconsistency.
-- (b) Read-only CONSULTATION added to the informational layer, derived from the
--     existing dashboard RPCs (projects tenant-scoped, KPIs platform). No new
--     tables, no parallel gateway. Reversible.

-- (a) diag.echo runner
update hermes_os.agent_action_catalog
   set target_workflow_id = '6687hzOPQ27an2J6', updated_at = now()
 where action_key = 'diag.echo';

-- (b) informational layer + consultation
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
  -- 1) Pending approvals (read-only, reuses the existing tenant-scoped reader).
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

  -- 2) Last action status (this user; excludes the internal resolve action).
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

  -- 3) Platform KPIs (read-only, reuses get_dashboard_public_kpis).
  if v_low ~ '(kpi|indicateur|activit[eé] de la plateforme|composants? actifs|tableau de bord plateforme)' then
    select agents_ia_active, modules_sw_active, subworkflows_active, components_active_total, components_registered_total, active_rate
      into v_a, v_m, v_s, v_ca, v_ct, v_rate from public.get_dashboard_public_kpis();
    return 'Indicateurs plateforme : '||coalesce(v_a,0)||' agents IA actifs, '||coalesce(v_m,0)||
           ' modules SW, '||coalesce(v_s,0)||' sous-workflows, '||coalesce(v_ca,0)||'/'||coalesce(v_ct,0)||
           ' composants actifs ('||coalesce(v_rate,0)||' %).';
  end if;

  -- 4) Chantiers / projets consultation (read-only, tenant-scoped, reuses
  --    get_dashboard_projects). Excludes executable "qualifie ..." phrasings.
  if v_low !~ 'qualif' and v_low ~ '((montre|affiche|liste|voir|consulte|combien|quels?|quelles?|[eé]tat|donne)[^.]{0,25}(chantiers?|projets?|dossiers?))|(mes (chantiers?|projets?))|((chantiers?|projets?) (en cours|actifs?|en qualification))' then
    v_j := public.get_dashboard_projects(null);
    if coalesce(v_j->>'resolution_status','') <> 'OK' then
      return 'Impossible de consulter les chantiers pour votre profil.';
    end if;
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

  -- 5) Capability discovery, PERMISSION-AWARE (derived from the registry).
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
