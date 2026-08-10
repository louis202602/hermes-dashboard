/**
 * Pure, DOM-free voice helpers for the Hermès command center.
 *
 * The voice layer is **browser-native** on purpose: real speech-to-text via the
 * Web Speech API (`SpeechRecognition`) and real text-to-speech via
 * `speechSynthesis`. There is **no transcription/TTS provider secret** anywhere
 * — the Next.js app deliberately holds no model/provider secret, so we never
 * send audio to a server route that would need one. Voice is only an I/O layer
 * on top of the already-proven Hermès orchestrator; it never becomes a second
 * orchestrator and never bypasses permissions / SW15.
 *
 * Everything in this module is a pure function (no DOM/global access) so it can
 * be unit-tested with the Node test runner. The thin DOM binding lives in
 * `useVoice.ts`.
 */

/** Interaction mode chosen by the user. Text stays available in every mode. */
export type VoiceMode =
  | "TEXT_ONLY"
  | "VOICE_INPUT_TEXT_OUTPUT"
  | "VOICE_INPUT_VOICE_OUTPUT";

/** Lifecycle of the microphone / speech pipeline (UI-facing). */
export type VoicePhase =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "LISTENING"
  | "PROCESSING_AUDIO"
  | "TRANSCRIBING"
  | "THINKING"
  | "SPEAKING"
  | "ERROR";

export const VOICE_MODE_LABEL: Record<VoiceMode, string> = {
  TEXT_ONLY: "Texte",
  VOICE_INPUT_TEXT_OUTPUT: "Voix → texte",
  VOICE_INPUT_VOICE_OUTPUT: "Voix → voix",
};

export const VOICE_PHASE_LABEL: Record<VoicePhase, string> = {
  IDLE: "Micro prêt",
  REQUESTING_PERMISSION: "Autorisation micro…",
  LISTENING: "Écoute…",
  PROCESSING_AUDIO: "Traitement audio…",
  TRANSCRIBING: "Transcription…",
  THINKING: "Hermès réfléchit…",
  SPEAKING: "Hermès parle…",
  ERROR: "Erreur micro",
};

/** True when the mode captures speech as input. */
export function isVoiceInputMode(mode: VoiceMode): boolean {
  return (
    mode === "VOICE_INPUT_TEXT_OUTPUT" || mode === "VOICE_INPUT_VOICE_OUTPUT"
  );
}

/** True when the mode should speak Hermès' final reply. */
export function isVoiceOutputMode(mode: VoiceMode): boolean {
  return mode === "VOICE_INPUT_VOICE_OUTPUT";
}

/**
 * Minimal shape of the browser globals we probe. Kept structural (not the DOM
 * lib types) so this module never depends on `lib.dom` and stays testable.
 */
export type SpeechCapabilityWindow = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
};

export type SpeechSupport = {
  /** Web Speech `SpeechRecognition` present (voice INPUT possible). */
  stt: boolean;
  /** `speechSynthesis` present (voice OUTPUT possible). */
  tts: boolean;
};

/**
 * Detect Web Speech support from a window-like object. Pure — no global access.
 * On iOS Safari `SpeechRecognition` is absent, so `stt` is false there and the
 * UI must fall back to text (never a fabricated transcript).
 */
export function detectSpeechSupport(
  win: SpeechCapabilityWindow | null | undefined,
): SpeechSupport {
  if (!win) return { stt: false, tts: false };
  const stt =
    typeof win.SpeechRecognition !== "undefined" ||
    typeof win.webkitSpeechRecognition !== "undefined";
  const tts = typeof win.speechSynthesis !== "undefined";
  return { stt: Boolean(stt), tts: Boolean(tts) };
}

/** Return the available SpeechRecognition constructor, or null. */
export function pickRecognitionCtor(
  win: SpeechCapabilityWindow | null | undefined,
): unknown {
  if (!win) return null;
  if (typeof win.SpeechRecognition !== "undefined") return win.SpeechRecognition;
  if (typeof win.webkitSpeechRecognition !== "undefined")
    return win.webkitSpeechRecognition;
  return null;
}

/**
 * A human-readable, safe-to-speak message for a Web Speech error code. Provider
 * failure / permission denial degrade to a controlled message — never a silent
 * fake success.
 */
export function speechErrorMessage(code: string | null | undefined): string {
  switch ((code ?? "").toLowerCase()) {
    case "not-allowed":
    case "service-not-allowed":
    case "permission-denied":
      return "Accès au micro refusé. Utilisez le mode texte ou autorisez le micro dans votre navigateur.";
    case "no-speech":
      return "Aucune parole détectée. Réessayez ou tapez votre message.";
    case "audio-capture":
      return "Aucun micro disponible. Utilisez le mode texte.";
    case "network":
      return "Service de reconnaissance vocale indisponible. Utilisez le mode texte.";
    case "aborted":
      return "Écoute interrompue.";
    default:
      return "La reconnaissance vocale a échoué. Utilisez le mode texte.";
  }
}

// --- TTS output sanitisation -------------------------------------------------
//
// Hermès' `reply` is already deterministic and honest, but voice output must
// NEVER read out technical noise: request/correlation ids, reference tags,
// tokens, URLs, stack-trace-ish fragments, or long code blocks. This strips
// those to a clean spoken form. It is defensive — the reply should not contain
// secrets, and this guarantees they are not vocalised even if one slipped in.

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const REF_LINE_RE = /r[ée]f\.?\s*[:=]?\s*\S+/gi;
const URL_RE = /https?:\/\/\S+/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g; // api-key / jwt-ish blobs
const CODE_SPAN_RE = /`[^`]*`/g;

/**
 * Produce a clean, speakable string from an assistant reply. Removes ids, refs,
 * URLs, long opaque tokens and inline code, collapses whitespace, and caps the
 * length so TTS stays snappy. Returns "" when nothing speakable remains.
 */
export function sanitizeForSpeech(reply: string | null | undefined): string {
  if (!reply) return "";
  let out = String(reply);
  out = out.replace(CODE_SPAN_RE, " ");
  out = out.replace(URL_RE, " ");
  out = out.replace(REF_LINE_RE, " ");
  out = out.replace(UUID_RE, " ");
  out = out.replace(LONG_TOKEN_RE, " ");
  // Drop leftover markdown emphasis / bullets that read poorly.
  out = out.replace(/[*_#>|]+/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  const MAX = 600;
  if (out.length > MAX) {
    out = out.slice(0, MAX).replace(/\s+\S*$/, "").trim();
  }
  return out;
}

/**
 * Decide whether a reply is worth speaking. Empty / id-only replies collapse to
 * nothing after sanitisation and should not trigger TTS.
 */
export function isSpeakable(reply: string | null | undefined): boolean {
  return sanitizeForSpeech(reply).length > 0;
}

/**
 * Clamp a raw transcript before it is sent to the orchestrator: trim, collapse
 * internal whitespace, and bound the length (defensive against a stuck
 * recogniser). Returns "" for an empty/blank transcript so the caller can refuse
 * to submit (never fabricates content).
 */
export function normalizeTranscript(raw: string | null | undefined): string {
  if (!raw) return "";
  const out = String(raw).replace(/\s+/g, " ").trim();
  const MAX = 2000;
  return out.length > MAX ? out.slice(0, MAX).trim() : out;
}
