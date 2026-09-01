import type { PvDailyKpi } from "@/types/pvDailyKpi";
import type { PvLeadInbox, PvLeadInboxItem, PvLeadTemperature } from "@/types/pvLead";

const TEMPERATURE_LABELS: Record<PvLeadTemperature, string> = {
  FROID: "Froid",
  TIEDE: "Tiède",
  CHAUD: "Chaud",
  TRES_PRIORITAIRE: "Très prioritaire",
};

const VIEW_LABELS: Record<string, string> = {
  QUALIFIED: "Qualifiés",
  HIGH: "Identité HIGH",
  PROBABLE: "Identité PROBABLE",
  REPLIED: "Avec réponse",
  INTERESTED: "Intéressés",
  MEETING_REQUEST: "Demandes de RDV",
  NO_REPLY: "Sans réponse",
  CALL_PENDING: "À appeler",
  EMAIL_SEQUENCE_EXHAUSTED: "Séquence épuisée",
  DO_NOT_CONTACT: "Ne pas contacter",
};

function displayDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayAction(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replaceAll("_", " ");
}

function boolLabel(value: boolean | null): string {
  if (value === null) return "Non disponible";
  return value ? "Oui" : "Non";
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hasReply(lead: PvLeadInboxItem): boolean {
  return Boolean(lead.replyStatus || lead.replyClass || lead.replySummary);
}

function matchesView(lead: PvLeadInboxItem, view: string | null): boolean {
  if (!view) return true;
  const next = lead.nextAction?.toUpperCase() ?? null;
  const reply = (lead.replyClass || lead.replyStatus)?.toUpperCase() ?? null;
  const qualification = lead.qualificationStatus?.toUpperCase() ?? null;
  const confidence = lead.identityConfidence?.toUpperCase() ?? null;

  switch (view) {
    case "QUALIFIED":
      return lead.pvCommercialQualified === true || qualification === "QUALIFIED";
    case "HIGH":
      return confidence === "HIGH";
    case "PROBABLE":
      return confidence === "PROBABLE";
    case "REPLIED":
      return hasReply(lead);
    case "INTERESTED":
      return reply === "INTERESTED" || reply === "POSITIVE";
    case "MEETING_REQUEST":
      return reply === "MEETING_REQUEST";
    case "NO_REPLY":
      return reply === "NO_REPLY" || next === "WAIT_REPLY" || next === "SEND_FOLLOWUP";
    case "CALL_PENDING":
      return lead.callPending === true || next === "CALL_PENDING";
    case "EMAIL_SEQUENCE_EXHAUSTED":
      return next === "EMAIL_SEQUENCE_EXHAUSTED";
    case "DO_NOT_CONTACT":
      return next === "DO_NOT_CONTACT" || reply === "UNSUBSCRIBE" || reply === "OPPOSED";
    default:
      return true;
  }
}

function Fact({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function PvLeadInboxPanel({
  inbox,
  dailyKpi,
  filters,
}: {
  inbox: PvLeadInbox;
  dailyKpi: PvDailyKpi | null;
  filters: {
    search: string | null;
    temperature: PvLeadTemperature | null;
    needsCallback: boolean | null;
    view?: string | null;
  };
}) {
  const visibleItems = inbox.items.filter((lead) => matchesView(lead, filters.view ?? null));
  const hot = visibleItems.filter(
    (lead) => lead.leadTemperature === "CHAUD" || lead.leadTemperature === "TRES_PRIORITAIRE",
  ).length;
  const callbacks = visibleItems.filter(
    (lead) => lead.needsCallback || lead.callPending === true || lead.nextAction === "CALL_PENDING",
  ).length;

  return (
    <div className="page-stack">
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">AUTONOMOUS PROSPECT · PHOTOVOLTAÏQUE</span>
            <h3>Prospects</h3>
          </div>
          <span className="photo-session-meta">
            {visibleItems.length === 0
              ? "aucun prospect affiché"
              : `${visibleItems.length} prospect${visibleItems.length > 1 ? "s" : ""} affiché${visibleItems.length > 1 ? "s" : ""}`}
          </span>
        </div>

        {dailyKpi && (
          <div className="pv-pilot-grid">
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Qualifiés aujourd’hui</span>
              <strong>{dailyKpi.qualifiedCallableCount} / {dailyKpi.target}</strong>
            </div>
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Objectif semaine</span>
              <strong>{dailyKpi.weeklyCount} / {dailyKpi.weeklyTarget}</strong>
            </div>
            <div className="pv-pilot-stat">
              <span className="photo-session-meta">Reste aujourd’hui</span>
              <strong>{dailyKpi.remaining}</strong>
            </div>
          </div>
        )}

        <div className="pv-pilot-grid">
          <div className="pv-pilot-stat">
            <span className="photo-session-meta">Affichés</span>
            <strong>{visibleItems.length}</strong>
          </div>
          <div className="pv-pilot-stat">
            <span className="photo-session-meta">Chauds / prioritaires</span>
            <strong>{hot}</strong>
          </div>
          <div className="pv-pilot-stat">
            <span className="photo-session-meta">À rappeler</span>
            <strong>{callbacks}</strong>
          </div>
        </div>

        <form className="pv-filters" method="get" action="/prospects">
          <label className="agent-field">
            <span>Recherche</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.search ?? ""}
              placeholder="Entreprise, SIREN, ville, contact, e-mail, téléphone, domaine"
              maxLength={120}
            />
          </label>

          <label className="agent-field">
            <span>Vue opérationnelle</span>
            <select name="vue" defaultValue={filters.view ?? ""}>
              <option value="">Tous</option>
              {Object.entries(VIEW_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="agent-field">
            <span>Température</span>
            <select name="temperature" defaultValue={filters.temperature ?? ""}>
              <option value="">Toutes</option>
              {Object.entries(TEMPERATURE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="agent-field">
            <span>Rappel</span>
            <select
              name="rappel"
              defaultValue={filters.needsCallback === true ? "1" : filters.needsCallback === false ? "0" : ""}
            >
              <option value="">Tous</option>
              <option value="1">À rappeler</option>
              <option value="0">Sans rappel</option>
            </select>
          </label>

          <button type="submit" className="card-secondary-button">
            Filtrer
          </button>
        </form>
      </section>

      <section className="dashboard-card pv-card">
        {visibleItems.length === 0 ? (
          <p className="photo-empty">Aucun prospect ne correspond à ces critères.</p>
        ) : (
          <ul className="photo-session-list">
            {visibleItems.map((lead) => {
              const nextAt = displayDate(lead.nextActionAt);
              const nextAction = displayAction(lead.nextAction);
              const name = lead.companyName || lead.contactName || "Prospect";
              const contact = [lead.contactName, lead.contactRole, lead.email, lead.phone].filter(Boolean).join(" · ");
              const identifiers = [lead.siren ? `SIREN ${lead.siren}` : null, lead.siret ? `SIRET ${lead.siret}` : null]
                .filter(Boolean)
                .join(" · ");
              const sourceUrl = safeHttpUrl(lead.sourceUrl);
              const reply = lead.replyClass || lead.replyStatus;
              return (
                <li key={lead.prospectId} className="photo-session-item">
                  <div className="photo-session-main">
                    <strong>{name}</strong>
                    <span className="photo-session-meta">
                      {[lead.city, lead.sector || lead.activity].filter(Boolean).join(" · ") || "Localisation / activité non disponible"}
                    </span>
                    {identifiers && <span className="photo-session-meta">{identifiers}</span>}
                    <span className="photo-session-meta">
                      {contact || "Contact à rechercher"}
                    </span>
                    {lead.domain && <span className="photo-session-meta">Domaine : {lead.domain}</span>}
                    {(lead.identityConfidence || lead.contactScope) && (
                      <span className="photo-session-meta">
                        Identité : {lead.identityConfidence || "non évaluée"}
                        {lead.contactScope ? ` · portée ${lead.contactScope}` : ""}
                      </span>
                    )}
                    {(lead.qualificationStatus || lead.qualificationReason) && (
                      <span className="photo-session-meta">
                        Qualification : {lead.qualificationStatus || "non disponible"}
                        {lead.qualificationReason ? ` · ${lead.qualificationReason}` : ""}
                      </span>
                    )}
                    {(lead.emailStatus || reply || lead.followupsSent !== null) && (
                      <span className="photo-session-meta">
                        Communication : {lead.emailStatus || "email —"}
                        {reply ? ` · réponse ${reply}` : ""}
                        {lead.followupsSent !== null ? ` · relances ${lead.followupsSent}` : ""}
                      </span>
                    )}
                    {lead.replySummary && <span className="photo-session-meta">Réponse : {lead.replySummary}</span>}
                    {(nextAction || nextAt) && (
                      <span className="photo-session-meta">
                        Prochaine action : {nextAction || "rappel"}{nextAt ? ` · ${nextAt}` : ""}
                      </span>
                    )}

                    <details>
                      <summary className="photo-session-meta">Voir les preuves et le suivi complet</summary>
                      <dl className="pv-facts">
                        <Fact label="Source" value={[lead.sourceMethod, lead.sourceProvider].filter(Boolean).join(" · ") || null} />
                        <Fact label="Confiance identité" value={lead.identityConfidence} />
                        <Fact label="Portée contact" value={lead.contactScope} />
                        <Fact label="Preuves" value={lead.verificationSources.length ? lead.verificationSources.join(" · ") : null} />
                        <Fact label="PV commercial qualifié" value={boolLabel(lead.pvCommercialQualified)} />
                        <Fact label="Site PV vérifié" value={boolLabel(lead.pvSiteVerified)} />
                        <Fact label="Agent" value={lead.agentId} />
                        <Fact label="Workflow" value={lead.workflowId} />
                        <Fact label="Créé" value={displayDate(lead.createdAt)} />
                        <Fact label="Vérifié" value={displayDate(lead.verifiedAt)} />
                        <Fact label="Email envoyé" value={displayDate(lead.sentAt)} />
                        <Fact label="Email délivré" value={displayDate(lead.deliveredAt)} />
                        <Fact label="Bounce" value={lead.bounce === null ? null : boolLabel(lead.bounce)} />
                        <Fact label="Motif bounce" value={lead.bounceReason} />
                        <Fact label="Dernier contact" value={displayDate(lead.lastContactAt)} />
                        <Fact label="Appel en attente" value={lead.callPending === null ? null : boolLabel(lead.callPending)} />
                        <Fact label="Statut appel" value={lead.callStatus} />
                        <Fact label="Résultat appel" value={lead.callOutcome} />
                        <Fact label="Rendez-vous" value={lead.meetingStatus} />
                        <Fact label="Date RDV" value={displayDate(lead.meetingAt)} />
                      </dl>
                      {sourceUrl && (
                        <a href={sourceUrl} target="_blank" rel="noreferrer" className="card-secondary-button">
                          Ouvrir la source
                        </a>
                      )}
                    </details>
                  </div>
                  <div className="photo-session-side">
                    <span className="photo-badge">
                      {lead.leadTemperature ? TEMPERATURE_LABELS[lead.leadTemperature] : "Non évalué"}
                    </span>
                    {lead.identityConfidence && <span className="photo-session-meta">ID {lead.identityConfidence}</span>}
                    {(lead.needsCallback || lead.callPending === true || lead.nextAction === "CALL_PENDING") && (
                      <span className="photo-session-meta">À rappeler</span>
                    )}
                    {lead.qualificationScore !== null && (
                      <span className="photo-session-meta">Score {lead.qualificationScore}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
