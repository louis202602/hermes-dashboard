/**
 * Vocabulaire de l'approvisionnement matériel — module PUR, partagé entre les
 * écrans et les actions serveur.
 *
 * Même règle qu'en PV-6 : les états s'affichent en TOUTES LETTRES. La couleur ne
 * fait que redire ce que le mot dit déjà.
 */

import type { PvMaterialCosts } from "@/types/pv";

export const PV_MATERIAL_CATEGORY_LABELS: Record<string, string> = {
  PANNEAU: "Panneau",
  ONDULEUR: "Onduleur",
  MICRO_ONDULEUR: "Micro-onduleur",
  BATTERIE: "Batterie",
  STRUCTURE: "Structure / fixation",
  RAIL: "Rail",
  CROCHET: "Crochet",
  BAC_LESTE: "Bac lesté",
  PROTECTION_DC: "Protections DC",
  PROTECTION_AC: "Protections AC",
  CABLE_DC: "Câble DC",
  CABLE_AC: "Câble AC",
  CONNECTIQUE: "Connectique",
  COFFRET: "Coffret",
  MONITORING: "Monitoring",
  MISE_A_LA_TERRE: "Mise à la terre",
  CONSOMMABLE: "Consommable",
  ACCES_SECURITE: "Accès / sécurité",
  AUTRE: "Autre",
};

export const PV_UNIT_LABELS: Record<string, string> = {
  U: "unité",
  M: "m",
  ML: "mètre linéaire",
  M2: "m²",
  KG: "kg",
  L: "litre",
  LOT: "lot",
  H: "heure",
  FORFAIT: "forfait",
};

/** L'ORIGINE d'un besoin. C'est elle qui rend l'écart explicable. */
export const PV_REQUIREMENT_ORIGIN_LABELS: Record<string, string> = {
  QUOTE: "Devis",
  STUDY: "Étude",
  SURVEY: "Visite technique",
  MANUAL: "Saisi à la main",
};

/** Écart matériel — libellés TEXTUELS, jamais une couleur seule. */
export const PV_MATERIAL_GAP_LABELS: Record<string, string> = {
  NOT_ORDERED: "Non commandé",
  PARTIALLY_ORDERED: "Partiellement commandé",
  ORDERED: "Commandé",
  PARTIALLY_RECEIVED: "Partiellement reçu",
  RECEIVED: "Reçu",
  OVER_ORDERED: "Reçu en excès",
  SHORTAGE: "Manquant — plus rien en attente",
};

export const PV_PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  READY: "Prête à commander",
  ORDERED: "Commandée",
  PARTIALLY_RECEIVED: "Partiellement reçue",
  RECEIVED: "Reçue",
  CANCELLED: "Annulée",
};

export const PV_RECEIPT_CONDITION_LABELS: Record<string, string> = {
  CONFORME: "Conforme",
  ENDOMMAGE: "Endommagé",
  NON_CONFORME: "Non conforme",
  INCOMPLET: "Incomplet",
};

export const PV_MATERIAL_READINESS_LABELS: Record<string, string> = {
  NOT_READY: "Approvisionnement non engagé",
  PARTIAL: "Approvisionnement partiel",
  READY: "Matériel disponible sur site",
};

/** Ce qui empêche une commande de partir, dit en français. */
export const PV_PURCHASE_BLOCKER_LABELS: Record<string, string> = {
  ORDER_NOT_FOUND: "Commande introuvable.",
  NO_LINE: "La commande ne contient aucune ligne.",
  TOTAL_NOT_POSITIVE: "Le total de la commande est nul.",
  SUPPLIER_INACTIVE: "Le fournisseur est désactivé.",
  QUOTE_NOT_ACCEPTED:
    "Aucun devis accepté sur cette affaire : on n’engage pas l’argent de l’entreprise avant que le client ait dit oui.",
  SITE_SURVEY_NOT_VALIDATED:
    "La visite technique n’est pas validée : rien ne confirme encore qu’on pourra poser.",
  SITE_SURVEY_BLOCKING:
    "La visite technique a constaté un blocage sur site.",
  SURVEY_FINDINGS_UNRESOLVED:
    "Des écarts bloquants de visite ne sont pas résolus.",
};

export const PV_SUPPLIER_AVAILABILITY_LABELS: Record<string, string> = {
  EN_STOCK: "En stock",
  SUR_COMMANDE: "Sur commande",
  RUPTURE: "En rupture",
  INCONNU: "Inconnue",
};

export const PV_PRICE_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Saisi à la main",
  SUPPLIER_QUOTE: "Devis fournisseur",
  CATALOG: "Catalogue fournisseur",
  INVOICE: "Facture fournisseur",
};

/** Ton d'affichage. Complète le libellé, ne le remplace jamais. */
export function pvGapTone(status: string): "ok" | "warn" | "muted" | "neutral" {
  if (status === "RECEIVED") return "ok";
  if (status === "SHORTAGE" || status === "OVER_ORDERED") return "warn";
  if (status === "NOT_ORDERED") return "muted";
  return "neutral";
}

export function pvOrderTone(status: string): "ok" | "warn" | "muted" | "neutral" {
  if (status === "RECEIVED") return "ok";
  if (status === "CANCELLED") return "muted";
  if (status === "PARTIALLY_RECEIVED") return "warn";
  return "neutral";
}

export function pvMaterialReadinessTone(r: string): "ok" | "warn" | "muted" | "neutral" {
  if (r === "READY") return "ok";
  if (r === "PARTIAL") return "warn";
  return "muted";
}

/** Quantité lisible : « 24 unité » n'aide personne, « 24 U » non plus. */
export function pvQty(value: number, unit: string): string {
  const n = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return unit === "U" ? n : `${n} ${PV_UNIT_LABELS[unit] ?? unit}`;
}

/**
 * La phrase de marge, ou son REFUS.
 *
 * Quand `marginReliable` est faux, on n'affiche PAS un chiffre en le nuançant :
 * on dit ce qui manque. Un montant affiché est lu, une nuance ne l'est pas.
 */
export function pvMarginSentence(costs: PvMaterialCosts): string {
  if (costs.quoteTotalHtEur === null) {
    return "Marge non calculable : aucun devis accepté sur cette affaire.";
  }
  if (!costs.marginReliable) {
    const causes: string[] = [];
    if (costs.materialsWithoutCost > 0) {
      causes.push(`${costs.materialsWithoutCost} article(s) sans coût connu`);
    }
    if (costs.requirementsPendingConfirmation > 0) {
      causes.push(`${costs.requirementsPendingConfirmation} besoin(s) non confirmé(s)`);
    }
    return `Marge non calculable : ${causes.join(" et ")}.`;
  }
  return "MARGE MATÉRIELLE INDICATIVE — matériel seulement, main-d’œuvre non déduite.";
}
