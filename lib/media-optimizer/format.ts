import type { MediaBufferStatus, MediaJobStatus, MediaPreviewKind } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Formatage d'affichage (pur, sans I/O, testé).
 * Règle : une valeur absente s'affiche « — », jamais une valeur devinée.
 */

const NF1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Taille en octets → « 12,3 Mo ». `null`, négatif ou non fini → « — ». */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${NF0.format(bytes)} o`;
  if (bytes < 1024 ** 2) return `${NF1.format(bytes / 1024)} Ko`;
  if (bytes < 1024 ** 3) return `${NF1.format(bytes / 1024 ** 2)} Mo`;
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bytes / 1024 ** 3)} Go`;
}

/**
 * Réduction de taille. Utilise `reportedPct` s'il est fourni ; sinon la déduit
 * des deux tailles (jamais d'une seule).
 */
export function computeReductionPct(
  before: number | null | undefined,
  after: number | null | undefined,
  reportedPct?: number | null,
): number | null {
  if (reportedPct !== null && reportedPct !== undefined && Number.isFinite(reportedPct)) return reportedPct;
  if (before === null || before === undefined || after === null || after === undefined) return null;
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
  return ((before - after) / before) * 100;
}

/** Un fichier plus gros qu'avant est dit « agrandi », pas présenté comme un gain. */
export function formatReduction(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "0 %";
  return rounded > 0 ? `−${NF1.format(rounded)} %` : `+${NF1.format(-rounded)} % (agrandi)`;
}

export function formatSeconds(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${NF1.format(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

export const STATUS_LABEL: Record<MediaJobStatus, string> = {
  discovered: "Découvert",
  technically_usable: "Techniquement utilisable",
  queued: "En file d’attente",
  processing: "En cours d’optimisation",
  optimized: "Optimisé",
  ready_to_publish: "Prêt",
  blocked: "Bloqué",
  failed: "Échec",
};

export type StatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

export function statusTone(status: MediaJobStatus): StatusTone {
  switch (status) {
    case "queued":
    case "processing":
      return "info";
    case "optimized":
    case "ready_to_publish":
      return "ok";
    case "blocked":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? "État inconnu";
}

export function networkLabel(network: string | null | undefined): string {
  if (network === "instagram") return "Instagram";
  if (network === "facebook") return "Facebook";
  return "—";
}

export function bufferStatusLabel(status: MediaBufferStatus | null | undefined): string {
  switch (status) {
    case "draft":
      return "Brouillon créé";
    case "sent":
      return "Envoyé à Buffer";
    case "deleted":
      return "Brouillon supprimé";
    case "error":
      return "Erreur Buffer";
    default:
      return "Aucun brouillon";
  }
}

/** Contrôle de compatibilité réseau : `null` = non évalué. */
export function compatLabel(ok: boolean | null | undefined): string {
  if (ok === true) return "compatible";
  if (ok === false) return "non conforme";
  return "non évalué";
}

/**
 * `aspect` vient de `result->'aspect'` (JSON libre) : on accepte une chaîne, un
 * nombre (ratio) ou un objet portant `label`/`ratio`/`width`/`height`. Tout le
 * reste → `null` (rien d'inventé).
 */
export function formatAspect(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return `ratio ${NF1.format(raw)}`;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["label", "name", "value", "ratio_label"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    const w = typeof o.width === "number" ? o.width : null;
    const h = typeof o.height === "number" ? o.height : null;
    if (w && h) return `${w}×${h}`;
    if (typeof o.ratio === "number" && Number.isFinite(o.ratio)) return `ratio ${NF1.format(o.ratio)}`;
  }
  return null;
}

/** `warnings` : tableau de chaînes ou d'objets `{message|text|label|code}` → liste de chaînes non vides. */
export function normalizeWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push(item.trim());
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const v = [o.message, o.text, o.label, o.code].find((x) => typeof x === "string" && (x as string).trim());
      if (typeof v === "string") out.push(v.trim());
    }
  }
  return out;
}

export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(d);
}

/** Extrait de légende (coupe sur un espace, ajoute « … »). */
export function captionExcerpt(caption: string | null | undefined, max = 160): string | null {
  if (!caption) return null;
  const flat = caption.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export const PREVIEW_KIND_LABEL: Record<MediaPreviewKind, string> = {
  orig: "Original",
  opt: "Optimisé",
  orig_crop: "Original — détail",
  opt_crop: "Optimisé — détail",
  pad916: "Cadrage vertical 9:16",
};
