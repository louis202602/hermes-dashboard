import { requireRoute } from "@/lib/dashboard/routeGuard";

export const metadata = { title: "Agenda photovoltaïque — Hermès" };

/**
 * Route volontairement sans compteur ni rendez-vous synthétique.
 * La façade historique `get_dashboard_agenda` agrège des signaux BTP génériques ;
 * tant qu'une source calendrier/PV auditée n'est pas branchée, afficher ces lignes ici
 * ferait passer des données multi-métier pour l'agenda commercial photovoltaïque.
 */
export default async function PvAgendaPage() {
  await requireRoute("/agenda");

  return (
    <div className="page-stack">
      <section className="dashboard-card pv-card">
        <div className="dashboard-card-header">
          <div>
            <span className="panel-eyebrow">PHOTOVOLTAÏQUE</span>
            <h3>Agenda</h3>
          </div>
        </div>
        <p className="agenda-empty">
          Aucun rendez-vous n’est affiché tant que la source calendrier photovoltaïque
          réelle n’est pas reliée et vérifiée. Aucune donnée de démonstration n’est utilisée.
        </p>
      </section>
    </div>
  );
}
