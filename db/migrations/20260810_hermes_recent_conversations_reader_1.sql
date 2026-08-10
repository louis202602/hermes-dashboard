-- Migration: hermes_recent_conversations_reader (project smubxqorirlfldatzmym)
-- =====================================================================
-- Read-only, tenant/user-scoped reader for the dashboard "Conversations
-- récentes" panel — wires that previously-mock panel to REAL data
-- (hermes_conversations / hermes_messages, written by the orchestrator).
--
-- Returns ONLY the caller's own conversations (user_id = auth.uid()) on their
-- resolved tenant, with a short preview of the latest assistant reply and its
-- business outcome. Fail-closed: unauthenticated / no-tenant / cross-tenant all
-- return an empty list with a resolution_status. No internal ids (request /
-- correlation / workflow) or secrets are exposed — only the user's own
-- conversation id, title, preview, outcome and timestamp. Granted to
-- `authenticated` only (mirrors the other dashboard readers); not reachable by
-- `anon` / `service_role`. Reversible.
-- =====================================================================

create or replace function public.get_recent_hermes_conversations(p_limit integer default 6)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os','pg_catalog','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tenant text; v_status text; v_convs jsonb; v_limit int;
begin
  v_limit := least(greatest(coalesce(p_limit, 6), 1), 20);

  if v_uid is null then
    return jsonb_build_object('resolution_status', 'UNAUTHENTICATED', 'tenant_id', null, 'conversations', '[]'::jsonb);
  end if;

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('resolution_status', v_status, 'tenant_id', null, 'conversations', '[]'::jsonb);
  end if;

  with convs as (
    select c.id, c.title, coalesce(c.last_message_at, c.created_at) as ts
    from hermes_os.hermes_conversations c
    where c.user_id = v_uid and c.tenant_id = v_tenant
    order by coalesce(c.last_message_at, c.created_at) desc
    limit v_limit
  ),
  enriched as (
    select cv.id, cv.title, cv.ts,
      (select m.content from hermes_os.hermes_messages m
        where m.conversation_id = cv.id and m.role = 'assistant'
        order by m.created_at desc limit 1) as assistant_preview,
      (select m.content from hermes_os.hermes_messages m
        where m.conversation_id = cv.id
        order by m.created_at desc limit 1) as last_preview,
      (select m.outcome from hermes_os.hermes_messages m
        where m.conversation_id = cv.id and m.role = 'assistant'
        order by m.created_at desc limit 1) as last_outcome
    from convs cv
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'title', coalesce(nullif(trim(e.title), ''), 'Conversation'),
      'preview', left(coalesce(e.assistant_preview, e.last_preview, ''), 180),
      'outcome', e.last_outcome,
      'last_message_at', e.ts
    ) order by e.ts desc), '[]'::jsonb)
    into v_convs from enriched e;

  return jsonb_build_object(
    'resolution_status', 'OK',
    'tenant_id', v_tenant,
    'conversations', coalesce(v_convs, '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_recent_hermes_conversations(integer) from public;
grant execute on function public.get_recent_hermes_conversations(integer) to authenticated;
