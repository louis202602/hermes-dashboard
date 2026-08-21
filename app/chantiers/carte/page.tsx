import Link from "next/link";

import ChantierMapWidget from "@/components/dashboard/ChantierMapWidget";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getChantiersMap } from "@/services/hermes/chantierMap";

export const metadata = {
  title: "Carte des chantiers — Hermès OS",
};

export default async function ChantierMapPage() {
  // Auth + MODULE. Avant, seule l'authentification était vérifiée : n'importe
  // quel tenant connecté — y compris un studio photo — atteignait cette page
  // BTP par URL directe. La carte était vide (les données sont bornées au
  // tenant), mais la page n'était pas la sienne. `requireRoute` interroge la
  // MÊME liste de modules que le menu : le module `worksites` ou rien.
  await requireRoute("/chantiers/carte");

  const res = await getChantiersMap();
  const data = res.ok
    ? res.data
    : { resolutionStatus: "UNAVAILABLE", tenantId: null, points: [] };

  return (
    <main className="chantier-map-page">
      <header className="chantier-map-page-head">
        <div>
          <span className="panel-eyebrow">TERRAIN</span>
          <h1>Carte des chantiers</h1>
        </div>
        <Link href="/" className="settings-back">
          ← Retour
        </Link>
      </header>
      <ChantierMapWidget initial={data} />
    </main>
  );
}
