import Link from "next/link";
import { notFound } from "next/navigation";

import ChantierMapWidget from "@/components/dashboard/ChantierMapWidget";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getChantiersMap } from "@/services/hermes/chantierMap";

export const metadata = {
  title: "Carte des chantiers — Hermès OS",
};

export default async function ChantierMapPage() {
  const ctx = await requireRoute("/chantiers/carte");

  // Heliosolar a explicitement retiré cette carte de son cockpit. La route reste
  // disponible pour les verticales BTP qui possèdent le module, sans laisser une
  // ancienne page solaire accessible par URL directe.
  if (ctx.composition.vertical === "solar") notFound();

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
