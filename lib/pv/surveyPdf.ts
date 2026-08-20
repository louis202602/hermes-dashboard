/**
 * RAPPORT DE VISITE TECHNIQUE — le CONTENU du document.
 *
 * Ce n'est NI un devis, NI une synthèse d'étude : c'est un constat de terrain,
 * interne à l'entreprise. Il n'engage aucun prix et ne se signe pas — le
 * document le dit lui-même, parce qu'un rapport qui ressemble à un devis finira
 * par être envoyé comme tel.
 *
 * La mécanique PDF vit dans `lib/pv/pdfEngine.ts`, partagée avec la synthèse
 * (PV-4) et le devis (PV-5).
 *
 * AUCUNE VALEUR N'EST INVENTÉE. Une mesure absente s'affiche « Non mesuré » —
 * et « Non mesuré » n'est PAS « conforme » : sur un constat, confondre les deux
 * serait affirmer une vérification qui n'a pas eu lieu.
 */

import {
  boxedText,
  createPainter,
  emitPdf,
  ensure,
  hline,
  LINE,
  MARGIN,
  PAGE_W,
  rect,
  text,
  textAt,
  wrap,
  type Painter,
} from "@/lib/pv/pdfEngine";

export const PV_SURVEY_PDF_TITLE = "Rapport de visite technique photovoltaïque";

export const PV_SURVEY_DRAFT_BANNER = "VISITE NON VALIDÉE — CONSTAT PROVISOIRE";

/**
 * Mentions obligatoires. Elles bornent honnêtement ce que ce document est —
 * et surtout ce qu'il n'est pas.
 */
export const PV_SURVEY_NOTICES = [
  "Ce rapport est un CONSTAT de terrain à usage interne. Il ne constitue ni un devis, " +
    "ni un engagement contractuel, ni un diagnostic réglementaire.",
  "Une suspicion d’amiante relevée ici est un constat visuel. Un diagnostic amiante " +
    "relève exclusivement d’un opérateur certifié et fait l’objet d’un rapport distinct.",
  "Les observations électriques (tableau, prise de terre) sont visuelles. Elles ne " +
    "remplacent pas un contrôle réglementaire de l’installation.",
];

export const SURVEY_NOT_MEASURED = "Non mesuré";
export const SURVEY_NOT_PROVIDED = "Non renseigné";

export type PvSurveyPdfRow = {
  label: string;
  declared: string | null;
  measured: string | null;
  delta: string | null;
  /** Libellé TEXTUEL du statut — jamais une couleur seule. */
  status: string;
};

export type PvSurveyPdfFinding = {
  label: string;
  severity: string;
  declared: string | null;
  measured: string | null;
  unit: string | null;
  comment: string | null;
  resolution: string | null;
};

export type PvSurveyPdfModel = {
  /** `VALIDATED` produit un rapport définitif ; tout autre statut, un provisoire. */
  isValidated: boolean;
  statusLabel: string;
  company: string;
  clientName: string;
  siteAddress: string | null;
  technician: string | null;
  scheduledOn: string | null;
  completedOn: string | null;
  validatedOn: string | null;
  generatedOn: string;
  /** Comparaison déclaré ↔ mesuré, déjà construite par `pvSurveyComparison`. */
  comparison: PvSurveyPdfRow[];
  findings: PvSurveyPdfFinding[];
  /** Relevés qui n'ont pas de contrepartie déclarée — implantation, électricité. */
  observations: { heading: string; rows: { label: string; value: string | null }[] }[];
  constraints: string | null;
  remarks: string | null;
  /** Documents rattachés, RÉFÉRENCÉS par leur nom : les images ne sont pas embarquées. */
  attachments: string[];
  /** Verdict, en toutes lettres : VALIDATED / NEEDS_REVIEW / BLOCKING / … */
  outcome: string;
};

const COL_LABEL = 0;
const COL_DECLARED = 200;
const COL_MEASURED = 290;
const COL_DELTA = 380;
const COL_STATUS = 445;
const TABLE_W = PAGE_W - 2 * MARGIN;

