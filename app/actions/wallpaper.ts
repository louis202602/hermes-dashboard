"use server";

import {
  deleteUserWallpaper,
  uploadUserWallpaper,
  type WallpaperUploadResult,
} from "@/services/hermes/wallpapers";

/**
 * Server Action — upload ONE wallpaper image (multipart/form-data). All security is
 * server-side (magic-byte validation, image-only, tenant/user isolation, private
 * storage). The browser only sees an honest transport outcome and a `user:<path>`
 * ref it can never widen.
 */
export async function uploadWallpaperAction(
  formData: FormData,
): Promise<WallpaperUploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "NO_FILE", reason: "Aucun fichier reçu." };
  }
  return uploadUserWallpaper(file);
}

/** Server Action — delete one of the CALLER's own wallpapers (ownership re-checked). */
export async function deleteWallpaperAction(ref: string): Promise<{ ok: boolean }> {
  return deleteUserWallpaper(ref);
}
