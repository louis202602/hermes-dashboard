/**
 * Real, executable unit tests for the pure voice logic
 * (`lib/voice/speech.ts`). Run with the Node built-in test runner:
 *
 *   node --test tests/
 *
 * These exercise the actual production functions (no mocks of our own code) and
 * cover the security-relevant behaviour: TTS never vocalises secrets/ids, empty
 * transcripts are never fabricated into messages, and capability detection
 * fails closed on browsers without speech recognition (e.g. iOS Safari).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectSpeechSupport,
  isSpeakable,
  isVoiceInputMode,
  isVoiceOutputMode,
  normalizeTranscript,
  pickRecognitionCtor,
  sanitizeForSpeech,
  speechErrorMessage,
} from "../lib/voice/speech.ts";

// --- Mode helpers -----------------------------------------------------------

test("mode helpers classify input/output correctly", () => {
  assert.equal(isVoiceInputMode("TEXT_ONLY"), false);
  assert.equal(isVoiceInputMode("VOICE_INPUT_TEXT_OUTPUT"), true);
  assert.equal(isVoiceInputMode("VOICE_INPUT_VOICE_OUTPUT"), true);

  assert.equal(isVoiceOutputMode("TEXT_ONLY"), false);
  assert.equal(isVoiceOutputMode("VOICE_INPUT_TEXT_OUTPUT"), false);
  assert.equal(isVoiceOutputMode("VOICE_INPUT_VOICE_OUTPUT"), true);
});

// --- Capability detection (fail-closed) ------------------------------------

test("detectSpeechSupport: Chrome-like (webkitSpeechRecognition) → STT+TTS", () => {
  const s = detectSpeechSupport({
    webkitSpeechRecognition: function () {},
    speechSynthesis: {},
  });
  assert.deepEqual(s, { stt: true, tts: true });
});

test("detectSpeechSupport: standard SpeechRecognition → STT true", () => {
  const s = detectSpeechSupport({
    SpeechRecognition: function () {},
    speechSynthesis: {},
  });
  assert.equal(s.stt, true);
  assert.equal(s.tts, true);
});

test("detectSpeechSupport: iOS Safari (no SpeechRecognition, has synthesis) → STT false, TTS true", () => {
  const s = detectSpeechSupport({ speechSynthesis: {} });
  assert.deepEqual(s, { stt: false, tts: true });
});

test("detectSpeechSupport: no window / no APIs → both false (fail-closed)", () => {
  assert.deepEqual(detectSpeechSupport(null), { stt: false, tts: false });
  assert.deepEqual(detectSpeechSupport(undefined), { stt: false, tts: false });
  assert.deepEqual(detectSpeechSupport({}), { stt: false, tts: false });
});

test("pickRecognitionCtor returns the available constructor or null", () => {
  const ctor = function () {};
  assert.equal(pickRecognitionCtor({ SpeechRecognition: ctor }), ctor);
  assert.equal(pickRecognitionCtor({ webkitSpeechRecognition: ctor }), ctor);
  assert.equal(pickRecognitionCtor({ speechSynthesis: {} }), null);
  assert.equal(pickRecognitionCtor(null), null);
});

// --- TTS sanitisation: never vocalise secrets / ids ------------------------

test("sanitizeForSpeech strips UUIDs, Réf. tags, URLs and long tokens", () => {
  // The token below is a synthetic opaque blob (>=24 chars, no real provider
  // prefix) used only to prove long-token stripping — it is not a credential.
  const opaqueToken = "OPAQUEblob" + "0123456789abcdefGHIJKLMN";
  const reply =
    "Chantier qualifié. Réf. 3f2504e0-4f89-41d3-9a0c-0305e82c3301 " +
    "détails sur https://internal.example/x token " +
    opaqueToken;
  const spoken = sanitizeForSpeech(reply);
  assert.ok(!/3f2504e0/.test(spoken), "UUID must be removed");
  assert.ok(!/réf\./i.test(spoken), "Réf. tag must be removed");
  assert.ok(!/https?:\/\//.test(spoken), "URL must be removed");
  assert.ok(!spoken.includes(opaqueToken), "long opaque token must be removed");
  assert.ok(spoken.includes("Chantier qualifié"), "human text is preserved");
});

test("sanitizeForSpeech drops inline code and markdown noise", () => {
  const spoken = sanitizeForSpeech("Voici `const x = secret()` **gras** > cite");
  assert.ok(!spoken.includes("`"));
  assert.ok(!spoken.includes("*"));
  assert.ok(!spoken.includes(">"));
  assert.ok(spoken.includes("Voici"));
});

test("sanitizeForSpeech caps very long replies", () => {
  const spoken = sanitizeForSpeech("mot ".repeat(500));
  assert.ok(spoken.length <= 600);
});

test("isSpeakable: an id-only reply collapses to nothing (no TTS)", () => {
  assert.equal(
    isSpeakable("Réf. 3f2504e0-4f89-41d3-9a0c-0305e82c3301"),
    false,
  );
  assert.equal(isSpeakable(""), false);
  assert.equal(isSpeakable(null), false);
  assert.equal(isSpeakable("Bonjour, voici votre synthèse."), true);
});

// --- Transcript normalisation: never fabricate a message -------------------

test("normalizeTranscript trims and collapses whitespace", () => {
  assert.equal(normalizeTranscript("  qualifie   le   chantier  "), "qualifie le chantier");
});

test("normalizeTranscript returns '' for blank/empty (caller refuses to submit)", () => {
  assert.equal(normalizeTranscript(""), "");
  assert.equal(normalizeTranscript("   "), "");
  assert.equal(normalizeTranscript(null), "");
  assert.equal(normalizeTranscript(undefined), "");
});

test("normalizeTranscript bounds an over-long transcript", () => {
  const out = normalizeTranscript("a".repeat(5000));
  assert.ok(out.length <= 2000);
});

// --- Error messages: controlled, safe to display/speak ---------------------

test("speechErrorMessage maps permission denial to a text-fallback message", () => {
  assert.match(speechErrorMessage("not-allowed"), /micro/i);
  assert.match(speechErrorMessage("service-not-allowed"), /micro|texte/i);
  assert.match(speechErrorMessage("network"), /indisponible|texte/i);
  assert.match(speechErrorMessage("no-speech"), /parole|réessayez/i);
  assert.match(speechErrorMessage("audio-capture"), /micro|texte/i);
  // Unknown codes still return a controlled message (never throws / never empty).
  assert.ok(speechErrorMessage("weird-code").length > 0);
  assert.ok(speechErrorMessage(null).length > 0);
});
