import { notFound } from "next/navigation";

import PvSurveyEditor from "@/components/dashboard/PvSurveyEditor";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { getPvSiteSurvey } from "@/services/hermes/pv";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

export const metadata = { title: "Visite technique — Hermès" };

/**
 * /etudes/visites/[surveyId] — L'ÉCRAN DE VISITE TECHNIQUE.
 *
 * Il reste dans le module `solar.studies` : même garde de route que l'étude et
 * le devis, aucun menu parallèle. La façade borne au tenant résolu SERVEUR —
 * une visite d'un autre tenant renvoie `NOT_FOUND`, donc 404, et son existence
 * n'est pas révélée. Aucun paramètre de tenant n'existe dans l'URL.
 */
export default async function PvSurveyPage({
  params,
}: {
  params: Promise<{ surveyId: string }>;
}) {
  await requireRoute("/etudes");

  const { surveyId } = await params;
  const [detail, tenant] = await Promise.all([
    getPvSiteSurvey(surveyId),
    getActiveTenantIdentity(),
  ]);
  if (detail === null) notFound();

  const company = tenant.ok ? (tenant.data.displayName ?? "Hermès OS") : "Hermès OS";

  return (
    <div className="page-stack">
      <PvSurveyEditor detail={detail} company={company} />
    </div>
  );
}
