/**
 * Pure, DOM-free helpers for the Hermès composer's LOCAL attachment layer
 * (Phase A). These functions operate on plain file *metadata* only — no `File`,
 * no DOM, no network — so they are unit-testable with the Node test runner. The
 * thin DOM binding (native file input, object-URL thumbnails) lives in
 * `components/dashboard/HermesPanel.tsx`.
 *
 * IMPORTANT — honesty boundary. This is a **client-side UX layer only**. In
 * Phase A the selected files are NEVER uploaded, stored, or transmitted to
 * Hermès; there is no bucket, no upload route and no multimodal orchestrator
 * (see the audit in the PR description). The validation below is a *usability*
 * guard (sane counts/sizes/types for a local preview) and is **not** a security
 * boundary — real MIME sniffing, size enforcement, tenant-scoped storage and
 * signed URLs belong to the separate Phase B backend slice.
 */

export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "document" | "other";

/** UX caps for the LOCAL preview (not security limits). */
export const MAX_ATTACHMENTS = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB local preview cap
export const MAX_NAME_LENGTH = 200;

export type FileMeta = { name: string; size: number; type: string };
export type AttachmentError = { name: string; reason: string };
export type ValidationOutcome = { accepted: FileMeta[]; errors: AttachmentError[] };

/** Reasonable client-side allowlist (UX only — NOT a security boundary). */
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/"] as const;
const ALLOWED_MIME_EXACT = new Set<string>([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/rtf",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
/** Extension fallback when the browser reports an empty MIME type. */
const ALLOWED_EXT_FALLBACK = new Set<string>([
  // images
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "svg", "bmp",
  // video
  "mp4", "mov", "webm", "m4v", "avi", "mkv",
  // audio
  "mp3", "wav", "m4a", "aac", "ogg", "flac", "opus",
  // documents
  "pdf", "txt", "csv", "md", "rtf", "json", "zip",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods",
]);
/** Executable/script types are always refused (client-side hint only). */
const BLOCKED_EXTENSIONS = new Set<string>([
  "exe", "msi", "bat", "cmd", "com", "scr", "sh", "ps1", "js", "mjs", "cjs",
  "jar", "app", "dll", "so", "deb", "rpm", "apk", "dmg", "pkg", "vbs", "wsf",
]);

export function extensionOf(name: string): string {
  const clean = name.split(/[\\/]/).pop() ?? name;
  const i = clean.lastIndexOf(".");
  return i > 0 ? clean.slice(i + 1).toLowerCase() : "";
}

export function kindFor(meta: FileMeta): AttachmentKind {
  const type = (meta.type || "").toLowerCase();
  const ext = extensionOf(meta.name);
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "svg", "bmp"].includes(ext)) {
    return "image";
  }
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "m4v", "avi", "mkv"].includes(ext)) {
    return "video";
  }
  if (type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext)) {
    return "audio";
  }
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (
    ALLOWED_MIME_EXACT.has(type) ||
    ["txt", "csv", "md", "rtf", "json", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods"].includes(ext)
  ) {
    return "document";
  }
  return "other";
}

/** Whether a preview thumbnail (object URL) is meaningful for this kind. */
export function isPreviewable(kind: AttachmentKind): boolean {
  return kind === "image" || kind === "video";
}

export function isAllowedType(meta: FileMeta): boolean {
  const ext = extensionOf(meta.name);
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  const type = (meta.type || "").toLowerCase();
  if (type.length > 0) {
    if (ALLOWED_MIME_PREFIXES.some((p) => type.startsWith(p))) return true;
    if (ALLOWED_MIME_EXACT.has(type)) return true;
    // Some browsers report generic octet-stream — fall back to the extension.
    return ALLOWED_EXT_FALLBACK.has(ext);
  }
  return ALLOWED_EXT_FALLBACK.has(ext);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

/**
 * Validate a batch of freshly-picked files against the existing selection.
 * Pure: takes metadata + the current count, returns accepted metas and
 * per-file errors. Order-preserving; the count cap is applied incrementally so
 * the first N within budget are accepted and the rest reported.
 */
export function validateFiles(incoming: FileMeta[], existingCount: number): ValidationOutcome {
  const accepted: FileMeta[] = [];
  const errors: AttachmentError[] = [];
  let count = existingCount;

  for (const meta of incoming) {
    const name = meta.name || "fichier";
    if (count >= MAX_ATTACHMENTS) {
      errors.push({ name, reason: `maximum ${MAX_ATTACHMENTS} fichiers` });
      continue;
    }
    if (name.length > MAX_NAME_LENGTH) {
      errors.push({ name, reason: "nom de fichier trop long" });
      continue;
    }
    if (!Number.isFinite(meta.size) || meta.size <= 0) {
      errors.push({ name, reason: "fichier vide ou illisible" });
      continue;
    }
    if (meta.size > MAX_FILE_BYTES) {
      errors.push({ name, reason: `trop volumineux (max ${formatBytes(MAX_FILE_BYTES)})` });
      continue;
    }
    if (!isAllowedType(meta)) {
      errors.push({ name, reason: "type de fichier non pris en charge" });
      continue;
    }
    accepted.push(meta);
    count += 1;
  }

  return { accepted, errors };
}

/** The native file-picker `accept` attribute for the allowed types. */
export const FILE_INPUT_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.txt,.csv,.md,.rtf,.json,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods";
