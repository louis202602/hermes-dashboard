/**
 * PHOTO-P0 — Lecture EXIF minimale (pure, sans DOM, sans dépendance).
 *
 * On n'extrait QUE ce dont le tri a besoin :
 *   * DateTimeOriginal (+ SubSecTimeOriginal) → regroupement en rafales ;
 *   * Model / LensModel / ISO → contexte affiché à la photographe.
 *
 * Rien d'autre n'est lu, et surtout PAS le GPS : la géolocalisation d'une photo
 * de client est une donnée sensible dont Hermès n'a aucun besoin pour trier.
 * Ne pas la lire est plus sûr que la lire puis la filtrer.
 *
 * L'horodatage EXIF ne porte pas de fuseau. Il est renvoyé tel quel (naïf) ;
 * seules les DIFFÉRENCES entre clichés comptent pour détecter une rafale, et
 * elles sont invariantes par changement de fuseau tant que l'interprétation est
 * la même pour toute la séance.
 */

export type ExifSummary = {
  /** `YYYY-MM-DDTHH:MM:SS[.mmm]` — naïf (sans fuseau), ou null si absent. */
  capturedAt: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
};

const EMPTY: ExifSummary = {
  capturedAt: null,
  cameraModel: null,
  lensModel: null,
  iso: null,
};

const TAG_MODEL = 0x0110;
const TAG_EXIF_IFD = 0x8769;
const TAG_ISO = 0x8827;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_SUBSEC_ORIGINAL = 0x9291;
const TAG_LENS_MODEL = 0xa434;

function readUint16(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, little: boolean): number {
  return little
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>> 0;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = bytes[offset + i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

/** Localise le segment APP1 « Exif\0\0 » et renvoie l'offset du header TIFF. */
function findTiffOffset(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // pas un JPEG
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // flux corrompu → abandon propre
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null; // début image / fin : pas d'EXIF
    const size = readUint16(bytes, offset + 2, false);
    if (size < 2) return null;
    if (marker === 0xe1 && offset + 10 <= bytes.length) {
      if (readAscii(bytes, offset + 4, 4) === "Exif") return offset + 10;
    }
    offset += 2 + size;
  }
  return null;
}

type Entry = { tag: number; type: number; count: number; valueOffset: number };

function readIfd(
  bytes: Uint8Array,
  tiff: number,
  ifdOffset: number,
  little: boolean,
): Entry[] {
  const base = tiff + ifdOffset;
  if (base + 2 > bytes.length) return [];
  const count = readUint16(bytes, base, little);
  // Garde-fou : un IFD réaliste tient largement sous 512 entrées.
  if (count > 512) return [];
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const p = base + 2 + i * 12;
    if (p + 12 > bytes.length) break;
    entries.push({
      tag: readUint16(bytes, p, little),
      type: readUint16(bytes, p + 2, little),
      count: readUint32(bytes, p + 4, little),
      valueOffset: p + 8,
    });
  }
  return entries;
}

/** Valeur ASCII d'une entrée (inline si ≤ 4 octets, sinon pointeur). */
function entryAscii(
  bytes: Uint8Array,
  tiff: number,
  entry: Entry,
  little: boolean,
): string | null {
  if (entry.type !== 2 || entry.count === 0 || entry.count > 512) return null;
  const offset =
    entry.count <= 4 ? entry.valueOffset : tiff + readUint32(bytes, entry.valueOffset, little);
  if (offset < 0 || offset + entry.count > bytes.length) return null;
  const value = readAscii(bytes, offset, entry.count);
  return value.length > 0 ? value : null;
}

/** Valeur entière courte/longue d'une entrée. */
function entryNumber(bytes: Uint8Array, entry: Entry, little: boolean): number | null {
  if (entry.type === 3) return readUint16(bytes, entry.valueOffset, little);
  if (entry.type === 4) return readUint32(bytes, entry.valueOffset, little);
  return null;
}

/** `2026:08:18 10:24:31` → `2026-08-18T10:24:31`. Null si le format ne colle pas. */
export function exifDateToIso(value: string, subsec?: string | null): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = subsec ? String(subsec).replace(/\D/g, "").slice(0, 3).padEnd(3, "0") : null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${ms ? `.${ms}` : ""}`;
}

/**
 * Extrait le résumé EXIF utile. Toute anomalie (fichier non JPEG, EXIF absent,
 * offsets incohérents) renvoie un résumé vide — jamais d'exception, jamais de
 * valeur devinée.
 */
export function readExifSummary(bytes: Uint8Array): ExifSummary {
  try {
    const tiff = findTiffOffset(bytes);
    if (tiff === null || tiff + 8 > bytes.length) return EMPTY;

    const byteOrder = readAscii(bytes, tiff, 2);
    if (byteOrder !== "II" && byteOrder !== "MM") return EMPTY;
    const little = byteOrder === "II";
    if (readUint16(bytes, tiff + 2, little) !== 42) return EMPTY;

    const ifd0 = readIfd(bytes, tiff, readUint32(bytes, tiff + 4, little), little);
    let cameraModel: string | null = null;
    let exifIfdOffset: number | null = null;
    for (const e of ifd0) {
      if (e.tag === TAG_MODEL) cameraModel = entryAscii(bytes, tiff, e, little);
      else if (e.tag === TAG_EXIF_IFD) exifIfdOffset = readUint32(bytes, e.valueOffset, little);
    }

    let capturedAt: string | null = null;
    let lensModel: string | null = null;
    let iso: number | null = null;
    if (exifIfdOffset !== null) {
      const exifIfd = readIfd(bytes, tiff, exifIfdOffset, little);
      let raw: string | null = null;
      let subsec: string | null = null;
      for (const e of exifIfd) {
        if (e.tag === TAG_DATETIME_ORIGINAL) raw = entryAscii(bytes, tiff, e, little);
        else if (e.tag === TAG_SUBSEC_ORIGINAL) subsec = entryAscii(bytes, tiff, e, little);
        else if (e.tag === TAG_LENS_MODEL) lensModel = entryAscii(bytes, tiff, e, little);
        else if (e.tag === TAG_ISO) iso = entryNumber(bytes, e, little);
      }
      if (raw) capturedAt = exifDateToIso(raw, subsec);
    }

    return {
      capturedAt,
      cameraModel: cameraModel ? cameraModel.slice(0, 120) : null,
      lensModel: lensModel ? lensModel.slice(0, 120) : null,
      iso: iso !== null && iso > 0 && iso <= 4000000 ? iso : null,
    };
  } catch {
    return EMPTY;
  }
}
