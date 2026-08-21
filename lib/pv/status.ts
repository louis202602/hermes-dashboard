/**
 * PACK PHOTOVOLTAÏQUE — vocabulaire d'affichage des statuts (LOT PV-2).
 *
 * Module PUR, sans I/O ni React : il ne décide d'aucun droit et n'appelle
 * aucune base. Son unique rôle est de rendre VISIBLE, en français, la
 * distinction que PV-1 a rendue STRUCTURELLE :
 *
 *     ce qu'une machine a produit  ≠  ce qu'un humain a certifié.
 *
 * L'exigence est explicite : « une donnée CALCULATED ou NEEDS_REVIEW doit être
 * visuellement distincte d'une donnée VERIFIED », et « une étude non validée
 * doit être clairement marquée À valider et ne jamais apparaître comme une étude
 * définitive ». Concentrer cette règle ici — plutôt que de la disperser dans les
 * composants — la rend testable, et rend impossible qu'un écran l'oublie.
 */

/** Ton d'affichage. `certified` est le SEUL ton réservé à une validation humaine. */
export type PvTone = "certified" | "pending" | "draft" | "rejected" | "neutral";

export type PvBadge = {
  label: string;
  tone: PvTone;
  /** `true` ⇒ la donnée attend un geste humain. Sert aux compteurs « à valider ». */
  awaitingHuman: boolean;
};

const BADGES: Record<string, PvBadge> = {
  // — factures énergie —
  RECEIVED: { label: "Reçue", tone: "draft", awaitingHuman: false },
  EXTRACTED: { label: "Lue par l’IA", tone: "pending", awaitingHuman: true },
  // — études —
  DRAFT: { label: "Brouillon", tone: "draft", awaitingHuman: false },
  CALCULATED: { label: "Calculée — à valider", tone: "pending", awaitingHuman: true },
  SUPERSEDED: { label: "Remplacée", tone: "neutral", awaitingHuman: false },
  // — commun —
  NEEDS_REVIEW: { label: "À valider", tone: "pending", awaitingHuman: true },
  VERIFIED: { label: "Vérifiée par un humain", tone: "certified", awaitingHuman: false },
  VALIDATED: { label: "Validée par un humain", tone: "certified", awaitingHuman: false },
  REJECTED: { label: "Rejetée", tone: "rejected", awaitingHuman: false },
  UNVERIFIED: { label: "Non vérifiée", tone: "draft", awaitingHuman: true },
};

/**
 * Badge d'un statut de validation.
 *
 * FAIL-CLOSED SUR L'AFFICHAGE : un statut INCONNU n'est jamais présenté comme
 * certifié. Il retombe sur « À vérifier », pas sur un libellé rassurant — c'est
 * la même logique que le reste d'Hermès : le doute ferme.
 */
export function pvBadge(status: string | null | undefined): PvBadge {
  if (!status) return { label: "À vérifier", tone: "pending", awaitingHuman: true };
  return BADGES[status] ?? { label: "À vérifier", tone: "pending", awaitingHuman: true };
}

/**
 * Une donnée est-elle CERTIFIÉE PAR UN HUMAIN ? Seuls `VERIFIED` et `VALIDATED`
 * le sont. `CALCULATED` ne l'est pas — c'est précisément le piège à éviter.
 */
export function isHumanCertified(status: string | null | undefined): boolean {
  return status === "VERIFIED" || status === "VALIDATED";
}

/** Classe CSS du badge. Une seule table : aucun composant n'improvise sa couleur. */
export function pvToneClass(tone: PvTone): string {
  return `pv-badge pv-badge-${tone}`;
}

/** Libellés des statuts de prospect. Pas de validation : c'est un tunnel commercial. */
export const PV_PROSPECT_STATUS_LABELS: Record<string, string> = {
  NEW: "Nouveau",
  CONTACTED: "Contacté",
  QUALIFYING: "En qualification",
  QUALIFIED: "Qualifié",
  UNQUALIFIED: "Non qualifié",
  STUDY_REQUESTED: "Étude demandée",
  STUDY_DELIVERED: "Étude remise",
  WON: "Gagné",
  LOST: "Perdu",
  ON_HOLD: "En attente",
  ARCHIVED: "Archivé",
};

export const PV_PROSPECT_TYPE_LABELS: Record<string, string> = {
  PARTICULIER: "Particulier",
  PROFESSIONNEL: "Professionnel",
  INDUSTRIEL: "Industriel",
  AGRICOLE: "Agricole",
};

/** Nom affichable d'un prospect, sans jamais inventer de valeur. */
export function pvProspectName(p: {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  const person = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (p.companyName && person) return `${p.companyName} — ${person}`;
  return p.companyName ?? (person.length > 0 ? person : "Prospect sans nom");
}

/**
 * Orientation lisible depuis un azimut NUMÉRIQUE (0 = Nord, 180 = Sud).
 * PV-1 a délibérément stocké un nombre : « plein sud » n'est pas calculable.
 * Cette fonction fait le chemin inverse — nombre → mot — pour l'affichage SEUL.
 */
export function pvAzimuthLabel(azimuth: number | null | undefined): string | null {
  if (azimuth === null || azimuth === undefined || !Number.isFinite(azimuth)) return null;
  const a = ((azimuth % 360) + 360) % 360;
  const points = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest"];
  const index = Math.round(a / 45) % 8;
  return `${points[index]} (${a.toFixed(0)}°)`;
}
