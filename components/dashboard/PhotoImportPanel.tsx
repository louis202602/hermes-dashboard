"use client";

import { useCallback, useRef, useState } from "react";

import {
  recordSignalsAction,
  registerImportAction,
  uploadPhotoProxyAction,
} from "@/app/actions/photo";
import {
  PHOTO_IMPORT_ACCEPT,
  preparePhotoForImport,
  type PreparedPhoto,
} from "@/lib/photo/browserProxy";

/**
 * PHOTO-P0 — Import navigateur + passe 1 déterministe.
 *
 * Tout le calcul se fait sur le poste de la photographe : le RAW ne part jamais,
 * seuls le proxy (~400 Ko) et la vignette (~40 Ko) sont téléversés. Coût IA = 0.
 *
 * Ordre fail-closed, à chaque étape :
 *   1. préparation locale (sha256, EXIF, proxy, vignette, mesures) ;
 *   2. enregistrement des RÉFÉRENCES → la base rend les `asset_id` ;
 *   3. téléversement des dérivés (le serveur décide seul du chemin) ;
 *   4. envoi des MESURES → la base dérive les verdicts.
 *
 * Une photo illisible n'est jamais perdue ni supprimée : elle est comptée en
 * échec, reste inventoriée, et reste visible dans la revue.
 */

type Phase = "idle" | "preparing" | "registering" | "uploading" | "scoring" | "done" | "error";

const UPLOAD_CONCURRENCY = 3;

export default function PhotoImportPanel({ sessionId }: { sessionId: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async (files: FileList) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setPhase("preparing");
      setTotal(list.length);
      setDone(0);
      setFailed(0);
      setMessage(null);

      // 1. Préparation locale.
      const prepared: PreparedPhoto[] = [];
      let localFailures = 0;
      for (const file of list) {
        try {
          prepared.push(await preparePhotoForImport(file));
        } catch {
          localFailures += 1;
          setFailed(localFailures);
        }
        setDone((n) => n + 1);
      }
      if (prepared.length === 0) {
        setPhase("error");
        setMessage("Aucune photo n’a pu être lue par le navigateur.");
        return;
      }

      // 2. Enregistrement des références.
      setPhase("registering");
      const registration = await registerImportAction(
        sessionId,
        prepared.map((p) => ({
          source_reference: p.filename,
          original_filename: p.filename,
          file_sha256: p.sha256,
          captured_at: p.capturedAt,
          camera_model: p.cameraModel,
          lens_model: p.lensModel,
          iso: p.iso,
          width: p.width,
          height: p.height,
        })),
      );
      if (!registration.ok) {
        setPhase("error");
        setMessage(`Import refusé (${registration.code}).`);
        return;
      }
      const idBySha = new Map(registration.assets.map((a) => [a.file_sha256, a.asset_id]));

      // 3. Téléversement des dérivés, par petits paquets.
      setPhase("uploading");
      setDone(0);
      setTotal(prepared.length);
      let uploadFailures = localFailures;
      const queue = [...prepared];
      const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const item = queue.shift();
          if (!item) return;
          const assetId = idBySha.get(item.sha256);
          if (!assetId) {
            uploadFailures += 1;
            setFailed(uploadFailures);
            setDone((n) => n + 1);
            continue;
          }
          const form = new FormData();
          form.set("session_id", sessionId);
          form.set("asset_id", assetId);
          form.set("proxy", new File([item.proxyBlob], "p1600.jpg", { type: "image/jpeg" }));
          form.set("thumb", new File([item.thumbBlob], "t400.jpg", { type: "image/jpeg" }));
          const result = await uploadPhotoProxyAction(form);
          if (result.phase !== "ok") {
            uploadFailures += 1;
            setFailed(uploadFailures);
          }
          setDone((n) => n + 1);
        }
      });
      await Promise.all(workers);

      // 4. Mesures → la base dérive les verdicts (aucun seuil côté client).
      setPhase("scoring");
      const signals = prepared
        .map((p) => {
          const assetId = idBySha.get(p.sha256);
          if (!assetId) return null;
          return {
            asset_id: assetId,
            sharpness: p.signal.sharpness,
            clip_low: p.signal.clipLow,
            clip_high: p.signal.clipHigh,
            brightness: p.signal.brightness,
            ahash: p.signal.ahash,
            dhash: p.signal.dhash,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const scored = await recordSignalsAction(sessionId, signals);
      if (scored.phase !== "ok") {
        setPhase("error");
        setMessage(`Tri non calculé (${scored.code}).`);
        return;
      }

      setPhase("done");
      setMessage(
        uploadFailures > 0
          ? `${prepared.length - uploadFailures} photo(s) importée(s), ${uploadFailures} en échec (conservée(s), à réimporter).`
          : `${prepared.length} photo(s) importée(s) et triée(s).`,
      );
    },
    [sessionId],
  );

  const busy =
    phase === "preparing" || phase === "registering" || phase === "uploading" || phase === "scoring";

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    preparing: "Analyse locale…",
    registering: "Enregistrement…",
    uploading: "Téléversement des aperçus…",
    scoring: "Calcul du tri…",
    done: "Terminé",
    error: "Erreur",
  };

  return (
    <section className="dashboard-card photo-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HERMÈS STUDIO</span>
          <h3>Importer des photos</h3>
        </div>
      </div>
      <p className="photo-note">
        Vos fichiers d’origine restent sur votre poste. Hermès ne téléverse qu’un aperçu
        compressé et une vignette, et les supprime automatiquement après 90 jours.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_IMPORT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void run(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        className="card-secondary-button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? phaseLabel[phase] : "Choisir des photos"}
      </button>

      {busy || phase === "done" ? (
        <p className="photo-session-meta" role="status" aria-live="polite">
          {phaseLabel[phase]} {total > 0 ? `${done}/${total}` : null}
          {failed > 0 ? ` · ${failed} en échec` : null}
        </p>
      ) : null}

      {message ? <p className="photo-session-meta">{message}</p> : null}
    </section>
  );
}
