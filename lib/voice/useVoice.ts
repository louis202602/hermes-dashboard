"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-native voice I/O for the Hermès command center.
 *
 * - Speech-to-text uses the Web Speech API (`SpeechRecognition` /
 *   `webkitSpeechRecognition`). It is REAL, browser-native transcription — there
 *   is NO provider key anywhere (client or server), and no audio is uploaded or
 *   stored by the app; the browser handles the audio for the duration of the
 *   utterance only.
 * - Text-to-speech uses `speechSynthesis` (fully local).
 *
 * Both degrade cleanly: when unsupported (e.g. desktop Firefox for STT), the
 * caller falls back to text — the panel always works without a microphone.
 */

// Minimal typings — the Web Speech API is not in the standard TS DOM lib.
type SpeechRecognitionAlternativeLike = { transcript: string; confidence: number };
type SpeechRecognitionResultLike = {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
};
type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike> & {
    [i: number]: SpeechRecognitionResultLike;
  };
  resultIndex: number;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export type VoiceState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "LISTENING"
  | "ERROR";

export type PermissionState = "unknown" | "granted" | "denied";

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function ttsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

// Max listening window (ms) as a safety cap even if the engine never fires end.
const MAX_LISTEN_MS = 15000;

export function useVoice(lang = "fr-FR") {
  const [sttSupported, setSttSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("IDLE");
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef<((t: string) => void) | null>(null);
  const capRef = useRef<number | null>(null);

  useEffect(() => {
    // Capability detection must run after mount (client only) so it never causes
    // an SSR/hydration mismatch. This one-time set is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSttSupported(getRecognitionCtor() !== null);
    setTtsSupported(ttsAvailable());
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      if (ttsAvailable()) window.speechSynthesis.cancel();
      if (capRef.current) window.clearTimeout(capRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    if (capRef.current) {
      window.clearTimeout(capRef.current);
      capRef.current = null;
    }
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
  }, []);

  const start = useCallback(
    (onFinal: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        setError("La reconnaissance vocale n’est pas disponible sur ce navigateur.");
        setState("ERROR");
        return;
      }
      // Cancel any playback so the mic doesn't capture Hermès speaking.
      if (ttsAvailable()) window.speechSynthesis.cancel();
      setError(null);
      setInterim("");
      finalRef.current = "";
      onFinalRef.current = onFinal;

      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setPermission("granted");
        setState("LISTENING");
      };
      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const res = e.results[i];
          const txt = res[0]?.transcript ?? "";
          if (res.isFinal) finalRef.current += txt;
          else interimText += txt;
        }
        setInterim(interimText);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setPermission("denied");
          setError(
            "Micro refusé. Autorisez le micro ou utilisez le mode texte.",
          );
        } else if (e.error === "no-speech") {
          setError("Aucune parole détectée. Réessayez.");
        } else if (e.error !== "aborted") {
          setError("Erreur de reconnaissance vocale. Utilisez le mode texte.");
        }
        setState(e.error === "aborted" ? "IDLE" : "ERROR");
      };
      rec.onend = () => {
        if (capRef.current) {
          window.clearTimeout(capRef.current);
          capRef.current = null;
        }
        setState((s) => (s === "ERROR" ? "ERROR" : "IDLE"));
        const text = finalRef.current.trim();
        setInterim("");
        if (text.length > 0 && onFinalRef.current) onFinalRef.current(text);
      };

      recRef.current = rec;
      setState("REQUESTING_PERMISSION");
      try {
        rec.start();
        capRef.current = window.setTimeout(() => {
          try {
            rec.stop();
          } catch {
            /* noop */
          }
        }, MAX_LISTEN_MS);
      } catch {
        setError("Impossible de démarrer le micro.");
        setState("ERROR");
      }
    },
    [lang],
  );

  const speak = useCallback(
    (text: string) => {
      if (!ttsAvailable()) return;
      const clean = (text ?? "").trim();
      if (clean.length === 0) return;
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(clean.slice(0, 600));
      u.lang = lang;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [lang],
  );

  const cancelSpeak = useCallback(() => {
    if (ttsAvailable()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return {
    sttSupported,
    ttsSupported,
    state,
    permission,
    interim,
    error,
    speaking,
    start,
    stop,
    speak,
    cancelSpeak,
  };
}
