import Link from "next/link";

import {
  PV_PROSPECT_STATUS_LABELS,
  PV_PROSPECT_TYPE_LABELS,
  pvProspectName,
} from "@/lib/pv/status";
import type { PvProspectList } from "@/types/pv";

/**
 * PV-2 — liste des prospects photovoltaïques.
 *
 * ÉTAT VIDE HONNÊTE : aucune donnée PV réelle n'existe aujourd'hui. Cet écran ne
 * fabrique donc AUCUN exemple, aucune ligne de démonstration, aucun chiffre
 * illustratif. Il dit ce qui est vrai — « aucun prospect » — et distingue les
 * deux cas que l'on confond souvent :
 *   * le tenant n'a AUCUN prospect        ⇒ message de démarrage ;
 *   * le tenant en a, mais le FILTRE ne rend rien ⇒ message de recherche.
 */
export default function PvProspectsPanel({
  list,
  filters,
}: {
  list: PvProspectList;
  filters: { search: string | null; status: string | null; type: string | null };
}) {
  const hasFilters = Boolean(filters.search || filters.status || filters.type);

  return (
    <section className="dashboard-card pv-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
          <h3>Prospects</h3>
        </div>
        <span className="photo-session-meta">
          {list.total === 0
            ? "aucun prospect"
            : `${list.items.length} affiché${list.items.length > 1 ? "s" : ""} sur ${list.total}`}
        </span>
      </div>

      <form className="pv-filters" method="get" action="/etudes">
        <label className="agent-field">
          <span>Recherche</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.search ?? ""}
            placeholder="Nom, société, e-mail, téléphone"
            maxLength={120}
          />
        </label>
        <label className="agent-field">
          <span>Statut</span>
          <select name="statut" defaultValue={filters.status ?? ""}>
            <option value="">Tous</option>
            {Object.entries(PV_PROSPECT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="agent-field">
          <span>Type</span>
          <select name="type" defaultValue={filters.type ?? ""}>
            <option value="">Tous</option>
            {Object.entries(PV_PROSPECT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="card-secondary-button">
          Filtrer
        </button>
      </form>

      {list.items.length === 0 ? (
        <p className="photo-empty">
          {hasFilters
            ? "Aucun prospect ne correspond à ces critères."
            : "Aucun prospect photovoltaïque enregistré. Créez le premier ci-dessous — rien n’est pré-rempli."}
        </p>
      ) : (
        <ul className="photo-session-list">
          {list.items.map((p) => (
            <li key={p.id} className="photo-session-item">
              <Link href={`/etudes/${p.id}`} className="photo-session-main">
                <strong>{pvProspectName(p)}</strong>
                <span className="photo-session-meta">
                  {PV_PROSPECT_TYPE_LABELS[p.prospectType] ?? p.prospectType}
                  {` · ${p.siteCount} site${p.siteCount > 1 ? "s" : ""}`}
                  {p.optedOut ? " · désinscrit" : ""}
                </span>
              </Link>
              <div className="photo-session-side">
                <span className="photo-badge">
                  {PV_PROSPECT_STATUS_LABELS[p.status] ?? p.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
