/**
 * PACK PHOTOVOLTAÏQUE — projection d'une AFFAIRE vers le modèle de synthèse PDF.
 *
 * Module PUR, séparé du constructeur PDF pour une raison simple : ce qu'on
 * IMPRIME et COMMENT on l'imprime sont deux décisions différentes, et seule la
 * première est du métier. Cette séparation rend le contenu testable sans lire un
 * seul octet de PDF.
 *
 * RÈGLE ABSOLUE : aucune valeur n'est inventée, complétée ni déduite. Une donnée
 * absente reste absente et s'affichera « Non renseigné ». Une synthèse
 * photovoltaïque qui comble ses trous est pire qu'une synthèse incomplète.
 */

import { PV_REQUIREMENT_LABELS, type PvReadiness } from "@/lib/pv/readiness";
import { pvAzimuthLabel, pvProspectName } from "@/lib/pv/status";
import { pvValue, type PvPdfModel, type PvPdfSection } from "@/lib/pv/studyPdf";
import type { PvDeal } from "@/types/pv";

function num(v: number | null | undefined, unit?: string): string | null {
  return pvValue(v ?? null, unit);
}

/**
 * Construit le modèle imprimable d'une affaire.
 *
 * `stage` est décidé par l'appelant (le serveur), pas ici : ce module ne connaît
 * ni les droits ni l'état de validation — il met en forme ce qu'on lui donne.
 */
