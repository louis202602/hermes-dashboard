/**
 * PHOTO-P0 — Mesures d'image pures (aucun DOM, aucun réseau, aucune dépendance).
 *
 * Ce module ne produit QUE des mesures : netteté, écrêtage d'exposition,
 * luminosité, empreintes perceptuelles. Il ne décide RIEN.
 *
 * Frontière volontaire : les SEUILS, le regroupement en rafales, le choix du
 * meilleur de série et l'application des consignes de protection vivent dans
 * l'unique service métier `hermes_os.derive_photo_culling_verdicts`. Un verdict
 * n'est donc jamais calculé côté client, et un client modifié ne peut pas
 * fabriquer un verdict : il ne peut qu'envoyer des mesures, que la façade
 * re-borne de toute façon dans [0..1].
 *
 * COST-FIRST : tout ce fichier tourne dans le navigateur de la photographe, sur
 * des proxies qu'elle a déjà en local. Coût IA = 0, coût serveur = 0.
 *
 * RGPD : aucune détection de visage, aucun gabarit biométrique, aucune donnée
 * personnelle. Uniquement de la statistique d'image.
 */

/** Une mesure complète pour une photo. Correspond 1:1 au payload de la façade. */
export type CullingSignal = {
  sharpness: number;
  clipLow: number;
  clipHigh: number;
  brightness: number;
  ahash: string;
  dhash: string;
};

/**
 * Borne une valeur dans [0..1]. `NaN` — c'est-à-dire une mesure impossible —
 * devient 0 plutôt que de propager une valeur invalide jusqu'aux contraintes
 * `numeric(6,5)` de la base ; `±Infinity` est ramené à la borne correspondante.
 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Arrondi à 5 décimales — la précision exacte des colonnes `numeric(6,5)`. */
export function round5(value: number): number {
  return Math.round(clamp01(value) * 1e5) / 1e5;
}

/**
 * Luminance perceptuelle (Rec. 601) d'un buffer RGBA, normalisée [0..1].
 * Le canal alpha est ignoré : les proxies sont des JPEG opaques.
 */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    out[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) / 255;
  }
  return out;
}

/**
 * Variance du Laplacien 4-voisins — l'indicateur de netteté classique : une
 * image floue a peu de contraste local, donc une variance faible. Le bord de
 * 1 px est exclu (le noyau y est indéfini).
 */
export function laplacianVariance(gray: Float32Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance > 0 ? variance : 0;
}

/**
 * Normalisation de la netteté vers [0..1].
 *
 * `SHARPNESS_REFERENCE` est la variance de Laplacien d'une image nette de
 * référence sur un proxy 1600 px. C'est une constante de CALIBRATION de la
 * mesure (comme une échelle de thermomètre), pas un seuil de décision : aucune
 * photo n'est gardée ou écartée ici. La courbe est concave (racine) pour ne pas
 * écraser toute la plage utile près de 0.
 */
export const SHARPNESS_REFERENCE = 0.0025;

export function normalizeSharpness(variance: number): number {
  if (!Number.isFinite(variance) || variance <= 0) return 0;
  return round5(Math.sqrt(variance / SHARPNESS_REFERENCE));
}

/**
 * Exposition : fraction de pixels écrêtés en bas (< 2 %) et en haut (> 98 %),
 * plus la luminosité moyenne. Trois mesures brutes, aucune appréciation.
 */
export function exposureStats(gray: Float32Array): {
  clipLow: number;
  clipHigh: number;
  brightness: number;
} {
  const n = gray.length;
  if (n === 0) return { clipLow: 0, clipHigh: 0, brightness: 0 };
  let low = 0;
  let high = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    if (v < 0.02) low++;
    else if (v > 0.98) high++;
    sum += v;
  }
  return {
    clipLow: round5(low / n),
    clipHigh: round5(high / n),
    brightness: round5(sum / n),
  };
}

/**
 * Ré-échantillonnage par moyenne de boîte vers une petite grille. Utilisé pour
 * les empreintes perceptuelles : la moyenne de boîte est stable au bruit et à
 * une légère recompression, ce qui est exactement ce qu'on veut pour détecter
 * des doublons.
 */
export function resampleGray(
  gray: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const out = new Float32Array(targetWidth * targetHeight);
  if (width <= 0 || height <= 0) return out;
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * height) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / targetHeight));
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * width) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / targetWidth));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          sum += gray[y * width + x];
          count++;
        }
      }
      out[ty * targetWidth + tx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/** Convertit 64 booléens en 16 caractères hexadécimaux (format attendu en base). */
function bitsToHex(bits: boolean[]): string {
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) if (bits[i + j]) nibble |= 1 << (3 - j);
    hex += nibble.toString(16);
  }
  return hex;
}

/** aHash 8×8 : chaque bit = « ce bloc est-il plus clair que la moyenne ? ». */
export function averageHash(gray: Float32Array, width: number, height: number): string {
  const small = resampleGray(gray, width, height, 8, 8);
  let mean = 0;
  for (let i = 0; i < 64; i++) mean += small[i];
  mean /= 64;
  const bits: boolean[] = [];
  for (let i = 0; i < 64; i++) bits.push(small[i] > mean);
  return bitsToHex(bits);
}

/** dHash 9×8 : chaque bit = « ce bloc est-il plus clair que son voisin de droite ? ».
 *  Plus robuste que l'aHash aux variations globales de luminosité. */
export function differenceHash(gray: Float32Array, width: number, height: number): string {
  const small = resampleGray(gray, width, height, 9, 8);
  const bits: boolean[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits.push(small[y * 9 + x] > small[y * 9 + x + 1]);
    }
  }
  return bitsToHex(bits);
}

/** Distance de Hamming entre deux empreintes hexadécimales de même longueur. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (!Number.isFinite(x)) return Number.POSITIVE_INFINITY;
    distance += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  return distance;
}

/** Une empreinte est valide si elle fait 16 caractères hexadécimaux minuscules. */
export function isValidHash(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

/**
 * Passe 1 complète pour une image décodée. Sortie directement conforme aux
 * contraintes de `hermes_os.photo_culling_signals`.
 */
export function computeSignals(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): CullingSignal {
  const gray = toGrayscale(rgba, width, height);
  const exposure = exposureStats(gray);
  return {
    sharpness: normalizeSharpness(laplacianVariance(gray, width, height)),
    clipLow: exposure.clipLow,
    clipHigh: exposure.clipHigh,
    brightness: exposure.brightness,
    ahash: averageHash(gray, width, height),
    dhash: differenceHash(gray, width, height),
  };
}
