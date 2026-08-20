/**
 * MOTEUR PDF PARTAGÉ DU PACK PHOTOVOLTAÏQUE — pur, sans dépendance, sans I/O.
 *
 * Extrait de `lib/pv/studyPdf.ts` (PV-4) au moment où PV-5 a eu besoin du même
 * moteur pour le devis. Extraire plutôt que dupliquer : deux écrivains PDF
 * divergeraient — l'un corrigerait un échappement que l'autre garderait faux.
 *
 * Le moteur ne sait RIEN du métier : ni étude, ni devis, ni mention légale. Il
 * pose du texte, des filets et des aplats sur de l'A4, et assemble un fichier
 * PDF valide (xref + trailer). Ce que le document DIT reste dans les modules
 * appelants, où cela peut être relu.
 *
 * Police : Helvetica / Helvetica-Bold, deux des 14 polices de base garanties
 * par tout lecteur PDF. Aucun fichier de police n'est embarqué. Encodage
 * WinAnsi — il couvre les accents français, le degré et l'euro.
 */

// A4 en points PostScript (72 dpi).
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - 2 * MARGIN;
export const LINE = 14;

export const FONT_REGULAR = "F1"; // Helvetica
export const FONT_BOLD = "F2"; // Helvetica-Bold

// --- Encodage --------------------------------------------------------------

/**
 * WinAnsi (CP1252). Les caractères hors table deviennent `?` plutôt que d'être
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
  return WINANSI_EXTRA[ch] ?? 0x3f;
}

/** Chaîne littérale PDF : parenthèses et antislash échappés, WinAnsi. */
export function pdfString(text: string): string {
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

export function bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concat(chunks: Uint8Array[]): Uint8Array {
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

export function n2(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// --- Mise en page ----------------------------------------------------------

/**
 * Largeur approchée d'une chaîne en Helvetica. Approximation VOLONTAIRE : une
 * table de métriques exacte pèserait plus que le gain. On majore légèrement
 * (0.52 em au lieu de ~0.5), donc la césure coupe un peu tôt — jamais trop tard,
 * ce qui produirait un débordement visible.
 */
export function textWidth(text: string, size: number): number {
  return text.length * size * 0.52;
}

export function wrap(text: string, size: number, maxWidth: number): string[] {
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

export type Op =
  | { kind: "text"; x: number; y: number; size: number; bold: boolean; text: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; gray: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number };

/** Une page en cours de composition. */
export type Painter = {
  pages: Op[][];
  ops: Op[];
  y: number;
};

export function createPainter(): Painter {
  return { pages: [], ops: [], y: PAGE_H - MARGIN };
}

export function newPage(p: Painter): void {
  if (p.ops.length > 0) p.pages.push(p.ops);
  p.ops = [];
  p.y = PAGE_H - MARGIN;
}

/**
 * Réserve le pied de page : sans cette marge, une section pourrait écrire
 * par-dessus les mentions du pied, qui sont justement ce qu'on ne peut pas perdre.
 */
export function ensure(p: Painter, needed: number): void {
  if (p.y - needed < MARGIN + 30) newPage(p);
}

export function text(p: Painter, s: string, size: number, bold: boolean, indent = 0): void {
  for (const line of wrap(s, size, CONTENT_W - indent)) {
    ensure(p, LINE);
    p.ops.push({ kind: "text", x: MARGIN + indent, y: p.y, size, bold, text: line });
    p.y -= size + 3;
  }
}

/** Texte posé à une abscisse imposée, sans césure ni avance de curseur. */
export function textAt(
  p: Painter,
  s: string,
  x: number,
  size: number,
  bold: boolean,
  y?: number,
): void {
  p.ops.push({ kind: "text", x, y: y ?? p.y, size, bold, text: s });
}

export function rect(p: Painter, x: number, y: number, w: number, h: number, gray: number): void {
  p.ops.push({ kind: "rect", x, y, w, h, gray });
}

export function hline(p: Painter, y?: number): void {
  const at = y ?? p.y;
  p.ops.push({ kind: "line", x1: MARGIN, y1: at, x2: PAGE_W - MARGIN, y2: at });
}

/** Encadré de texte grisé — utilisé pour les mentions qu'on ne doit pas rater. */
export function boxedText(p: Painter, body: string, size = 9.5, gray = 0.93): void {
  const lines = wrap(body, size, CONTENT_W - 16);
  const boxH = lines.length * 12 + 14;
  ensure(p, boxH + 10);
  rect(p, MARGIN, p.y - boxH + 8, CONTENT_W, boxH, gray);
  let dy = p.y - 4;
  for (const line of lines) {
    p.ops.push({ kind: "text", x: MARGIN + 8, y: dy, size, bold: false, text: line });
    dy -= 12;
  }
  p.y -= boxH + 8;
}

// --- Émission --------------------------------------------------------------

export type EmitOptions = {
  /** Lignes de pied de page, recalculées par page. Toujours écrites. */
  footer: (pageIndex: number, pageCount: number) => string[];
  /** Cachet en bas à droite (par ex. « BROUILLON »). `null` = aucun. */
  cornerStamp?: (pageIndex: number, pageCount: number) => string | null;
};

/**
 * Assemble les pages en un PDF complet et autonome : catalogue, arbre de pages,
 * deux polices, un flux de contenu par page, table xref et trailer.
 */
export function emitPdf(p: Painter, opts: EmitOptions): Uint8Array {
  newPage(p); // referme la page courante

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

    // Pied de page sur CHAQUE page : une page détachée du document doit rester
    // honnête sur ce qu'elle est.
    let fy = MARGIN - 12;
    for (const line of opts.footer(i, pageCount)) {
      body.push(`BT /${FONT_REGULAR} 8 Tf ${n2(MARGIN)} ${n2(fy)} Td (${pdfString(line)}) Tj ET`);
      fy -= 10;
    }
    const stamp = opts.cornerStamp?.(i, pageCount) ?? null;
    if (stamp !== null) {
      body.push(
        `BT /${FONT_BOLD} 8 Tf ${n2(PAGE_W - MARGIN - textWidth(stamp, 8))} ${n2(MARGIN - 12)} Td ` +
          `(${pdfString(stamp)}) Tj ET`,
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
