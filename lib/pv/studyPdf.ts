/**
 * SYNTHÈSE D'ÉTUDE PHOTOVOLTAÏQUE — le CONTENU du document.
 *
 * La mécanique PDF (encodage WinAnsi, césure, pagination, xref, trailer) vit
 * dans `lib/pv/pdfEngine.ts` depuis PV-5, qui en a eu besoin pour le devis.
 * Ce module ne garde que ce qui est propre à la synthèse d'étude : ce qu'elle
 * dit, dans quel ordre, et les mentions qu'elle ne doit jamais perdre.
 *
 * CE DOCUMENT N'EST PAS CONTRACTUEL, et le construit le dit trois fois : dans le
 * titre, dans un encadré de tête, et en pied de chaque page. Un brouillon porte
 * en plus un bandeau que l'on ne peut pas manquer.
 */

import {
  boxedText,
  createPainter,
  emitPdf,
  ensure,
  hline,
  LINE,
  MARGIN,
  rect,
  text,
  textAt,
  type Painter,
} from "@/lib/pv/pdfEngine";

export const PV_PDF_DISCLAIMER =
  "Étude indicative et non contractuelle, sous réserve de validation finale, " +
  "visite technique, contraintes du site et conditions contractuelles.";

export const PV_PDF_DRAFT_BANNER = "BROUILLON — NON VALIDÉ — NE PAS TRANSMETTRE AU CLIENT";

export const PV_PDF_TITLE = "Synthèse d\u2019étude photovoltaïque";

/** Une ligne de fiche : libellé + valeur. Une valeur absente n'est jamais inventée. */
export type PvPdfRow = { label: string; value: string | null };

export type PvPdfSection = { heading: string; rows: PvPdfRow[]; note?: string };

export type PvPdfModel = {
  stage: "DRAFT" | "FINAL";
  company: string;
  reference: string;
  clientName: string;
  siteAddress: string | null;
  generatedOn: string;
  studyVersion: number;
  sections: PvPdfSection[];
  /** Statut des données utilisées — affiché tel quel, sans adoucissement. */
  dataStatus: string[];
};

/** Valeur absente : « Non renseigné ». Jamais un zéro, jamais une estimation. */
export const NOT_PROVIDED = "Non renseigné";

export function pvValue(v: string | number | null | undefined, unit?: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const s = typeof v === "number" ? String(v) : v.trim();
  if (s.length === 0) return null;
  return unit ? `${s} ${unit}` : s;
}

/** Bandeau BROUILLON, posé avant tout le reste : impossible à manquer. */
function draftBanner(p: Painter, banner: string): void {
  rect(p, MARGIN, p.y - 22, 595.28 - 2 * MARGIN, 26, 0.85);
  textAt(p, banner, MARGIN + 8, 11, true, p.y - 15);
  p.y -= 40;
}

/**
 * Construit la synthèse. Renvoie les octets d'un PDF complet et autonome.
 *
 * Aucune valeur n'est inventée : une ligne dont la valeur est `null` s'affiche
 * « Non renseigné ». C'est la règle la plus importante de ce document — un
 * chiffre absent qui deviendrait un zéro serait un mensonge imprimé.
 */
export function buildPvStudyPdf(model: PvPdfModel): Uint8Array {
  const p = createPainter();

  if (model.stage === "DRAFT") draftBanner(p, PV_PDF_DRAFT_BANNER);

  // --- Titre -----------------------------------------------------------------
  text(p, PV_PDF_TITLE, 20, true);
  p.y -= 6;
  text(p, model.company, 11, false);
  text(p, `Référence dossier : ${model.reference}`, 10, false);
  text(p, `Établie le ${model.generatedOn} — étude version ${model.studyVersion}`, 10, false);
  p.y -= 4;
  hline(p);
  p.y -= 14;

  // --- Non-contractualité, en tête et non en note de bas de page -------------
  boxedText(p, PV_PDF_DISCLAIMER);

  // --- Client et site --------------------------------------------------------
  text(p, "Client", 13, true);
  text(p, model.clientName, 11, false, 10);
  text(p, `Site : ${model.siteAddress ?? NOT_PROVIDED}`, 11, false, 10);
  p.y -= 8;

  // --- Sections --------------------------------------------------------------
  for (const section of model.sections) {
    ensure(p, LINE * 3);
    text(p, section.heading, 13, true);
    p.y -= 2;
    for (const row of section.rows) {
      ensure(p, LINE);
      // Colonne de valeurs alignée : un tableau se lit, une liste se déchiffre.
      textAt(p, row.label, MARGIN + 10, 10, false);
      textAt(p, row.value ?? NOT_PROVIDED, MARGIN + 260, 10, true);
      p.y -= LINE;
    }
    if (section.note) {
      p.y -= 2;
      text(p, section.note, 9, false, 10);
    }
    p.y -= 10;
  }

  // --- Statut des données utilisées ------------------------------------------
  ensure(p, LINE * (model.dataStatus.length + 2));
  text(p, "Statut des données utilisées", 13, true);
  for (const s of model.dataStatus) text(p, `— ${s}`, 10, false, 10);

  return emitPdf(p, {
    footer: (i, total) => [
      `${PV_PDF_TITLE} — ${model.reference} — page ${i + 1} / ${total}`,
      "Document non contractuel.",
    ],
    cornerStamp: () => (model.stage === "DRAFT" ? "BROUILLON — NE PAS TRANSMETTRE" : null),
  });
}
