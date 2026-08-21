"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { addCullingInstructionAction, applyReviewAction } from "@/app/actions/photo";
import { cullingSummary } from "@/lib/photo/sessionState";
import type { PhotoCullingReview as ReviewData, PhotoHumanDecision } from "@/types/photo";

/**
 * PHOTO-P0 — Grille de revue du tri.
 *
 * INVARIANT PRODUIT : la photographe décide, Hermès propose. « Écarter » retire
 * de la sélection et RIEN D'AUTRE — aucun bouton de cette interface ne supprime
 * un fichier, et aucune façade appelée ici ne le peut. Une photo protégée par une
 * consigne est signalée et ne peut pas être suggérée au rejet.
 *
 * Clavier : G = garder · E = écarter · ← → navigation. Les décisions sont
 * tamponnées localement puis envoyées en un lot — une seule écriture pour une
 * séance entière (COST-FIRST), et l'état serveur reste l'autorité.
 */

const VERDICT_LABEL: Record<string, string> = {
  KEEP_SUGGESTION: "Proposée",
  BEST_OF_SERIES: "Meilleure de la série",
  REJECTED_SUGGESTION: "Suggérée à l’écart",
};

const REASON_LABEL: Record<string, string> = {
  PROTECTED_BY_INSTRUCTION: "protégée par votre consigne",
  LOW_QUALITY: "netteté ou exposition faible",
  BEST_OF_BURST: "meilleure de la rafale",
  WEAKER_IN_BURST: "moins bonne que sa rafale",
  QUALITY_OK: "qualité correcte",
};

