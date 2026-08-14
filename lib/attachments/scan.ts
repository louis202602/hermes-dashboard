/**
 * Pure, DOM-free helpers for the composer's capture / scan-to-PDF experience.
 * The heavy lifting (canvas encode, PDF assembly) lives in browser/pure modules;
 * this file holds the plain logic (limits, filename, resize math, per-menu input
 * config) so it is unit-testable and shared by the UI.
 *
 * Capture + format conversion ONLY — no OCR, no analysis, no network. Whatever
 * is produced is fed into the canonical Phase B upload pipeline unchanged.
 */

/** The composer "+" menu actions. */
export type AttachMenuKind = "camera" | "photos" | "documents" | "audio";

/** Sensible, honest limits for scan-to-PDF (kept small on purpose). */
export const SCAN_MAX_PAGES = 20;
/** Longest edge (px) a captured/scanned image is downscaled to before encoding. */
export const SCAN_MAX_IMAGE_EDGE = 2200;
/** JPEG quality used when (re-)encoding captured images. */
export const SCAN_JPEG_QUALITY = 0.72;
/** Hard ceiling for the generated PDF — aligns with the Phase B document cap. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;

/**
 * `<input type="file">` configuration for each menu action. `capture` triggers
 * the camera on mobile/tablet and is silently ignored on desktop (progressive
 * enhancement → the desktop file chooser is the fallback). Accept lists are the
 * Phase B V1 allowlist, sliced per category. Video is never offered.
 */
export function attachInputConfig(kind: AttachMenuKind): {
  accept: string;
  capture: "environment" | false;
  multiple: boolean;
} {
  switch (kind) {
    case "camera":
      return { accept: "image/*", capture: "environment", multiple: false };
    case "photos":
      return {
        accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
        capture: false,
        multiple: true,
      };
    case "documents":
      return {
        accept:
          "application/pdf,.pdf,text/plain,.txt,text/csv,.csv,.docx,.xlsx",
        capture: false,
        multiple: true,
      };
    case "audio":
      return {
        accept: "audio/mpeg,.mp3,audio/wav,.wav,audio/mp4,.m4a",
        capture: false,
        multiple: true,
      };
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Automatic, clean PDF name for a scan: `scan-YYYY-MM-DD-HHMM.pdf` (local time).
 * The result is still passed through the Phase B server-side filename
 * sanitisation, so this is only a friendly default.
 */
export function scanPdfFilename(date: Date): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `scan-${y}-${m}-${d}-${hh}${mm}.pdf`;
}

/**
 * Ensure a user-supplied scan name ends with `.pdf` and is non-empty. Purely a
 * convenience — the authoritative sanitisation happens server-side (Phase B).
 */
export function ensurePdfName(name: string, fallback: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return fallback;
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

/**
 * Downscale (w×h) so its longest edge is at most `maxEdge`, preserving aspect.
 * Never upscales. Returns integer pixel dimensions (≥ 1).
 */
export function resizeToMaxEdge(
  w: number,
  h: number,
  maxEdge: number = SCAN_MAX_IMAGE_EDGE,
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const longest = Math.max(w, h);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Human-readable page-count guard message, or null when within the limit. */
export function scanPageLimitError(pageCount: number): string | null {
  if (pageCount > SCAN_MAX_PAGES) {
    return `Un scan est limité à ${SCAN_MAX_PAGES} pages.`;
  }
  return null;
}
