import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  averageHash,
  clamp01,
  computeSignals,
  differenceHash,
  exposureStats,
  hammingHex,
  isValidHash,
  laplacianVariance,
  normalizeSharpness,
  resampleGray,
  round5,
  toGrayscale,
} from "../lib/photo/imageStats.ts";

/**
 * PHOTO-P0 — mesures d'image.
 *
 * On vérifie ce qui compte vraiment pour le produit : que les mesures sont
 * bornées (contraintes de la base), que le flou est bien distingué du net, que
 * les empreintes détectent les quasi-doublons, et surtout que ce module ne prend
 * AUCUNE décision de tri.
 */

/** Fabrique un buffer RGBA à partir d'une fonction de luminance [0..255]. */
function makeRgba(width: number, height: number, fn: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const p = (y * width + x) * 4;
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return out;
}

// --- BORNES ------------------------------------------------------------------
test("clamp01/round5 neutralisent NaN, Infinity et les dépassements", () => {
  assert.equal(clamp01(Number.NaN), 0);
  assert.equal(clamp01(Number.POSITIVE_INFINITY), 1);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(round5(1.23456789), 1);
  assert.equal(round5(0.123456789), 0.12346);
});

test("computeSignals reste dans [0..1] et produit des empreintes valides", () => {
  const rgba = makeRgba(64, 48, (x, y) => (x * 7 + y * 13) % 256);
  const signal = computeSignals(rgba, 64, 48);
  for (const value of [signal.sharpness, signal.clipLow, signal.clipHigh, signal.brightness]) {
    assert.ok(value >= 0 && value <= 1, `hors bornes: ${value}`);
    assert.ok(Number.isFinite(value));
  }
  assert.ok(isValidHash(signal.ahash), signal.ahash);
  assert.ok(isValidHash(signal.dhash), signal.dhash);
});

// --- NETTETÉ -----------------------------------------------------------------
test("NETTETÉ: une image contrastée mesure nettement plus qu'un aplat", () => {
  const flat = toGrayscale(makeRgba(32, 32, () => 128), 32, 32);
  const sharp = toGrayscale(makeRgba(32, 32, (x) => (x % 2 === 0 ? 0 : 255)), 32, 32);
  const flatVar = laplacianVariance(flat, 32, 32);
  const sharpVar = laplacianVariance(sharp, 32, 32);
  assert.equal(flatVar, 0);
  assert.ok(sharpVar > flatVar, "le damier doit mesurer plus que l'aplat");
  assert.equal(normalizeSharpness(flatVar), 0);
  assert.equal(normalizeSharpness(sharpVar), 1, "une mire saturée est plafonnée à 1");
});

test("NETTETÉ: un dégradé doux mesure moins qu'un motif fin (flou vs net)", () => {
  const blurry = toGrayscale(makeRgba(64, 64, (x) => 40 + x * 2), 64, 64);
  const detailed = toGrayscale(makeRgba(64, 64, (x, y) => ((x >> 1) + (y >> 1)) % 2 ? 60 : 190), 64, 64);
  assert.ok(
    laplacianVariance(blurry, 64, 64) < laplacianVariance(detailed, 64, 64),
    "le dégradé doit être mesuré moins net que le motif",
  );
});

test("NETTETÉ: une image trop petite ne casse pas (retour 0)", () => {
  assert.equal(laplacianVariance(new Float32Array(4), 2, 2), 0);
  assert.equal(normalizeSharpness(-1), 0);
});

// --- EXPOSITION --------------------------------------------------------------
test("EXPOSITION: écrêtage bas/haut et luminosité moyenne sont mesurés séparément", () => {
  const black = toGrayscale(makeRgba(10, 10, () => 0), 10, 10);
  const white = toGrayscale(makeRgba(10, 10, () => 255), 10, 10);
  const mid = toGrayscale(makeRgba(10, 10, () => 128), 10, 10);

  const b = exposureStats(black);
  assert.equal(b.clipLow, 1);
  assert.equal(b.clipHigh, 0);
  assert.equal(b.brightness, 0);

  const w = exposureStats(white);
  assert.equal(w.clipLow, 0);
  assert.equal(w.clipHigh, 1);
  assert.equal(w.brightness, 1);

  const m = exposureStats(mid);
  assert.equal(m.clipLow, 0);
  assert.equal(m.clipHigh, 0);
  assert.ok(m.brightness > 0.49 && m.brightness < 0.51);
});

test("EXPOSITION: buffer vide → mesures nulles, jamais NaN", () => {
  const empty = exposureStats(new Float32Array(0));
  assert.deepEqual(empty, { clipLow: 0, clipHigh: 0, brightness: 0 });
});

// --- EMPREINTES --------------------------------------------------------------
test("EMPREINTES: deux images identiques ont une distance nulle", () => {
  const gray = toGrayscale(makeRgba(40, 40, (x, y) => (x * 5 + y * 3) % 256), 40, 40);
  assert.equal(hammingHex(averageHash(gray, 40, 40), averageHash(gray, 40, 40)), 0);
  assert.equal(hammingHex(differenceHash(gray, 40, 40), differenceHash(gray, 40, 40)), 0);
});

test("EMPREINTES: un quasi-doublon reste proche, une image différente s'éloigne", () => {
  const base = toGrayscale(makeRgba(48, 48, (x, y) => (x * 4 + y * 6) % 256), 48, 48);
  // Quasi-doublon : même scène + un léger bruit (comme une seconde vue de rafale).
  const near = toGrayscale(
    makeRgba(48, 48, (x, y) => ((x * 4 + y * 6) % 256) + ((x + y) % 3) - 1),
    48,
    48,
  );
  const other = toGrayscale(makeRgba(48, 48, (x, y) => (x * 31 + y * 17) % 256), 48, 48);

  const dNear = hammingHex(differenceHash(base, 48, 48), differenceHash(near, 48, 48));
  const dOther = hammingHex(differenceHash(base, 48, 48), differenceHash(other, 48, 48));
  assert.ok(dNear <= 6, `quasi-doublon attendu proche, distance=${dNear}`);
  assert.ok(dOther > dNear, "une image différente doit être plus éloignée");
});

test("EMPREINTES: hachage de longueurs différentes → distance infinie (fail-safe)", () => {
  assert.equal(hammingHex("00ff", "00ff00ff"), Number.POSITIVE_INFINITY);
  assert.equal(isValidHash("XYZ"), false);
  assert.equal(isValidHash("0123456789abcdef"), true);
});

// --- RÉÉCHANTILLONNAGE -------------------------------------------------------
test("RESAMPLE: la moyenne de boîte préserve un aplat et ne sort jamais des bornes", () => {
  const gray = toGrayscale(makeRgba(37, 23, () => 100), 37, 23);
  const small = resampleGray(gray, 37, 23, 8, 8);
  assert.equal(small.length, 64);
  for (const v of small) assert.ok(v > 0.38 && v < 0.4, `valeur inattendue ${v}`);
});

// --- PURETÉ / FRONTIÈRE ------------------------------------------------------
test("FRONTIÈRE: le module ne décide RIEN — aucun verdict, aucun seuil de tri", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/photo/imageStats.ts", import.meta.url)),
    "utf8",
  );
  for (const forbidden of [
    "KEEP_SUGGESTION",
    "REJECTED_SUGGESTION",
    "BEST_OF_SERIES",
    "delete",
    "fetch(",
    "document",
    "window",
  ]) {
    assert.ok(!source.includes(forbidden), `imageStats ne doit pas contenir « ${forbidden} »`);
  }
});
