/**
 * Vocabulaire de la visite technique — module PUR, partagé entre les écrans,
 * les actions serveur et le PDF de rapport.
 *
 * Il ne vit pas dans `app/actions/pv.ts` : un fichier `"use server"` n'est pas
 * l'endroit d'une table de libellés, et le PDF (qui ne tourne pas dans une
 * action) en a besoin aussi.
 */

import type { PvSiteSurvey, PvSurveyComparisonRow } from "@/types/pv";

export const PV_SURVEY_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planifiée",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
  NEEDS_REVIEW: "À revoir",
  VALIDATED: "Validée",
  BLOCKING: "Bloquante",
  CANCELLED: "Annulée",
};

/** Libellés des écarts. Un code brut n'aide personne à l'écran. */
export const PV_SURVEY_FINDING_LABELS: Record<string, string> = {
  ROOF_AREA_MISMATCH: "Surface totale de toiture",
  USABLE_AREA_MISMATCH: "Surface exploitable",
  AZIMUTH_MISMATCH: "Orientation (azimut)",
  TILT_MISMATCH: "Inclinaison",
  ROOF_TYPE_MISMATCH: "Type de couverture",
  ROOF_CONDITION_ISSUE: "État de la couverture",
  SHADING_MISMATCH: "Ombrage",
  ACCESS_BLOCKED: "Accès au toit",
  ELECTRICAL_PANEL_ISSUE: "Tableau électrique",
  CABLE_ROUTE_ISSUE: "Cheminement de câble",
  STRUCTURAL_CONCERN: "État général du site",
  ASBESTOS_SUSPICION: "Suspicion d’amiante",
  EARTHING_ISSUE: "Prise de terre",
  HEIGHT_ACCESS_NOTICE: "Hauteur et moyens d’accès",
};

/**
 * Libellés de gravité. TEXTUELS, jamais seulement une couleur : un daltonien
 * doit lire la même information qu'un autre, et une impression noir et blanc
 * aussi.
 */
export const PV_SURVEY_SEVERITY_LABELS: Record<string, string> = {
  INFO: "Information",
  REVIEW: "À revoir",
  BLOCKING: "Bloquant",
  OK: "Conforme",
  NON_MESURE: "Non mesuré",
};

export const PV_SURVEY_RESOLUTION_LABELS: Record<string, string> = {
  ACCEPTED_AS_IS: "Accepté en l’état",
  SITE_UPDATED: "Site mis à jour avec la mesure",
  STUDY_TO_REVISE: "Étude à réviser",
  QUOTE_TO_REVISE: "Devis à réviser",
  NOT_AN_ISSUE: "Sans conséquence",
};

/** Ton d'affichage. Complète le libellé, ne le remplace jamais. */
export function pvSurveyTone(severity: string): "ok" | "warn" | "muted" | "neutral" {
  if (severity === "BLOCKING") return "warn";
  if (severity === "REVIEW") return "warn";
  if (severity === "OK") return "ok";
  if (severity === "NON_MESURE") return "muted";
  return "neutral";
}

export function pvSurveyStatusTone(status: string): "ok" | "warn" | "muted" | "neutral" {
  if (status === "VALIDATED") return "ok";
  if (status === "BLOCKING" || status === "NEEDS_REVIEW") return "warn";
  if (status === "CANCELLED") return "muted";
  return "neutral";
}

