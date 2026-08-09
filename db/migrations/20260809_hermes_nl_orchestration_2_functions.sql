-- Migration: hermes_nl_orchestration_functions  (applied to project smubxqorirlfldatzmym)
-- Canonical contract: free text -> intent/capability resolution -> canonical
-- action -> DELEGATE to the existing gateway (request_agent_action), which
-- enforces auth/tenant/permission/idempotency; SW15 stays with the poller's
-- gateway_policy_gate. The orchestrator NEVER executes actions itself and is
-- NEVER the authorization authority.

-- Deterministic slot extractor.
create or replace function hermes_os._nl_extract_slot(p_message text, p_keywords text[])
returns text
language plpgsql
immutable
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_low  text := lower(coalesce(p_message,''));
  kw     text;
  pos    int;
  endpos int;
  best   int := -1;
  v_rest text;
  v_out  text;
begin
  if p_keywords is null then return null; end if;
  foreach kw in array p_keywords loop
    if kw is null or kw = '' then continue; end if;
    pos := position(lower(kw) in v_low);
    if pos > 0 then
      endpos := pos + length(kw) - 1;
      if endpos > best then best := endpos; end if;
    end if;
  end loop;
  if best < 0 then return null; end if;

  v_rest := substr(p_message, best + 1);
  v_rest := regexp_replace(v_rest, '^[[:space:]:,\.\-]+', '', '');
  v_rest := regexp_replace(v_rest,
    '^(le|la|les|du|de|des|un|une|nomm[eé]+|appel[eé]+|intitul[eé]+)[[:space:]:,\-]+',
    '', 'i');
  v_out := trim(regexp_replace(v_rest, '[[:space:]]+', ' ', 'g'));
  if length(v_out) = 0 then return null; end if;
  return left(v_out, 200);
end;
$function$;