function comparisonHeader(p: Painter): void {
  ensure(p, LINE * 2);
  rect(p, MARGIN, p.y - 4, TABLE_W, 16, 0.9);
  const y = p.y + 1;
  textAt(p, "Élément", MARGIN + COL_LABEL + 2, 9, true, y);
  textAt(p, "Déclaré", MARGIN + COL_DECLARED, 9, true, y);
  textAt(p, "Mesuré", MARGIN + COL_MEASURED, 9, true, y);
  textAt(p, "Écart", MARGIN + COL_DELTA, 9, true, y);
  textAt(p, "Statut", MARGIN + COL_STATUS, 9, true, y);
  p.y -= 20;
}

/**
 * Une ligne de comparaison. Le statut est TEXTUEL — « Bloquant », « À revoir »,
 * « Conforme », « Non mesuré » — pas un code couleur : un rapport imprimé en
 * noir et blanc doit rester lisible, et un lecteur daltonien aussi.
 */
function comparisonRow(p: Painter, row: PvSurveyPdfRow): void {
  const wrapped = wrap(row.label, 9, COL_DECLARED - 10);
  ensure(p, LINE * (wrapped.length + 1));
  const top = p.y;
  textAt(p, row.declared ?? SURVEY_NOT_PROVIDED, MARGIN + COL_DECLARED, 9, false, top);
  textAt(p, row.measured ?? SURVEY_NOT_MEASURED, MARGIN + COL_MEASURED, 9, false, top);
  textAt(p, row.delta ?? "—", MARGIN + COL_DELTA, 9, false, top);
  textAt(p, row.status, MARGIN + COL_STATUS, 9, true, top);
  for (const l of wrapped) {
    textAt(p, l, MARGIN + COL_LABEL + 2, 9, false, p.y);
    p.y -= 11;
  }
  p.y -= 3;
  hline(p, p.y + 2);
  p.y -= 4;
}

/**
 * Construit le rapport. Renvoie les octets d'un PDF complet et autonome.
 *
 * Les photos ne sont pas embarquées : elles sont RÉFÉRENCÉES par leur nom. Un
 * rapport de 40 Mo qu'aucune messagerie n'accepte n'aide personne, et les photos
 * restent consultables dans Hermès, derrière une URL signée.
 */
