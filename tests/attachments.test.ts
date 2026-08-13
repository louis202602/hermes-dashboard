/**
 * Real, executable unit tests for the pure LOCAL-attachment logic
 * (`lib/attachments/attachments.ts`). Run with the Node built-in test runner:
 *
 *   node --test tests/
 *
 * These cover the Phase-A client-side UX guard: kind detection, the reasonable
 * MIME/extension allowlist, executable-type refusal, and the count/size/name
 * caps. This is a usability guard, NOT a security boundary (real enforcement is
 * the separate Phase B backend slice) — the tests assert the honest behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_NAME_LENGTH,
  extensionOf,
  kindFor,
  isPreviewable,
  isAllowedType,
  formatBytes,
  validateFiles,
} from "../lib/attachments/attachments.ts";

test("extensionOf handles paths, dotfiles and missing extensions", () => {
  assert.equal(extensionOf("photo.JPG"), "jpg");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
  assert.equal(extensionOf("C:\\Users\\a\\report.pdf"), "pdf");
  assert.equal(extensionOf("noext"), "");
  assert.equal(extensionOf(".env"), "");
});

test("kindFor classifies by mime then by extension fallback", () => {
  assert.equal(kindFor({ name: "a.png", size: 1, type: "image/png" }), "image");
  assert.equal(kindFor({ name: "clip.mov", size: 1, type: "" }), "video");
  assert.equal(kindFor({ name: "song.mp3", size: 1, type: "audio/mpeg" }), "audio");
  assert.equal(kindFor({ name: "doc.pdf", size: 1, type: "application/pdf" }), "pdf");
  assert.equal(kindFor({ name: "sheet.xlsx", size: 1, type: "" }), "document");
  assert.equal(kindFor({ name: "mystery.bin", size: 1, type: "application/octet-stream" }), "other");
});

test("isPreviewable only for image/video", () => {
  assert.equal(isPreviewable("image"), true);
  assert.equal(isPreviewable("video"), true);
  assert.equal(isPreviewable("audio"), false);
  assert.equal(isPreviewable("pdf"), false);
  assert.equal(isPreviewable("document"), false);
  assert.equal(isPreviewable("other"), false);
});

test("isAllowedType accepts media + docs, refuses executables/scripts", () => {
  assert.equal(isAllowedType({ name: "a.png", size: 1, type: "image/png" }), true);
  assert.equal(isAllowedType({ name: "v.mp4", size: 1, type: "video/mp4" }), true);
  assert.equal(isAllowedType({ name: "d.pdf", size: 1, type: "application/pdf" }), true);
  // empty type → extension fallback
  assert.equal(isAllowedType({ name: "notes.md", size: 1, type: "" }), true);
  assert.equal(isAllowedType({ name: "data.bin", size: 1, type: "" }), false);
  // blocked executables/scripts are always refused, even with a benign mime
  assert.equal(isAllowedType({ name: "malware.exe", size: 1, type: "application/pdf" }), false);
  assert.equal(isAllowedType({ name: "script.js", size: 1, type: "text/plain" }), false);
  assert.equal(isAllowedType({ name: "app.apk", size: 1, type: "" }), false);
});

test("formatBytes is human readable", () => {
  assert.equal(formatBytes(0), "0 o");
  assert.equal(formatBytes(512), "512 o");
  assert.equal(formatBytes(1024), "1 Ko");
  assert.equal(formatBytes(1536), "1.5 Ko");
  assert.equal(formatBytes(25 * 1024 * 1024), "25 Mo");
  assert.equal(formatBytes(-1), "—");
});

test("validateFiles accepts within caps and preserves order", () => {
  const { accepted, errors } = validateFiles(
    [
      { name: "a.png", size: 10, type: "image/png" },
      { name: "b.pdf", size: 20, type: "application/pdf" },
    ],
    0,
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(accepted.map((f) => f.name), ["a.png", "b.pdf"]);
});

test("validateFiles enforces the count cap against the existing selection", () => {
  const incoming = Array.from({ length: 3 }, (_, i) => ({
    name: `f${i}.png`,
    size: 10,
    type: "image/png",
  }));
  const { accepted, errors } = validateFiles(incoming, MAX_ATTACHMENTS - 1);
  assert.equal(accepted.length, 1); // only one slot left
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => e.reason.includes(String(MAX_ATTACHMENTS))));
});

test("validateFiles rejects oversize, empty, long-name and bad types", () => {
  const { accepted, errors } = validateFiles(
    [
      { name: "big.png", size: MAX_FILE_BYTES + 1, type: "image/png" },
      { name: "empty.png", size: 0, type: "image/png" },
      { name: `${"x".repeat(MAX_NAME_LENGTH + 1)}.png`, size: 10, type: "image/png" },
      { name: "run.exe", size: 10, type: "application/octet-stream" },
      { name: "ok.jpg", size: 10, type: "image/jpeg" },
    ],
    0,
  );
  assert.deepEqual(accepted.map((f) => f.name), ["ok.jpg"]);
  assert.equal(errors.length, 4);
  assert.match(errors[0].reason, /volumineux/);
  assert.match(errors[1].reason, /vide/);
  assert.match(errors[2].reason, /trop long/);
  assert.match(errors[3].reason, /non pris en charge/);
});
