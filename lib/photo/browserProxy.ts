/**
 * PHOTO-P0 — Pipeline d'import NAVIGATEUR (module DOM, jamais importé côté serveur).
 *
 * C'est la pièce qui rend la Phase 1 possible SANS n8n et à coût IA nul : tout se
 * passe sur le poste de la photographe.
 *
 *   fichier local ─┬─ sha256 (identité, idempotence)
 *                  ├─ EXIF (date de prise de vue → rafales, boîtier, ISO)
 *                  ├─ proxy JPEG 1600 px  (~400 Ko) ─► bucket privé
 *                  ├─ vignette JPEG 400 px (~40 Ko) ─► bucket privé
 *                  └─ mesures passe 1 sur un buffer 512 px ─► façade
 *
 * LE RAW NE QUITTE JAMAIS LE POSTE. Seuls les deux dérivés bornés sont téléversés :
 * ~264 Mo par séance de 600 photos au lieu de ~18 Go, soit un facteur ~68.
 *
 * Le décodeur est celui, déjà éprouvé, de `lib/attachments/browserImage.ts` — on
 * ne réécrit pas une seconde gestion des bizarreries de décodage des navigateurs.
 */

import { decodeImageFile } from "@/lib/attachments/browserImage";
import { resizeToMaxEdge } from "@/lib/attachments/scan";
import { readExifSummary } from "@/lib/photo/exif";
import { computeSignals, type CullingSignal } from "@/lib/photo/imageStats";

/** Grand côté du proxy téléversé (analyse humaine + revue à l'écran). */
export const PHOTO_PROXY_EDGE = 1600;
/** Grand côté de la vignette (grille de revue). */
export const PHOTO_THUMB_EDGE = 400;
/** Grand côté du buffer d'ANALYSE : assez pour la netteté, assez petit pour être instantané. */
export const PHOTO_ANALYSIS_EDGE = 512;

export const PHOTO_PROXY_QUALITY = 0.72;
export const PHOTO_THUMB_QUALITY = 0.62;

/** Extensions acceptées à l'import. Les RAW sont acceptés en RÉFÉRENCE mais ne
 *  sont pas décodables par le navigateur : ils doivent être accompagnés de leur
 *  JPEG (aperçu embarqué exporté), sinon la photo reste PENDING, jamais perdue. */
export const PHOTO_IMPORT_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export type PreparedPhoto = {
  filename: string;
  sha256: string;
  width: number;
  height: number;
  capturedAt: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  proxyBlob: Blob;
  thumbBlob: Blob;
  signal: CullingSignal;
};

/** SHA-256 hexadécimal minuscule — l'identité stable d'une photo (idempotence). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function drawTo(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } {
  const target = resizeToMaxEdge(sourceWidth, sourceHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, target.width);
  canvas.height = Math.max(1, target.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

async function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
  if (!blob) throw new Error("encode_failed");
  return blob;
}

/**
 * Prépare une photo : identité, EXIF, deux dérivés et les mesures de la passe 1.
 * Aucune décision de tri n'est prise ici — voir `lib/photo/imageStats.ts`.
 */
export async function preparePhotoForImport(file: File): Promise<PreparedPhoto> {
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const exif = readExifSummary(new Uint8Array(buffer));

  const { source, width, height, cleanup } = await decodeImageFile(file);
  try {
    if (width === 0 || height === 0) throw new Error("empty_image");

    const proxy = drawTo(source, width, height, PHOTO_PROXY_EDGE);
    const proxyBlob = await toBlob(proxy.canvas, PHOTO_PROXY_QUALITY);

    const thumb = drawTo(source, width, height, PHOTO_THUMB_EDGE);
    const thumbBlob = await toBlob(thumb.canvas, PHOTO_THUMB_QUALITY);

    const analysis = drawTo(source, width, height, PHOTO_ANALYSIS_EDGE);
    const pixels = analysis.ctx.getImageData(0, 0, analysis.width, analysis.height);
    const signal = computeSignals(pixels.data, analysis.width, analysis.height);

    return {
      filename: file.name,
      sha256,
      width,
      height,
      capturedAt: exif.capturedAt,
      cameraModel: exif.cameraModel,
      lensModel: exif.lensModel,
      iso: exif.iso,
      proxyBlob,
      thumbBlob,
      signal,
    };
  } finally {
    cleanup();
  }
}

/** Chemin d'objet canonique — doit correspondre EXACTEMENT au préfixe re-validé
 *  par `finalize_photo_proxy`, sinon le serveur refuse (`PATH_OUT_OF_SCOPE`). */
export function proxyObjectPath(
  tenantId: string,
  sessionId: string,
  assetId: string,
  variant: "p1600" | "t400",
): string {
  return `${tenantId}/${sessionId}/${assetId}/${variant}.jpg`;
}
