"use client";

import { Camera, Check, Loader2, Plus, RotateCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  encodeImageFileToJpeg,
  pagesToPdfFile,
} from "@/lib/attachments/browserImage";
import type { PdfImagePage } from "@/lib/attachments/imagesToPdf";
import {
  PDF_MAX_BYTES,
  SCAN_MAX_PAGES,
  ensurePdfName,
  scanPdfFilename,
} from "@/lib/attachments/scan";

type ScanPage = { id: string; previewUrl: string; page: PdfImagePage };

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Simple, premium "scan a document" flow: capture page 1 → preview → add / remove
 * / retake pages → name → generate a single (multi-page) PDF. The PDF is handed
 * back via `onComplete` and then flows through the SAME Phase B upload pipeline
 * as any other attachment. Capture + conversion only — no analysis of content.
 */
export default function ScanDocumentModal({
  onComplete,
  onClose,
}: {
  onComplete: (file: File) => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [name, setName] = useState<string>(() => scanPdfFilename(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retakeIndexRef = useRef<number | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<ScanPage[]>([]);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Revoke all preview object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  const openCapture = useCallback((retakeIdx: number | null) => {
    retakeIndexRef.current = retakeIdx;
    setError(null);
    captureInputRef.current?.click();
  }, []);

  const onCaptured = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = ""; // allow re-picking the same file
      if (!file) return;

      const retakeIdx = retakeIndexRef.current;
      retakeIndexRef.current = null;

      if (retakeIdx === null && pagesRef.current.length >= SCAN_MAX_PAGES) {
        setError(`Un scan est limité à ${SCAN_MAX_PAGES} pages.`);
        return;
      }

      setBusy(true);
      try {
        const enc = await encodeImageFileToJpeg(file);
        const previewUrl = URL.createObjectURL(enc.blob);
        const page: PdfImagePage = {
          jpeg: enc.jpeg,
          width: enc.width,
          height: enc.height,
        };
        setPages((prev) => {
          if (retakeIdx !== null && prev[retakeIdx]) {
            URL.revokeObjectURL(prev[retakeIdx].previewUrl);
            const next = prev.slice();
            next[retakeIdx] = { id: prev[retakeIdx].id, previewUrl, page };
            return next;
          }
          return [...prev, { id: uid(), previewUrl, page }];
        });
      } catch {
        setError(
          "Impossible de lire cette image. Réessayez ou choisissez une autre photo.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setError(null);
  }

  function cancel() {
    for (const p of pagesRef.current) URL.revokeObjectURL(p.previewUrl);
    onClose();
  }

  function finish() {
    if (pages.length === 0) {
      setError("Ajoutez au moins une page.");
      return;
    }
    setBusy(true);
    try {
      const filename = ensurePdfName(name, scanPdfFilename(new Date()));
      const file = pagesToPdfFile(
        pages.map((p) => p.page),
        filename,
      );
      if (file.size > PDF_MAX_BYTES) {
        setError(
          `Le PDF généré est trop volumineux (max ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} Mo). Retirez des pages.`,
        );
        setBusy(false);
        return;
      }
      for (const p of pagesRef.current) URL.revokeObjectURL(p.previewUrl);
      onComplete(file);
    } catch {
      setError("La génération du PDF a échoué. Réessayez.");
      setBusy(false);
    }
  }

  return (
    <div
      className="scan-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Scanner un document"
    >
      <div className="scan-modal">
        <header className="scan-modal-head">
          <div>
            <span className="panel-eyebrow">SCANNER UN DOCUMENT</span>
            <h3>Composez votre PDF</h3>
          </div>
          <button
            type="button"
            className="scan-close"
            onClick={cancel}
            aria-label="Fermer"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onCaptured}
          className="hermes-file-input"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="scan-capture-input"
        />

        {pages.length === 0 ? (
          <button
            type="button"
            className="scan-empty"
            onClick={() => openCapture(null)}
            disabled={busy}
            data-testid="scan-start"
          >
            {busy ? (
              <Loader2 size={26} strokeWidth={1.8} className="scan-spin" />
            ) : (
              <Camera size={26} strokeWidth={1.7} />
            )}
            <strong>Prendre la première page</strong>
            <span>Photographiez le document — vous pourrez ajouter des pages.</span>
          </button>
        ) : (
          <>
            <ul className="scan-page-list" data-testid="scan-page-list">
              {pages.map((p, i) => (
                <li key={p.id} className="scan-page">
                  <span className="scan-page-index">{i + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`Page ${i + 1}`} />
                  <div className="scan-page-actions">
                    <button
                      type="button"
                      onClick={() => openCapture(i)}
                      disabled={busy}
                      title="Reprendre cette page"
                      aria-label={`Reprendre la page ${i + 1}`}
                    >
                      <RotateCw size={13} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePage(p.id)}
                      disabled={busy}
                      title="Retirer cette page"
                      aria-label={`Retirer la page ${i + 1}`}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </div>
                </li>
              ))}
              {pages.length < SCAN_MAX_PAGES ? (
                <li className="scan-page-add">
                  <button
                    type="button"
                    onClick={() => openCapture(null)}
                    disabled={busy}
                    data-testid="scan-add-page"
                  >
                    {busy ? (
                      <Loader2 size={20} strokeWidth={1.8} className="scan-spin" />
                    ) : (
                      <Plus size={20} strokeWidth={2} />
                    )}
                    <span>Ajouter une page</span>
                  </button>
                </li>
              ) : null}
            </ul>

            <label className="scan-name">
              <span>Nom du fichier</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                data-testid="scan-name-input"
              />
            </label>
          </>
        )}

        {error ? (
          <p className="scan-error" role="status">
            {error}
          </p>
        ) : null}

        <footer className="scan-modal-foot">
          <span className="scan-count">
            {pages.length} page{pages.length > 1 ? "s" : ""} · max {SCAN_MAX_PAGES}
          </span>
          <div className="scan-foot-buttons">
            <button type="button" className="scan-btn-secondary" onClick={cancel}>
              Annuler
            </button>
            <button
              type="button"
              className="scan-btn-primary"
              onClick={finish}
              disabled={busy || pages.length === 0}
              data-testid="scan-finish"
            >
              <Check size={15} strokeWidth={2.2} />
              <span>Joindre le PDF</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
