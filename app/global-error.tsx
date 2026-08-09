"use client";

/**
 * Global error boundary. Replaces the root layout when a crash happens above the
 * route-level boundary, so it must render its own `<html>` and `<body>`. It is
 * fully self-contained (no theme tokens, no fonts) and shows only a generic,
 * safe message — never internal error details.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#060913",
          color: "#f7f9fc",
        }}
      >
        <title>Erreur — Hermès OS</title>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Une erreur est survenue</h1>
        <p style={{ margin: 0, maxWidth: "36rem", color: "#a8b3c7" }}>
          L’application a rencontré un problème inattendu. Veuillez réessayer.
        </p>
        {error.digest ? (
          <code style={{ fontSize: "0.75rem", color: "#6f7d96" }}>
            Référence : {error.digest}
          </code>
        ) : null}
        <button
          type="button"
          onClick={() => unstable_retry()}
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.2rem",
            borderRadius: "12px",
            border: "1px solid rgba(96, 165, 250, 0.28)",
            background: "rgba(65, 145, 255, 0.14)",
            color: "#f7f9fc",
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
