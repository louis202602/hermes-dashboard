-- Migration: hermes_nl_orchestration_facades_grants  (applied to project smubxqorirlfldatzmym)
-- PostgREST exposes only `public`; hermes_os is reached via thin SECURITY
-- DEFINER wrappers. Grants: authenticated only (fail closed).

create or replace function public.orchestrate_hermes_message(
  p_message text,
  p_conversation_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $function$
begin
  return hermes_os.orchestrate_hermes_message(p_message, p_conversation_id, p_request_id);
end;
$function$;

create or replace function public.get_hermes_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $function$
begin
  return hermes_os.get_hermes_conversation(p_conversation_id);
end;
$function$;

revoke all on function public.orchestrate_hermes_message(text,uuid,text) from public;
grant  execute on function public.orchestrate_hermes_message(text,uuid,text) to authenticated;

revoke all on function public.get_hermes_conversation(uuid) from public;
grant  execute on function public.get_hermes_conversation(uuid) to authenticated;

revoke all on function hermes_os.orchestrate_hermes_message(text,uuid,text) from public;
revoke all on function hermes_os.get_hermes_conversation(uuid) from public;
revoke all on function hermes_os._nl_extract_slot(text,text[]) from public;
