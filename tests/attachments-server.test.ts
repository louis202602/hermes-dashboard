/**
 * Real, executable unit tests for the SERVER-SIDE, fail-closed attachment
 * validator (`lib/attachments/serverValidate.ts`). Run with the Node built-in
 * test runner:
 *
 *   node --test tests/
 *
 * Unlike the Phase-A client guard, this module IS a security boundary: it never
 * trusts the declared MIME or filename and cross-checks the real head bytes
 * (magic-byte signature) against a strict allowlist. These tests assert the
 * honest fail-closed behaviour for every rejection code plus the accepted
 * happy paths, the batch guardrails, and the traversal-proof filename sanitizer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_BYTES_PER_MESSAGE,
  MAX_BYTES_BY_CATEGORY,
  extensionOf,
  sanitizeFilename,
  validateAttachment,
  checkBatchLimits,
  ATTACHMENT_ACCEPT_V1,
  type FileHead,
} from "../lib/attachments/serverValidate.ts";

// --- Tiny magic-byte fixtures (real signatures, minimal length) -------------
const bytes = (...b: number[]) => Uint8Array.from(b);
const ascii = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
const PDF = ascii("%PDF-1.7\n%âãÏÓ");
const TXT = ascii("bonjour,\nligne 2,\nligne 3\n");
const DOCX = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
const MP3 = bytes(0xff, 0xfb, 0x90, 0x00);
const MP3_ID3 = Uint8Array.from([...ascii("ID3"), 3, 0, 0, 0]);
const WAV = Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]);
const M4A = Uint8Array.from([0, 0, 0, 0x20, ...ascii("ftypM4A ")]);

function head(name: string, size: number, type: string, h: Uint8Array): FileHead {
  return { name, size, type, head: h };
}

test("extensionOf normalises case and strips any path", () => {
  assert.equal(extensionOf("Photo.JPG"), "jpg");
  assert.equal(extensionOf("/etc/passwd"), "");
  assert.equal(extensionOf("C:\\tmp\\report.PDF"), "pdf");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
});

test("valid image (jpg/png/webp) passes with canonical mime + category", () => {
  const r = validateAttachment(head("photo.jpg", JPG.length, "image/jpeg", JPG));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.category, "image");
    assert.equal(r.formatId, "jpg");
    assert.equal(r.canonicalMime, "image/jpeg");
    assert.equal(r.safeName, "photo.jpg");
  }
  assert.equal(validateAttachment(head("p.png", PNG.length, "image/png", PNG)).ok, true);
  assert.equal(validateAttachment(head("p.webp", WEBP.length, "image/webp", WEBP)).ok, true);
});

test("valid pdf / txt / docx documents pass", () => {
  assert.equal(validateAttachment(head("cv.pdf", PDF.length, "application/pdf", PDF)).ok, true);
  // txt: browsers may report empty type; the text heuristic carries it.
  assert.equal(validateAttachment(head("notes.txt", TXT.length, "", TXT)).ok, true);
  const d = validateAttachment(
    head(
      "contrat.docx",
      DOCX.length,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      DOCX,
    ),
  );
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.category, "document");
});

test("valid audio (mp3 with ID3 or frame sync, wav, m4a) passes", () => {
  assert.equal(validateAttachment(head("a.mp3", MP3.length, "audio/mpeg", MP3)).ok, true);
  assert.equal(validateAttachment(head("a.mp3", MP3_ID3.length, "audio/mpeg", MP3_ID3)).ok, true);
  assert.equal(validateAttachment(head("a.wav", WAV.length, "audio/wav", WAV)).ok, true);
  const m = validateAttachment(head("a.m4a", M4A.length, "audio/mp4", M4A));
  assert.equal(m.ok, true);
  if (m.ok) assert.equal(m.category, "audio");
});

test("EMPTY_FILE: zero or non-finite size is rejected", () => {
  const r = validateAttachment(head("x.png", 0, "image/png", PNG));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "EMPTY_FILE");
});

test("VIDEO_NOT_SUPPORTED_YET: recognised by extension or mime, rejected honestly", () => {
  const byExt = validateAttachment(head("clip.mp4", 1000, "", bytes(0, 0, 0, 0)));
  assert.equal(byExt.ok, false);
  if (!byExt.ok) assert.equal(byExt.code, "VIDEO_NOT_SUPPORTED_YET");
  const byMime = validateAttachment(head("clip.bin", 1000, "video/mp4", bytes(0, 0, 0, 0)));
  assert.equal(byMime.ok, false);
  if (!byMime.ok) assert.equal(byMime.code, "VIDEO_NOT_SUPPORTED_YET");
});

test("TYPE_NOT_ALLOWED: unknown/executable extension rejected", () => {
  const r = validateAttachment(head("run.exe", 1000, "application/octet-stream", bytes(0x4d, 0x5a)));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "TYPE_NOT_ALLOWED");
});

test("MIME_MISMATCH: declared mime inconsistent with the extension", () => {
  const r = validateAttachment(head("photo.png", PNG.length, "application/pdf", PNG));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MIME_MISMATCH");
});

test("MAGIC_BYTES_MISMATCH: extension+mime say png but bytes are not png", () => {
  const r = validateAttachment(head("fake.png", 1000, "image/png", PDF));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MAGIC_BYTES_MISMATCH");
});

test("MAGIC_BYTES_MISMATCH: a renamed executable posing as pdf is caught", () => {
  // MZ header (a Windows PE) with a .pdf name + pdf mime must never pass.
  const r = validateAttachment(head("invoice.pdf", 4096, "application/pdf", bytes(0x4d, 0x5a, 0x90, 0x00)));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MAGIC_BYTES_MISMATCH");
});

test("TOO_LARGE: per-category cap enforced (image 10MB)", () => {
  const r = validateAttachment(
    head("big.jpg", MAX_BYTES_BY_CATEGORY.image + 1, "image/jpeg", JPG),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "TOO_LARGE");
  // Just under the cap passes.
  assert.equal(
    validateAttachment(head("ok.jpg", MAX_BYTES_BY_CATEGORY.image, "image/jpeg", JPG)).ok,
    true,
  );
});

test("sanitizeFilename strips path, control chars and separators (no traversal)", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
  assert.equal(sanitizeFilename("/absolute/path/report.pdf"), "report.pdf");
  // control chars (NUL, newline, DEL) removed; illegal fs chars → underscore
  assert.equal(sanitizeFilename("a\u0000b\nc:*?.txt"), "abc___.txt");
  // leading dots stripped so it can never become a dotfile / traversal segment
  assert.equal(sanitizeFilename("...hidden"), "hidden");
  // empty after cleaning falls back to a safe default
  assert.equal(sanitizeFilename("///"), "file");
});

test("sanitizeFilename caps overly long names but keeps the extension", () => {
  const long = `${"a".repeat(500)}.png`;
  const out = sanitizeFilename(long);
  assert.ok(out.length <= 200);
  assert.ok(out.endsWith(".png"));
});

test("checkBatchLimits: TOO_MANY when the count cap would be exceeded", () => {
  const r = checkBatchLimits(MAX_ATTACHMENTS_PER_MESSAGE, 0, 1);
  assert.ok(r);
  if (r) assert.equal(r.code, "TOO_MANY");
  assert.equal(checkBatchLimits(0, 0, 1), null);
});

test("checkBatchLimits: TOTAL_TOO_LARGE when cumulative size would exceed the cap", () => {
  const r = checkBatchLimits(1, MAX_TOTAL_BYTES_PER_MESSAGE, 1);
  assert.ok(r);
  if (r) assert.equal(r.code, "TOTAL_TOO_LARGE");
});

test("ATTACHMENT_ACCEPT_V1 advertises the allowlist and never video", () => {
  assert.match(ATTACHMENT_ACCEPT_V1, /image\/jpeg/);
  assert.match(ATTACHMENT_ACCEPT_V1, /application\/pdf/);
  assert.match(ATTACHMENT_ACCEPT_V1, /audio\/mpeg/);
  assert.doesNotMatch(ATTACHMENT_ACCEPT_V1, /video\//);
  assert.doesNotMatch(ATTACHMENT_ACCEPT_V1, /\.mp4/);
});