export function buildPvDealPdfModel(input: {
  deal: PvDeal;
  readiness: PvReadiness;
  stage: "DRAFT" | "FINAL";
  company: string;
  generatedOn: string;
}): PvPdfModel {
  const { deal, readiness, stage } = input;
  const site = deal.site;
  const study = deal.retainedStudy ?? deal.latestStudy;
  const econ = deal.retainedEconomics;
  const assumptions = deal.retainedAssumptions;

  const address = site
    ? [site.addressLine1, [site.postalCode, site.city].filter(Boolean).join(" ")]
        .filter((s) => s !== null && String(s).trim().length > 0)
        .join(", ")
    : null;

  const sections: PvPdfSection[] = [];

  sections.push({
    heading: "Site",
    rows: [
      { label: "Type de bâtiment", value: pvValue(site?.buildingType ?? null) },
      { label: "Toiture", value: pvValue(site?.roofType ?? null) },
      { label: "Couverture", value: pvValue(site?.roofMaterial ?? null) },
      { label: "État de la toiture", value: pvValue(site?.roofCondition ?? null) },
      { label: "Surface totale", value: num(site?.roofAreaTotalM2 ?? null, "m2") },
      { label: "Surface exploitable", value: num(site?.roofAreaUsableM2 ?? null, "m2") },
      { label: "Orientation", value: pvValue(pvAzimuthLabel(site?.azimuthDeg ?? null)) },
      { label: "Inclinaison", value: num(site?.tiltDeg ?? null, "deg") },
      { label: "Ombrage", value: pvValue(site?.shadingLevel ?? null) },
    ],
  });

  sections.push({
    heading: "Consommation retenue",
    rows: [
      {
        label: "Consommation annuelle",
        value: num(deal.consumption?.annualConsumptionKwh ?? null, "kWh"),
      },
      {
        label: "Puissance souscrite",
        value: num(deal.consumption?.subscribedPowerKva ?? null, "kVA"),
      },
      {
        label: "Facture vérifiée retenue",
        value: deal.verifiedBill
          ? `${deal.verifiedBill.supplier ?? "fournisseur non renseigné"} — ${
              deal.verifiedBill.consumptionKwh ?? "?"
            } kWh`
          : null,
      },
      {
        label: "Statut de vérification",
        value: pvValue(deal.consumption?.verificationStatus ?? null),
      },
    ],
  });

  sections.push({
    heading: "Installation étudiée",
    rows: [
      { label: "Puissance cible", value: num(study?.targetPowerKwc ?? null, "kWc") },
      { label: "Nombre de panneaux", value: num(study?.panelCount ?? null) },
      { label: "Puissance unitaire", value: num(study?.panelUnitPowerW ?? null, "W") },
      { label: "Panneau", value: pvValue(study?.panelBrand ?? null) },
      {
        label: "Onduleur",
        value: pvValue(
          [study?.inverterType, study?.inverterBrand].filter(Boolean).join(" ") || null,
        ),
      },
      {
        label: "Batterie",
        value: study?.hasBattery
          ? num(study.batteryCapacityKwh ?? null, "kWh") ?? "Oui, capacité non renseignée"
          : study
            ? "Non"
            : null,
      },
    ],
  });

  sections.push({
    heading: "Production estimée",
    rows: [
      { label: "Production annuelle", value: num(study?.annualProductionKwh ?? null, "kWh") },
      { label: "Productible", value: num(study?.specificYieldKwhKwc ?? null, "kWh/kWc") },
      { label: "Autoconsommation", value: num(study?.selfConsumptionRatePct ?? null, "%") },
      { label: "Autoproduction", value: num(study?.selfProductionRatePct ?? null, "%") },
      { label: "Surplus estimé", value: num(study?.surplusKwh ?? null, "kWh") },
      { label: "Pertes système", value: num(study?.systemLossesPct ?? null, "%") },
    ],
    note:
      "Valeurs estimées à partir des hypothèses ci-dessous. Elles ne constituent " +
      "ni une garantie de production, ni un engagement de rendement.",
  });

  sections.push({
    heading: "Chiffrage estimé",
    rows: [
      { label: "Investissement HT", value: num(econ?.investmentHtEur ?? null, "EUR") },
      { label: "Investissement TTC", value: num(econ?.investmentTtcEur ?? null, "EUR") },
      { label: "Aides retenues", value: num(econ?.subsidyTotalEur ?? null, "EUR") },
      { label: "Reste à charge", value: num(econ?.netCostEur ?? null, "EUR") },
      { label: "Économies année 1", value: num(econ?.year1SavingsEur ?? null, "EUR") },
      { label: "Revenus de surplus", value: num(econ?.surplusRevenueEur ?? null, "EUR") },
      { label: "Gain annuel estimé", value: num(econ?.annualGainEur ?? null, "EUR") },
      { label: "Temps de retour estimé", value: num(econ?.paybackYears ?? null, "ans") },
      { label: "VAN", value: num(econ?.npvEur ?? null, "EUR") },
      { label: "TRI", value: num(econ?.irrPct ?? null, "%") },
    ],
    note:
      "Montants estimés, hors visite technique et hors conditions de raccordement. " +
      "Ils ne constituent ni un devis, ni une offre, ni un engagement de prix.",
  });

  sections.push({
    heading: "Hypothèses importantes",
    rows: [
      { label: "Prix de l’énergie", value: num(assumptions?.energyPriceEurKwh ?? null, "EUR/kWh") },
      {
        label: "Inflation retenue",
        value: num(assumptions?.energyPriceInflationPct ?? null, "%/an"),
      },
      { label: "Horizon d’analyse", value: num(assumptions?.analysisHorizonYears ?? null, "ans") },
      {
        label: "Dégradation panneaux",
        value: num(assumptions?.panelDegradationPctYear ?? null, "%/an"),
      },
      {
        label: "Rachat du surplus",
        value: num(assumptions?.surplusSalePriceEurKwh ?? null, "EUR/kWh"),
      },
      { label: "Aides", value: pvValue(assumptions?.subsidyScheme ?? null) },
      { label: "TVA retenue", value: num(assumptions?.vatRatePct ?? null, "%") },
    ],
  });

  // --- Statut des données : dit franchement ce sur quoi le document repose ----
  const dataStatus: string[] = [];
  dataStatus.push(
    deal.retainedStudy
      ? `Étude version ${deal.retainedStudy.version} — VALIDÉE par un humain.`
      : study
        ? `Étude version ${study.version} — statut ${study.status}, NON VALIDÉE.`
        : "Aucune étude n’est rattachée à ce dossier.",
  );
  dataStatus.push(
    econ
      ? "Chiffrage économique VÉRIFIÉ par un humain."
      : "Aucun chiffrage vérifié : les montants ci-dessus sont incomplets ou absents.",
  );
  dataStatus.push(
    deal.consumption?.verificationStatus === "VERIFIED"
      ? "Consommation VÉRIFIÉE."
      : "Consommation non vérifiée.",
  );
  dataStatus.push(`État du dossier : ${readiness.state}.`);
  for (const req of readiness.missingRequirements) {
    dataStatus.push(PV_REQUIREMENT_LABELS[req]);
  }

  return {
    stage,
    company: input.company,
    reference: `PV-${deal.prospect.id.slice(0, 8).toUpperCase()}`,
    clientName: pvProspectName(deal.prospect),
    siteAddress: address && address.length > 0 ? address : null,
    generatedOn: input.generatedOn,
    studyVersion: study?.version ?? 0,
    sections,
    dataStatus,
  };
}
