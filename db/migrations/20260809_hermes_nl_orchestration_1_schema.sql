-- Migration: hermes_nl_orchestration_schema  (applied to project smubxqorirlfldatzmym)
-- Hermès Natural Language Orchestration — schema.
-- Reuses the existing Agent Action Gateway & capability registry.
-- Adds: (a) NL routing metadata on the capability registry (source of truth),
--       (b) conversation/message persistence (audit trail).
-- Idempotent & reversible (see 20260809_hermes_nl_orchestration_9_rollback.sql).

-- (a) NL routing metadata on the capability registry.
alter table hermes_os.agent_action_catalog
  add column if not exists nl_enabled boolean not null default false;
alter table hermes_os.agent_action_catalog
  add column if not exists nl_keywords text[] not null default '{}'::text[];
alter table hermes_os.agent_action_catalog
  add column if not exists nl_primary_slot text;
alter table hermes_os.agent_action_catalog
  add column if not exists nl_help_text text;

comment on column hermes_os.agent_action_catalog.nl_enabled is
  'Whether this allowlisted action is reachable through natural-language orchestration.';
comment on column hermes_os.agent_action_catalog.nl_keywords is
  'Lowercased trigger substrings used by the deterministic intent resolver.';
comment on column hermes_os.agent_action_catalog.nl_primary_slot is
  'Payload key filled from free-text extraction (nullable).';

-- Seed NL metadata for the two existing, allowlisted actions.
-- NOTE: "test" is intentionally NOT a diag keyword — it collides with common
-- chantier names (e.g. "Natural Language Test") and would create false ambiguity.
update hermes_os.agent_action_catalog
   set nl_enabled = true,
       nl_keywords = array['qualifie','qualifier','qualification','chantier'],
       nl_primary_slot = 'chantier_name'
 where action_key = 'btp.qualification.create';

update hermes_os.agent_action_catalog
   set nl_enabled = true,
       nl_keywords = array['diagnostic','diag','echo','ping'],
       nl_primary_slot = null
 where action_key = 'diag.echo';

-- (b) Conversation persistence. hermes_os is NOT exposed via PostgREST; all
-- access flows through SECURITY DEFINER RPCs. RLS is enabled deny-by-default
-- (no policies, no grants to authenticated) — defense in depth.
create table if not exists hermes_os.hermes_conversations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null,
  user_id         uuid not null,
  title           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_hermes_conversations_tenant_user
  on hermes_os.hermes_conversations (tenant_id, user_id, last_message_at desc);

create table if not exists hermes_os.hermes_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references hermes_os.hermes_conversations(id) on delete cascade,
  tenant_id       text not null,
  user_id         uuid not null,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  outcome         text check (outcome in ('ANSWER_ONLY','ACTION','NEEDS_CLARIFICATION','PENDING_APPROVAL','ERROR')),
  action_key      text,
  request_id      text,
  correlation_id  uuid,
  confidence      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_hermes_messages_conversation
  on hermes_os.hermes_messages (conversation_id, created_at);

alter table hermes_os.hermes_conversations enable row level security;
alter table hermes_os.hermes_messages      enable row level security;
-- No policies & no grants to app roles: only SECURITY DEFINER RPCs may touch them.
