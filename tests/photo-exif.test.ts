import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { exifDateToIso, readExifSummary } from "../lib/photo/exif.ts";

/**
 * PHOTO-P0 — lecture EXIF.
 *
 * Deux propriétés produit sont vérifiées ici :
 *   * la date de prise de vue est lue correctement (c'est elle qui permet de
 *     regrouper les rafales, donc tout le « meilleur de la série ») ;
 *   * un fichier corrompu, tronqué ou non-JPEG ne fait JAMAIS lever d'exception
 *     et ne renvoie jamais de valeur devinée.
 *
 * Le module ne lit délibérément PAS le GPS : on ne collecte pas la position d'une
 * photo de client. Un test garde cette décision.
 */

/** Construit un JPEG minimal (SOI + APP1/Exif + EOI) en little-endian. */
function buildJpegWithExif(dateTimeOriginal: string, model = "TEST", iso = 400): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);

  tiff.push(0x49, 0x49); // "II" little-endian
  u16(42);
  u32(8); // IFD0 à l'offset 8

  const modelBytes = [...Buffer.from(model, "ascii"), 0];
  const dateBytes = [...Buffer.from(dateTimeOriginal, "ascii"), 0];

  // Plan mémoire (offsets relatifs au début du TIFF) :
  //   8  IFD0 (2 + 2*12 + 4 = 30 octets) → 8..37
  //   38 chaîne Model
  //   38+len  IFD Exif
  const modelOffset = 38;
  const exifIfdOffset = modelOffset + modelBytes.length;
  // IFD Exif : 2 + 2*12 + 4 = 30 octets → données ensuite
  const dateOffset = exifIfdOffset + 30;

  // --- IFD0 : Model + pointeur vers l'IFD Exif
  u16(2);
  u16(0x0110); u16(2); u32(modelBytes.length); u32(modelOffset); // Model (ASCII)
  u16(0x8769); u16(4); u32(1); u32(exifIfdOffset); // ExifIFDPointer
  u32(0); // pas d'IFD1

  assert.equal(tiff.length, modelOffset, "plan mémoire IFD0 incohérent");
  tiff.push(...modelBytes);

  // --- IFD Exif : DateTimeOriginal + ISO
  assert.equal(tiff.length, exifIfdOffset, "plan mémoire IFD Exif incohérent");
  u16(2);
  u16(0x9003); u16(2); u32(dateBytes.length); u32(dateOffset); // DateTimeOriginal
  u16(0x8827); u16(3); u32(1); u32(iso); // ISO (SHORT, valeur en ligne)
  u32(0);
  assert.equal(tiff.length, dateOffset, "plan mémoire données incohérent");
  tiff.push(...dateBytes);

  const app1Length = 2 + 6 + tiff.length; // taille + "Exif\0\0" + TIFF
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    ...tiff,
    0xff, 0xd9, // EOI
  ]);
}

// --- LECTURE NOMINALE --------------------------------------------------------
test("EXIF: DateTimeOriginal, modèle et ISO sont lus", () => {
  const bytes = buildJpegWithExif("2026:08:18 10:24:31", "ILCE-7M4", 800);
  const summary = readExifSummary(bytes);
  assert.equal(summary.capturedAt, "2026-08-18T10:24:31");
  assert.equal(summary.cameraModel, "ILCE-7M4");
  assert.equal(summary.iso, 800);
});

test("EXIF: deux clichés d'une même rafale se distinguent à la seconde près", () => {
  const a = readExifSummary(buildJpegWithExif("2026:08:18 10:24:31"));
  const b = readExifSummary(buildJpegWithExif("2026:08:18 10:24:32"));
  assert.ok(a.capturedAt && b.capturedAt);
  const delta =
    new Date(`${b.capturedAt}Z`).getTime() - new Date(`${a.capturedAt}Z`).getTime();
  assert.equal(delta, 1000, "l'écart doit être exploitable pour grouper une rafale");
});

// --- ROBUSTESSE --------------------------------------------------------------
test("EXIF: un fichier non-JPEG renvoie un résumé vide, sans exception", () => {
  const summary = readExifSummary(Uint8Array.from([1, 2, 3, 4, 5]));
  assert.deepEqual(summary, { capturedAt: null, cameraModel: null, lensModel: null, iso: null });
});

test("EXIF: un JPEG tronqué en plein EXIF ne lève pas", () => {
  const full = buildJpegWithExif("2026:08:18 10:24:31");
  for (const cut of [12, 20, 40, full.length - 4]) {
    const summary = readExifSummary(full.slice(0, cut));
    assert.ok(summary !== null);
    assert.ok(summary.capturedAt === null || typeof summary.capturedAt === "string");
  }
});

test("EXIF: un JPEG sans segment EXIF renvoie un résumé vide", () => {
  const summary = readExifSummary(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.equal(summary.capturedAt, null);
});

// --- NORMALISATION DE DATE ---------------------------------------------------
test("exifDateToIso convertit le format EXIF et refuse les dates invalides", () => {
  assert.equal(exifDateToIso("2026:08:18 10:24:31"), "2026-08-18T10:24:31");
  assert.equal(exifDateToIso("2026:08:18 10:24:31", "45"), "2026-08-18T10:24:31.450");
  assert.equal(exifDateToIso("2026:13:18 10:24:31"), null, "mois 13 refusé");
  assert.equal(exifDateToIso("2026:08:18 25:24:31"), null, "heure 25 refusée");
  assert.equal(exifDateToIso("pas une date"), null);
  assert.equal(exifDateToIso(""), null);
});

// --- MINIMISATION DES DONNÉES ------------------------------------------------
test("MINIMISATION: aucune lecture GPS n'est implémentée (choix RGPD explicite)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/photo/exif.ts", import.meta.url)),
    "utf8",
  );
  // 0x8825 = GPSInfoIFDPointer. Il ne doit apparaître nulle part.
  assert.ok(!source.includes("0x8825"), "le pointeur GPS ne doit pas être lu");
  assert.ok(!/GPSLatitude|GPSLongitude/.test(source));
});
