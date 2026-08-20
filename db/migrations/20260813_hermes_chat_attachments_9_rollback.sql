-- Rollback: hermes_chat_attachments (project smubxqorirlfldatzmym)
-- Removes the Phase B attachment facades, storage policies + helper, and the
-- link table. The private bucket itself is NOT removed here — see below.
--
-- ⚠️ CORRECTIF PV-3 (2026-08-20). Ce fichier contenait
-- `delete from storage.buckets where id = 'hermes-chat-attachments';`.
-- MESURÉ sur ce projet, Postgres REFUSE toute suppression directe dans les
-- tables `storage.*` :
--     ERROR 42501: Direct deletion from storage tables is not allowed.
--                  Use the Storage API instead.
--     CONTEXT: PL/pgSQL function storage.protect_delete()
-- Cette instruction faisait donc ÉCHOUER L'INTÉGRALITÉ de ce rollback. Elle est
-- retirée — même défaut, même correctif que pour le rollback du lot photo.
--
-- PROCÉDURE CORRECTE pour retirer le bucket, APRÈS ce rollback :
--     supabase storage rm --recursive ss:///hermes-chat-attachments
--     puis suppression du bucket depuis le dashboard Supabase (API Storage)
--
-- Après ce rollback SQL, le bucket subsiste mais PRIVÉ et sans aucune policy :
-- inerte, pas dangereux.
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

-- Le bucket N'EST PAS supprimé ici — voir l'en-tête (correctif PV-3).
-- Ses policies viennent d'être retirées : il devient inerte.

commit;
