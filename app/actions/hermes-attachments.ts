"use server";

import {
  getHermesMessageAttachments,
  linkHermesAttachments,
  uploadHermesAttachment,
} from "@/services/hermes/attachments";
import type {
  LinkAttachmentsResult,
  SignedMessageAttachment,
  UploadAttachmentResult,
} from "@/types/hermes-attachments";

/**
 * Server Action: upload ONE composer file (multipart/form-data). All security
 * lives server-side — magic-byte validation, tenant/user isolation, private
 * storage, checksum. The browser only sees an honest transport outcome; it can
 * never widen its scope or bypass a rejection. `existingCount` /
 * `existingTotalBytes` let the server enforce the per-message ceilings too.
 */
export async function uploadHermesAttachmentAction(
  formData: FormData,
): Promise<UploadAttachmentResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "NO_FILE", reason: "Aucun fichier reçu." };
  }
  const existingCount = Number(formData.get("existingCount") ?? 0);
  const existingTotalBytes = Number(formData.get("existingTotalBytes") ?? 0);
  return uploadHermesAttachment(file, existingCount, existingTotalBytes);
}

/**
 * Server Action: link uploaded attachments to the persisted user message after
 * orchestration. Returns honest linked/requested counts so the UI never shows a
 * false "transmitted" when a link partially fails.
 */
export async function linkHermesAttachmentsAction(
  conversationId: string,
  messageId: string,
  attachmentIds: string[],
): Promise<LinkAttachmentsResult> {
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter(Boolean) : [];
  return linkHermesAttachments(conversationId, messageId, ids);
}

/**
 * Server Action: the caller's own attachments for one of their messages, each
 * with a short-TTL signed URL (private read — never a public URL).
 */
export async function getHermesMessageAttachmentsAction(
  messageId: string,
): Promise<SignedMessageAttachment[]> {
  return getHermesMessageAttachments(messageId);
}
