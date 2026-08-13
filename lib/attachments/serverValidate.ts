/**
 * Server-side, fail-closed validation for Hermès chat attachments (Phase B).
 *
 * This runs inside the upload Server Action (Node runtime) BEFORE anything is
 * stored. It never trusts the browser: the declared MIME and the filename are
 * treated as hints and cross-checked against the real file bytes (magic-byte
 * signature) and a strict allowlist. Pure + DOM-free so it is unit-tested.
 *
 * V1 scope (operator-decided): IMAGE (jpg/jpeg/png/webp), DOCUMENT
 * (pdf/txt/csv/docx/xlsx), AUDIO (mp3/wav/m4a). VIDEO is NOT_SUPPORTED_YET
 * (rejected honestly). No LLM, no content understanding (that is Phase C).
 */

export type AttachmentCategory = "image" | "document" | "audio";

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_TOTAL_BYTES_PER_MESSAGE = 50 * 1024 * 1024; // 50 MB
export const MAX_FILENAME_LENGTH = 200;

const MB = 1024 * 1024;
export const MAX_BYTES_BY_CATEGORY: Record<AttachmentCategory, number> = {
  image: 10 * MB,
  document: 20 * MB,
  audio: 25 * MB,
};

type FormatSpec = {
  id: string;
  category: AttachmentCategory;
  ext: string[];
  mime: string[];
  sniff: (head: Uint8Array) => boolean;
};

function startsWith(head: Uint8Array, sig: number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (head[offset + i] !== sig[i]) return false;
  return true;
}
function hasAsciiAt(head: Uint8Array, offset: number, ascii: string): boolean {
  if (head.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) if (head[offset + i] !== ascii.charCodeAt(i)) return false;
  return true;
}
/** Heuristic for real text (txt/csv): no NUL bytes and mostly printable in the head. */
function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let printable = 0;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0) return false; // NUL → binary
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128) printable++;
  }
  return printable / head.length > 0.85;
}

