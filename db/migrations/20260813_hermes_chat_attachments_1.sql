-- Migration: hermes_chat_attachments (project smubxqorirlfldatzmym)
-- Phase B — REAL transmission of Hermès composer attachments.
--
-- Scope (operator-decided): the composer "+" really uploads files to a PRIVATE
-- Storage bucket, isolated per tenant AND per user, with fail-closed server-side
-- validation (done in the Server Action). This migration provisions:
--   1. a PRIVATE bucket `hermes-chat-attachments` (never public),
--   2. strict `storage.objects` RLS scoped to `<tenant>/<user>/…` — a user can
--      only touch objects under their own tenant+user prefix, cross-tenant and
--      cross-user access is DENIED, unauthenticated is DENIED,
--   3. the link table `hermes_os.hermes_message_attachments` (facade-only,
--      RLS deny-all for ordinary roles — mirrors hermes_os.tenants),
--   4. SECURITY DEFINER facades: finalize (record after upload), link (attach
--      to a persisted message the caller owns), read (owner-scoped), plus a
--      bounded, CALLABLE orphan helper (no auto worker / no schedule).
--
-- Honesty boundary: NO LLM / no content understanding here (that is Phase C,
-- forbidden). The orchestrator (`orchestrate_hermes_message`) is NOT modified;
-- linking is a separate post-message step.
--
-- Multi-tenant safety: the active tenant is ALWAYS resolved server-side
-- (`hermes_os.resolve_active_tenant` / `auth.uid()`); a client-supplied
-- tenant_id or storage path is never trusted — RLS re-derives both from the
-- object key and the JWT.
--
-- Reversible: 20260813_hermes_chat_attachments_9_rollback.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. PRIVATE bucket. `public=false` ⇒ objects are only reachable via a
--    short-TTL signed URL minted server-side (never getPublicUrl). Coarse
--    secondary guards (size ceiling + declared-mime allowlist) back up the
--    authoritative app-level magic-byte validation.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hermes-chat-attachments',
  'hermes-chat-attachments',
  false,
  26214400, -- 25 MiB hard ceiling (per-category caps enforced in the app)
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'audio/mpeg', 'audio/wav', 'audio/mp4'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tenant-membership helper for the storage policies. SECURITY DEFINER so a
--    plain authenticated role can evaluate membership without direct table
--    grants — mirrors the pattern of `hermes_os.resolve_active_tenant`.
--    Returns true only when the CURRENT user is a `tenant.member` of p_tenant.
-- ---------------------------------------------------------------------------
create or replace function hermes_os.is_active_tenant_member(p_tenant text)
returns boolean
language sql
stable
security definer
set search_path to 'hermes_os', 'pg_temp'
as $function$
  select exists (
    select 1
    from hermes_os.user_tenant_permissions p
    where p.user_id = auth.uid()
      and p.tenant_id = p_tenant
      and p.permission = 'tenant.member'
  );
$function$;

revoke all on function hermes_os.is_active_tenant_member(text) from public;
grant execute on function hermes_os.is_active_tenant_member(text) to authenticated;

-- ---------------------------------------------------------------------------
--    storage.objects RLS — restricted to THIS bucket only. Object key layout
--    is `<tenant_id>/<user_id>/<attachment_id>/<safe_filename>` so:
--      foldername[1] = tenant_id  → must be a tenant the caller belongs to
--      foldername[2] = user_id    → must equal auth.uid()
--    Both are re-derived from the key here; the client cannot widen its scope
--    by supplying a different path. Only authenticated may match; anon is
--    denied by the `to authenticated` clause (+ auth.uid() null).
-- ---------------------------------------------------------------------------
create policy "hermes_attach_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hermes-chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_attach_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hermes-chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

create policy "hermes_attach_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'hermes-chat-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and hermes_os.is_active_tenant_member((storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 3. Link table. One row per uploaded object; `message_id` is filled by the
--    post-message link step (nullable until then → status UPLOADED_PENDING_LINK).
--    RLS is enabled with NO policy ⇒ deny-all for ordinary roles: the table is
--    reached ONLY through the SECURITY DEFINER facades below (hermes_os is not
--    PostgREST-exposed). storage_path is the single source of truth for reads;
--    no public URL is ever persisted.
-- ---------------------------------------------------------------------------
create table if not exists hermes_os.hermes_message_attachments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null,
  user_id           uuid not null,
  conversation_id   uuid references hermes_os.hermes_conversations(id) on delete cascade,
  message_id        uuid references hermes_os.hermes_messages(id) on delete cascade,
  storage_bucket    text not null default 'hermes-chat-attachments',
  storage_path      text not null unique,
  original_filename text not null,
  safe_filename     text not null,
  mime_type         text not null,
  category          text not null check (category in ('image', 'document', 'audio')),
  size_bytes        bigint not null check (size_bytes > 0),
  checksum_sha256   text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status            text not null default 'UPLOADED_PENDING_LINK'
                      check (status in ('UPLOADED_PENDING_LINK', 'LINKED', 'DELETED')),
  created_at        timestamptz not null default now(),
  linked_at         timestamptz
);

