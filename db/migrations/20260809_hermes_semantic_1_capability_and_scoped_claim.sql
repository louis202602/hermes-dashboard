-- Migration: hermes_semantic_resolve_capability_and_scoped_claim (project smubxqorirlfldatzmym)
-- Hermès Semantic Intelligence — part A.
-- (a) register the semantic-resolution capability in the canonical registry;
-- (b) action-scoped claim so the resolver consumer and the BTP poller never
--     claim each other's work.
-- Idempotent & reversible (see 20260809_hermes_semantic_9_rollback.sql).

-- (a) Semantic resolution capability. RESOLUTION action: the model only
-- proposes (no business write); not itself NL-routable. target_workflow_id
-- points at the "GW Consumer — Hermes Semantic Resolver" n8n workflow.
insert into hermes_os.agent_action_catalog
  (action_key, display_name, description, target_kind, target_workflow_id,
   required_permission, required_payload_keys, enabled, is_sensitive,
   nl_enabled, nl_keywords, nl_primary_slot)
values
  ('hermes.intent.resolve',
   'Résolution sémantique (Hermès)',
   'Résout une demande en langage naturel vers une capacité canonique via le modèle. Proposition uniquement : la validation et l''exécution restent côté backend/gateway.',
   'N8N_WORKFLOW', 'IS1I8g0K8VXbm4oH',
   'tenant.member', '{}'::text[], true, false,
   false, '{}'::text[], null)
on conflict (action_key) do update
  set display_name = excluded.display_name,
      description  = excluded.description,
      target_kind  = excluded.target_kind,
      target_workflow_id = excluded.target_workflow_id,
      required_permission = excluded.required_permission,
      required_payload_keys = excluded.required_payload_keys,
      enabled = true, is_sensitive = false, nl_enabled = false,
      updated_at = now();

-- (b) Action-scoped claim (service_role/consumer only).
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
