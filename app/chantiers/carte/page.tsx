import Link from "next/link";
import { redirect } from "next/navigation";

import ChantierMapWidget from "@/components/dashboard/ChantierMapWidget";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getChantiersMap } from "@/services/hermes/chantierMap";

export const metadata = {
  title: "Carte des chantiers — Hermès OS",
};

export default async function ChantierMapPage() {
  // Same server-side auth boundary as the dashboard.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