/** Écart angulaire CIRCULAIRE : 350° et 10° sont distants de 20°, pas de 340°. */
export function pvAngleDelta(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

const NUM = (v: number | null): string | null =>
  v === null || !Number.isFinite(v) ? null : String(Number(v));

/**
 * LA VUE COMPARATIVE — déclaré, mesuré, écart, statut.
 *
 * Construite ici, à partir des données déjà lues : ni l'écran ni le PDF ne
 * recalculent quoi que ce soit de leur côté. Le STATUT vient des écarts produits
 * par la base — l'application ne redécide pas d'une gravité, elle l'affiche.
 * Un champ mesuré sans écart retenu est donc « Conforme », et un champ non
 * mesuré est « Non mesuré » : deux situations différentes, deux libellés.
 */
export function pvSurveyComparison(
  survey: PvSiteSurvey,
  site: {
    roofAreaTotalM2: number | null;
    roofAreaUsableM2: number | null;
    azimuthDeg: number | null;
    tiltDeg: number | null;
    roofType: string | null;
    roofCondition: string | null;
    shadingLevel: string | null;
    accessDifficulty: string | null;
  } | null,
  findings: { code: string; severity: string }[],
): PvSurveyComparisonRow[] {
  const bySeverity = new Map(findings.map((f) => [f.code, f.severity]));

  const numericRow = (
    field: string,
    label: string,
    declared: number | null,
    measured: number | null,
    unit: string,
    code: string,
    circular = false,
  ): PvSurveyComparisonRow => {
    const sev = bySeverity.get(code);
    // SIGNES ASCII, délibérément. Le moins typographique U+2212 et le « ≠ »
    // n'existent pas dans WinAnsi : le PDF du rapport les remplacerait par « ? ».
    // L'écran et le rapport doivent lire la MÊME chaîne, sinon l'un des deux ment.
    const delta =
      declared === null || measured === null
        ? null
        : circular
          ? `${pvAngleDelta(measured, declared) === 0 ? "" : "±"}${Number(pvAngleDelta(measured, declared).toFixed(2))}`
          : `${measured - declared >= 0 ? "+" : "-"}${Number(Math.abs(measured - declared).toFixed(2))}`;
    return {
      field,
      label,
      declared: NUM(declared),
      measured: NUM(measured),
      delta,
      unit,
      status: measured === null ? "NON_MESURE" : ((sev ?? "OK") as PvSurveyComparisonRow["status"]),
      findingCode: sev === undefined ? null : code,
      applicable: measured !== null,
    };
  };

  const textRow = (
    field: string,
    label: string,
    declared: string | null,
    measured: string | null,
    code: string,
  ): PvSurveyComparisonRow => {
    const sev = bySeverity.get(code);
    return {
      field,
      label,
      declared,
      measured,
      // Un mot plutôt qu'un symbole : « ≠ » n'est pas encodable en WinAnsi, et
      // un écart de vocabulaire se lit mieux en toutes lettres de toute façon.
      delta: declared !== null && measured !== null && declared !== measured ? "différent" : null,
      unit: null,
      status: measured === null ? "NON_MESURE" : ((sev ?? "OK") as PvSurveyComparisonRow["status"]),
      findingCode: sev === undefined ? null : code,
      applicable: measured !== null,
    };
  };

  return [
    numericRow("roof_area_total_m2", "Surface totale de toiture",
      site?.roofAreaTotalM2 ?? null, survey.roofAreaTotalMeasuredM2, "m²", "ROOF_AREA_MISMATCH"),
    numericRow("roof_area_usable_m2", "Surface exploitable",
      site?.roofAreaUsableM2 ?? null, survey.roofAreaUsableMeasuredM2, "m²", "USABLE_AREA_MISMATCH"),
    numericRow("azimuth_deg", "Orientation (azimut)",
      site?.azimuthDeg ?? null, survey.azimuthMeasuredDeg, "°", "AZIMUTH_MISMATCH", true),
    numericRow("tilt_deg", "Inclinaison",
      site?.tiltDeg ?? null, survey.tiltMeasuredDeg, "°", "TILT_MISMATCH"),
    textRow("roof_type", "Type de couverture",
      site?.roofType ?? null, survey.roofTypeMeasured, "ROOF_TYPE_MISMATCH"),
    textRow("roof_condition", "État de la couverture",
      site?.roofCondition ?? null, survey.roofConditionMeasured, "ROOF_CONDITION_ISSUE"),
    textRow("shading_level", "Ombrage",
      site?.shadingLevel ?? null, survey.shadingMeasured, "SHADING_MISMATCH"),
    textRow("access_difficulty", "Difficulté d’accès",
      site?.accessDifficulty ?? null, survey.accessDifficultyMeasured, "ACCESS_BLOCKED"),
  ];
}

/**
 * LIBELLÉS DES VOCABULAIRES. Un écran qui affiche `TRES_DIFFICILE` ou
 * `NON_CONFORME_APPARENT` fait lire du code à un technicien sur un toit.
 */
export const PV_SURVEY_VALUE_LABELS: Record<string, string> = {
  // Couverture (aligné sur `pv_sites`)
  PENTE: "Toiture en pente",
  TERRASSE: "Toiture-terrasse",
  MULTIPENTE: "Multipente",
  SHED: "Shed",
  COURBE: "Courbe",
  SOL: "Au sol",
  OMBRIERE: "Ombrière",
  AUTRE: "Autre",
  // État (couverture, site, tableau)
  BON: "Bon",
  MOYEN: "Moyen",
  MAUVAIS: "Mauvais",
  INCONNU: "Inconnu",
  DEGRADE: "Dégradé",
  CRITIQUE: "Critique",
  NON_CONFORME_APPARENT: "Non-conformité apparente",
  // Ombrage
  AUCUN: "Aucun",
  FAIBLE: "Faible",
  MODERE: "Modéré",
  FORT: "Fort",
  // Accès
  FACILE: "Facile",
  DIFFICILE: "Difficile",
  TRES_DIFFICILE: "Très difficile",
  IMPOSSIBLE: "Impossible",
  ECHELLE: "Échelle",
  ECHAFAUDAGE: "Échafaudage",
  NACELLE: "Nacelle",
  TRAPPE: "Trappe de toit",
  // Météo
  SEC: "Sec",
  PLUIE: "Pluie",
  NEIGE: "Neige",
  VENT_FORT: "Vent fort",
  // Prise de terre
  PRESENTE: "Présente (observée)",
  ABSENTE: "Absente (observée)",
  NON_VERIFIABLE: "Non vérifiable",
};

/** Traduit une valeur de vocabulaire, ou la rend telle quelle si inconnue. */
export function pvSurveyValue(v: string | null): string | null {
  if (v === null) return null;
  return PV_SURVEY_VALUE_LABELS[v] ?? v;
}
