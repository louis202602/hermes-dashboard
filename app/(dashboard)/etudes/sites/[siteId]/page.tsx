import { notFound } from "next/navigation";

import PvDocumentsPanel from "@/components/dashboard/PvDocumentsPanel";
import PvPurgeJournalPanel from "@/components/dashboard/PvPurgeJournalPanel";
import PvEnergyPanel from "@/components/dashboard/PvEnergyPanel";
import PvSiteDetailPanel from "@/components/dashboard/PvSiteDetailPanel";
import { PvNewStudyForm, PvStudyEditor } from "@/components/dashboard/PvStudyEditor";
import PvStudyPanel, { type PvStudyBundle } from "@/components/dashboard/PvStudyPanel";
import { requireRoute } from "@/lib/dashboard/routeGuard";
import {
  getPvBillExtractions,
  getPvConsumptionProfiles,
  getPvDocuments,
  getPvPurgeJournal,
  getPvEconomics,
  getPvEnergyBills,
  getPvSite,
  getPvStudies,
  getPvStudyAssumptions,
} from "@/services/hermes/pv";
import type { PvBillExtraction } from "@/types/pv";

export const metadata = { title: "Site photovoltaïque — Hermès" };

/**
 * /etudes/sites/[siteId] — site, énergie, études, chiffrage.
 *
 * Toutes les lectures sont bornées au tenant PAR LA BASE. Cette page ne fait
 * qu'agréger des façades ; elle ne calcule aucun chiffre, n'estime rien et ne
 * complète aucune donnée manquante — un champ absent s'affiche « — ».
 */
export default async function PvSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  await requireRoute("/etudes");

  const { siteId } = await params;
  const site = await getPvSite(siteId);
  if (site === null) notFound();

  const [profiles, bills, studies, documents, purgeJournal] = await Promise.all([
    getPvConsumptionProfiles(siteId),
    getPvEnergyBills(siteId),
    getPvStudies(siteId),
    getPvDocuments(siteId),
    getPvPurgeJournal(50),
  ]);

  // Extractions : une lecture par facture QUI EN A. Une facture sans extraction
  // n'engendre aucun appel — l'écran vide ne coûte donc rien.
  const extractionsByBill: Record<string, PvBillExtraction[]> = {};
  await Promise.all(
    bills
      .filter((b) => b.extractionCount > 0)
      .map(async (b) => {
        extractionsByBill[b.id] = await getPvBillExtractions(b.id);
      }),
  );

  const bundles: PvStudyBundle[] = await Promise.all(
    studies.map(async (study) => {
      const [assumptions, economics] = await Promise.all([
        getPvStudyAssumptions(study.id),
        getPvEconomics(study.id),
      ]);
      return { study, assumptions, economics };
    }),
  );

  return (
    <div className="page-stack">
      <PvSiteDetailPanel site={site} />
      <PvEnergyPanel
        siteId={siteId}
        profiles={profiles}
        bills={bills}
        extractionsByBill={extractionsByBill}
      />
      <PvStudyPanel siteId={siteId} bundles={bundles} />
      {/* Travail MANUEL : modifier chaque étude vivante, puis en créer une nouvelle.
          L'ordre suit le geste réel — on corrige ce qui existe avant d'ajouter. */}
      {bundles.map((b) => (
        <PvStudyEditor
          key={b.study.id}
          siteId={siteId}
          study={b.study}
          assumptions={b.assumptions}
          economics={b.economics}
        />
      ))}
      <PvNewStudyForm siteId={siteId} />
      <PvDocumentsPanel siteId={siteId} documents={documents} />
      <PvPurgeJournalPanel entries={purgeJournal} />
    </div>
  );
}
