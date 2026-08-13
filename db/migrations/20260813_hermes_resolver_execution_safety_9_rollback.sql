-- Rollback: hermes_resolver_execution_safety (project smubxqorirlfldatzmym)
-- Restores claim_agent_action + complete_agent_action to their pre-migration
-- bodies, drops the reaper, and drops the additive columns. Non-destructive to
-- business rows (only the two helper columns are removed).

begin;

-- Restore the original action-scoped claim (no lease_token, no attempt cap).
create or replace function hermes_os.claim_agent_action(p_action_key text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_row hermes_os.agent_action_requests%rowtype; v_cat hermes_os.agent_action_catalog%rowtype;
begin
  select * into v_row from hermes_os.agent_action_requests
  where action_key = p_action_key
    and (status = 'QUEUED'
         or (status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now()))
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update hermes_os.agent_action_requests
    set status='RUNNING', attempts = attempts + 1, started_at = coalesce(started_at, now()),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  select * into v_cat from hermes_os.agent_action_catalog where action_key = v_row.action_key;

  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
    v_row.correlation_id, 'CLAIMED', jsonb_build_object('attempt', v_row.attempts, 'scoped', p_action_key));

  return jsonb_build_object('claimed', true,
    'id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id,
    'action_key', v_row.action_key, 'request_id', v_row.request_id,
    'correlation_id', v_row.correlation_id, 'payload', v_row.payload,
    'target_kind', v_cat.target_kind, 'target_workflow_id', v_cat.target_workflow_id,
    'target_agent', v_cat.target_agent, 'attempts', v_row.attempts);
end;
$function$;

revoke all on function hermes_os.claim_agent_action(text,integer) from public;
grant execute on function hermes_os.claim_agent_action(text,integer) to service_role;
grant execute on function hermes_os.claim_agent_action(text,integer) to postgres;

-- Restore the original 5-arg completion (no fence).
drop function if exists hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text,uuid);
create or replace function hermes_os.complete_agent_action(
  p_id uuid, p_status text, p_result jsonb default null, p_error jsonb default null, p_execution_id text default null)
returns void
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare v_row hermes_os.agent_action_requests%rowtype;
begin
  if p_status not in ('SUCCEEDED','FAILED') then
    raise exception 'complete_agent_action: invalid terminal status %', p_status;
  end if;
  update hermes_os.agent_action_requests
    set status = p_status, result = p_result, error = p_error,
        workflow_execution_id = coalesce(p_execution_id, workflow_execution_id),
        finished_at = now(), lease_expires_at = null, updated_at = now()
  where id = p_id returning * into v_row;
  perform hermes_os._agent_action_audit(v_row.tenant_id, v_row.user_id, v_row.action_key, v_row.request_id,
    v_row.correlation_id, p_status, jsonb_build_object('execution_id', p_execution_id));
end;
$function$;

revoke all on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text) from public;
grant execute on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text) to service_role;
grant execute on function hermes_os.complete_agent_action(uuid,text,jsonb,jsonb,text) to postgres;

drop function if exists hermes_os.reap_dead_letter_agent_actions(text,integer);

alter table hermes_os.agent_action_requests drop column if exists lease_token;
alter table hermes_os.agent_action_requests drop column if exists max_attempts;

commit;
