/**
 * PROJECTION PURE : une visite lue en base → le modèle du rapport PDF.
 *
 * Séparée du constructeur pour la même raison qu'en PV-4 et PV-5 : cette couche
 * est testable sans décoder un octet, et c'est ici que se joue la règle qui
 * compte — AUCUNE VALEUR INVENTÉE, et « non mesuré » n'est jamais transformé en
 * « conforme ».
 */

import {
  PV_SURVEY_FINDING_LABELS,
  PV_SURVEY_RESOLUTION_LABELS,
  PV_SURVEY_SEVERITY_LABELS,
  PV_SURVEY_STATUS_LABELS,
  pvSurveyComparison,
  pvSurveyValue,
} from "@/lib/pv/surveyLabels";
import type { PvSurveyPdfModel } from "@/lib/pv/surveyPdf";
import type { PvSiteSurveyDetail } from "@/types/pv";

/** Nom du client, ou `null`. Jamais « Client inconnu ». */
export function pvSurveyClientName(
  prospect: { companyName: string | null; firstName: string | null; lastName: string | null } | null,
): string | null {
  if (prospect === null) return null;
  const company = prospect.companyName?.trim() ?? "";
  if (company.length > 0) return company;
  const parts = [prospect.firstName, prospect.lastName]
    .map((p) => p?.trim() ?? "")
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
}

