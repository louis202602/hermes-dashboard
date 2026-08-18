"use client";

import { useState, useTransition } from "react";

import { markSessionShotAction } from "@/app/actions/photo";
import type { PhotoNextAction } from "@/types/photo";

/**
 * PHOTO-P0 — Le geste « j'ai terminé la séance ».
 *
 * N'est rendu QUE lorsque la projection serveur dit que c'est effectivement la
 * prochaine action : l'UI n'invente jamais un bouton que l'état ne justifie pas.
 * L'écriture est idempotente côté base (le statut ne recule jamais).
 */
export default function PhotoSessionActions({
  sessionId,
  nextAction,
}: {
  sessionId: string;
  nextAction: PhotoNextAction;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  if (nextAction !== "MARK_SHOT") return null;

  return (
    <>
      <button
        type="button"
        className="card-secondary-button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await markSessionShotAction(sessionId);
            setFeedback(
              result.phase === "ok"
                ? "Séance déclarée réalisée."
                : (result.message ?? "Action refusée."),
            );
          })
        }
      >
        {pending ? "Enregistrement…" : "J’ai terminé la séance"}
      </button>
      {feedback ? (
        <span className="photo-session-meta" role="status">
          {feedback}
        </span>
      ) : null}
    </>
  );
}
