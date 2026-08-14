/**
 * Unit tests for the pure scan/capture helpers (`lib/attachments/scan.ts`).
 * Run: node --test tests/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SCAN_MAX_PAGES,
  attachInputConfig,
  scanPdfFilename,
  ensurePdfName,
  resizeToMaxEdge,
  scanPageLimitError,
} from "../lib/attachments/scan.ts";

test("attachInputConfig: camera captures rear camera, single", () => {
  const c = attachInputConfig("camera");
  assert.equal(c.accept, "image/*");
  assert.equal(c.capture, "environment");
  assert.equal(c.multiple, false);
});

test("attachInputConfig: photos/documents/audio never offer video", () => {
  for (const kind of ["photos", "documents", "audio"] as const) {
    const c = attachInputConfig(kind);
    assert.equal(c.capture, false);
    assert.equal(c.multiple, true);
    assert.doesNotMatch(c.accept, /video\//);
    assert.doesNotMatch(c.accept, /\.mp4/);
  }
  assert.match(attachInputConfig("photos").accept, /image\/jpeg/);
  assert.match(attachInputConfig("documents").accept, /application\/pdf/);
  assert.match(attachInputConfig("audio").accept, /audio\/mpeg/);
});

test("scanPdfFilename formats scan-YYYY-MM-DD-HHMM.pdf (local time)", () => {
  // Construct via local-time components to avoid TZ ambiguity.
  const d = new Date(2026, 7, 13, 9, 5); // 2026-08-13 09:05 local
  assert.equal(scanPdfFilename(d), "scan-2026-08-13-0905.pdf");
});

test("ensurePdfName enforces .pdf and a non-empty fallback", () => {
  assert.equal(ensurePdfName("Contrat", "scan.pdf"), "Contrat.pdf");
  assert.equal(ensurePdfName("Contrat.pdf", "scan.pdf"), "Contrat.pdf");
  assert.equal(ensurePdfName("facture.PDF", "scan.pdf"), "facture.PDF");
  assert.equal(ensurePdfName("   ", "scan.pdf"), "scan.pdf");
});

test("resizeToMaxEdge downscales the long edge, never upscales", () => {
  assert.deepEqual(resizeToMaxEdge(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(resizeToMaxEdge(3000, 4000, 2000), { width: 1500, height: 2000 });
  // Already within budget → unchanged.
  assert.deepEqual(resizeToMaxEdge(1000, 800, 2000), { width: 1000, height: 800 });
  // Degenerate input → zero (caller skips).
  assert.deepEqual(resizeToMaxEdge(0, 0, 2000), { width: 0, height: 0 });
});

test("scanPageLimitError guards the page cap", () => {
  assert.equal(scanPageLimitError(SCAN_MAX_PAGES), null);
  assert.match(String(scanPageLimitError(SCAN_MAX_PAGES + 1)), /pages/);
});
