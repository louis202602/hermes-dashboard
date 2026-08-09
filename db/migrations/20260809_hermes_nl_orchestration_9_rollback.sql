-- Rollback for the Hermès Natural Language Orchestration migrations.
-- Reverses functions/facades/schema in FK-safe order. Does NOT drop the
-- underlying Agent Action Gateway (request_agent_action, SW15, catalog rows) —
-- those pre-existed and are shared infrastructure.

-- facades + internal functions
drop function if exists public.get_hermes_conversation(uuid);
drop function if exists public.orchestrate_hermes_message(text,uuid,text);
drop function if exists hermes_os.get_hermes_conversation(uuid);
drop function if exists hermes_os.orchestrate_hermes_message(text,uuid,text);
drop function if exists hermes_os._nl_extract_slot(text,text[]);

-- conversation persistence (messages cascade from conversations)
drop table if exists hermes_os.hermes_messages;
drop table if exists hermes_os.hermes_conversations;

-- NL routing metadata on the capability registry
-- (reset the seeded values first so a re-apply starts clean)
update hermes_os.agent_action_catalog
   set nl_enabled = false, nl_keywords = '{}'::text[], nl_primary_slot = null, nl_help_text = null
 where action_key in ('btp.qualification.create','diag.echo');

alter table hermes_os.agent_action_catalog
  drop column if exists nl_help_text,
  drop column if exists nl_primary_slot,
  drop column if exists nl_keywords,
  drop column if exists nl_enabled;
