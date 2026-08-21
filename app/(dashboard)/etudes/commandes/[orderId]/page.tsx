import { notFound } from "next/navigation";

import PvPurchaseOrderEditor from "@/components/dashboard/PvPurchaseOrderEditor";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvMaterials, getPvPurchaseOrder } from "@/services/hermes/pv";

export const metadata = { title: "Commande fournisseur — Hermès" };

/**
 * /etudes/commandes/[orderId] — L'ÉCRAN DE COMMANDE FOURNISSEUR.
 *
 * Il reste dans le module `solar.studies` : même garde de route que l'étude, le
 * devis et la visite, aucun menu parallèle. La façade borne au tenant résolu
 * SERVEUR — une commande d'un autre tenant renvoie `NOT_FOUND`, donc 404, et son
 * existence n'est pas révélée. Aucun paramètre de tenant n'existe dans l'URL.
 */
export default async function PvPurchaseOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireRoute("/etudes");

  const { orderId } = await params;
  const [detail, materials] = await Promise.all([
    getPvPurchaseOrder(orderId),
    getPvMaterials(),
  ]);
  if (detail === null) notFound();

  return (
    <div className="page-stack">
      <PvPurchaseOrderEditor detail={detail} materials={materials} />
    </div>
  );
}
