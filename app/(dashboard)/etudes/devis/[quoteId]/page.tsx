import { notFound } from "next/navigation";

import PvQuoteEditor from "@/components/dashboard/PvQuoteEditor";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvQuote } from "@/services/hermes/pv";

export const metadata = { title: "Devis photovoltaïque — Hermès" };

/**
 * /etudes/devis/[quoteId] — L'ÉDITEUR DE DEVIS.
 *
 * Même garde de route que le reste du module solaire (`solar.studies`), et la
 * façade borne au tenant résolu SERVEUR : un devis d'un autre tenant renvoie
 * `NOT_FOUND`, donc 404 — son existence n'est pas révélée. Aucun paramètre de
 * tenant n'existe dans l'URL ni dans un formulaire.
 */
export default async function PvQuotePage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  await requireRoute("/etudes");

  const { quoteId } = await params;
  const detail = await getPvQuote(quoteId);
  if (detail === null) notFound();

  return (
    <div className="page-stack">
      <PvQuoteEditor detail={detail} />
    </div>
  );
}
