/**
 * Contracts for the Hermès composer attachment pipeline (Phase B — REAL
 * transmission). Files are validated server-side (fail-closed), stored in a
 * PRIVATE, tenant+user-isolated bucket, recorded in
 * `hermes_os.hermes_message_attachments`, and linked to the persisted user
 * message AFTER orchestration (the orchestrator itself is untouched).
 *
 * Honesty boundary: there is NO content understanding here (no LLM / OCR /
 * transcription — that is Phase C). The UI states below describe *transport*
 * only: a file is LOCAL, UPLOADING, UPLOADED (stored, not yet linked) or FAILED.
 * It is never labelled "sent", "analysed" or "understood".
 */

/** The three supported categories in V1 (video is deferred — rejected honestly). */
export type AttachmentCategory = "image" | "document" | "audio";

/** Transport lifecycle of one composer attachment (client-facing). */
export type AttachmentUploadState = "LOCAL" | "UPLOADING" | "UPLOADED" | "FAILED";

/** Result of uploading + finalising one file via the Server Action. */
export type UploadAttachmentResult =
  | {
      ok: true;
      attachmentId: string;
      category: AttachmentCategory;
      safeName: string;
      sizeBytes: number;
      mimeType: string;
    }
  | { ok: false; code: string; reason: string };

/**
 * Result of linking uploaded attachments to a persisted message. `linked` and
 * `requested` are exposed so the caller NEVER shows a false success on a partial
 * link — `ok` is true only when every requested attachment was linked.
 */
export type LinkAttachmentsResult = {
  ok: boolean;
  code: string;
  linked: number;
  requested: number;
};

/** A stored attachment belonging to one of the caller's messages. */
export type MessageAttachment = {
  id: string;
  originalFilename: string;
  mimeType: string;
  category: AttachmentCategory;
  sizeBytes: number;
  status: "LINKED";
};

/** A stored attachment plus a short-TTL signed URL (minted server-side). */
export type SignedMessageAttachment = MessageAttachment & {
  /** Short-lived signed URL, or null if signing failed (never a public URL). */
  url: string | null;
};
