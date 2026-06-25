// Voice dictation via the Web Speech API (SpeechRecognition). Controlled by the
// `active` flag; final transcript segments are delivered to `onText`. Gracefully
// reports `supported:false` where the platform (e.g. a stripped WebView2) has no
// speech backend, so the UI can show an honest "not supported" state instead of
// silently doing nothing.

import { useEffect, useRef, useState } from "react";

// Minimal typings for the (non-standard-lib) Web Speech API.
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionResultList {
  length: number;
  [i: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  interim: string;
  error: string | null;
}

export function useDictation(active: boolean, onText: (finalText: string) => void): Dictation {
  const ctor = useRef<SpeechRecognitionCtor | null>(getCtor());
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const supported = ctor.current !== null;

  useEffect(() => {
    if (!supported) return;
    if (!active) {
      recRef.current?.stop();
      return;
    }

    const Ctor = ctor.current!;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    recRef.current = rec;
    setError(null);

    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) onTextRef.current(finalText);
      setInterim(interimText);
    };
    rec.onerror = (ev) => {
      // "no-speech"/"aborted" are benign; surface the rest.
      if (ev.error !== "no-speech" && ev.error !== "aborted") setError(ev.error);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(String(e));
      setListening(false);
    }

    return () => {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
      setListening(false);
      setInterim("");
    };
  }, [active, supported]);

  return { supported, listening, interim, error };
}
