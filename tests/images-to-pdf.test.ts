/**
 * Unit tests for the pure JPEG→PDF builder (`lib/attachments/imagesToPdf.ts`).
 * Run: node --test tests/
 *
 * The builder does not parse the JPEG (dimensions are supplied), so dummy JPEG
 * byte payloads are sufficient to assert the PDF structure: header, one Page per
 * image, embedded DCTDecode streams, a Count matching the page total, a valid
 * xref/trailer and %%EOF. This proves the produced file is a well-formed,
 * self-contained PDF that will pass the Phase B `%PDF-` magic-byte check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { imagesToPdf, type PdfImagePage } from "../lib/attachments/imagesToPdf.ts";
import { validateAttachment } from "../lib/attachments/serverValidate.ts";

const dummyJpeg = (marker: number) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, marker, 0x00, 0x10, 0xff, 0xd9]);

function asLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

test("single image → one-page PDF, well-formed", () => {
  const page: PdfImagePage = { jpeg: dummyJpeg(1), width: 1000, height: 1400 };
  const pdf = imagesToPdf([page]);
  const s = asLatin1(pdf);
  assert.ok(s.startsWith("%PDF-1.4"), "has PDF header");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "ends with EOF");
  assert.match(s, /\/Count 1/);
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, 1, "exactly one Page");
  assert.match(s, /\/Filter \/DCTDecode/);
  assert.match(s, /\bxref\b/);
  assert.match(s, /\bstartxref\b/);
  assert.match(s, /\/Root 1 0 R/);
});

test("multiple images → multi-page PDF with matching Count and Kids", () => {
  const pages: PdfImagePage[] = [
    { jpeg: dummyJpeg(1), width: 1200, height: 1600 },
    { jpeg: dummyJpeg(2), width: 1600, height: 1200 }, // landscape
    { jpeg: dummyJpeg(3), width: 800, height: 800 },
  ];
  const pdf = imagesToPdf(pages);
  const s = asLatin1(pdf);
  assert.match(s, /\/Count 3/);
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.equal((s.match(/\/Filter \/DCTDecode/g) || []).length, 3);
  // Kids list references the three page objects (3, 6, 9).
  assert.match(s, /\/Kids \[ 3 0 R 6 0 R 9 0 R \]/);
  // Trailer size = 2 + 3*3 objects + free object 0 = 12
  assert.match(s, /\/Size 12/);
});

test("embeds the exact JPEG bytes verbatim (DCTDecode, no re-compression)", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xde, 0xad, 0xbe, 0xef, 0xff, 0xd9]);
  const pdf = imagesToPdf([{ jpeg, width: 640, height: 480 }]);
  const s = asLatin1(pdf);
  assert.match(s, new RegExp(`/Length ${jpeg.length}\\b`));
  // The raw JPEG payload appears between stream/endstream.
  assert.ok(asLatin1(pdf).includes(asLatin1(jpeg)), "JPEG bytes embedded verbatim");
});

test("landscape image uses A4 landscape MediaBox", () => {
  const pdf = imagesToPdf([{ jpeg: dummyJpeg(9), width: 2000, height: 1000 }]);
  const s = asLatin1(pdf);
  // A4 landscape width 841.89 appears first in the MediaBox.
  assert.match(s, /\/MediaBox \[0 0 841\.89 595\.28\]/);
});

test("empty page list throws (fail-closed)", () => {
  assert.throws(() => imagesToPdf([]), /at least one page/);
});

test("generated PDF passes the Phase B server validator (UPLOAD gate)", () => {
  // Cross-subsystem proof: a scan-produced PDF flows through the SAME fail-closed
  // Phase B validation as any uploaded document (magic %PDF-, document category).
  const pdf = imagesToPdf([{ jpeg: dummyJpeg(1), width: 1200, height: 1600 }]);
  const verdict = validateAttachment({
    name: "scan-2026-08-13-0905.pdf",
    size: pdf.length,
    type: "application/pdf",
    head: pdf.subarray(0, 4096),
  });
  assert.equal(verdict.ok, true);
  if (verdict.ok) {
    assert.equal(verdict.category, "document");
    assert.equal(verdict.formatId, "pdf");
    assert.equal(verdict.canonicalMime, "application/pdf");
  }
});

test("xref offsets point at real object starts", () => {
  const pdf = imagesToPdf([{ jpeg: dummyJpeg(1), width: 100, height: 100 }]);
  const s = asLatin1(pdf);
  const xrefIdx = s.indexOf("xref\n");
  const startxrefMatch = s.match(/startxref\n(\d+)/);
  assert.ok(startxrefMatch, "startxref present");
  // startxref must equal the byte offset of the xref keyword.
  assert.equal(Number(startxrefMatch[1]), xrefIdx);
  // Object 1 offset (first data line after "0 N" and the free entry) points at "1 0 obj".
  const firstEntry = s.slice(xrefIdx).match(/\n(\d{10}) 00000 n /);
  assert.ok(firstEntry);
  const obj1Offset = Number(firstEntry[1]);
  assert.ok(s.slice(obj1Offset).startsWith("1 0 obj"), "obj1 offset lands on '1 0 obj'");
});