-- Main orchestrator.
create or replace function hermes_os.orchestrate_hermes_message(
  p_message text,
  p_conversation_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_tenant    text;
  v_status    text;
  v_msg       text := coalesce(p_message,'');
  v_low       text;
  v_conv_id   uuid;
  v_user_msg  uuid;
  v_asst_msg  uuid;
  v_cat       hermes_os.agent_action_catalog%rowtype;
  v_matches   int := 0;
  v_candidates text[] := '{}'::text[];
  v_slot      text;
  v_name      text;
  v_payload   jsonb := '{}'::jsonb;
  v_missing   text[] := '{}'::text[];
  v_reply     text;
  v_outcome   text;
  v_confidence text;
  v_action_key text;
  v_req_id    text;
  v_correlation uuid;
  v_gw        jsonb;
  v_gw_status text;
  v_help      boolean := false;
  rec         record;
begin
  -- 1) Authentication (fail closed).
  if v_uid is null then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','UNAUTHENTICATED',
      'reply','Session expirée. Reconnectez-vous.',
      'error',jsonb_build_object('code','UNAUTHENTICATED','message','Not authenticated.'));
  end if;

  -- 2) Tenant resolution — server-side only; never client-supplied.
  select r.tenant_id, r.resolution_status into v_tenant, v_status
  from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'outcome','ERROR','status',v_status,
      'reply','Aucun tenant actif n''a pu être résolu.',
      'error',jsonb_build_object('code',v_status,'message','Tenant not resolved.'));
  end if;

  -- 3) Message validation (fail closed, bounded size).
  if length(trim(v_msg)) = 0 then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','VALIDATION_FAILED',
      'reply','Saisissez un message.',
      'error',jsonb_build_object('code','EMPTY_MESSAGE','message','Message is required.'));
  end if;
  if length(v_msg) > 4000 then
    return jsonb_build_object('ok',false,'outcome','ERROR','status','VALIDATION_FAILED',
      'reply','Message trop long (max 4000 caractères).',
      'error',jsonb_build_object('code','MESSAGE_TOO_LONG','message','Message too long.'));
  end if;
  v_low := lower(v_msg);

  -- 4) Resolve or create the conversation (strictly tenant + user scoped).
  if p_conversation_id is not null then
    select id into v_conv_id from hermes_os.hermes_conversations
    where id = p_conversation_id and tenant_id = v_tenant and user_id = v_uid;
    if v_conv_id is null then
      return jsonb_build_object('ok',false,'outcome','ERROR','status','NOT_FOUND',
        'reply','Conversation introuvable.',
        'error',jsonb_build_object('code','CONVERSATION_NOT_FOUND',
          'message','Conversation not found for this user/tenant.'));
    end if;
  else
    insert into hermes_os.hermes_conversations(tenant_id,user_id,title)
    values (v_tenant, v_uid, left(trim(v_msg),80))
    returning id into v_conv_id;
  end if;

  insert into hermes_os.hermes_messages(conversation_id,tenant_id,user_id,role,content)
  values (v_conv_id, v_tenant, v_uid, 'user', v_msg)
  returning id into v_user_msg;

  -- 5) Deterministic intent resolution against the capability registry.
  for rec in
    select * from hermes_os.agent_action_catalog c
    where c.enabled = true and c.nl_enabled = true
  loop
    if exists (
      select 1 from unnest(rec.nl_keywords) kw
      where kw <> '' and position(lower(kw) in v_low) > 0
    ) then
      v_matches := v_matches + 1;
      v_candidates := array_append(v_candidates, rec.action_key);
      v_cat := rec;
    end if;
  end loop;

  if v_low ~ '(aide|help|que (peux|pouvez)|capacit|quelles? actions|que sais-tu|liste des actions)' then
    v_help := true;
  end if;

  -- 6) Decide the canonical outcome. Never guess/execute on ambiguity/no-match.
  if v_matches = 1 then
    v_action_key := v_cat.action_key;

    if v_cat.nl_primary_slot is not null then
      v_name := hermes_os._nl_extract_slot(v_msg, v_cat.nl_keywords);
      if v_name is not null and length(v_name) > 0 then
        v_payload := jsonb_build_object(v_cat.nl_primary_slot, v_name);
      end if;
    end if;

    v_missing := '{}'::text[];
    foreach v_slot in array v_cat.required_payload_keys loop
      if not (v_payload ? v_slot) then
        v_missing := array_append(v_missing, v_slot);
      end if;
    end loop;

    if array_length(v_missing,1) is not null then
      v_outcome := 'NEEDS_CLARIFICATION';
      v_confidence := 'MEDIUM';
      v_reply := 'Pour « '||v_cat.display_name||' », précisez : '||array_to_string(v_missing, ', ')||'.';
    else
      v_req_id := coalesce(nullif(trim(coalesce(p_request_id,'')),''),
                           v_conv_id::text||':'||v_user_msg::text);
      v_gw := hermes_os.request_agent_action(v_action_key, v_payload, v_req_id);
      v_gw_status := v_gw->>'status';

      if coalesce((v_gw->>'ok')::boolean,false) and v_gw_status = 'QUEUED' then
        v_outcome := 'ACTION';
        v_confidence := 'HIGH';
        v_correlation := nullif(v_gw->>'correlation_id','')::uuid;
        v_reply := 'Action lancée : '||v_cat.display_name||'. Suivi en cours.';
      elsif coalesce((v_gw->>'ok')::boolean,false) and coalesce(v_gw->>'replay','false') = 'true' then
        v_outcome := 'ACTION';
        v_confidence := 'HIGH';
        v_correlation := nullif(v_gw->>'correlation_id','')::uuid;
        v_reply := 'Action déjà enregistrée : '||v_cat.display_name||'. Suivi en cours.';
      else
        v_outcome := 'ERROR';
        v_confidence := 'HIGH';
        v_gw_status := coalesce(v_gw_status,'RPC_ERROR');
        v_reply := coalesce(v_gw#>>'{error,message}',
                            'Action refusée par la passerelle de sécurité.');
      end if;
    end if;

  elsif v_matches > 1 then
    v_outcome := 'NEEDS_CLARIFICATION';
    v_confidence := 'LOW';
    v_reply := 'Votre demande peut correspondre à plusieurs actions. Précisez : '||
      coalesce((select string_agg(c.display_name, ' ; ' order by c.display_name)
                  from hermes_os.agent_action_catalog c
                  where c.action_key = any(v_candidates)),'')||'.';
  else
    if v_help then
      v_outcome := 'ANSWER_ONLY';
      v_confidence := 'HIGH';
      v_reply := 'Voici les actions que je peux exécuter : '||
        coalesce((select string_agg(c.display_name||' — '||coalesce(c.description,''), E'\n' order by c.display_name)
                    from hermes_os.agent_action_catalog c
                    where c.enabled = true and c.nl_enabled = true),
                 'aucune pour le moment')||
        E'\n\nDécrivez votre demande en langage naturel.';
    else
      v_outcome := 'NEEDS_CLARIFICATION';
      v_confidence := 'NONE';
      v_reply := 'Je n''ai pas compris cette demande. Actions disponibles : '||
        coalesce((select string_agg(c.display_name, ' ; ' order by c.display_name)
                    from hermes_os.agent_action_catalog c
                    where c.enabled = true and c.nl_enabled = true),
                 'aucune')||'.';
    end if;
  end if;

  -- 7) Persist the assistant message (canonical outcome, audit trail).
  insert into hermes_os.hermes_messages(
    conversation_id,tenant_id,user_id,role,content,outcome,action_key,request_id,correlation_id,confidence,metadata)
  values (v_conv_id, v_tenant, v_uid, 'assistant', v_reply, v_outcome, v_action_key, v_req_id, v_correlation, v_confidence,
          jsonb_build_object('match_count', v_matches,
                             'candidates', to_jsonb(v_candidates),
                             'gateway_status', v_gw_status))
  returning id into v_asst_msg;

  update hermes_os.hermes_conversations
     set last_message_at = now(), updated_at = now()
   where id = v_conv_id;

  -- 8) Canonical response envelope.
  return jsonb_build_object(
    'ok', (v_outcome <> 'ERROR'),
    'outcome', v_outcome,
    'conversation_id', v_conv_id,
    'user_message_id', v_user_msg,
    'assistant_message_id', v_asst_msg,
    'reply', v_reply,
    'action_key', v_action_key,
    'request_id', v_req_id,
    'correlation_id', v_correlation,
    'confidence', v_confidence,
    'missing', case when array_length(v_missing,1) is not null then to_jsonb(v_missing) else null end,
    'candidates', case when v_matches > 1 then to_jsonb(v_candidates) else null end,
    'status', coalesce(v_gw_status, v_outcome),
    'error', case when v_outcome = 'ERROR'
                  then jsonb_build_object('code', coalesce(v_gw_status,'ERROR'), 'message', v_reply)
                  else null end
  );
end;
$function$;

-- Read a conversation (tenant + user scoped). Fail closed on foreign conversations.
create or replace function hermes_os.get_hermes_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text;
  v_exists boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok',false,'status','UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
  from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok',false,'status',v_status);
  end if;

  select exists(
    select 1 from hermes_os.hermes_conversations
    where id = p_conversation_id and tenant_id = v_tenant and user_id = v_uid
  ) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok',false,'status','NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'OK',
    'conversation_id', p_conversation_id,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'role', m.role, 'content', m.content,
        'outcome', m.outcome, 'action_key', m.action_key,
        'request_id', m.request_id, 'confidence', m.confidence,
        'created_at', m.created_at
      ) order by m.created_at)
      from hermes_os.hermes_messages m
      where m.conversation_id = p_conversation_id and m.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
end;
$function$;
