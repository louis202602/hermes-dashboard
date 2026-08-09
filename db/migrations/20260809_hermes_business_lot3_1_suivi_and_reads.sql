-- Migration: hermes_business_lot3_suivi_and_reads (project smubxqorirlfldatzmym)
-- =====================================================================
-- Hermès Business Capabilities — lot 3
-- (a) btp.suivi.progress.report : WRITE capability. Sensitive → SW15.
--     Applies the REAL Agent BTP-Suivi canonical idempotent contract
--     (INSERT btp_suivi_avancement ON CONFLICT (tenant,chantier,date) DO
--     NOTHING) through the gateway consumer "GW Consumer — BTP Suivi"
--     (n8n 1xCiexp3oVj0R8Tk, INACTIVE). The consumer applies the contract
--     directly rather than invoking the agent workflow, because that agent's
--     legacy `workflowTrigger` is not Execute-Sub-workflow-invokable; the
--     production agent is left untouched (SW4 remains its sole caller).
--     Multi-param (chantier_name + pct) → routed via the semantic model
--     (empty nl_keywords so the deterministic single-slot path never matches).
-- (b) Read-only consultation added for operational reporting (+ blockers),
--     fournisseurs and avancement. Reversible. All derived from REAL
--     tenant-scoped data. Read branches require a read verb and exclude write
--     phrasings (write verbs / any percentage value) so they never swallow the
--     btp.suivi.progress.report WRITE.
--
-- NOTE: this file consolidates the applied migration
-- `hermes_business_lot3_suivi_and_reads` together with the small follow-up
-- guard refinement (KPI branch keeps "activité de la plateforme"; the
-- last-action branch requires "où en est ma/mon …"; reporting owns
-- "principaux indicateurs"). It reproduces the FINAL live definitions.
-- =====================================================================

insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id,
   required_permission, required_payload_keys, enabled, is_sensitive,
   nl_enabled, nl_keywords, nl_primary_slot)
