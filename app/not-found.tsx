import Link from "next/link";

/**
 * 404 page. Server Component — shows a generic "not found" UI and a way back to
 * the dashboard. Reuses theme tokens so it respects dark/light.
 */
export default function NotFound() {
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
      <span
        style={{
          fontSize: "0.8rem",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
        }}
      >
        ERREUR 404
      </span>
      <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Page introuvable</h1>
      <p style={{ margin: 0, maxWidth: "36rem", color: "var(--text-secondary)" }}>
        La page demandée n’existe pas ou a été déplacée.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "0.5rem",
          padding: "0.6rem 1.2rem",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--accent-soft)",
          color: "var(--text)",
          textDecoration: "none",
        }}
      >
        Retour au tableau de bord
      </Link>
    </main>
  );
}
