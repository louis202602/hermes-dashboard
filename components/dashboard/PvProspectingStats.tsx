import type { PvOutreachSnapshot } from "@/services/hermes/prospecting";

export default function PvProspectingStats({ snapshot }: { snapshot: PvOutreachSnapshot }) {
  const metrics = [
    ["Prospects trouvés", snapshot.found],
    ["Qualifiés", snapshot.qualified],
    ["Email-ready", snapshot.emailReady],
    ["Emails envoyés", snapshot.sent],
    ["Réponses", snapshot.replies],
    ["Intéressés", snapshot.interested],
  ] as const;

  return (
    <section className="dashboard-card commercial-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">AUTONOMOUS PROSPECT · AUJOURD’HUI</span>
          <h3>Prospection photovoltaïque B2B</h3>
        </div>
        <span className="provenance-badge provenance-real">RÉEL</span>
      </div>

      {!snapshot.ok ? (
        <p className="commercial-empty">Données de prospection indisponibles.</p>
      ) : (
        <>
          <div className="commercial-grid">
            {metrics.map(([label, value]) => (
              <div className="commercial-metric" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="commercial-note">
            Objectif minimum : {snapshot.minimumTarget} emails qualifiés/jour · plafond technique : {snapshot.technicalCap}/jour · qualité avant volume.
          </p>
        </>
      )}
    </section>
  );
}
