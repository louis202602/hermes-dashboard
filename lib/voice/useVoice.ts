"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  detectSpeechSupport,
  pickRecognitionCtor,
  speechErrorMessage,
  type SpeechCapabilityWindow,
  type SpeechSupport,
} from "@/lib/voice/speech";

// --- Minimal structural typings for the Web Speech API ----------------------
// The standard TS DOM lib does not ship `SpeechRecognition`, so we type only the
// surface we use. No `any`.

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
type RecognitionErrorEvent = { error?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

// Cached, stable capability snapshot so useSyncExternalStore never re-renders in
// a loop (getSnapshot must return a referentially-stable value).
let cachedSupport: SpeechSupport | null = null;
const SERVER_SUPPORT: SpeechSupport = { stt: false, tts: false };

function clientSupport(): SpeechSupport {
  if (cachedSupport) return cachedSupport;
  const win =
    typeof window !== "undefined"
      ? (window as unknown as SpeechCapabilityWindow)
      : null;
  cachedSupport = detectSpeechSupport(win);
  return cachedSupport;
}

function subscribeNoop(): () => void {
  return () => {};
}

export type UseVoice = {
  /** Static capability of this browser (no hydration mismatch). */
  support: SpeechSupport;
  /** Microphone currently capturing. */
  listening: boolean;
  /** Live (interim) transcript while listening — for on-screen feedback only. */
  interim: string;
  /** speechSynthesis currently speaking. */
  speaking: boolean;
  /** Last controlled error message (safe to display), or null. */
  error: string | null;
  clearError: () => void;
  /**
   * Begin listening. `onFinal` receives the final transcript exactly once when
   * recognition settles. Never fabricates text: if nothing is recognised,
   * `onFinal` is not called.
   */
  startListening: (onFinal: (transcript: string) => void, lang?: string) => void;
  stopListening: () => void;
  /** Speak `text` via the browser. Caller should pass already-sanitised text. */
  speak: (text: string, lang?: string) => void;
  cancelSpeech: () => void;
};

const DEFAULT_LANG = "fr-FR";

/**
 * Browser-native voice I/O for Hermès. Real STT (`SpeechRecognition`) and real
 * TTS (`speechSynthesis`), with no provider secret in our app and no audio sent
 * to our backend. NOTE: `SpeechRecognition` is browser-native but not guaranteed
 * local — Chrome/Chromium streams audio to the vendor speech service (Google),
 * so it needs network and fails offline; that path is outside our app and
 * carries no secret of ours (see lib/voice/README.md).
 * Fail-closed: unsupported browsers (e.g. iOS Safari for STT) report
 * `support.stt = false` and the UI keeps text fully usable.
 */
export function useVoice(): UseVoice {
  const support = useSyncExternalStore(
    subscribeNoop,
    clientSupport,
    () => SERVER_SUPPORT,
  );

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef<((t: string) => void) | null>(null);
  const finalSentRef = useRef(false);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // stopping an already-stopped recogniser is harmless
      }
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const startListening = useCallback(
    (onFinal: (transcript: string) => void, lang: string = DEFAULT_LANG) => {
      if (listening) return;
      const Ctor = pickRecognitionCtor(
        typeof window !== "undefined"
          ? (window as unknown as SpeechCapabilityWindow)
          : null,
      ) as RecognitionCtor | null;
      if (!Ctor) {
        setError(speechErrorMessage("network"));
        return;
      }
      // Any TTS still playing must not bleed into capture.
      cancelSpeech();

      let rec: SpeechRecognitionLike;
      try {
        rec = new Ctor();
      } catch {
        setError(speechErrorMessage(null));
        return;
      }

      onFinalRef.current = onFinal;
      finalSentRef.current = false;
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setError(null);
        setInterim("");
        setListening(true);
      };

      rec.onresult = (event: RecognitionEvent) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const alt = result[0];
          if (!alt) continue;
          if (result.isFinal) finalText += alt.transcript;
          else interimText += alt.transcript;
        }
        if (interimText) setInterim(interimText);
        if (finalText && !finalSentRef.current) {
          finalSentRef.current = true;
          setInterim(finalText);
          onFinalRef.current?.(finalText);
        }
      };

      rec.onerror = (event: RecognitionErrorEvent) => {
        setError(speechErrorMessage(event.error));
        setListening(false);
      };

      rec.onend = () => {
        setListening(false);
        setInterim("");
        recognitionRef.current = null;
      };

      recognitionRef.current = rec;
      try {
        rec.start();
      } catch {
        setError(speechErrorMessage(null));
        setListening(false);
        recognitionRef.current = null;
      }
    },
    [listening, cancelSpeech],
  );

  const speak = useCallback(
    (text: string, lang: string = DEFAULT_LANG) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const clean = text.trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = lang;
      // Best-effort: prefer an installed voice matching the language (e.g. a
      // French voice for fr-FR). If none is available yet, the browser falls
      // back to its default voice for that lang — never blocks output.
      try {
        const voices = window.speechSynthesis.getVoices();
        const prefix = lang.slice(0, 2).toLowerCase();
        const match = voices.find((v) => v.lang?.toLowerCase().startsWith(prefix));
        if (match) utter.voice = match;
      } catch {
        // getVoices unavailable — default voice is fine
      }
      utter.onstart = () => setSpeaking(true);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount: stop any capture / playback.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    support,
    listening,
    interim,
    speaking,
    error,
    clearError,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
  };
}
