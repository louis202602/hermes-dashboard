/**
 * Libellés du devis — module PUR, partagé entre les écrans et les actions.
 *
 * Il ne vit pas dans `app/actions/pv.ts` parce qu'un fichier `"use server"` ne
 * peut exporter que des fonctions asynchrones : y poser une constante casse la
 * compilation. Et il ne vit pas dans un composant parce que les actions serveur
 * s'en servent aussi pour composer leurs messages de refus.
 */

/** Blocages d'un devis. Un code brut n'aide personne à l'écran. */
export const PV_QUOTE_BLOCKER_LABELS: Record<string, string> = {
  STUDY_NOT_VALIDATED: "L’étude n’est pas validée",
  ECONOMICS_NOT_VERIFIED: "Le chiffrage n’est pas vérifié",
  NO_LINE: "Le devis ne contient aucune ligne",
  TOTAL_NOT_POSITIVE: "Le total TTC n’est pas positif",
  CLIENT_IDENTITY_MISSING: "L’identité du client est incomplète",
  SITE_MISSING: "Le site d’installation est manquant",
  VALIDITY_DATE_MISSING: "La date de validité n’est pas renseignée",
  PROSPECT_OPTED_OUT: "Le prospect s’est opposé à toute sollicitation",
  NO_SITE: "Aucun site n’est rattaché au prospect",
  QUOTE_NOT_FOUND: "Ce devis n’existe plus",
  QUOTE_NOT_READY: "Le devis doit d’abord être préparé",
};

export const PV_QUOTE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  READY: "Prêt à transmettre",
  SENT: "Transmis",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
  EXPIRED: "Périmé",
  CANCELLED: "Annulé",
  SUPERSEDED: "Remplacé",
};

export const PV_QUOTE_CATEGORY_LABELS: Record<string, string> = {
  PANNEAUX: "Panneaux",
  ONDULEUR: "Onduleur",
  BATTERIE: "Batterie",
  STRUCTURE: "Structure et fixations",
  PROTECTIONS: "Protections électriques",
  CABLAGE: "Câblage",
  POSE: "Pose",
  MISE_EN_SERVICE: "Mise en service",
  ETUDES_ADMINISTRATIF: "Études et administratif",
  OPTION: "Option",
  AUTRE: "Autre",
};

/**
 * Ton d'affichage d'un statut. `ACCEPTED` est le seul « bon » état terminal ;
 * `REFUSED`, `EXPIRED`, `CANCELLED` sont des fins, pas des alertes.
 */
export function pvQuoteTone(status: string): "ok" | "warn" | "muted" | "neutral" {
  if (status === "ACCEPTED") return "ok";
  if (status === "SENT" || status === "READY") return "warn";
  if (status === "REFUSED" || status === "EXPIRED" || status === "CANCELLED" || status === "SUPERSEDED") {
    return "muted";
  }
  return "neutral";
}

/**
 * Séparateur de milliers : espace INSÉCABLE (U+00A0), écrit en échappement pour
 * qu'il soit visible dans le source. C'est la typographie française correcte, et
 * cela empêche un montant de se couper en fin de ligne — sur un devis, « 5 830 »
 * d'un côté et « ,46 € » de l'autre serait au mieux illisible.
 */
export const NBSP = "\u00A0";

/** Valeur absente. Jamais un zéro : sur un devis, un zéro fabriqué engage. */
export const PV_QUOTE_NOT_PROVIDED = "Non renseigné";

/**
 * Montant formaté à la française. `null` n'est jamais transformé en zéro.
 *
 * Implémentation CANONIQUE : le PDF (`lib/pv/quotePdf.ts`) l'importe plutôt que
 * d'en garder une copie. Deux formatages de montant divergeraient un jour, et
 * l'écran afficherait alors un total différent du document imprimé.
 */
export function pvMoney(
  v: number | null | undefined,
  currency = "EUR",
  absent = "—",
): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return absent;
  const sign = v < 0 ? "-" : "";
  const [whole, frac] = Math.abs(v).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}${grouped},${frac}${NBSP}${currency === "EUR" ? "€" : currency}`;
}