const FORMATS: FormatSpec[] = [
  { id: "jpg", category: "image", ext: ["jpg", "jpeg"], mime: ["image/jpeg"], sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  { id: "png", category: "image", ext: ["png"], mime: ["image/png"], sniff: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { id: "webp", category: "image", ext: ["webp"], mime: ["image/webp"], sniff: (h) => hasAsciiAt(h, 0, "RIFF") && hasAsciiAt(h, 8, "WEBP") },
  { id: "pdf", category: "document", ext: ["pdf"], mime: ["application/pdf"], sniff: (h) => hasAsciiAt(h, 0, "%PDF-") },
  { id: "txt", category: "document", ext: ["txt"], mime: ["text/plain", ""], sniff: looksLikeText },
  { id: "csv", category: "document", ext: ["csv"], mime: ["text/csv", "application/csv", "text/plain", ""], sniff: looksLikeText },
  { id: "docx", category: "document", ext: ["docx"], mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", ""], sniff: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]) || startsWith(h, [0x50, 0x4b, 0x05, 0x06]) },
  { id: "xlsx", category: "document", ext: ["xlsx"], mime: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", ""], sniff: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]) || startsWith(h, [0x50, 0x4b, 0x05, 0x06]) },
  { id: "mp3", category: "audio", ext: ["mp3"], mime: ["audio/mpeg", "audio/mp3"], sniff: (h) => hasAsciiAt(h, 0, "ID3") || startsWith(h, [0xff, 0xfb]) || startsWith(h, [0xff, 0xf3]) || startsWith(h, [0xff, 0xf2]) || startsWith(h, [0xff, 0xfa]) },
  { id: "wav", category: "audio", ext: ["wav"], mime: ["audio/wav", "audio/x-wav", "audio/wave"], sniff: (h) => hasAsciiAt(h, 0, "RIFF") && hasAsciiAt(h, 8, "WAVE") },
  { id: "m4a", category: "audio", ext: ["m4a"], mime: ["audio/mp4", "audio/x-m4a", "audio/m4a", ""], sniff: (h) => hasAsciiAt(h, 4, "ftyp") },
];

/** Video extensions/mimes we recognise only to reject them honestly in V1. */
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "avi", "mkv"];

export function extensionOf(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/**
 * Sanitize a client filename to a safe basename: strip any path, drop control
 * and separator characters, collapse spaces, cap length. Never traversal-capable.
 */
export function sanitizeFilename(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  // Drop control characters (0x00–0x1F and 0x7F) without a control-char regex.
  const noControl = Array.from(base)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  let cleaned = noControl
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length === 0) cleaned = "file";
  if (cleaned.length > MAX_FILENAME_LENGTH) {
    const ext = extensionOf(cleaned);
    const stem = cleaned.slice(0, MAX_FILENAME_LENGTH - (ext ? ext.length + 1 : 0));
    cleaned = ext ? `${stem}.${ext}` : stem;
  }
  return cleaned;
}

export type FileHead = {
  name: string;
  size: number;
  type: string; // declared MIME (untrusted)
  head: Uint8Array; // first bytes of the real content
};

export type ValidationOk = {
  ok: true;
  category: AttachmentCategory;
  formatId: string;
  canonicalMime: string;
  safeName: string;
};
export type ValidationFail = { ok: false; code: string; reason: string };
export type ValidationResult = ValidationOk | ValidationFail;

/** Full fail-closed validation of one file. */
export function validateAttachment(f: FileHead): ValidationResult {
  const ext = extensionOf(f.name);
  const declared = (f.type || "").toLowerCase();

  if (!Number.isFinite(f.size) || f.size <= 0) {
    return { ok: false, code: "EMPTY_FILE", reason: "fichier vide ou illisible" };
  }
  if ((f.name ?? "").length > MAX_FILENAME_LENGTH * 2) {
    return { ok: false, code: "NAME_TOO_LONG", reason: "nom de fichier trop long" };
  }

  // Honest V1 boundary: video is recognised but not supported yet.
  if (VIDEO_EXT.includes(ext) || declared.startsWith("video/")) {
    return { ok: false, code: "VIDEO_NOT_SUPPORTED_YET", reason: "les vidéos ne sont pas encore prises en charge" };
  }

  const spec = FORMATS.find((s) => s.ext.includes(ext));
  if (!spec) {
    return { ok: false, code: "TYPE_NOT_ALLOWED", reason: "type de fichier non pris en charge" };
  }
  if (declared.length > 0 && !spec.mime.includes(declared)) {
    return { ok: false, code: "MIME_MISMATCH", reason: "le type déclaré ne correspond pas à l’extension" };
  }
  if (!spec.sniff(f.head)) {
    return { ok: false, code: "MAGIC_BYTES_MISMATCH", reason: "le contenu réel ne correspond pas au type annoncé" };
  }
  if (f.size > MAX_BYTES_BY_CATEGORY[spec.category]) {
    return {
      ok: false,
      code: "TOO_LARGE",
      reason: `fichier trop volumineux (max ${Math.round(MAX_BYTES_BY_CATEGORY[spec.category] / MB)} Mo)`,
    };
  }

  return {
    ok: true,
    category: spec.category,
    formatId: spec.id,
    canonicalMime: spec.mime.find((m) => m.length > 0) ?? declared,
    safeName: sanitizeFilename(f.name),
  };
}

/** Batch-level guardrails (count + cumulative size) against the existing set. */
export function checkBatchLimits(
  existingCount: number,
  existingTotalBytes: number,
  incomingSize: number,
): ValidationFail | null {
  if (existingCount + 1 > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, code: "TOO_MANY", reason: `maximum ${MAX_ATTACHMENTS_PER_MESSAGE} fichiers par message` };
  }
  if (existingTotalBytes + incomingSize > MAX_TOTAL_BYTES_PER_MESSAGE) {
    return { ok: false, code: "TOTAL_TOO_LARGE", reason: `taille totale trop élevée (max ${Math.round(MAX_TOTAL_BYTES_PER_MESSAGE / MB)} Mo par message)` };
  }
  return null;
}

/** The native file-picker accept string for the V1 allowlist (video excluded). */
export const ATTACHMENT_ACCEPT_V1 =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp," +
  "application/pdf,.pdf,text/plain,.txt,text/csv,.csv," +
  ".docx,.xlsx,audio/mpeg,.mp3,audio/wav,.wav,audio/mp4,.m4a";
