/**
 * SYNTHÈSE D'ÉTUDE PHOTOVOLTAÏQUE — constructeur PDF pur, sans dépendance.
 *
 * Pourquoi pas une bibliothèque : le dépôt possède déjà un écrivain PDF maison
 * (`lib/attachments/imagesToPdf.ts`) pour les images, avec ses xref/trailer
 * corrects. Ajouter `pdfkit` ou `jspdf` pour poser du texte sur de l'A4
 * introduirait une dépendance lourde — polices embarquées, API DOM ou Node —
 * pour un besoin que trente lignes de PostScript couvrent. On écrit donc le
 * pendant TEXTE du module existant, dans le même esprit et avec les mêmes
 * garanties : pur, sans I/O, testable au contenu.
 *
 * Police : Helvetica, l'une des 14 polices de base garanties par tout lecteur
 * PDF. Aucun fichier de police n'est embarqué. Encodage WinAnsi — il couvre les
 * accents français, le degré et l'euro, ce qui suffit exactement à ce document.
 *
 * CE DOCUMENT N'EST PAS CONTRACTUEL, et le construit le dit trois fois : dans le
 * titre, dans un encadré de tête, et en pied de chaque page. Un brouillon porte
 * en plus un bandeau que l'on ne peut pas manquer.
 */

// A4 en points PostScript (72 dpi).
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LINE = 14;

const FONT_REGULAR = "F1"; // Helvetica
const FONT_BOLD = "F2"; // Helvetica-Bold

export const PV_PDF_DISCLAIMER =
  "Étude indicative et non contractuelle, sous réserve de validation finale, " +
  "visite technique, contraintes du site et conditions contractuelles.";

export const PV_PDF_DRAFT_BANNER = "BROUILLON — NON VALIDÉ — NE PAS TRANSMETTRE AU CLIENT";

export const PV_PDF_TITLE = "Synthèse d’étude photovoltaïque";

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

// --- Encodage --------------------------------------------------------------

/**
 * WinAnsi (CP1252). Les caractères hors table sont remplacés par `?` plutôt que
 * silencieusement supprimés : un texte tronqué se remarque, un texte amputé non.
 */
const WINANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
  "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

function winAnsiByte(ch: string): number {
  const code = ch.codePointAt(0) ?? 0x3f;
  if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) return code;
  const mapped = WINANSI_EXTRA[ch];
  return mapped ?? 0x3f;
}

