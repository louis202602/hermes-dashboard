import type { PvLeadInbox, PvLeadTemperature } from "@/types/pvLead";

const TEMPERATURE_LABELS: Record<PvLeadTemperature, string> = {
  FROID: "Froid",
  TIEDE: "Tiède",
  CHAUD: "Chaud",
  TRES_PRIORITAIRE: "Très prioritaire",
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

export default function PvLeadInboxPanel({
  inbox,
  filters,
}: {
  inbox: PvLeadInbox;
  filters: {
    search: string | null;
    temperature: PvLeadTemperature | null;
    needsCallback: boolean | null;
  };
}) {
  const hot = inbox.items.filter(
    (lead) => lead.leadTemperature === "CHAUD" || lead.leadTemperature === "TRES_PRIORITAIRE",
  ).length;
  const callbacks = inbox.items.filter((lead) => lead.needsCallback).length;

  return (
    <div className="page-stack">
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Prospects</h3>
          </div>
          <span className="photo-session-meta">
            {inbox.total === 0 ? "aucun prospect" : `${inbox.total} prospect${inbox.total > 1 ? "s" : ""}`}
          </span>
        </div>

        <div className="pv-pilot-grid">
          <div className="pv-pilot-stat">
            <span className="photo-session-meta">Affichés</span>
            <strong>{inbox.items.length}</strong>
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
              placeholder="Entreprise, ville, contact, e-mail, téléphone"
              maxLength={120}
            />
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
        {inbox.items.length === 0 ? (
          <p className="photo-empty">Aucun prospect ne correspond à ces critères.</p>
        ) : (
          <ul className="photo-session-list">
            {inbox.items.map((lead) => {
              const nextAt = displayDate(lead.nextActionAt);
              const nextAction = displayAction(lead.nextAction);
              const name = lead.companyName || lead.contactName || "Prospect";
              const contact = [lead.contactName, lead.email, lead.phone].filter(Boolean).join(" · ");
              return (
                <li key={lead.prospectId} className="photo-session-item">
                  <div className="photo-session-main">
                    <strong>{name}</strong>
                    {lead.city && <span className="photo-session-meta">{lead.city}</span>}
                    <span className="photo-session-meta">
                      {contact || "Contact à rechercher"}
                    </span>
                    <span className="photo-session-meta">
                      {lead.priorityReason || lead.replySummary || "Enrichissement en cours"}
                    </span>
                    {(nextAction || nextAt) && (
                      <span className="photo-session-meta">
                        Prochaine action : {nextAction || "rappel"}{nextAt ? ` · ${nextAt}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="photo-session-side">
                    <span className="photo-badge">{TEMPERATURE_LABELS[lead.leadTemperature]}</span>
                    {lead.needsCallback && <span className="photo-session-meta">À rappeler</span>}
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
