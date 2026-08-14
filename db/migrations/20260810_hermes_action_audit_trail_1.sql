-- Migration: hermes_action_audit_trail (project smubxqorirlfldatzmym)
-- =====================================================================
-- Safety-critical accountability: a tenant-scoped, READ-ONLY audit trail of
-- agent actions and their SW15 approval decisions. The dashboard already lists
-- PENDING approvals (list_pending_agent_approvals) but had no view of the
-- DECIDED history — who/what was requested, the policy decision, whether an
-- approval was required and its outcome, retries, terminal status, and error
-- code. A mission-critical / safety-critical autonomous system must expose this.
--
-- This adds NO write path and NO second orchestrator: it only reads the real
-- gateway audit table `agent_action_requests`. Consumers stay INACTIVE — actions
-- that are still QUEUED (no active runner) are shown honestly as such.
--
-- SECURITY DEFINER, search_path locked, granted to `authenticated` only,
-- fail-closed. Tenant resolved via `resolve_active_tenant` — caller's tenant
-- only. Non-identifying: NO payload, NO requester/approver user UUIDs, NO
-- free-text result — only the accountability metadata + error CODE.
--
-- Provenance: actions[] and summary are REAL (agent_action_requests). The SW23
-- audit logs (sw23_audit_log / sw23_policy_audit) are empty in this project and
-- are reported UNAVAILABLE, never fabricated.
-- =====================================================================

-- Pure/immutable helper: derive the approval accountability outcome for one row.
create or replace function public.sw_action_approval_outcome(
  p_status text,
  p_policy_decision text,
  p_required_approval boolean,
  p_has_approver boolean,
  p_decided boolean
)
returns text
language sql
immutable
as $function$
  select case
    when p_has_approver then 'APPROVED'
    when upper(coalesce(p_status,'')) like '%REJECT%'
      or upper(coalesce(p_policy_decision,'')) like '%DENY%'
      or upper(coalesce(p_policy_decision,'')) like '%DENIED%'
      or upper(coalesce(p_status,'')) like '%DENIED%' then 'REJECTED'
    when coalesce(p_required_approval,false) and not coalesce(p_decided,false) then 'PENDING_APPROVAL'
    else 'NOT_REQUIRED'
  end;
$function$;

create or replace function public.get_action_audit_trail(p_limit integer default 12)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_limit int;
  v_actions jsonb; v_summary jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('resolution_status','UNAUTHENTICATED');
  end if;
  v_limit := least(greatest(coalesce(p_limit,12),1),50);

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', coalesce(v_status,'NO_TENANT'), 'tenant_id', v_tenant);
  end if;

  -- Recent actions with their accountability chain (non-identifying).
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) into v_actions
  from (
    select jsonb_build_object(
             'action_key', a.action_key,
             'is_sensitive', coalesce(c.is_sensitive, false),
             'status', a.status,
             'policy_decision', a.policy_decision,
             'policy_reason', left(a.policy_reason, 160),
             'required_approval', (a.approval_request_id is not null),
             'approval_outcome', public.sw_action_approval_outcome(
                a.status, a.policy_decision,
                a.approval_request_id is not null, a.approved_by is not null,
                a.decided_at is not null),
             'decided_at', a.decided_at,
             'attempts', a.attempts,
             'error_code', a.error->>'code',
             'created_at', a.created_at,
             'started_at', a.started_at,
             'finished_at', a.finished_at
           ) x
      from hermes_os.agent_action_requests a
      left join hermes_os.agent_action_catalog c on c.action_key = a.action_key
     where a.tenant_id = v_tenant
     order by a.created_at desc
     limit v_limit
  ) s;

  -- Compact security posture summary (all REAL counts, tenant-scoped).
  select jsonb_build_object(
    'total', count(*),
    'sensitive', count(*) filter (where coalesce(c.is_sensitive,false)),
    'policy_denied', count(*) filter (
      where upper(coalesce(a.policy_decision,'')) like '%DENY%'
         or upper(coalesce(a.policy_decision,'')) like '%DENIED%'
         or upper(coalesce(a.status,'')) like '%DENIED%'),
    'approved', count(*) filter (where a.approved_by is not null),
    'rejected', count(*) filter (where upper(coalesce(a.status,'')) like '%REJECT%'),
    'pending_approval', count(*) filter (where a.approval_request_id is not null and a.decided_at is null),
    'failed', count(*) filter (where upper(coalesce(a.status,'')) like '%FAIL%'),
    'queued', count(*) filter (where upper(coalesce(a.status,'')) = 'QUEUED'),
    'succeeded', count(*) filter (where upper(coalesce(a.status,'')) in ('SUCCEEDED','SUCCESS','DONE'))
  ) into v_summary
  from hermes_os.agent_action_requests a
  left join hermes_os.agent_action_catalog c on c.action_key = a.action_key
  where a.tenant_id = v_tenant;

  return jsonb_build_object(
    'resolution_status','OK',
    'tenant_id', v_tenant,
    'as_of', now(),
    'summary', v_summary,
    'actions', v_actions,
    -- SW23 dedicated audit logs are not populated in this project.
    'unavailable', jsonb_build_array('sw23_audit_log','sw23_policy_audit')
  );
end;
$function$;

revoke all on function public.sw_action_approval_outcome(text, text, boolean, boolean, boolean) from public;
grant execute on function public.sw_action_approval_outcome(text, text, boolean, boolean, boolean) to authenticated;
revoke all on function public.get_action_audit_trail(integer) from public;
grant execute on function public.get_action_audit_trail(integer) to authenticated;
