import type { PvOutreachKpi } from "@/types/pvOutreachKpi";

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="pv-pilot-stat">
      <span className="photo-session-meta">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="photo-session-meta">{detail}</span> : null}
    </div>
  );
}

export default function PvOutreachKpiPanel({ kpi }: { kpi: PvOutreachKpi | null }) {
  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">AUTONOMOUS PROSPECT · ACTIVITÉ RÉELLE</span>
          <h3>Prospection aujourd’hui</h3>
        </div>
        <span className="photo-session-meta">
          {kpi ? `${kpi.engagedToday} / ${kpi.target} engagés` : "données indisponibles"}
        </span>
      </div>

      {!kpi ? (
        <p className="photo-empty">Impossible de charger les compteurs réels d’envoi.</p>
      ) : (
        <>
          <div className="pv-pilot-grid">
            <Stat label="Envoyés" value={kpi.sentToday} detail="confirmés par le transporteur" />
            <Stat label="En cours" value={kpi.sendingToday} detail="pris par le worker" />
            <Stat label="En file" value={kpi.queuedToday} detail="en attente d’envoi" />
            <Stat label="Objectif du jour" value={`${kpi.engagedToday} / ${kpi.target}`} detail={`${kpi.remainingToTarget} restant${kpi.remainingToTarget > 1 ? "s" : ""}`} />
          </div>

          <div className="pv-pilot-grid">
            <Stat label="Réponses" value={kpi.repliesToday} detail={`${kpi.actionableRepliesToday} à traiter`} />
            <Stat label="Bounces" value={kpi.bouncesToday} />
            <Stat label="Désinscriptions" value={kpi.unsubscribesToday} />
            <Stat label="Échecs d’envoi" value={kpi.failedToday} />
          </div>

          <div className="pv-pilot-grid">
            <Stat label="Prospects qualifiés" value={kpi.qualifiedTotal} />
            <Stat label="Avec email sélectionnable" value={kpi.qualifiedWithEmail} />
            <Stat label="STOP global" value={kpi.globalStopActive ? "ACTIF" : "INACTIF"} detail={kpi.globalStopActive ? "les garde-fous spécifiques PV restent appliqués" : undefined} />
          </div>
        </>
      )}
    </section>
  );
}
