import "server-only";

import { randomUUID } from "node:crypto";

import { validateAttachment, type FileHead } from "@/lib/attachments/serverValidate";
import {
  isOwnedWallpaperPath,
  userWallpaperPath,
  userWallpaperPrefix,
} from "@/lib/dashboard/wallpapers";
import { logEvent } from "@/lib/observability/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET } from "@/services/hermes/attachments";

/**
 * DASH-4E — user wallpaper storage. Reuses the EXISTING private attachment bucket +
 * storage RLS + magic-byte validation (no second upload system, no public bucket, no
 * new table). A wallpaper is stored under `${tenant}/${user}/wallpapers/<uuid>/<safe>`
 * — the same tenant/user path the storage RLS already enforces — and referenced as
 * `user:<storagePath>`. Reads are short-TTL signed URLs; ownership is re-verified
 * server-side before signing or deleting, so a crafted ref can never touch another
 * tenant's/user's object. No LLM, no external paid API.
 */

const HEAD_BYTES = 4096;
const SIGNED_URL_TTL_SECONDS = 600; // 10 min — dashboards are long-lived
const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024; // 8 MB (client compresses first)

export type WallpaperUploadResult =
  | { ok: true; ref: string }
  | { ok: false; code: string; reason: string };

/** Resolve the caller's user id + ACTIVE tenant id (server-side, never client-supplied). */
async function resolveOwner(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<{ userId: string; tenantId: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: identity, error } = await supabase.rpc("get_active_tenant_identity");
  if (error) return null;
  const tenantId = (identity as Record<string, unknown> | null)?.tenant_id as string | null;
  const resolution = (identity as Record<string, unknown> | null)?.resolution_status;
  if (resolution !== "OK" || !tenantId) return null;
  return { userId: user.id, tenantId };
}

export async function uploadUserWallpaper(file: File): Promise<WallpaperUploadResult> {
  try {
    if (file.size > MAX_WALLPAPER_BYTES) {
      return { ok: false, code: "TOO_LARGE", reason: "Image trop lourde (max 8 Mo)." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const head: FileHead = {
      name: file.name,
      size: buffer.length,
      type: file.type || "",
      head: new Uint8Array(buffer.subarray(0, HEAD_BYTES)),
    };
    const verdict = validateAttachment(head);
    if (!verdict.ok) return { ok: false, code: verdict.code, reason: verdict.reason };
    if (verdict.category !== "image") {
      return { ok: false, code: "NOT_IMAGE", reason: "Image requise (JPEG / PNG / WebP)." };
    }

    const supabase = await createSupabaseServerClient();
    const owner = await resolveOwner(supabase);
    if (!owner) return { ok: false, code: "NO_TENANT", reason: "Session ou tenant indisponible." };

    const id = randomUUID();
    const path = `${userWallpaperPrefix(owner.tenantId, owner.userId)}${id}/${verdict.safeName}`;
    const { error: upErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, buffer, { contentType: verdict.canonicalMime, upsert: false });
    if (upErr) {
      logEvent("error", "wallpaper.upload_error", { message: upErr.message });
      return { ok: false, code: "UPLOAD_FAILED", reason: "Le téléversement a échoué." };
    }
    return { ok: true, ref: `user:${path}` };
  } catch (e) {
    logEvent("error", "wallpaper.upload_exception", {
      message: e instanceof Error ? e.message : "unknown",
    });
    return { ok: false, code: "EXCEPTION", reason: "Erreur inattendue." };
  }
}

/** Delete a user wallpaper — only if the ref belongs to the CALLER (ownership re-checked). */
export async function deleteUserWallpaper(ref: string): Promise<{ ok: boolean }> {
  const path = userWallpaperPath(ref);
  if (!path) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const owner = await resolveOwner(supabase);
  if (!owner || !isOwnedWallpaperPath(path, owner.tenantId, owner.userId)) return { ok: false };
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  return { ok: !error };
}

/** Short-TTL signed URL for a user wallpaper — ownership re-checked (defense in depth). */
export async function signUserWallpaper(ref: string): Promise<string | null> {
  const path = userWallpaperPath(ref);
  if (!path) return null;
  const supabase = await createSupabaseServerClient();
  const owner = await resolveOwner(supabase);
  if (!owner || !isOwnedWallpaperPath(path, owner.tenantId, owner.userId)) return null;
  const { data } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

/**
 * Sign several profiles' user wallpapers in one pass. COST-FIRST: the owner (user +
 * active tenant) is resolved ONCE for the whole batch — not per ref — so N profiles
 * cost 1 identity resolution + N signed-URL calls (was 3×N round-trips before). Each
 * path is still ownership-checked (defense in depth). Returns { key → signedUrl } for
 * refs that resolved; unknown/foreign refs are simply omitted (never a broken screen).
 */
export async function signUserWallpapers(
  entries: { key: string; ref: string }[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (entries.length === 0) return out;
  const supabase = await createSupabaseServerClient();
  const owner = await resolveOwner(supabase);
  if (!owner) return out;
  await Promise.all(
    entries.map(async ({ key, ref }) => {
      const path = userWallpaperPath(ref);
      if (!path || !isOwnedWallpaperPath(path, owner.tenantId, owner.userId)) return;
      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (data?.signedUrl) out[key] = data.signedUrl;
    }),
  );
  return out;
}