alter table hermes_os.hermes_message_attachments enable row level security;

create index if not exists hermes_msg_attach_by_message
  on hermes_os.hermes_message_attachments (message_id);
create index if not exists hermes_msg_attach_orphans
  on hermes_os.hermes_message_attachments (tenant_id, status, created_at);

-- ---------------------------------------------------------------------------
-- 4a. finalize — record metadata AFTER the object was uploaded under RLS. The
--     tenant + user are re-derived server-side and the supplied storage_path is
--     re-validated to start with `<tenant>/<uid>/` (defence in depth even though
--     the Server Action builds it). Category/size/checksum are re-checked so a
--     forged client call cannot record an inconsistent row. Idempotent on id.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_hermes_attachment(
  p_attachment_id   uuid,
  p_storage_path    text,
  p_original_filename text,
  p_safe_filename   text,
  p_mime_type       text,
  p_category        text,
  p_size_bytes      bigint,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_tenant  text;
  v_status  text;
  v_prefix  text;
  v_cap     bigint;
  v_existing hermes_os.hermes_message_attachments%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', 'TENANT_' || coalesce(v_status, 'UNKNOWN'));
  end if;

  -- Idempotency: a repeated finalize for the same id returns the stored row.
  select * into v_existing
    from hermes_os.hermes_message_attachments where id = p_attachment_id;
  if found then
    if v_existing.tenant_id is distinct from v_tenant or v_existing.user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    return jsonb_build_object('ok', true, 'attachment_id', v_existing.id,
      'status', v_existing.status, 'idempotent', true);
  end if;

  -- The object key MUST live under this caller's own tenant+user prefix.
  v_prefix := v_tenant || '/' || v_uid::text || '/';
  if p_storage_path is null or left(p_storage_path, length(v_prefix)) is distinct from v_prefix then
    return jsonb_build_object('ok', false, 'code', 'PATH_OUT_OF_SCOPE');
  end if;

  if p_category not in ('image', 'document', 'audio') then
    return jsonb_build_object('ok', false, 'code', 'BAD_CATEGORY');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_FILE');
  end if;
  v_cap := case p_category
    when 'image' then 10485760      -- 10 MiB
    when 'document' then 20971520   -- 20 MiB
    when 'audio' then 26214400      -- 25 MiB
  end;
  if p_size_bytes > v_cap then
    return jsonb_build_object('ok', false, 'code', 'TOO_LARGE');
  end if;
  if p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'BAD_CHECKSUM');
  end if;

  insert into hermes_os.hermes_message_attachments (
    id, tenant_id, user_id, storage_path, original_filename, safe_filename,
    mime_type, category, size_bytes, checksum_sha256, status)
  values (
    p_attachment_id, v_tenant, v_uid, p_storage_path,
    left(coalesce(p_original_filename, p_safe_filename), 512),
    left(coalesce(p_safe_filename, 'file'), 512),
    p_mime_type, p_category, p_size_bytes, p_checksum_sha256, 'UPLOADED_PENDING_LINK');

  return jsonb_build_object('ok', true, 'attachment_id', p_attachment_id,
    'status', 'UPLOADED_PENDING_LINK', 'idempotent', false);
end;
$function$;

