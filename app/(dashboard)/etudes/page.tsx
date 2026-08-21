import PvNewProspectForm from "@/components/dashboard/PvNewProspectForm";
import PvPilotBand from "@/components/dashboard/PvPilotBand";
import PvProspectsPanel from "@/components/dashboard/PvProspectsPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvPilotSnapshot, getPvProspects } from "@/services/hermes/pv";

export const metadata = { title: "Études photovoltaïques — Hermès" };

/**
 * /etudes — racine de la verticale photovoltaïque.
 *
 * CAPABILITY-FIRST : la garde est la MÊME que celle du menu et de
 * `/chantiers/carte` — une seule liste de modules. Un tenant qui n'a pas
 * `solar.studies` obtient 404, pas 403 : il n'apprend pas que la page existe.
 * Et la garde ne protège pas seule — les façades appelées ci-dessous bornent
 * elles aussi au tenant résolu côté serveur.
 */
export default async function PvStudiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoute("/etudes");

  const params = await searchParams;
  const one = (v: string | string[] | undefined): string | null => {
    const s = Array.isArray(v) ? v[0] : v;
    const t = (s ?? "").trim();
    return t.length > 0 ? t : null;
  };

  const filters = {
    search: one(params.q),
    status: one(params.statut),
    type: one(params.type),
  };

  // Deux lectures, pas plus : la liste filtrée et l'instantané de pilotage
  // partagé par les trois widgets.
  const [list, pilot] = await Promise.all([
    getPvProspects({
      search: filters.search,
      status: filters.status,
      type: filters.type,
    }),
    getPvPilotSnapshot(),
  ]);

  return (
    <div className="page-stack">
      <PvPilotBand snapshot={pilot} />
      <PvProspectsPanel list={list} filters={filters} />
      <PvNewProspectForm />
    </div>
  );
}
