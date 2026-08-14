-- Rollback: agent_action_claim_exclusions (project smubxqorirlfldatzmym)
-- Restores both claim_agent_action variants to their pre-migration definitions
-- (no exclusion filter), drops the helper functions and the exclusion table.
-- No business data touched. NOTE: run only when no rows are quarantined, else the
-- protected head-of-line rows become claimable again.
begin;

-- restore 2-arg claim_agent_action (original, no exclusion filter)
create or replace function hermes_os.claim_agent_action(p_action_key text, p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $function$
declare
  v_row hermes_os.agent_action_requests%rowtype;
  v_cat hermes_os.agent_action_catalog%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_row from hermes_os.agent_action_requests
  where action_key = p_action_key
    and (status = 'QUEUED'
         or (status = 'RUNNING' and lease_expires_at is not null
             and lease_expires_at < now() and attempts < max_attempts))
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  update hermes_os.agent_action_requests
    set status='RUNNING', attempts = attempts + 1, started_at = coalesce(started_at, now()),
        lease_token = v_token,
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
    'lease_token', v_token, 'attempts', v_row.attempts, 'max_attempts', v_row.max_attempts,
    'target_kind', v_cat.target_kind, 'target_workflow_id', v_cat.target_workflow_id,
    'target_agent', v_cat.target_agent);
end;
$function$;

-- restore 1-arg claim_agent_action (original, no exclusion filter)
create or replace function hermes_os.claim_agent_action(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp' as $function$
declare v_row hermes_os.agent_action_requests%rowtype; v_cat hermes_os.agent_action_catalog%rowtype;
begin
  select * into v_row from hermes_os.agent_action_requests
  where status = 'QUEUED'
     or (status = 'RUNNING' and lease_expires_at is not null and lease_expires_at < now())
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
    v_row.correlation_id, 'CLAIMED', jsonb_build_object('attempt', v_row.attempts));

  return jsonb_build_object('claimed', true,
    'id', v_row.id, 'tenant_id', v_row.tenant_id, 'user_id', v_row.user_id,
    'action_key', v_row.action_key, 'request_id', v_row.request_id,
    'correlation_id', v_row.correlation_id, 'payload', v_row.payload,
    'target_kind', v_cat.target_kind, 'target_workflow_id', v_cat.target_workflow_id,
    'target_agent', v_cat.target_agent, 'attempts', v_row.attempts);
end;
$function$;

drop function if exists hermes_os.exclude_agent_action_from_claim(uuid,text,timestamptz);
drop function if exists hermes_os.release_agent_action_claim_exclusion(uuid);
drop table if exists hermes_os.agent_action_claim_exclusions;

commit;