export default function PhotoCullingReview({
  sessionId,
  review,
}: {
  sessionId: string;
  review: ReviewData;
}) {
  const [decisions, setDecisions] = useState<Record<string, PhotoHumanDecision>>({});
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  const items = review.items;
  const summary = cullingSummary(review.state);

  // Décision courante = tampon local sinon décision déjà persistée.
  const decisionFor = useCallback(
    (assetId: string, persisted: PhotoHumanDecision | null): PhotoHumanDecision | null =>
      decisions[assetId] ?? persisted,
    [decisions],
  );

  const pending = useMemo(
    () =>
      Object.entries(decisions).map(([asset_id, decision]) => ({
        asset_id,
        decision,
      })),
    [decisions],
  );

  const decide = useCallback(
    (assetId: string, decision: PhotoHumanDecision) => {
      setDecisions((prev) => ({ ...prev, [assetId]: decision }));
      setCursor((c) => Math.min(c + 1, Math.max(items.length - 1, 0)));
    },
    [items.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const current = items[cursor];
      if (!current) return;
      const key = event.key.toLowerCase();
      if (key === "g") decide(current.assetId, "KEEP");
      else if (key === "e") decide(current.assetId, "DISCARD");
      else if (event.key === "ArrowRight") setCursor((c) => Math.min(c + 1, items.length - 1));
      else if (event.key === "ArrowLeft") setCursor((c) => Math.max(c - 1, 0));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, decide, items]);

  const save = useCallback(
    async (approveSelection: boolean) => {
      setSaving(true);
      setFeedback(null);
      const result = await applyReviewAction(sessionId, pending, approveSelection);
      setSaving(false);
      if (result.phase !== "ok") {
        setFeedback(result.message ?? "Enregistrement refusé.");
        return;
      }
      setDecisions({});
      setFeedback(
        result.selectionApproved
          ? "Sélection validée."
          : `Décisions enregistrées. ${result.undecidedRemaining ?? 0} photo(s) restante(s).`,
      );
    },
    [pending, sessionId],
  );

  const submitInstruction = useCallback(async () => {
    const text = instruction.trim();
    if (text.length === 0) return;
    setSaving(true);
    const result = await addCullingInstructionAction(sessionId, text);
    setSaving(false);
    setFeedback(result.phase === "ok" ? "Consigne enregistrée." : (result.message ?? "Refusée."));
    if (result.phase === "ok") setInstruction("");
  }, [instruction, sessionId]);

  if (!review.found) {
    return <p className="photo-empty">Séance introuvable.</p>;
  }
  if (items.length === 0) {
    return <p className="photo-empty">Aucune photo importée pour cette séance.</p>;
  }

  return (
    <div className="page-stack">
      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Revue du tri</h3>
          </div>
        </div>
        <p className="photo-session-meta">
          {summary.decided}/{summary.total} tranchées · {summary.kept} gardées ·{" "}
          {summary.discarded} écartées · {summary.protectedCount} protégées
        </p>
        <p className="photo-note">
          « Écarter » retire la photo de la sélection. Aucun fichier n’est supprimé, ni
          maintenant ni plus tard.
        </p>
        <p className="photo-note">
          Les suggestions reposent sur des seuils <strong>non encore calibrés</strong> sur
          vos séances : traitez-les comme un premier tri, pas comme un jugement de qualité.
        </p>

        <div className="photo-actions">
          <button
            type="button"
            className="card-secondary-button"
            disabled={saving || pending.length === 0}
            onClick={() => void save(false)}
          >
            Enregistrer ({pending.length})
          </button>
          <button
            type="button"
            className="card-secondary-button"
            disabled={saving || summary.total === 0}
            onClick={() => void save(true)}
            title="Possible seulement quand toutes les photos ont été tranchées"
          >
            Valider la sélection
          </button>
        </div>
        {feedback ? (
          <p className="photo-session-meta" role="status" aria-live="polite">
            {feedback}
          </p>
        ) : null}
      </section>

      <section className="dashboard-card photo-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">HERMÈS STUDIO</span>
            <h3>Consigne de tri</h3>
          </div>
        </div>
        <p className="photo-note">
          Exemple : « ne supprime aucune photo des grands-parents ». Une consigne comprise
          comme ambiguë est refusée plutôt que devinée.
        </p>
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Votre consigne…"
          className="photo-input"
          maxLength={500}
        />
        <button
          type="button"
          className="card-secondary-button"
          disabled={saving || instruction.trim().length === 0}
          onClick={() => void submitInstruction()}
        >
          Ajouter la consigne
        </button>
      </section>

      <section className="dashboard-card photo-card">
        <ul className="photo-grid">
          {items.map((item, index) => {
            const decision = decisionFor(item.assetId, item.humanDecision);
            return (
              <li
                key={item.assetId}
                className={`photo-cell${index === cursor ? " is-current" : ""}${
                  decision === "DISCARD" ? " is-discarded" : ""
                }`}
              >
                <button
                  type="button"
                  className="photo-cell-media"
                  onClick={() => setCursor(index)}
                  aria-label={`Sélectionner ${item.filename}`}
                >
                  {item.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="photo-cell-placeholder">
                      {item.proxyStatus === "FAILED" ? "illisible" : "aperçu indisponible"}
                    </span>
                  )}
                </button>
                <span className="photo-cell-meta">
                  <strong>{item.filename}</strong>
                  <span>
                    {item.verdict ? (VERDICT_LABEL[item.verdict] ?? item.verdict) : "non analysée"}
                    {item.reasonCode ? ` — ${REASON_LABEL[item.reasonCode] ?? item.reasonCode}` : ""}
                  </span>
                  {item.isProtected ? <span className="photo-badge">protégée</span> : null}
                </span>
                <span className="photo-cell-actions">
                  <button
                    type="button"
                    className={`photo-decide${decision === "KEEP" ? " is-active" : ""}`}
                    onClick={() => decide(item.assetId, "KEEP")}
                  >
                    Garder
                  </button>
                  <button
                    type="button"
                    className={`photo-decide is-discard${decision === "DISCARD" ? " is-active" : ""}`}
                    onClick={() => decide(item.assetId, "DISCARD")}
                  >
                    Écarter
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="photo-note">Clavier : G pour garder, E pour écarter, ← → pour naviguer.</p>
      </section>
    </div>
  );
}
