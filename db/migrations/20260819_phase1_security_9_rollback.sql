-- 20260819_phase1_security_9_rollback.sql
-- Rollback COMPLET des lots PHASE 1 (1 à 4). Idempotent.
--
-- ⚠️ AVERTISSEMENT — exécuter ce fichier RÉ-OUVRE le BLOCKER B2 : la passerelle SW15
-- redevient FAIL-OPEN et toute action sensible sans politique explicite redevient
-- automatiquement PERMISE, sans approbation humaine. À n'exécuter que pour revenir
-- délibérément à l'état antérieur au 2026-08-19.
--
-- Ordre inverse des lots : 4 -> 3 -> 2 -> 1.

-- --- Lot 4 : search_path de photo_session_status_rank ------------------------
alter function hermes_os.photo_session_status_rank(text) reset search_path;

-- --- Lot 3 : RLS de dashboard_context_settings -------------------------------
-- Réactive l'état antérieur (RLS désactivée). Les REVOKE du lot 3 ne sont PAS
-- annulés : aucun GRANT n'existait avant, les rétablir créerait une régression de
-- sécurité qui n'a jamais existé.
alter table hermes_os.dashboard_context_settings disable row level security;

-- --- Lot 2 : politiques BTP --------------------------------------------------
-- Supprime UNIQUEMENT les lignes créées par le lot 2 (marquées updated_by).
-- Les 13 politiques préexistantes (SW18 + photo) ne sont jamais touchées.
delete from hermes_os.sw15_policies
 where tenant_id = 'heliosolar'
   and updated_by = 'phase1_security_2'
   and action_pattern in ('btp.qualification.create',
                          'btp.planning.phase.add',
                          'btp.suivi.progress.report');

-- --- Lot 1 : gateway_policy_gate ---------------------------------------------
-- Restaure MOT POUR MOT la définition antérieure (fail-open, sans is_sensitive),
-- telle que relevée en base le 2026-08-19 avant migration.
create or replace function hermes_os.gateway_policy_gate(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_req hermes_os.agent_action_requests%rowtype;
  v_effect text;
  v_policy uuid;
  v_ar uuid;
begin
  select * into v_req from hermes_os.agent_action_requests where id = p_id;
  if not found then return 'NOT_FOUND'; end if;

  if v_req.approved_by is not null then
    perform hermes_os.record_agent_action_policy(p_id, 'PERMIT', 'Human-approved');
    return 'PERMIT';
  end if;

  select p.effect, p.policy_id into v_effect, v_policy
  from hermes_os.sw15_policies p
  where p.tenant_id = v_req.tenant_id
    and p.status = 'ACTIVE'
    and (p.valid_from is null or p.valid_from <= now())
    and (p.valid_until is null or p.valid_until >= now())
    and v_req.action_key like replace(p.action_pattern, '*', '%')
  order by case p.effect when 'DENY' then 0 when 'REQUIRE_APPROVAL' then 1 when 'PERMIT' then 2 else 3 end,
           p.priority desc nulls last
  limit 1;

  if v_effect is null then v_effect := 'PERMIT'; end if;

  if v_effect = 'DENY' then
    perform hermes_os.record_agent_action_policy(p_id, 'DENY', 'SW15 policy DENY');
    return 'DENY';
  elsif v_effect = 'REQUIRE_APPROVAL' then
    if v_req.approval_request_id is null then
      v_ar := gen_random_uuid();
      insert into hermes_os.sw15_approval_requests
        (approval_request_id, tenant_id, request_id, action, policy_id, required_approvals, status, created_at, expires_at)
      values (v_ar, v_req.tenant_id, v_req.request_id, v_req.action_key, v_policy, 1, 'PENDING', now(), now() + interval '7 days');
      update hermes_os.agent_action_requests set approval_request_id = v_ar where id = p_id;
    end if;
    perform hermes_os.record_agent_action_policy(p_id, 'REQUIRE_APPROVAL', 'Approbation humaine requise (SW15)');
    return 'REQUIRE_APPROVAL';
  else
    perform hermes_os.record_agent_action_policy(p_id, 'PERMIT', 'SW15 permit');
    return 'PERMIT';
  end if;
end;
$function$;

comment on function hermes_os.gateway_policy_gate(uuid) is null;
