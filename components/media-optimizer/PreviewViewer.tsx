import { formatBytes, formatSeconds, PREVIEW_KIND_LABEL } from "@/lib/media-optimizer/format";
import type { MediaPreview, MediaPreviewKind } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Rendu PUR (sans état) des aperçus avant/après.
 * Importé par la visionneuse cliente et par le harnais de captures d'écran.
 * Aucune donnée n'est fabriquée : une colonne sans image affiche « Non disponible ».
 */

export type PreviewSection = "full" | "crop" | "vertical";

export const SECTION_LABEL: Record<PreviewSection, string> = {
  full: "Avant / après",
  crop: "Détails des panneaux",
  vertical: "Cadrage vertical 9:16",
};

interface Pair {
  pos: number;
  left: MediaPreview | null;
  right: MediaPreview | null;
}

function pairs(previews: MediaPreview[], leftKind: MediaPreviewKind, rightKind: MediaPreviewKind): Pair[] {
  const positions = new Set<number>();
  for (const p of previews) if (p.kind === leftKind || p.kind === rightKind) positions.add(p.pos);
  return [...positions]
    .sort((a, b) => a - b)
    .map((pos) => ({
      pos,
      left: previews.find((p) => p.kind === leftKind && p.pos === pos) ?? null,
      right: previews.find((p) => p.kind === rightKind && p.pos === pos) ?? null,
    }));
}

export function availableSections(previews: MediaPreview[]): PreviewSection[] {
  const out: PreviewSection[] = [];
  if (previews.some((p) => p.kind === "orig" || p.kind === "opt")) out.push("full");
  if (previews.some((p) => p.kind === "orig_crop" || p.kind === "opt_crop")) out.push("crop");
  if (previews.some((p) => p.kind === "pad916")) out.push("vertical");
  return out;
}

/** Texte alternatif en français, sans prétendre décrire le contenu de l'image. */
export function previewAlt(p: MediaPreview): string {
  const when = p.tSec !== null ? ` à l’instant ${formatSeconds(p.tSec)}` : "";
  switch (p.kind) {
    case "orig":
      return `Image du fichier original${when}`;
    case "opt":
      return `Image du fichier optimisé${when}`;
    case "orig_crop":
      return `Détail agrandi du fichier original${when}`;
    case "opt_crop":
      return `Détail agrandi du fichier optimisé${when}`;
    case "pad916":
      return `Cadrage vertical 9:16 avec fond flouté${when}`;
  }
}

function Figure({ p, label }: { p: MediaPreview | null; label: string }) {
  if (!p) {
    return (
      <figure className="mo-fig mo-fig-empty">
        <div className="mo-fig-missing">Non disponible</div>
        <figcaption>{label}</figcaption>
      </figure>
    );
  }
  const dims = p.width && p.height ? ` · ${p.width}×${p.height}` : "";
  return (
    <figure className="mo-fig">
      {/* Image `data:` générée par l'optimiseur : next/image n'apporte rien ici. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:${p.mime};base64,${p.dataB64}`}
        alt={previewAlt(p)}
        width={p.width ?? undefined}
        height={p.height ?? undefined}
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        <strong>{label}</strong>
        {p.tSec !== null ? ` · instant ${formatSeconds(p.tSec)}` : ""}
        {dims}
      </figcaption>
    </figure>
  );
}

export function PreviewViewer({
  previews,
  section,
  sizeBefore,
  sizeAfter,
}: {
  previews: MediaPreview[];
  section: PreviewSection;
  sizeBefore?: number | null;
  sizeAfter?: number | null;
}) {
  if (section === "vertical") {
    const items = previews.filter((p) => p.kind === "pad916");
    return (
      <div className="mo-vert-grid">
        {items.map((p, i) => (
          <Figure key={`${p.kind}-${p.pos}-${i}`} p={p} label={PREVIEW_KIND_LABEL.pad916} />
        ))}
      </div>
    );
  }
  const rows = section === "crop" ? pairs(previews, "orig_crop", "opt_crop") : pairs(previews, "orig", "opt");
  const leftLabel = section === "crop" ? PREVIEW_KIND_LABEL.orig_crop : PREVIEW_KIND_LABEL.orig;
  const rightLabel = section === "crop" ? PREVIEW_KIND_LABEL.opt_crop : PREVIEW_KIND_LABEL.opt;
  return (
    <div className="mo-compare">
      <div className="mo-compare-head" aria-hidden="true">
        <span>Original{sizeBefore ? ` · ${formatBytes(sizeBefore)}` : ""}</span>
        <span>Optimisé{sizeAfter ? ` · ${formatBytes(sizeAfter)}` : ""}</span>
      </div>
      {rows.map((r) => (
        <div className="mo-compare-row" key={r.pos}>
          <Figure p={r.left} label={leftLabel} />
          <Figure p={r.right} label={rightLabel} />
        </div>
      ))}
    </div>
  );
}
