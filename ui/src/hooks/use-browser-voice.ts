import { useEffect, useRef, useState } from "react";
import {
  getSpokenText,
  recognitionConstructor,
  type BrowserRecognition,
} from "@/lib/browser-speech";
import type { Part } from "@/services/verity";

export function useBrowserVoice(scope: string) {
  const [supported, setSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const recognition = useRef<BrowserRecognition | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()));
    setSpeechSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
    setListening(false);
    setTranscript("");
    setError("");
    setSpeakingKey(null);
    return () => {
      const active = recognition.current;
      if (active) {
        active.onresult = null;
        active.onend = null;
        active.onerror = null;
        active.abort();
      }
      recognition.current = null;
      generation.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, [scope]);

  const stopReading = () => {
    generation.current += 1;
    window.speechSynthesis?.cancel();
    setSpeakingKey(null);
  };

  const read = (items: { key: string; part: Part }[]) => {
    stopReading();
    if (!speechSupported) return;
    setError("");
    const current = generation.current;
    for (const { key, part } of items) {
      const text = getSpokenText(part);
      if (!text) continue;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.onstart = () => {
        if (generation.current === current) setSpeakingKey(key);
      };
      utterance.onend = () => {
        if (generation.current === current) setSpeakingKey(null);
      };
      utterance.onerror = (event) => {
        if (generation.current !== current) return;
        stopReading();
        if (event.error !== "canceled" && event.error !== "interrupted")
          setError("Read aloud could not start. Select Read aloud to try again.");
      };
      window.speechSynthesis.speak(utterance);
    }
  };

  const startListening = (
    onTranscript: (text: string) => void,
    onSubmit: (text: string) => void,
  ) => {
    const Constructor = recognitionConstructor();
    if (!Constructor || recognition.current) return;
    stopReading();
    setError("");
    setTranscript("");
    const active = new Constructor();
    recognition.current = active;
    active.lang = "en-US";
    active.interimResults = true;
    active.continuous = false;
    let finalText = "";
    let failed = false;
    active.onresult = (event) => {
      const results = Array.from(event.results);
      const text = results.map((result) => result[0]?.transcript ?? "").join("");
      finalText = results
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      setTranscript(text);
      onTranscript(text);
    };
    active.onerror = (event) => {
      failed = true;
      setListening(false);
      setError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser, or type your question."
          : event.error === "no-speech"
            ? "No speech was heard. Try again, or type your question."
            : "Voice input could not start. Try again, or type your question.",
      );
    };
    active.onend = () => {
      recognition.current = null;
      setListening(false);
      if (!failed && finalText.trim()) onSubmit(finalText);
    };
    try {
      active.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError("Voice input could not start. Try again, or type your question.");
    }
  };

  return {
    supported,
    speechSupported,
    listening,
    transcript,
    error,
    speakingKey,
    read,
    stopReading,
    startListening,
    stopListening: () => recognition.current?.stop(),
  };
}
