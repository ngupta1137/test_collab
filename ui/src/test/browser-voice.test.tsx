import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBrowserVoice } from "@/hooks/use-browser-voice";
import { getSpokenText, type BrowserRecognition } from "@/lib/browser-speech";
import { mockSearch } from "@/services/mockData";

afterEach(() => vi.unstubAllGlobals());

function mockSpeech() {
  const spoken: { text: string; onstart: (() => void) | null }[] = [];
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      onstart = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak: vi.fn((utterance) => {
      spoken.push(utterance);
      utterance.onstart?.();
    }),
  });
  return spoken;
}

describe("Ask browser voice", () => {
  it("speaks the complete pricing disclaimer without changing any characters", async () => {
    const spoken = mockSpeech();
    const { result } = renderHook(() => useBrowserVoice("priya:voice"));
    await waitFor(() => expect(result.current.speechSupported).toBe(true));
    const part = mockSearch({
      query: "Rx pricing disclaimer",
      role: "pharmacy_advocate",
      channel: "voice",
    }).parts[0];
    if (!part || !part.text) throw new Error("Missing pricing fixture");
    act(() => result.current.read([{ key: "pricing", part }]));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.text).toBe(part.text);
    expect(result.current.speakingKey).toBe("pricing");
  });

  it("reads safety escalation text rather than a shortened message", () => {
    const part = mockSearch({ query: "I have chest pain", role: "member_chat", channel: "voice" })
      .parts[0];
    if (!part) throw new Error("Missing safety fixture");
    expect(part.outcome).toBe("safety_escalation");
    expect(getSpokenText(part)).toBe(part.text);
  });

  it("captures interim speech and submits the final transcript once recognition ends", async () => {
    let recognition: BrowserRecognition | undefined;
    vi.stubGlobal(
      "webkitSpeechRecognition",
      class {
        lang = "";
        interimResults = false;
        continuous = false;
        onresult = null;
        onerror = null;
        onend = null;
        start() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          recognition = this;
        }
        stop() {}
        abort() {}
      },
    );
    const { result } = renderHook(() => useBrowserVoice("priya:voice"));
    const transcript = vi.fn();
    const submit = vi.fn();
    act(() => result.current.startListening(transcript, submit));
    act(() =>
      recognition?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "Rx pricing" } }] }),
    );
    expect(transcript).toHaveBeenLastCalledWith("Rx pricing");
    expect(submit).not.toHaveBeenCalled();
    act(() =>
      recognition?.onresult?.({
        results: [{ isFinal: true, 0: { transcript: "Rx pricing disclaimer" } }],
      }),
    );
    act(() => recognition?.onend?.());
    expect(submit).toHaveBeenCalledExactlyOnceWith("Rx pricing disclaimer");
    expect(result.current.listening).toBe(false);
  });

  it("cancels microphone and playback when the channel changes", () => {
    mockSpeech();
    const abort = vi.fn();
    vi.stubGlobal(
      "SpeechRecognition",
      class {
        lang = "";
        interimResults = false;
        continuous = false;
        onresult = null;
        onerror = null;
        onend = null;
        start() {}
        stop() {}
        abort = abort;
      },
    );
    const { result, rerender } = renderHook(({ scope }) => useBrowserVoice(scope), {
      initialProps: { scope: "priya:voice" },
    });
    act(() => result.current.startListening(vi.fn(), vi.fn()));
    rerender({ scope: "eleanor:member_chat" });
    expect(abort).toHaveBeenCalledOnce();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("uses one approved verbatim pricing unit for Voice and Eleanor member chat", () => {
    const voice = mockSearch({
      query: "Rx pricing disclaimer",
      role: "pharmacy_advocate",
      channel: "voice",
    }).parts[0];
    const member = mockSearch({
      query: "Rx pricing disclaimer",
      role: "member_chat",
      channel: "member_chat",
    }).parts[0];
    expect(voice?.outcome).toBe("answer");
    expect(member?.outcome).toBe("answer");
    expect(member?.citations[0]?.verbatim).toBe(true);
    expect(member?.citations[0]?.unit_id).toBe(voice?.citations[0]?.unit_id);
    expect(member?.text).toBe(voice?.text);
  });
});