function siteAddress(
  site: { addressLine1: string | null; postalCode: string | null; city: string | null } | null,
): string | null {
  if (site === null) return null;
  const parts = [site.addressLine1, [site.postalCode, site.city].filter(Boolean).join(" ")]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Valeur d'observation : vide → absent, vocabulaire → libellé français. */
const txt = (v: string | null): string | null => {
  const s = (v ?? "").trim();
  return s.length > 0 ? pvSurveyValue(s) : null;
};
const numTxt = (v: number | null, unit?: string): string | null =>
  v === null || !Number.isFinite(v) ? null : `${Number(v)}${unit ? ` ${unit}` : ""}`;

/**
 * Le VERDICT, en toutes lettres. Un statut brut (`BLOCKING`) ne dit pas ce qu'il
 * faut faire ; une phrase, si.
 */
export function pvSurveyOutcomeSentence(status: string, blockingUnresolved: number): string {
  switch (status) {
    case "VALIDATED":
      return "VALIDÉE — la preuve terrain est disponible et peut fonder un devis.";
    case "BLOCKING":
      return blockingUnresolved > 0
        ? `BLOQUANTE — ${blockingUnresolved} écart(s) bloquant(s) non résolu(s). La pose est impossible en l’état.`
        : "BLOQUANTE — la visite a constaté un empêchement sur site.";
    case "NEEDS_REVIEW":
      return "À REVOIR — des écarts demandent un arbitrage avant validation.";
    case "DONE":
      return "TERMINÉE — relevé complet, en attente de validation humaine.";
    case "IN_PROGRESS":
      return "EN COURS — le relevé n’est pas terminé.";
    case "PLANNED":
      return "PLANIFIÉE — la visite n’a pas encore eu lieu.";
    case "CANCELLED":
      return "ANNULÉE — aucune preuve terrain n’en découle.";
    default:
      return status;
  }
}

export function buildPvSurveyPdfModel(input: {
  detail: PvSiteSurveyDetail;
  company: string;
  generatedOn: string;
  technicianLabel: string | null;
}): PvSurveyPdfModel {
  const { detail, company, generatedOn } = input;
  const s = detail.survey;

  // `pvSurveyValue` TRADUIT les vocabulaires (`PENTE` → « Toiture en pente »).
  // Sans lui, le même relevé se lirait en français à l'écran et en code dans le
  // rapport remis au client — deux versions d'un même constat.
  const val = (v: string | null, unit: string | null): string | null =>
    v === null ? null : `${pvSurveyValue(v)}${unit ? ` ${unit}` : ""}`;

  const comparison = pvSurveyComparison(s, detail.site, detail.findings).map((row) => ({
    label: row.label,
    declared: val(row.declared, row.unit),
    measured: val(row.measured, row.unit),
    delta: row.delta === null ? null : `${row.delta}${row.unit ? ` ${row.unit}` : ""}`,
    // TEXTUEL. « Non mesuré » n'est PAS « Conforme » : sur un constat, confondre
    // les deux affirmerait une vérification qui n'a pas eu lieu.
    status: PV_SURVEY_SEVERITY_LABELS[row.status] ?? row.status,
  }));

  const blockingUnresolved = detail.findings.filter(
    (f) => f.isBlocking && f.resolution === null,
  ).length;

  return {
    isValidated: s.status === "VALIDATED",
    statusLabel: PV_SURVEY_STATUS_LABELS[s.status] ?? s.status,
    company,
    clientName: pvSurveyClientName(detail.prospect) ?? "Non renseigné",
    siteAddress: siteAddress(detail.site),
    technician: input.technicianLabel,
    scheduledOn: s.scheduledOn,
    completedOn: s.completedAt === null ? null : s.completedAt.slice(0, 10),
    validatedOn: s.validatedAt === null ? null : s.validatedAt.slice(0, 10),
    generatedOn,
    comparison,
    findings: detail.findings.map((f) => ({
      label: PV_SURVEY_FINDING_LABELS[f.code] ?? f.code,
      severity: PV_SURVEY_SEVERITY_LABELS[f.severity] ?? f.severity,
      declared: pvSurveyValue(f.declaredValue),
      measured: pvSurveyValue(f.measuredValue),
      unit: f.unit,
      comment: f.comment,
      resolution:
        f.resolution === null ? null : (PV_SURVEY_RESOLUTION_LABELS[f.resolution] ?? f.resolution),
    })),
    observations: [
      {
        heading: "Conditions et accès",
        rows: [
          { label: "Météo", value: txt(s.weatherConditions) },
          { label: "Accès au toit", value: txt(s.roofAccess) },
          { label: "Moyen d’accès", value: txt(s.accessMeans) },
          { label: "Hauteur relevée", value: numTxt(s.heightMeasuredM, "m") },
          { label: "État général du site", value: txt(s.siteCondition) },
          { label: "Obstacles", value: txt(s.obstacles) },
          {
            label: "Suspicion d’amiante",
            value: s.asbestosSuspicion ? (txt(s.asbestosNote) ?? "Oui (constat)") : "Non constatée",
          },
        ],
      },
      {
        heading: "Dimensions relevées",
        rows: [
          { label: "Faîtage", value: numTxt(s.ridgeLengthM, "m") },
          { label: "Égout", value: numTxt(s.eaveLengthM, "m") },
          { label: "Rampant", value: numTxt(s.slopeLengthM, "m") },
        ],
      },
      {
        heading: "Implantation envisagée",
        rows: [
          { label: "Panneaux", value: txt(s.panelLocation) },
          { label: "Onduleur", value: txt(s.inverterLocation) },
          { label: "Batterie", value: txt(s.batteryLocation) },
          { label: "Cheminement de câble", value: txt(s.cableRoute) },
          { label: "Distance de cheminement", value: numTxt(s.cableDistanceM, "m") },
        ],
      },
      {
        heading: "Électricité (observations visuelles)",
        rows: [
          { label: "Emplacement du tableau", value: txt(s.panelBoardLocation) },
          { label: "État apparent du tableau", value: txt(s.panelBoardCondition) },
          { label: "Emplacements libres", value: numTxt(s.panelBoardFreeSlots) },
          { label: "Calibre du disjoncteur de branchement", value: numTxt(s.mainBreakerRatingA, "A") },
          { label: "Prise de terre observée", value: txt(s.earthingObserved) },
          { label: "Note", value: txt(s.earthingNote) },
        ],
      },
    ],
    constraints: txt(s.safetyConstraints),
    remarks: txt(s.remarks) ?? txt(s.observations),
    attachments: detail.documents
      .map((d) => d.originalFilename ?? d.docType)
      .filter((n): n is string => n !== null),
    outcome: pvSurveyOutcomeSentence(s.status, blockingUnresolved),
  };
}
