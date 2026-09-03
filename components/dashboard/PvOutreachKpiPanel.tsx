import type { PvOutreachKpi, PvOutreachWorkerStatus } from "@/types/pvOutreachKpi";

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="pv-pilot-stat">
      <span className="photo-session-meta">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="photo-session-meta">{detail}</span> : null}
    </div>
  );
}

function displayDateTime(value: string | null): string {
  if (!value) return "Aucun";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function workerLabel(status: PvOutreachWorkerStatus): string {
  switch (status) {
    case "ENVOI_ACTIF": return "ENVOI ACTIF";
    case "EN_ATTENTE": return "EN ATTENTE";
    case "BLOQUE": return "BLOQUÉ";
    case "REPOS": return "REPOS";
    default: return "INCONNU";
  }
}

function workerDetail(kpi: PvOutreachKpi): string {
  switch (kpi.workerStatus) {
    case "ENVOI_ACTIF": return `${kpi.sendingToday} mail${kpi.sendingToday > 1 ? "s" : ""} pris par le worker`;
    case "EN_ATTENTE": return `${kpi.queuedToday} mail${kpi.queuedToday > 1 ? "s" : ""} en file, prochain cycle attendu`;
    case "BLOQUE": return `${kpi.queuedToday} mail${kpi.queuedToday > 1 ? "s" : ""} en attente depuis plus de 10 min sans activité`;
    case "REPOS": return "aucun mail en attente";
    default: return "état du worker non déterminé";
  }
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
          {kpi ? `${kpi.engagedToday} engagés · plafond ${kpi.dailyCap}` : "données indisponibles"}
        </span>
      </div>

      {!kpi ? (
        <p className="photo-empty">Impossible de charger les compteurs réels d’envoi.</p>
      ) : (
        <>
          <div className="pv-pilot-grid">
            <Stat label="Moteur d’envoi" value={workerLabel(kpi.workerStatus)} detail={workerDetail(kpi)} />
            <Stat label="Dernier mail réellement envoyé" value={displayDateTime(kpi.lastSentAt)} detail="statut SENT confirmé" />
            <Stat label="Plus ancien mail prêt" value={displayDateTime(kpi.oldestDueQueuedAt)} detail={kpi.queuedToday ? `${kpi.queuedToday} en file` : "file vide"} />
            <Stat label="Plafond journalier" value={kpi.dailyCap} detail={`minimum ${kpi.target}/jour`} />
          </div>

          <div className="pv-pilot-grid">
            <Stat label="Envoyés" value={kpi.sentToday} detail="confirmés par le transporteur" />
            <Stat label="En cours" value={kpi.sendingToday} detail="pris par le worker" />
            <Stat label="En file" value={kpi.queuedToday} detail="en attente d’envoi" />
            <Stat label="Minimum du jour" value={`${kpi.engagedToday} / ${kpi.target}`} detail={kpi.remainingToTarget ? `${kpi.remainingToTarget} restant${kpi.remainingToTarget > 1 ? "s" : ""}` : "minimum atteint, la prospection continue"} />
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