/** Chaîne littérale PDF : parenthèses et antislash échappés, WinAnsi. */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "(" || ch === ")" || ch === "\\") {
      out += `\\${ch}`;
      continue;
    }
    const b = winAnsiByte(ch);
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, "0")}`;
  }
  return out;
}

function bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function n2(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// --- Mise en page ----------------------------------------------------------

/**
 * Largeur approchée d'une chaîne en Helvetica. Approximation VOLONTAIRE : une
 * table de métriques exacte pèserait plus que le gain. On majore légèrement
 * (0.52 em au lieu de ~0.5), donc la césure coupe un peu tôt — jamais trop tard,
 * ce qui produirait un débordement visible.
 */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.52;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current.length === 0 ? w : `${current} ${w}`;
    if (textWidth(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      current = w;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

type Op = { kind: "text"; x: number; y: number; size: number; bold: boolean; text: string }
        | { kind: "rect"; x: number; y: number; w: number; h: number; gray: number }
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number };

/** Une page en cours de composition. */
type Painter = {
  pages: Op[][];
  ops: Op[];
  y: number;
};

function newPage(p: Painter): void {
  if (p.ops.length > 0) p.pages.push(p.ops);
  p.ops = [];
  p.y = PAGE_H - MARGIN;
}

function ensure(p: Painter, needed: number): void {
  // Réserve le pied de page : sans cette marge, une section pourrait écrire
  // par-dessus le disclaimer, qui est justement ce qu'on ne peut pas perdre.
  if (p.y - needed < MARGIN + 30) newPage(p);
}

function text(p: Painter, s: string, size: number, bold: boolean, indent = 0): void {
  for (const line of wrap(s, size, CONTENT_W - indent)) {
    ensure(p, LINE);
    p.ops.push({ kind: "text", x: MARGIN + indent, y: p.y, size, bold, text: line });
    p.y -= size + 3;
  }
}

/**
 * Construit la synthèse. Renvoie les octets d'un PDF complet et autonome.
 *
 * Aucune valeur n'est inventée : une ligne dont la valeur est `null` s'affiche
 * « Non renseigné ». C'est la règle la plus importante de ce document — un
 * chiffre absent qui deviendrait un zéro serait un mensonge imprimé.
 */
export function buildPvStudyPdf(model: PvPdfModel): Uint8Array {
  const p: Painter = { pages: [], ops: [], y: PAGE_H - MARGIN };

  // --- Bandeau BROUILLON, avant tout le reste --------------------------------
  if (model.stage === "DRAFT") {
    p.ops.push({ kind: "rect", x: MARGIN, y: p.y - 22, w: CONTENT_W, h: 26, gray: 0.85 });
    p.ops.push({
      kind: "text",
      x: MARGIN + 8,
      y: p.y - 15,
      size: 11,
      bold: true,
      text: PV_PDF_DRAFT_BANNER,
    });
    p.y -= 40;
  }

  // --- Titre -----------------------------------------------------------------
  text(p, PV_PDF_TITLE, 20, true);
  p.y -= 6;
  text(p, model.company, 11, false);
  text(p, `Référence dossier : ${model.reference}`, 10, false);
  text(p, `Établie le ${model.generatedOn} — étude version ${model.studyVersion}`, 10, false);
  p.y -= 4;
  p.ops.push({ kind: "line", x1: MARGIN, y1: p.y, x2: PAGE_W - MARGIN, y2: p.y });
  p.y -= 14;

  // --- Encadré de non-contractualité, en tête et non en note de bas de page ---
  const disclaimerLines = wrap(PV_PDF_DISCLAIMER, 9.5, CONTENT_W - 16);
  const boxH = disclaimerLines.length * 12 + 14;
  ensure(p, boxH + 10);
  p.ops.push({ kind: "rect", x: MARGIN, y: p.y - boxH + 8, w: CONTENT_W, h: boxH, gray: 0.93 });
  let dy = p.y - 4;
  for (const line of disclaimerLines) {
    p.ops.push({ kind: "text", x: MARGIN + 8, y: dy, size: 9.5, bold: false, text: line });
    dy -= 12;
  }
  p.y -= boxH + 8;

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
      const value = row.value ?? NOT_PROVIDED;
      p.ops.push({ kind: "text", x: MARGIN + 10, y: p.y, size: 10, bold: false, text: row.label });
      // Colonne de valeurs alignée : un tableau se lit, une liste se déchiffre.
      p.ops.push({ kind: "text", x: MARGIN + 260, y: p.y, size: 10, bold: true, text: value });
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
  for (const s of model.dataStatus) {
    text(p, `— ${s}`, 10, false, 10);
  }

  newPage(p);

  // --- Émission --------------------------------------------------------------
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const push = (u: Uint8Array) => {
    chunks.push(u);
    offset += u.length;
  };
  const pushStr = (s: string) => push(bytes(s));

  pushStr("%PDF-1.4\n");
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageCount = p.pages.length;
  // 1 Catalog · 2 Pages · 3 F1 · 4 F2 · puis 2 objets par page (Page, Contents).
  const pageObj = (i: number) => 5 + i * 2;
  const contentObj = (i: number) => 5 + i * 2 + 1;
  const totalObjects = 4 + pageCount * 2;

  offsets[1] = offset;
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets[2] = offset;
  const kids = p.pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>\nendobj\n`);

  offsets[3] = offset;
  pushStr(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
      "/Encoding /WinAnsiEncoding >>\nendobj\n",
  );
  offsets[4] = offset;
  pushStr(
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold " +
      "/Encoding /WinAnsiEncoding >>\nendobj\n",
  );

  p.pages.forEach((ops, i) => {
    const footer = `${PV_PDF_TITLE} — ${model.reference} — page ${i + 1} / ${pageCount}`;
    const body: string[] = [];

    for (const op of ops) {
      if (op.kind === "rect") {
        body.push(`q ${n2(op.gray)} g ${n2(op.x)} ${n2(op.y)} ${n2(op.w)} ${n2(op.h)} re f Q`);
      } else if (op.kind === "line") {
        body.push(`q 0.6 w ${n2(op.x1)} ${n2(op.y1)} m ${n2(op.x2)} ${n2(op.y2)} l S Q`);
      } else {
        const font = op.bold ? FONT_BOLD : FONT_REGULAR;
        body.push(
          `BT /${font} ${n2(op.size)} Tf ${n2(op.x)} ${n2(op.y)} Td (${pdfString(op.text)}) Tj ET`,
        );
      }
    }

    // Pied de page : rappel de non-contractualité sur CHAQUE page. Une page
    // détachée du document doit rester honnête.
    body.push(
      `BT /${FONT_REGULAR} 8 Tf ${n2(MARGIN)} ${n2(MARGIN - 12)} Td (${pdfString(footer)}) Tj ET`,
    );
    body.push(
      `BT /${FONT_REGULAR} 8 Tf ${n2(MARGIN)} ${n2(MARGIN - 22)} Td ` +
        `(${pdfString("Document non contractuel.")}) Tj ET`,
    );
    if (model.stage === "DRAFT") {
      body.push(
        `BT /${FONT_BOLD} 8 Tf ${n2(PAGE_W - MARGIN - 150)} ${n2(MARGIN - 12)} Td ` +
          `(${pdfString("BROUILLON — NE PAS TRANSMETTRE")}) Tj ET`,
      );
    }

    const stream = bytes(body.join("\n") + "\n");

    offsets[pageObj(i)] = offset;
    pushStr(
      `${pageObj(i)} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${n2(PAGE_W)} ${n2(PAGE_H)}] ` +
        `/Resources << /Font << /${FONT_REGULAR} 3 0 R /${FONT_BOLD} 4 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>\nendobj\n`,
    );

    offsets[contentObj(i)] = offset;
    pushStr(`${contentObj(i)} 0 obj\n<< /Length ${stream.length} >>\nstream\n`);
    push(stream);
    pushStr("endstream\nendobj\n");
  });

  const xrefOffset = offset;
  const xrefCount = totalObjects + 1;
  const lines: string[] = ["xref\n", `0 ${xrefCount}\n`, "0000000000 65535 f \n"];
  for (let i = 1; i <= totalObjects; i++) {
    lines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  pushStr(lines.join(""));
  pushStr(`trailer\n<< /Size ${xrefCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return concat(chunks);
}
