import type { Part } from "@/services/verity";

export function getSpokenText(part: Part): string {
  // Do not read expired evidence, conflicting sources, or citation metadata.
  return part.outcome === "answer" || part.outcome === "safety_escalation"
    ? (part.text ?? part.message)
    : part.message;
}

export interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
export interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => BrowserRecognition;

export function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
