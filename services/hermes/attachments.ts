import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  checkBatchLimits,
  validateAttachment,
  type FileHead,
} from "@/lib/attachments/serverValidate";
import type {
  AttachmentCategory,
  LinkAttachmentsResult,
  SignedMessageAttachment,
  UploadAttachmentResult,
} from "@/types/hermes-attachments";

/** The PRIVATE bucket (never public; reads are via short-TTL signed URLs). */
export const ATTACHMENT_BUCKET = "hermes-chat-attachments";
/** Bytes read from the head for magic-byte sniffing (enough for every format). */
const HEAD_BYTES = 4096;
/** Signed-URL time-to-live for private reads (seconds). */
const SIGNED_URL_TTL_SECONDS = 60;

function fail(code: string, reason: string): UploadAttachmentResult {
  return { ok: false, code, reason };
}

/**
 * Upload ONE composer file to private storage and record it (pending link).
 *
 * Fail-closed order: validate real head bytes (magic sniff + allowlist + caps)
 * → resolve tenant + user SERVER-SIDE → build a tenant/user-scoped key the
 * client can never widen → upload under storage RLS → finalise metadata (which
 * re-checks path/size/category/checksum). Any failure removes the object (best
 * effort) and returns an honest error — the file is never half-recorded.
 *
 * `existingCount` / `existingTotalBytes` describe the message's current
 * selection so the per-message count/size ceilings are enforced on the server
 * too, not just in the browser.
 */
export async function uploadHermesAttachment(
  file: File,
  existingCount: number,
  existingTotalBytes: number,
): Promise<UploadAttachmentResult> {
  try {
    const size = file.size;
    const batch = checkBatchLimits(
      Number.isFinite(existingCount) ? existingCount : 0,
      Number.isFinite(existingTotalBytes) ? existingTotalBytes : 0,
      size,
    );
    if (batch) return fail(batch.code, batch.reason);

    const buffer = Buffer.from(await file.arrayBuffer());
    const head: FileHead = {
      name: file.name,
      size: buffer.length,
      type: file.type || "",
      head: new Uint8Array(buffer.subarray(0, HEAD_BYTES)),
    };
    const verdict = validateAttachment(head);
    if (!verdict.ok) return fail(verdict.code, verdict.reason);

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("UNAUTHENTICATED", "Session expirée. Reconnectez-vous.");

    // Resolve the ACTIVE tenant server-side (never a client-supplied id).
    const { data: identity, error: identityError } = await supabase.rpc(
      "get_active_tenant_identity",
    );
    if (identityError) {
      logEvent("error", "attachments.tenant_rpc_error", { code: identityError.code });
      return fail("TENANT_UNAVAILABLE", "Service indisponible. Réessayez plus tard.");
    }
    const tenantId = (identity as Record<string, unknown> | null)?.tenant_id as
      | string
      | null;
    const resolution = (identity as Record<string, unknown> | null)
      ?.resolution_status as string | undefined;
    if (resolution !== "OK" || !tenantId) {
      return fail(`TENANT_${resolution ?? "UNKNOWN"}`, "Aucun tenant actif.");
    }

    const checksum = createHash("sha256").update(buffer).digest("hex");
    const attachmentId = randomUUID();
    const storagePath = `${tenantId}/${user.id}/${attachmentId}/${verdict.safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(storagePath, buffer, {
        contentType: verdict.canonicalMime,
        upsert: false,
      });
    if (uploadError) {
      logEvent("error", "attachments.upload_error", {
        message: uploadError.message,
      });
      return fail("UPLOAD_FAILED", "Le téléversement a échoué. Réessayez.");
    }

    const { data: finalize, error: finalizeError } = await supabase.rpc(
      "finalize_hermes_attachment",
      {
        p_attachment_id: attachmentId,
        p_storage_path: storagePath,
        p_original_filename: file.name,
        p_safe_filename: verdict.safeName,
        p_mime_type: verdict.canonicalMime,
        p_category: verdict.category,
        p_size_bytes: buffer.length,
        p_checksum_sha256: checksum,
      },
    );

    const finalizeOk =
      !finalizeError && Boolean((finalize as Record<string, unknown> | null)?.ok);
    if (!finalizeOk) {
      // Roll back the stored object so nothing is left dangling on a failed
      // finalise (best effort — an orphan is still reclaimable via the TTL job).
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
      const code =
        ((finalize as Record<string, unknown> | null)?.code as string) ??
        finalizeError?.code ??
        "FINALIZE_FAILED";
      logEvent("error", "attachments.finalize_failed", { code });
      return fail(code, "L’enregistrement de la pièce jointe a échoué.");
    }

    return {
      ok: true,
      attachmentId,
      category: verdict.category as AttachmentCategory,
      safeName: verdict.safeName,
      sizeBytes: buffer.length,
      mimeType: verdict.canonicalMime,
    };
  } catch (err) {
    logEvent("error", "attachments.upload_exception", {
      message: (err as Error).message,
    });
    return fail("EXCEPTION", "Service indisponible. Réessayez plus tard.");
  }
}

/**
 * Link uploaded attachments to a persisted message the caller owns. Runs after
 * orchestration returns the `userMessageId`. Honest partial-failure semantics:
 * `ok` is true only when every requested attachment was linked.
 */
export async function linkHermesAttachments(
  conversationId: string,
  messageId: string,
  attachmentIds: string[],
): Promise<LinkAttachmentsResult> {
  const requested = attachmentIds.length;
  try {
    if (!conversationId || !messageId || requested === 0) {
      return { ok: requested === 0, code: "NOOP", linked: 0, requested };
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("link_hermes_attachments", {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_attachment_ids: attachmentIds,
    });
    if (error) {
      logEvent("error", "attachments.link_rpc_error", { code: error.code });
      return { ok: false, code: "RPC_ERROR", linked: 0, requested };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(d.ok),
      code: (d.code as string) ?? "UNKNOWN",
      linked: Number(d.linked ?? 0),
      requested: Number(d.requested ?? requested),
    };
  } catch (err) {
    logEvent("error", "attachments.link_exception", {
      message: (err as Error).message,
    });
    return { ok: false, code: "EXCEPTION", linked: 0, requested };
  }
}

/**
 * The caller's OWN attachments for one of their messages, each with a
 * short-TTL signed URL (private read — never a public URL). Used to re-render
 * attachments on a persisted conversation turn.
 */
export async function getHermesMessageAttachments(
  messageId: string,
): Promise<SignedMessageAttachment[]> {
  try {
    if (!messageId) return [];
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_hermes_message_attachments", {
      p_message_id: messageId,
    });
    if (error) {
      logEvent("error", "attachments.get_rpc_error", { code: error.code });
      return [];
    }
    const rows = (((data ?? {}) as Record<string, unknown>).attachments ??
      []) as Array<Record<string, unknown>>;

    const signed = await Promise.all(
      rows.map(async (r) => {
        const path = r.storage_path as string;
        let url: string | null = null;
        const { data: signedData } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        url = signedData?.signedUrl ?? null;
        return {
          id: r.id as string,
          originalFilename: r.original_filename as string,
          mimeType: r.mime_type as string,
          category: r.category as AttachmentCategory,
          sizeBytes: Number(r.size_bytes ?? 0),
          status: "LINKED" as const,
          url,
        };
      }),
    );
    return signed;
  } catch (err) {
    logEvent("error", "attachments.get_exception", {
      message: (err as Error).message,
    });
    return [];
  }
}