export function buildPvSurveyPdf(model: PvSurveyPdfModel): Uint8Array {
  const p = createPainter();

  if (!model.isValidated) {
    rect(p, MARGIN, p.y - 22, TABLE_W, 26, 0.85);
    textAt(p, PV_SURVEY_DRAFT_BANNER, MARGIN + 8, 11, true, p.y - 15);
    p.y -= 40;
  }

  // --- Titre -----------------------------------------------------------------
  text(p, PV_SURVEY_PDF_TITLE, 18, true);
  p.y -= 4;
  text(p, model.company, 11, false);
  text(p, `Édité le ${model.generatedOn}`, 9, false);
  p.y -= 4;
  hline(p);
  p.y -= 14;

  boxedText(p, PV_SURVEY_NOTICES[0], 9.5);

  // --- Identification --------------------------------------------------------
  text(p, "Dossier", 13, true);
  textAt(p, "Client", MARGIN + 10, 10, false);
  textAt(p, model.clientName, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Site", MARGIN + 10, 10, false);
  textAt(p, model.siteAddress ?? SURVEY_NOT_PROVIDED, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Technicien", MARGIN + 10, 10, false);
  textAt(p, model.technician ?? SURVEY_NOT_PROVIDED, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Visite planifiée le", MARGIN + 10, 10, false);
  textAt(p, model.scheduledOn ?? SURVEY_NOT_PROVIDED, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Visite réalisée le", MARGIN + 10, 10, false);
  textAt(p, model.completedOn ?? SURVEY_NOT_PROVIDED, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Validée le", MARGIN + 10, 10, false);
  textAt(p, model.validatedOn ?? SURVEY_NOT_PROVIDED, MARGIN + 200, 10, true);
  p.y -= LINE;
  textAt(p, "Statut", MARGIN + 10, 10, false);
  textAt(p, model.statusLabel, MARGIN + 200, 10, true);
  p.y -= LINE + 8;

  // --- Comparaison déclaré / mesuré -----------------------------------------
  ensure(p, LINE * 4);
  text(p, "Comparaison des données déclarées et mesurées", 13, true);
  p.y -= 2;
  comparisonHeader(p);
  for (const row of model.comparison) comparisonRow(p, row);
  p.y -= 6;

  // --- Écarts ----------------------------------------------------------------
  ensure(p, LINE * 3);
  text(p, "Écarts constatés", 13, true);
  p.y -= 2;
  if (model.findings.length === 0) {
    text(p, "Aucun écart retenu par les règles de comparaison.", 10, false, 10);
    p.y -= 6;
  }
  for (const f of model.findings) {
    ensure(p, LINE * 3);
    text(p, `${f.label} — ${f.severity}`, 10.5, true, 10);
    const parts: string[] = [];
    if (f.declared !== null) parts.push(`déclaré : ${f.declared}${f.unit ? ` ${f.unit}` : ""}`);
    if (f.measured !== null) parts.push(`mesuré : ${f.measured}${f.unit ? ` ${f.unit}` : ""}`);
    if (parts.length > 0) text(p, parts.join(" · "), 9, false, 20);
    if (f.comment !== null) text(p, f.comment, 9, false, 20);
    if (f.resolution !== null) text(p, `Résolution : ${f.resolution}`, 9, true, 20);
    p.y -= 4;
  }
  p.y -= 4;

  // --- Relevés sans contrepartie déclarée ------------------------------------
  for (const section of model.observations) {
    ensure(p, LINE * 3);
    text(p, section.heading, 13, true);
    p.y -= 2;
    for (const row of section.rows) {
      ensure(p, LINE);
      textAt(p, row.label, MARGIN + 10, 10, false);
      textAt(p, row.value ?? SURVEY_NOT_MEASURED, MARGIN + 260, 10, true);
      p.y -= LINE;
    }
    p.y -= 8;
  }

  // --- Contraintes et remarques ----------------------------------------------
  if (model.constraints !== null) {
    ensure(p, LINE * 3);
    text(p, "Contraintes de sécurité", 13, true);
    text(p, model.constraints, 10, false, 10);
    p.y -= 8;
  }
  if (model.remarks !== null) {
    ensure(p, LINE * 3);
    text(p, "Remarques", 13, true);
    text(p, model.remarks, 10, false, 10);
    p.y -= 8;
  }

  // --- Pièces jointes, RÉFÉRENCÉES -------------------------------------------
  ensure(p, LINE * 3);
  text(p, "Pièces jointes", 13, true);
  if (model.attachments.length === 0) {
    text(p, "Aucune pièce rattachée à cette visite.", 10, false, 10);
  } else {
    text(p, "Consultables dans Hermès (accès privé) — non incorporées à ce document :", 9, false, 10);
    for (const a of model.attachments) text(p, `— ${a}`, 9, false, 10);
  }
  p.y -= 8;

  // --- Résultat, en toutes lettres -------------------------------------------
  ensure(p, LINE * 4);
  text(p, "Résultat de la visite", 13, true);
  text(p, model.outcome, 12, true, 10);
  p.y -= 8;

  for (const notice of PV_SURVEY_NOTICES.slice(1)) boxedText(p, notice, 9);

  return emitPdf(p, {
    footer: (i, total) => [
      `${PV_SURVEY_PDF_TITLE} — ${model.clientName} — page ${i + 1} / ${total}`,
      "Constat de terrain à usage interne. Ni devis, ni diagnostic réglementaire.",
    ],
    cornerStamp: () => (model.isValidated ? null : "VISITE NON VALIDÉE"),
  });
}
