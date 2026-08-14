/**
 * Pure, dependency-free, DOM-free builder that assembles a multi-page PDF from
 * already-encoded JPEG pages. Each JPEG is embedded verbatim via the PDF
 * `DCTDecode` filter (no re-compression), so the output stays small and the
 * module has zero runtime dependencies — which also makes it unit-testable with
 * the Node test runner.
 *
 * This is a **format conversion only**: capture → JPEG (done in the browser) →
 * PDF. There is NO OCR, no content understanding, no network — that stays out
 * of scope (Phase C is forbidden). The produced PDF re-enters the canonical
 * Phase B upload pipeline like any other document (magic bytes `%PDF-`, size
 * cap, checksum, private RLS storage, message linking).
 */

/** One page: an encoded JPEG plus its pixel dimensions (known at encode time). */
export type PdfImagePage = {
  jpeg: Uint8Array;
  width: number;
  height: number;
};

// A4 in PostScript points (72 dpi). Pages are laid out A4 in the image's own
// orientation, image scaled to fit within a small margin and centred — a clean,
// printable "document scan" look rather than raw pixel-sized pages.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 18; // ~0.25in

const HEADER = "%PDF-1.4\n";
// Binary marker line so tools treat the file as binary (raw high bytes).
const BINARY_MARKER = Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

function ascii(s: string): Uint8Array {
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

function num(n: number): string {
  // Compact fixed-point; strip trailing zeros to keep the file small.
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** Fit (w×h) inside (boxW×boxH) preserving aspect ratio (may upscale to fill). */
function fit(
  w: number,
  h: number,
  boxW: number,
  boxH: number,
): { drawW: number; drawH: number } {
  if (w <= 0 || h <= 0) return { drawW: boxW, drawH: boxH };
  const scale = Math.min(boxW / w, boxH / h);
  return { drawW: w * scale, drawH: h * scale };
}

/**
 * Build a PDF (as bytes) from JPEG pages. Object layout: 1=Catalog, 2=Pages,
 * then three objects per page (Page, Image XObject, Content stream). A proper
 * xref table + trailer are emitted so the file is a valid, self-contained PDF.
 */
export function imagesToPdf(pages: PdfImagePage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error("imagesToPdf: at least one page is required");
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const offsets: number[] = []; // offsets[objNum] = byte offset of that object

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushStr = (s: string) => push(ascii(s));
  const startObj = (n: number) => {
    offsets[n] = offset;
  };

  push(ascii(HEADER));
  push(BINARY_MARKER);

  const pageObjNum = (i: number) => 3 + i * 3;
  const imageObjNum = (i: number) => 3 + i * 3 + 1;
  const contentObjNum = (i: number) => 3 + i * 3 + 2;
  const totalObjects = 2 + pages.length * 3; // objects 1..totalObjects

  // 1: Catalog
  startObj(1);
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // 2: Pages tree
  startObj(2);
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const landscape = page.width > page.height;
    const pageW = landscape ? A4_LONG : A4_SHORT;
    const pageH = landscape ? A4_SHORT : A4_LONG;
    const { drawW, drawH } = fit(
      page.width,
      page.height,
      pageW - 2 * MARGIN,
      pageH - 2 * MARGIN,
    );
    const tx = (pageW - drawW) / 2;
    const ty = (pageH - drawH) / 2;

    // Page object
    startObj(pageObjNum(i));
    pushStr(
      `${pageObjNum(i)} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjNum(i)} 0 R >> >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>\nendobj\n`,
    );

    // Image XObject (embedded JPEG, DCTDecode)
    startObj(imageObjNum(i));
    pushStr(
      `${imageObjNum(i)} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\n` +
        `stream\n`,
    );
    push(page.jpeg);
    pushStr("\nendstream\nendobj\n");

    // Content stream: draw the image into the fitted rectangle.
    const ops = `q ${num(drawW)} 0 0 ${num(drawH)} ${num(tx)} ${num(ty)} cm /Im0 Do Q\n`;
    const opsBytes = ascii(ops);
    startObj(contentObjNum(i));
    pushStr(`${contentObjNum(i)} 0 obj\n<< /Length ${opsBytes.length} >>\nstream\n`);
    push(opsBytes);
    pushStr("\nendstream\nendobj\n");
  });

  // xref table
  const xrefOffset = offset;
  const xrefCount = totalObjects + 1; // + the free object 0
  const lines: string[] = ["xref\n", `0 ${xrefCount}\n`, "0000000000 65535 f \n"];
  for (let n = 1; n <= totalObjects; n++) {
    lines.push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  pushStr(lines.join(""));
  pushStr(
    `trailer\n<< /Size ${xrefCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return concat(chunks);
}
