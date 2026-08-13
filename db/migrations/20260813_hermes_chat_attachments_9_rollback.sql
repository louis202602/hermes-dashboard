-- Rollback: hermes_chat_attachments (project smubxqorirlfldatzmym)
-- Removes the Phase B attachment facades, storage policies + helper, the link
-- table, and the private bucket. Storage OBJECTS in the bucket (if any) must be
-- emptied first — dropping a non-empty bucket errors — so this is safe to run
-- only after the bucket has been cleared out-of-band.
begin;

drop function if exists public.mark_hermes_attachment_deleted(uuid);
drop function if exists public.list_orphan_hermes_attachments(int, int);
drop function if exists public.get_hermes_message_attachments(uuid);
drop function if exists public.link_hermes_attachments(uuid, uuid, uuid[]);
drop function if exists public.finalize_hermes_attachment(uuid, text, text, text, text, text, bigint, text);

drop table if exists hermes_os.hermes_message_attachments;

drop policy if exists "hermes_attach_delete_own" on storage.objects;
drop policy if exists "hermes_attach_select_own" on storage.objects;
drop policy if exists "hermes_attach_insert_own" on storage.objects;

drop function if exists hermes_os.is_active_tenant_member(text);

delete from storage.buckets where id = 'hermes-chat-attachments';

commit;