revoke all on function public.finalize_hermes_attachment(uuid, text, text, text, text, text, bigint, text) from public;
grant execute on function public.finalize_hermes_attachment(uuid, text, text, text, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. link — attach uploaded objects to a persisted message the caller OWNS.
--     The message must belong to the caller's tenant + user AND to the given
--     conversation. Only the caller's own PENDING rows are moved to LINKED. The
--     honest return exposes requested vs linked counts so the UI never shows a
--     false "sent" when a link partially fails.
-- ---------------------------------------------------------------------------
create or replace function public.link_hermes_attachments(
  p_conversation_id uuid,
  p_message_id      uuid,
  p_attachment_ids  uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_tenant  text;
  v_status  text;
  v_owns    boolean;
  v_requested int := coalesce(array_length(p_attachment_ids, 1), 0);
  v_linked  int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'linked', 0, 'requested', v_requested);
  end if;

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', 'TENANT_' || coalesce(v_status, 'UNKNOWN'),
      'linked', 0, 'requested', v_requested);
  end if;

  if v_requested = 0 then
    return jsonb_build_object('ok', true, 'linked', 0, 'requested', 0);
  end if;

  -- Ownership check: the target message must be the caller's, in this tenant
  -- and conversation. Fail closed otherwise (never link to someone else's turn).
  select exists (
    select 1 from hermes_os.hermes_messages m
    where m.id = p_message_id
      and m.tenant_id = v_tenant
      and m.user_id = v_uid
      and m.conversation_id = p_conversation_id
  ) into v_owns;
  if not v_owns then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_OWNED', 'linked', 0, 'requested', v_requested);
  end if;

  with upd as (
    update hermes_os.hermes_message_attachments a
       set message_id = p_message_id,
           conversation_id = p_conversation_id,
           status = 'LINKED',
           linked_at = now()
     where a.id = any(p_attachment_ids)
       and a.tenant_id = v_tenant
       and a.user_id = v_uid
       and a.status = 'UPLOADED_PENDING_LINK'
     returning 1)
  select count(*) into v_linked from upd;

  return jsonb_build_object(
    'ok', v_linked = v_requested,
    'code', case when v_linked = v_requested then 'OK' else 'PARTIAL_LINK' end,
    'linked', v_linked, 'requested', v_requested);
end;
$function$;

revoke all on function public.link_hermes_attachments(uuid, uuid, uuid[]) from public;
grant execute on function public.link_hermes_attachments(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4c. read — the caller's OWN attachments for one of their messages. Returns
--     storage_path (owner-scoped) so the Server Action can mint a short-TTL
--     signed URL; no public URL is ever produced. Non-identifying to other
--     tenants/users by construction (tenant + user filter).
-- ---------------------------------------------------------------------------
create or replace function public.get_hermes_message_attachments(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant text;
  v_status text;
  v_items  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'attachments', '[]'::jsonb);
  end if;

  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', 'TENANT_' || coalesce(v_status, 'UNKNOWN'),
      'attachments', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'original_filename', a.original_filename,
           'mime_type', a.mime_type,
           'category', a.category,
           'size_bytes', a.size_bytes,
           'storage_path', a.storage_path,
           'status', a.status,
           'created_at', a.created_at
         ) order by a.created_at), '[]'::jsonb)
    into v_items
    from hermes_os.hermes_message_attachments a
   where a.message_id = p_message_id
     and a.tenant_id = v_tenant
     and a.user_id = v_uid
     and a.status = 'LINKED';

  return jsonb_build_object('ok', true, 'attachments', v_items);
end;
$function$;

revoke all on function public.get_hermes_message_attachments(uuid) from public;
grant execute on function public.get_hermes_message_attachments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4d. orphan helpers — CALLABLE, bounded, NO auto worker / NO schedule. Rows
--     stuck in UPLOADED_PENDING_LINK past a TTL (default 60 min) are surfaced
--     for out-of-band cleanup; the caller removes the object via the Storage
--     API (under RLS) then marks the row DELETED. Both are strictly scoped to
--     the caller's tenant + user.
-- ---------------------------------------------------------------------------
create or replace function public.list_orphan_hermes_attachments(
  p_older_than_minutes int default 60,
  p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant text;
  v_status text;
  v_ttl    int := greatest(coalesce(p_older_than_minutes, 60), 1);
  v_lim    int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_items  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED', 'orphans', '[]'::jsonb);
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', 'TENANT_' || coalesce(v_status, 'UNKNOWN'),
      'orphans', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'storage_path', a.storage_path, 'created_at', a.created_at
         ) order by a.created_at), '[]'::jsonb)
    into v_items
    from (
      select a.* from hermes_os.hermes_message_attachments a
       where a.tenant_id = v_tenant
         and a.user_id = v_uid
         and a.status = 'UPLOADED_PENDING_LINK'
         and a.created_at < now() - make_interval(mins => v_ttl)
       order by a.created_at
       limit v_lim
    ) a;

  return jsonb_build_object('ok', true, 'orphans', v_items);
end;
$function$;

revoke all on function public.list_orphan_hermes_attachments(int, int) from public;
grant execute on function public.list_orphan_hermes_attachments(int, int) to authenticated;

create or replace function public.mark_hermes_attachment_deleted(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_tenant text;
  v_status text;
  v_hit    int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  select r.tenant_id, r.resolution_status into v_tenant, v_status
    from hermes_os.resolve_active_tenant(null) r;
  if v_status is distinct from 'OK' then
    return jsonb_build_object('ok', false, 'code', 'TENANT_' || coalesce(v_status, 'UNKNOWN'));
  end if;

  with upd as (
    update hermes_os.hermes_message_attachments a
       set status = 'DELETED'
     where a.id = p_attachment_id
       and a.tenant_id = v_tenant
       and a.user_id = v_uid
       and a.status = 'UPLOADED_PENDING_LINK'
     returning 1)
  select count(*) into v_hit from upd;

  return jsonb_build_object('ok', v_hit = 1, 'code', case when v_hit = 1 then 'OK' else 'NOT_FOUND' end);
end;
$function$;

revoke all on function public.mark_hermes_attachment_deleted(uuid) from public;
grant execute on function public.mark_hermes_attachment_deleted(uuid) to authenticated;

commit;
