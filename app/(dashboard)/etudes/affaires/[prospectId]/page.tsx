import { notFound } from "next/navigation";

import PvDealPanel from "@/components/dashboard/PvDealPanel";
import PvQuotesPanel from "@/components/dashboard/PvQuotesPanel";
import PvStudySummaryForm from "@/components/dashboard/PvStudySummaryForm";
import PvMaterialPanel from "@/components/dashboard/PvMaterialPanel";
import PvSurveysPanel from "@/components/dashboard/PvSurveysPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import { resolvePvReadiness } from "@/lib/pv/readiness";
import {
  getPvDeal,
  getPvMaterialPlan,
  getPvMaterials,
  getPvQuotes,
  getPvSiteSurveys,
  getPvSuppliers,
} from "@/services/hermes/pv";
import { getActiveTenantIdentity } from "@/services/hermes/tenantIdentity";

export const metadata = { title: "Affaire photovoltaïque — Hermès" };

/**
 * /etudes/affaires/[prospectId] — LA VUE AFFAIRE.
 *
 * Une lecture, tout le dossier. La garde de route est la même que partout
 * ailleurs (`solar.studies`), et la façade borne au tenant résolu côté serveur :
 * une affaire d'un autre tenant renvoie `NOT_FOUND`, donc 404 — son existence
 * n'est pas révélée.
 *
 * L'état de préparation est calculé par un module PUR et déterministe : aucune
 * IA, aucun appel réseau, et les mêmes données donnent toujours le même verdict.
 */
export default async function PvDealPage({
  params,
}: {
  params: Promise<{ prospectId: string }>;
}) {
  await requireRoute("/etudes");

  const { prospectId } = await params;
  const [deal, tenant, quotes, surveys, plan, materials, suppliers] = await Promise.all([
    getPvDeal(prospectId),
    getActiveTenantIdentity(),
    getPvQuotes(prospectId),
    getPvSiteSurveys(prospectId),
    getPvMaterialPlan(prospectId),
    getPvMaterials(),
    getPvSuppliers(),
  ]);
  if (deal === null) notFound();

  const readiness = resolvePvReadiness({
    prospect: { status: deal.prospect.status, optedOut: deal.prospect.optedOut },
    site: deal.site,
    consumption: deal.consumption,
    verifiedBill: deal.verifiedBill,
    retainedStudy: deal.retainedStudy,
    latestStudy: deal.latestStudy,
    retainedEconomics: deal.retainedEconomics,
    hasAnyEconomics: deal.retainedEconomics !== null,
    // PV-6 — la preuve terrain entre dans le calcul d'état. Deux niveaux : tant
    // qu'aucune visite n'existe, c'est une ALERTE qui ne casse rien ; dès qu'une
    // visite constate un blocage, le dossier est bloqué.
    surveyGate: deal.surveyGate,
  });

  const company = tenant.ok ? (tenant.data.displayName ?? "Hermès OS") : "Hermès OS";

  return (
    <div className="page-stack">
      <PvDealPanel deal={deal} readiness={readiness} />
      <PvStudySummaryForm
        prospectId={deal.prospect.id}
        readiness={readiness}
        // Clé d'idempotence STABLE : dérivée du dossier et de l'étude retenue.
        // Deux clics sur le même bouton ne produisent donc pas deux fichiers ;
        // une nouvelle version d'étude, elle, produit bien une nouvelle synthèse.
        requestId={`${deal.prospect.id}-v${deal.retainedStudy?.version ?? deal.latestStudy?.version ?? 0}`}
        company={company}
      />
      {/* PV-6 — placé AVANT le devis : ce que le terrain confirme se lit avant
          de proposer un prix, pas après l'avoir envoyé. */}
      <PvSurveysPanel
        prospectId={deal.prospect.id}
        surveys={surveys}
        gate={deal.surveyGate}
      />
      {/* PV-5 — le devis consomme enfin l'état READY_FOR_OFFER produit par PV-4. */}
      <PvQuotesPanel
        prospectId={deal.prospect.id}
        quotes={quotes}
        canQuote={readiness.state === "READY_FOR_OFFER"}
      />
      {/* PV-7 — placé APRÈS le devis : on approvisionne ce qui a été vendu, et
          la porte de commande exige justement un devis accepté. */}
      <PvMaterialPanel
        prospectId={deal.prospect.id}
        plan={plan}
        materials={materials}
        suppliers={suppliers}
      />
    </div>
  );
}
