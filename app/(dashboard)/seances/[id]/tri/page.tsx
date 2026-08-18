import { notFound } from "next/navigation";

import PhotoCullingReview from "@/components/dashboard/PhotoCullingReview";
import PhotoImportPanel from "@/components/dashboard/PhotoImportPanel";
import { resolvePageContext } from "@/lib/dashboard/pageContext";
import { getPhotoCullingReview } from "@/services/hermes/photo";

export const metadata = { title: "Tri — Hermès Studio" };

/**
 * /seances/[id]/tri — import navigateur + revue du tri.
 *
 * C'est la page qui livre l'essentiel de la valeur du pilote SANS n8n : la
 * mesure tourne sur le poste, la dérivation des verdicts en base, la décision
 * reste humaine. Coût IA = 0.
 */
export default async function PhotoCullingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await resolvePageContext();
  if (!ctx.photoEnabled) notFound();

  const { id } = await params;
  const review = await getPhotoCullingReview(id, 300);
  if (!review.ok) {
    return <p className="photo-empty">Service indisponible.</p>;
  }
  if (!review.data.found) notFound();

  return (
    <div className="page-stack">
      <PhotoImportPanel sessionId={id} />
      <PhotoCullingReview sessionId={id} review={review.data} />
    </div>
  );
}