values
  ('btp.suivi.progress.report',
   'Enregistrer un avancement de chantier (BTP)',
   'Enregistre un rapport d''avancement (phase + pourcentage) sur un chantier existant via l''agent BTP-Suivi (nom du chantier + pourcentage). Action sensible : soumise à la politique SW15.',
   'N8N_WORKFLOW', '1xCiexp3oVj0R8Tk',
   'tenant.member', array['chantier_name','pct']::text[], true, true,
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
  v_read text := '(montre|affiche|liste|voir|consulte|combien|quels?|quelles?|donne|mes |mon |quel )';
  v_write text := '(enregistre|enregistrer|reporte|reporter|saisis|saisir|ajoute|ajouter|consigne|mets? [aà] jour|note l|planifie|qualif)';
  v_pct text := '[0-9]+ ?(%|pour ?cent)';
  v_f int; v_inc int; v_sv text;
begin
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

  if v_low ~ '(derni[eè]re action|dernier statut|o[uù] en est (ma|mon)|statut de (mon|ma)|mon action|ma demande|dernier r[eé]sultat)' then
    select coalesce(c.display_name, r0.action_key) as name, r0.status as st, r0.created_at as ca
      into r from hermes_os.agent_action_requests r0
      left join hermes_os.agent_action_catalog c on c.action_key = r0.action_key
      where r0.user_id = p_uid and r0.tenant_id = p_tenant and r0.action_key <> 'hermes.intent.resolve'
      order by r0.created_at desc limit 1;
    if not found then return 'Vous n''avez lancé aucune action récemment.'; end if;
    return 'Votre dernière action : « '||r.name||' » — statut '||r.st||' (le '||to_char(r.ca,'DD/MM/YYYY HH24:MI')||').';
  end if;

  if v_low ~ '(kpi|indicateurs? (de la )?plateforme|indicateurs? technique|activit[eé] de la plateforme|composants? actifs|tableau de bord plateforme)' then
    select agents_ia_active, modules_sw_active, subworkflows_active, components_active_total, components_registered_total, active_rate
      into v_a, v_m, v_s, v_ca, v_ct, v_rate from public.get_dashboard_public_kpis();
    return 'Indicateurs plateforme : '||coalesce(v_a,0)||' agents IA actifs, '||coalesce(v_m,0)||
           ' modules SW, '||coalesce(v_s,0)||' sous-workflows, '||coalesce(v_ca,0)||'/'||coalesce(v_ct,0)||
           ' composants actifs ('||coalesce(v_rate,0)||' %).';
  end if;

  -- Operational reporting / point d'activité + blockers (real, tenant-scoped).
  -- Placed before chantier consultation so "résume mes chantiers" summarises.
  if v_low ~ '(fais[- ]?(moi )?le point|le point sur|r[eé]sum|synth[eè]se|bilan|reporting|point d.activit|activit[eé] globale|qu.est[- ]ce qui bloque|ce qui bloque|t[aâ]ches? prioritaires|priorit[eé]s du jour|traiter en premier|principaux indicateurs)' then
    select count(*) into v_total from hermes_os.btp_chantiers where tenant_id = p_tenant;
    select string_agg(status||' : '||c, ', ' order by status)
      into v_bystatus from (select status, count(*) c from hermes_os.btp_chantiers where tenant_id = p_tenant group by status) z;
    select count(*) into v_f from hermes_os.btp_fournisseurs where tenant_id = p_tenant;
    select count(*) into v_inc from hermes_os.btp_incidents_qualite where tenant_id = p_tenant and upper(status) in ('OUVERT','OPEN');
    select coalesce(c.chantier_name,'?')||' — '||coalesce(sv.phase_en_cours,'—')||' à '||coalesce(sv.pct_global::text,'0')||'%'
      into v_sv from hermes_os.btp_suivi_avancement sv
      left join hermes_os.btp_chantiers c on c.id = sv.chantier_id
      where sv.tenant_id = p_tenant order by sv.date_rapport desc nulls last, sv.created_at desc limit 1;
    return 'Point d''activité : '||v_total||' chantier(s)'||coalesce(' ('||v_bystatus||')','')||'. '||
           coalesce(v_f,0)||' fournisseur(s). '||coalesce(v_inc,0)||' incident(s) qualité ouvert(s)'||
           case when coalesce(v_inc,0) > 0 then ' — à traiter en priorité' else '' end||
           '. Dernier avancement : '||coalesce(v_sv,'—')||'.';
  end if;

  -- Fournisseurs consultation (read verb required; excludes write phrasings).
  if v_low !~ v_write and v_low ~ v_read and v_low ~ 'fournisseur' then
    select count(*) into v_total from hermes_os.btp_fournisseurs where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucun fournisseur enregistré pour votre tenant.'; end if;
    select string_agg(nom||' ('||coalesce(type_fourniture,'—')||', fiab. '||coalesce(fiabilite_pct::text,'—')||' %, délai '||coalesce(delai_jours::text,'—')||' j)', ' ; ' order by nom)
      into v_list from (select * from hermes_os.btp_fournisseurs where tenant_id = p_tenant order by nom limit 8) f;
    return v_total||' fournisseur(s) : '||coalesce(v_list,'—')||'.';
  end if;

  -- Avancement / suivi consultation (read intent; excludes the WRITE — write
  -- verbs and any percentage value route to btp.suivi.progress.report instead).
  if v_low !~ v_write and v_low !~ v_pct and (v_low ~ 'avancement' or v_low ~ 'progression' or (v_low ~ v_read and v_low ~ 'suivi')) then
    select count(*) into v_total from hermes_os.btp_suivi_avancement where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucun rapport d''avancement enregistré pour votre tenant.'; end if;
    select string_agg(coalesce(c.chantier_name,'?')||' — '||coalesce(sv.phase_en_cours,'—')||' '||coalesce(sv.pct_global::text,'0')||' %'||
             case when sv.retards_jours is not null and sv.retards_jours > 0 then ' (retard '||sv.retards_jours||' j)' else '' end,
             ' ; ' order by sv.date_rapport desc nulls last, sv.created_at desc)
      into v_list from (select * from hermes_os.btp_suivi_avancement where tenant_id = p_tenant order by date_rapport desc nulls last, created_at desc limit 6) sv
      left join hermes_os.btp_chantiers c on c.id = sv.chantier_id;
    return v_total||' rapport(s) d''avancement. Récents : '||coalesce(v_list,'—')||'.';
  end if;

  if v_low !~ 'qualif' and v_low !~ 'planifie' and v_low ~ v_read and v_low ~ '(chantiers?|projets?|dossiers?)' then
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

  if v_low !~ 'qualif' and v_low !~ 'planifie' and v_low ~ 'planning' and v_low ~ v_read then
    select count(*) into v_total from hermes_os.btp_planning where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucune phase de planning enregistrée pour votre tenant.'; end if;
    select string_agg(coalesce(c.chantier_name,'?')||' — '||pl.phase_name||' ('||pl.status||')', ' ; ' order by pl.created_at desc)
      into v_list from (select * from hermes_os.btp_planning where tenant_id = p_tenant order by created_at desc limit 6) pl
      left join hermes_os.btp_chantiers c on c.id = pl.chantier_id;
    return v_total||' phase(s) de planning. Récentes : '||coalesce(v_list,'—')||'.';
  end if;

  if v_low !~ 'qualif' and v_low !~ 'planifie' and v_low ~ 'devis' and v_low ~ v_read then
    select count(*) into v_total from hermes_os.btp_devis where tenant_id = p_tenant;
    if v_total = 0 then return 'Aucun devis enregistré pour votre tenant.'; end if;
    select string_agg(coalesce(c.chantier_name,'?')||' — '||coalesce(d.total_ttc_eur::text,'—')||' € ('||d.status||')', ' ; ' order by d.created_at desc)
      into v_list from (select * from hermes_os.btp_devis where tenant_id = p_tenant order by created_at desc limit 6) d
      left join hermes_os.btp_chantiers c on c.id = d.chantier_id;
    return v_total||' devis. Récents : '||coalesce(v_list,'—')||'.';
  end if;

  if v_low ~ '(peux[- ]tu faire|que tu peux faire|qu.est[- ]ce que tu peux|que peux[- ]tu|de quoi es[- ]tu capable|quelles? (actions?|capacit)|que sais[- ]tu|tes capacit|liste des actions|actions disponibles|capacit[eé]s? disponibles|disponibles pour moi)' then
    select string_agg(c.display_name||' — '||coalesce(c.description,''), E'\n' order by c.display_name)
      into v_list from hermes_os.agent_action_catalog c
      where c.enabled = true and c.nl_enabled = true
        and exists (select 1 from hermes_os.user_tenant_permissions p
                    where p.user_id = p_uid and p.tenant_id = p_tenant and p.permission = c.required_permission);
    if v_list is null then return 'Vous n''avez accès à aucune action pour le moment sur ce tenant.'; end if;
    return 'Voici les actions que vous pouvez lancer : '||E'\n'||v_list||E'\n\nDécrivez votre demande en langage naturel.';
  end if;

  return null;
end;
$function$;

revoke all on function hermes_os._hermes_informational(uuid,text,text) from public;
