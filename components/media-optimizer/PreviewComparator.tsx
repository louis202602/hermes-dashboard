"use client";

import { useId, useRef, useState } from "react";

import { availableSections, PreviewViewer, SECTION_LABEL, type PreviewSection } from "@/components/media-optimizer/PreviewViewer";
import type { MediaPreview, MediaPreviewsResult } from "@/types/mediaOptimizer";

/**
 * MEDIA-OPT — Comparateur avant/après, chargé À LA DEMANDE.
 * Les images (base64, lourdes) ne sont jamais dans la liste : elles sont
 * demandées pour un seul média quand on ouvre la visionneuse.
 */

type Phase =
  | { name: "closed" }
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "empty" }
  | { name: "ready"; previews: MediaPreview[]; sections: PreviewSection[]; section: PreviewSection };

const ERROR_TEXT: Record<string, string> = {
  RPC_ERROR: "Le service d’aperçus ne répond pas (la migration des aperçus est peut-être en attente).",
  NO_TENANT: "Aucune entreprise active n’est associée à ce compte.",
  UNAUTHENTICATED: "Session expirée : reconnectez-vous.",
  INVALID_ID: "Identifiant de média invalide.",
};

export function PreviewComparator({
  jobId,
  sizeBefore,
  sizeAfter,
  loadPreviews,
}: {
  jobId: string;
  sizeBefore: number | null;
  sizeAfter: number | null;
  loadPreviews: (jobId: string) => Promise<MediaPreviewsResult>;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "closed" });
  const panelRef = useRef<HTMLDivElement>(null);
  const token = useRef(0);
  const panelId = useId();
  const open = phase.name !== "closed";

  async function load() {
    const mine = ++token.current;
    setPhase({ name: "loading" });
    let res: MediaPreviewsResult;
    try {
      res = await loadPreviews(jobId);
    } catch {
      res = { ok: false, code: "RPC_ERROR" };
    }
    if (mine !== token.current) return; // fermé ou relancé entre-temps
    if (!res.ok) {
      setPhase({ name: "error", message: ERROR_TEXT[res.code] ?? "Impossible de charger les aperçus." });
    } else if (res.previews.length === 0) {
      setPhase({ name: "empty" });
    } else {
      const sections = availableSections(res.previews);
      setPhase({ name: "ready", previews: res.previews, sections, section: sections[0] ?? "full" });
    }
    requestAnimationFrame(() => panelRef.current?.focus());
  }

  function close() {
    token.current++;
    setPhase({ name: "closed" });
  }

  return (
    <div className="mo-previews">
      <div className="mo-previews-bar">
        <button
          type="button"
          className="mo-btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : void load())}
        >
          {open ? "Masquer les aperçus" : "Voir l’avant / après"}
        </button>
        {phase.name === "ready" && phase.sections.length > 1 ? (
          <div className="mo-seg" role="group" aria-label="Type d’aperçu">
            {phase.sections.map((s) => (
              <button
                key={s}
                type="button"
                className="mo-btn mo-btn-seg"
                aria-pressed={phase.section === s}
                onClick={() => setPhase({ ...phase, section: s })}
              >
                {SECTION_LABEL[s]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div id={panelId} ref={panelRef} tabIndex={-1} className="mo-previews-panel" hidden={!open} aria-live="polite" aria-busy={phase.name === "loading"}>
        {phase.name === "loading" ? <p className="mo-state">Chargement des aperçus…</p> : null}
        {phase.name === "error" ? (
          <p className="mo-state mo-state-error" role="alert">
            {phase.message}{" "}
            <button type="button" className="mo-btn" onClick={() => void load()}>
              Réessayer
            </button>
          </p>
        ) : null}
        {phase.name === "empty" ? <p className="mo-state">Aucun aperçu n’a été généré pour ce média.</p> : null}
        {phase.name === "ready" ? (
          <>
            <h5 className="mo-previews-title">{SECTION_LABEL[phase.section]}</h5>
            <PreviewViewer previews={phase.previews} section={phase.section} sizeBefore={sizeBefore} sizeAfter={sizeAfter} />
          </>
        ) : null}
      </div>
    </div>
  );
}
