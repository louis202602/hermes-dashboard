/**
 * Browser-only (DOM) helpers that turn a picked/captured image `File` into a
 * compressed JPEG plus its dimensions, and assemble scanned pages into a PDF
 * `File`. Kept apart from the pure logic so the pure modules stay unit-testable.
 *
 * This is capture + format conversion ONLY — canvas re-encode for size/orientation
 * and a client-side JPEG→PDF assembly. No OCR, no analysis, no network. Whatever
 * is produced is handed to the canonical Phase B upload pipeline unchanged.
 */

import { imagesToPdf, type PdfImagePage } from "./imagesToPdf";
import {
  SCAN_JPEG_QUALITY,
  SCAN_MAX_IMAGE_EDGE,
  resizeToMaxEdge,
} from "./scan";

export type EncodedImage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
  blob: Blob;
};

/**
 * Decode a File to something drawable, honouring EXIF orientation when possible.
 * Exported so the photo proxy pipeline reuses this one decoder instead of
 * shipping a second, divergent copy of the same browser quirks.
 */
export async function decodeImageFile(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  // Preferred path: createImageBitmap applies EXIF orientation with the option.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path (e.g. some Safari builds).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode_failed"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Re-encode an image File to a size-bounded JPEG. Downscales so the longest edge
 * is at most `maxEdge`; normalises odd camera formats (e.g. HEIC) to JPEG so the
 * result always passes the Phase B allowlist + magic-byte check.
 */
export async function encodeImageFileToJpeg(
  file: File,
  maxEdge: number = SCAN_MAX_IMAGE_EDGE,
  quality: number = SCAN_JPEG_QUALITY,
): Promise<EncodedImage> {
  const { source, width, height, cleanup } = await decodeImageFile(file);
  try {
    const target = resizeToMaxEdge(width, height, maxEdge);
    if (target.width === 0 || target.height === 0) {
      throw new Error("empty_image");
    }
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.drawImage(source, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
    if (!blob) throw new Error("encode_failed");
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    return { jpeg, width: target.width, height: target.height, blob };
  } finally {
    cleanup();
  }
}

/** Assemble encoded pages into a single PDF `File` (application/pdf). */
export function pagesToPdfFile(
  pages: PdfImagePage[],
  filename: string,
): File {
  const bytes = imagesToPdf(pages);
  // Copy into a fresh ArrayBuffer so the File holds an exact-length buffer.
  const buffer = bytes.slice().buffer;
  return new File([buffer], filename, { type: "application/pdf" });
}
