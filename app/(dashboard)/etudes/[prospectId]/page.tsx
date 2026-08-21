import { notFound } from "next/navigation";

import PvNewSiteForm from "@/components/dashboard/PvNewSiteForm";
import PvProspectDetailPanel from "@/components/dashboard/PvProspectDetailPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvProspect } from "@/services/hermes/pv";

export const metadata = { title: "Prospect photovoltaïque — Hermès" };

/**
 * /etudes/[prospectId] — fiche prospect.
 *
 * DEUX portillons, dans cet ordre : le module (garde de route), puis le tenant
 * (façade). Un identifiant appartenant à un AUTRE tenant renvoie `NOT_FOUND`
 * depuis la base, donc `notFound()` ici : l'existence de la ressource n'est
 * jamais révélée, pas même par un code d'erreur différent.
 */
export default async function PvProspectPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  await requireRoute("/etudes");

  const { prospectId } = await params;
  const prospect = await getPvProspect(prospectId);
  if (prospect === null) notFound();

  return (
    <div className="page-stack">
      <PvProspectDetailPanel prospect={prospect} />
      <PvNewSiteForm prospectId={prospect.id} />
    </div>
  );
}
