-- Migration: hermes_semantic_orchestrator_and_apply (project smubxqorirlfldatzmym)
-- Hermès Semantic Intelligence — part B.
-- Fast path (deterministic) stays. When it can't confidently resolve, the
-- orchestrator enqueues a semantic-resolution request via the SAME gateway
-- (the model only PROPOSES). apply_hermes_resolution() re-validates the proposal
-- against the registry and executes via the gateway. Fail-closed everywhere.
-- Reversible (see 20260809_hermes_semantic_9_rollback.sql).

create or replace function hermes_os.orchestrate_hermes_message(
  p_message text, p_conversation_id uuid default null, p_request_id text default null)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_tenant text; v_status text;
  v_msg text := coalesce(p_message,''); v_low text;
  v_conv_id uuid; v_user_msg uuid; v_asst_msg uuid;
  v_cat hermes_os.agent_action_catalog%rowtype;
  v_matches int := 0; v_candidates text[] := '{}'::text[];
  v_slot text; v_name text; v_payload jsonb := '{}'::jsonb; v_missing text[] := '{}'::text[];
  v_reply text; v_outcome text; v_confidence text; v_action_key text;
  v_req_id text; v_correlation uuid; v_gw jsonb; v_gw_status text; v_help boolean := false;
  v_caps jsonb; v_ctx jsonb; v_resolve_id text; rec record;
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','UNAUTHENTICATED',
      'reply','Session expirée. Reconnectez-vous.','error',jsonb_build_object('code','UNAUTHENTICATED','message','Not authenticated.'));
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'outcome','ERROR','status',v_status,
      'reply','Aucun tenant actif n''a pu être résolu.','error',jsonb_build_object('code',v_status,'message','Tenant not resolved.'));
  end if;
  if length(trim(v_msg)) = 0 then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','VALIDATION_FAILED',
      'reply','Saisissez un message.','error',jsonb_build_object('code','EMPTY_MESSAGE','message','Message is required.'));
  end if;
  if length(v_msg) > 4000 then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','VALIDATION_FAILED',
      'reply','Message trop long (max 4000 caractères).','error',jsonb_build_object('code','MESSAGE_TOO_LONG','message','Message too long.'));
  end if;
  v_low := lower(v_msg);

  if p_conversation_id is not null then
    select id into v_conv_id from hermes_os.hermes_conversations
    where id = p_conversation_id and tenant_id = v_tenant and user_id = v_uid;
    if v_conv_id is null then
      return jsonb_build_object('ok',false,'outcome','ERROR','status','NOT_FOUND',
        'reply','Conversation introuvable.','error',jsonb_build_object('code','CONVERSATION_NOT_FOUND','message','Conversation not found for this user/tenant.'));
    end if;
  else
    insert into hermes_os.hermes_conversations(tenant_id,user_id,title)
    values (v_tenant, v_uid, left(trim(v_msg),80)) returning id into v_conv_id;
  end if;

  insert into hermes_os.hermes_messages(conversation_id,tenant_id,user_id,role,content)
  values (v_conv_id, v_tenant, v_uid, 'user', v_msg) returning id into v_user_msg;

  for rec in select * from hermes_os.agent_action_catalog c where c.enabled = true and c.nl_enabled = true loop
    if exists (select 1 from unnest(rec.nl_keywords) kw where kw <> '' and position(lower(kw) in v_low) > 0) then
      v_matches := v_matches + 1; v_candidates := array_append(v_candidates, rec.action_key); v_cat := rec;
    end if;
  end loop;
  if v_low ~ '(aide|help|que (peux|pouvez)|capacit|quelles? actions|que sais-tu|liste des actions)' then v_help := true; end if;

  if v_matches = 1 then
    -- FAST PATH: single confident deterministic match.
    v_action_key := v_cat.action_key;
    if v_cat.nl_primary_slot is not null then
      v_name := hermes_os._nl_extract_slot(v_msg, v_cat.nl_keywords);
      if v_name is not null and length(v_name) > 0 then v_payload := jsonb_build_object(v_cat.nl_primary_slot, v_name); end if;
    end if;
    v_missing := '{}'::text[];
    foreach v_slot in array v_cat.required_payload_keys loop
      if not (v_payload ? v_slot) then v_missing := array_append(v_missing, v_slot); end if;
    end loop;
    if array_length(v_missing,1) is not null then
      v_outcome := 'NEEDS_CLARIFICATION'; v_confidence := 'MEDIUM';
      v_reply := 'Pour « '||v_cat.display_name||' », précisez : '||array_to_string(v_missing, ', ')||'.';
    else
      v_req_id := coalesce(nullif(trim(coalesce(p_request_id,'')),''), v_conv_id::text||':'||v_user_msg::text);
      v_gw := hermes_os.request_agent_action(v_action_key, v_payload, v_req_id); v_gw_status := v_gw->>'status';
      if coalesce((v_gw->>'ok')::boolean,false) and v_gw_status = 'QUEUED' then
        v_outcome := 'ACTION'; v_confidence := 'HIGH'; v_correlation := nullif(v_gw->>'correlation_id','')::uuid;
        v_reply := 'Action lancée : '||v_cat.display_name||'. Suivi en cours.';
      elsif coalesce((v_gw->>'ok')::boolean,false) and coalesce(v_gw->>'replay','false') = 'true' then
        v_outcome := 'ACTION'; v_confidence := 'HIGH'; v_correlation := nullif(v_gw->>'correlation_id','')::uuid;
        v_reply := 'Action déjà enregistrée : '||v_cat.display_name||'. Suivi en cours.';
      else
        v_outcome := 'ERROR'; v_confidence := 'HIGH'; v_gw_status := coalesce(v_gw_status,'RPC_ERROR');
        v_reply := coalesce(v_gw#>>'{error,message}','Action refusée par la passerelle de sécurité.');
      end if;
    end if;
  elsif v_help then
    v_outcome := 'ANSWER_ONLY'; v_confidence := 'HIGH';
    v_reply := 'Voici les actions que je peux exécuter : '||
      coalesce((select string_agg(c.display_name||' — '||coalesce(c.description,''), E'\n' order by c.display_name)
                  from hermes_os.agent_action_catalog c where c.enabled = true and c.nl_enabled = true),'aucune pour le moment')||
      E'\n\nDécrivez votre demande en langage naturel.';
  else
    -- SEMANTIC PATH: 0 matches or ambiguous. Enqueue the model resolver via the
    -- SAME gateway (proposal only). Fail-closed fallback if the enqueue fails.
    v_caps := (select jsonb_agg(jsonb_build_object('action_key', c.action_key, 'display_name', c.display_name,
                 'description', c.description, 'required_payload_keys', c.required_payload_keys))
               from hermes_os.agent_action_catalog c where c.enabled = true and c.nl_enabled = true);
    v_ctx := (select jsonb_agg(jsonb_build_object('role', x.role, 'content', x.content) order by x.created_at)
              from (select role, content, created_at from hermes_os.hermes_messages
                    where conversation_id = v_conv_id and tenant_id = v_tenant and id <> v_user_msg
                    order by created_at desc limit 6) x);
    v_resolve_id := v_conv_id::text||':resolve:'||v_user_msg::text;
    v_gw := hermes_os.request_agent_action('hermes.intent.resolve',
              jsonb_build_object('message', v_msg, 'capabilities', coalesce(v_caps,'[]'::jsonb), 'context', coalesce(v_ctx,'[]'::jsonb)),
              v_resolve_id);
    v_gw_status := v_gw->>'status';
    if coalesce((v_gw->>'ok')::boolean,false) and v_gw_status = 'QUEUED' then
      update hermes_os.hermes_conversations set last_message_at = now(), updated_at = now() where id = v_conv_id;
      return jsonb_build_object('ok',true,'outcome','RESOLVING','status','RESOLVING','conversation_id', v_conv_id,
        'user_message_id', v_user_msg,'resolve_request_id', v_resolve_id,'reply','Hermès analyse votre demande…',
        'confidence', null, 'action_key', null, 'request_id', null, 'error', null);
    elsif coalesce((v_gw->>'ok')::boolean,false) and coalesce(v_gw->>'replay','false')='true' then
      update hermes_os.hermes_conversations set last_message_at = now(), updated_at = now() where id = v_conv_id;
      return jsonb_build_object('ok',true,'outcome','RESOLVING','status','RESOLVING','conversation_id', v_conv_id,
        'user_message_id', v_user_msg,'resolve_request_id', v_resolve_id,'reply','Hermès analyse votre demande…',
        'confidence', null, 'action_key', null, 'request_id', null, 'error', null);
    else
      v_outcome := 'NEEDS_CLARIFICATION'; v_confidence := 'NONE';
      v_reply := 'Je n''ai pas compris cette demande. Actions disponibles : '||
        coalesce((select string_agg(c.display_name, ' ; ' order by c.display_name)
                    from hermes_os.agent_action_catalog c where c.enabled = true and c.nl_enabled = true),'aucune')||'.';
    end if;
  end if;

  insert into hermes_os.hermes_messages(conversation_id,tenant_id,user_id,role,content,outcome,action_key,request_id,correlation_id,confidence,metadata)
  values (v_conv_id, v_tenant, v_uid, 'assistant', v_reply, v_outcome, v_action_key, v_req_id, v_correlation, v_confidence,
          jsonb_build_object('match_count', v_matches, 'path', 'deterministic'))
  returning id into v_asst_msg;
  update hermes_os.hermes_conversations set last_message_at = now(), updated_at = now() where id = v_conv_id;

  return jsonb_build_object('ok', (v_outcome <> 'ERROR'),'outcome', v_outcome,'conversation_id', v_conv_id,
    'user_message_id', v_user_msg,'assistant_message_id', v_asst_msg,'reply', v_reply,'action_key', v_action_key,
    'request_id', v_req_id,'correlation_id', v_correlation,'confidence', v_confidence,
    'missing', case when array_length(v_missing,1) is not null then to_jsonb(v_missing) else null end,
    'status', coalesce(v_gw_status, v_outcome),
    'error', case when v_outcome = 'ERROR' then jsonb_build_object('code', coalesce(v_gw_status,'ERROR'), 'message', v_reply) else null end);
end;
$function$;

-- apply_hermes_resolution: re-validate the model proposal and execute via the
-- gateway. Runs as the ORIGINAL user (auth.uid()); fail-closed on unknown
-- action, low confidence, missing params, malformed output, or resolver failure.
create or replace function hermes_os.apply_hermes_resolution(
  p_conversation_id uuid, p_resolve_request_id text, p_request_id text default null)
returns jsonb language plpgsql security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid(); v_tenant text; v_status text; v_conf_min numeric := 0.60;
  v_row hermes_os.agent_action_requests%rowtype; v_proposal jsonb; v_model_outcome text;
  v_action_key text; v_confidence numeric; v_params jsonb; v_cat hermes_os.agent_action_catalog%rowtype;
  v_missing text[] := '{}'::text[]; v_slot text; v_reply text; v_outcome text; v_req_id text;
  v_correlation uuid; v_gw jsonb; v_gw_status text; v_asst_msg uuid; v_reason text;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'outcome','ERROR','status','UNAUTHENTICATED','reply','Session expirée.'); end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then return jsonb_build_object('ok',false,'outcome','ERROR','status',v_status,'reply','Tenant non résolu.'); end if;

  select * into v_row from hermes_os.agent_action_requests
  where request_id = p_resolve_request_id and tenant_id = v_tenant and user_id = v_uid and action_key = 'hermes.intent.resolve';
  if not found then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','NOT_FOUND','reply','Résolution introuvable.',
      'error',jsonb_build_object('code','RESOLVE_NOT_FOUND','message','not found'));
  end if;
  if not exists (select 1 from hermes_os.hermes_conversations where id = p_conversation_id and tenant_id = v_tenant and user_id = v_uid) then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','NOT_FOUND','reply','Conversation introuvable.');
  end if;

  if v_row.status <> 'SUCCEEDED' then
    if v_row.status in ('FAILED','POLICY_DENIED','REJECTED') then
      v_outcome := 'ERROR'; v_reply := 'La compréhension de votre demande a échoué. Reformulez, s''il vous plaît.';
      insert into hermes_os.hermes_messages(conversation_id,tenant_id,user_id,role,content,outcome,confidence,metadata)
      values (p_conversation_id,v_tenant,v_uid,'assistant',v_reply,'ERROR','NONE',jsonb_build_object('path','semantic','resolve_status',v_row.status))
      returning id into v_asst_msg;
      return jsonb_build_object('ok',false,'outcome','ERROR','status',v_row.status,'conversation_id',p_conversation_id,
        'assistant_message_id',v_asst_msg,'reply',v_reply,'error',jsonb_build_object('code','RESOLVER_FAILED','message',v_row.status));
    end if;
    return jsonb_build_object('ok',true,'outcome','RESOLVING','status',v_row.status,'conversation_id',p_conversation_id,'reply','Hermès analyse votre demande…');
  end if;

  v_proposal := coalesce(v_row.result, '{}'::jsonb);
  v_model_outcome := upper(coalesce(v_proposal->>'outcome',''));
  v_action_key := nullif(btrim(coalesce(v_proposal->>'action_key','')), '');
  if v_action_key in ('null','NULL','None','none') then v_action_key := null; end if;
  begin v_confidence := coalesce((v_proposal->>'confidence')::numeric, 0); exception when others then v_confidence := 0; end;
  if jsonb_typeof(v_proposal->'parameters') = 'object' then v_params := v_proposal->'parameters'; else v_params := '{}'::jsonb; end if;
  v_reason := left(coalesce(v_proposal->>'reason',''), 500);

  if v_model_outcome = '' or v_model_outcome not in ('ACTION','ANSWER_ONLY','NEEDS_CLARIFICATION') then
    v_outcome := 'NEEDS_CLARIFICATION'; v_reply := 'Je n''ai pas réussi à interpréter votre demande de façon fiable. Reformulez, s''il vous plaît.';
  elsif v_model_outcome = 'ANSWER_ONLY' then
    v_outcome := 'ANSWER_ONLY'; v_reply := coalesce(nullif(v_reason,''), 'Je peux qualifier un chantier ou lancer un diagnostic. Décrivez votre besoin.');
  elsif v_model_outcome = 'NEEDS_CLARIFICATION' or v_action_key is null then
    v_outcome := 'NEEDS_CLARIFICATION'; v_reply := coalesce(nullif(v_reason,''), 'Pouvez-vous préciser votre demande (nom du chantier, action souhaitée) ?');
  else
    select * into v_cat from hermes_os.agent_action_catalog where action_key = v_action_key and enabled = true and nl_enabled = true;
    if not found then
      v_outcome := 'NEEDS_CLARIFICATION'; v_reply := 'Cette demande ne correspond à aucune action disponible.';
    elsif v_confidence < v_conf_min then
      v_outcome := 'NEEDS_CLARIFICATION'; v_reply := 'Je ne suis pas assez sûr de votre demande. Pouvez-vous préciser ?';
    else
      v_missing := '{}'::text[];
      foreach v_slot in array v_cat.required_payload_keys loop
        if not (v_params ? v_slot) or length(coalesce(v_params->>v_slot,'')) = 0 then v_missing := array_append(v_missing, v_slot); end if;
      end loop;
      if array_length(v_missing,1) is not null then
        v_outcome := 'NEEDS_CLARIFICATION'; v_reply := 'Pour « '||v_cat.display_name||' », précisez : '||array_to_string(v_missing, ', ')||'.';
      else
        v_req_id := coalesce(nullif(trim(coalesce(p_request_id,'')),''), p_conversation_id::text||':apply:'||v_row.request_id);
        v_gw := hermes_os.request_agent_action(v_action_key, v_params, v_req_id); v_gw_status := v_gw->>'status';
        if coalesce((v_gw->>'ok')::boolean,false) and v_gw_status = 'QUEUED' then
          v_outcome := 'ACTION'; v_correlation := nullif(v_gw->>'correlation_id','')::uuid; v_reply := 'Action lancée : '||v_cat.display_name||'. Suivi en cours.';
        elsif coalesce((v_gw->>'ok')::boolean,false) and coalesce(v_gw->>'replay','false')='true' then
          v_outcome := 'ACTION'; v_correlation := nullif(v_gw->>'correlation_id','')::uuid; v_reply := 'Action déjà enregistrée : '||v_cat.display_name||'. Suivi en cours.';
        else
          v_outcome := 'ERROR'; v_gw_status := coalesce(v_gw_status,'RPC_ERROR'); v_reply := coalesce(v_gw#>>'{error,message}','Action refusée par la passerelle de sécurité.');
        end if;
      end if;
    end if;
  end if;

  insert into hermes_os.hermes_messages(conversation_id,tenant_id,user_id,role,content,outcome,action_key,request_id,correlation_id,confidence,metadata)
  values (p_conversation_id, v_tenant, v_uid, 'assistant', v_reply, v_outcome,
          case when v_outcome='ACTION' then v_action_key else null end, v_req_id, v_correlation,
          case when v_confidence is null then null else round(v_confidence,2)::text end,
          jsonb_build_object('path','semantic','model_outcome',v_model_outcome,'proposed_action', v_action_key,'telemetry', v_proposal->'telemetry'))
  returning id into v_asst_msg;

  return jsonb_build_object('ok', (v_outcome <> 'ERROR'),'outcome', v_outcome,'conversation_id', p_conversation_id,
    'assistant_message_id', v_asst_msg,'reply', v_reply,
    'action_key', case when v_outcome='ACTION' then v_action_key else null end,'request_id', v_req_id,'correlation_id', v_correlation,
    'confidence', round(coalesce(v_confidence,0),2),'status', coalesce(v_gw_status, v_outcome),
    'error', case when v_outcome='ERROR' then jsonb_build_object('code',coalesce(v_gw_status,'ERROR'),'message',v_reply) else null end);
end;
$function$;

create or replace function public.apply_hermes_resolution(
  p_conversation_id uuid, p_resolve_request_id text, p_request_id text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_catalog','pg_temp'
as $function$
begin
  return hermes_os.apply_hermes_resolution(p_conversation_id, p_resolve_request_id, p_request_id);
end;
$function$;

revoke all on function public.apply_hermes_resolution(uuid,text,text) from public;
grant execute on function public.apply_hermes_resolution(uuid,text,text) to authenticated;
revoke all on function hermes_os.apply_hermes_resolution(uuid,text,text) from public;
