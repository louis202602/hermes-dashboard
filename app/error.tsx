"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Catches uncaught exceptions in the page tree and
 * shows a generic, safe fallback — it never renders internal error details in
 * the UI. The `digest` (a stable, non-sensitive id) is shown to help support
 * correlate reports, and the raw error is logged for future observability.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Placeholder for future observability wiring (Sentry, etc.). No backend yet.
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
        textAlign: "center",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <span style={{ fontSize: "0.8rem", letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        HERMÈS OS
      </span>
      <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Une erreur est survenue</h1>
      <p style={{ margin: 0, maxWidth: "36rem", color: "var(--text-secondary)" }}>
        Un incident technique a interrompu l’affichage de cette section. Vous
        pouvez réessayer ; si le problème persiste, contactez le support.
      </p>
      {error.digest ? (
        <code style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Référence : {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={() => unstable_retry()}
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 1.2rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--accent-soft)",
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        Réessayer
      </button>
    </main>
  );
}
