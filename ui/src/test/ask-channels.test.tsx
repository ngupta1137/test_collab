import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AskPage } from "@/routes/index";
import { SessionProvider, useSession } from "@/lib/session";
import { search } from "@/services/verity";
import { mockSearch } from "@/services/mockData";
import type { BrowserRecognition } from "@/lib/browser-speech";

vi.mock("@/services/verity", () => ({ search: vi.fn(async (request) => mockSearch(request)) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function VoicePage() {
  const { setChannel } = useSession();
  return (
    <>
      <button onClick={() => setChannel("voice")}>Voice test</button>
      <AskPage />
    </>
  );
}

it("automatically submits recognized speech with input_mode voice and auto-reads the exact answer", async () => {
  let recognition: BrowserRecognition | undefined;
  vi.stubGlobal(
    "SpeechRecognition",
    class {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror = null;
      onend = null;
      start() {
        // The browser API hands the test its live recognition instance.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        recognition = this;
      }
      stop() {}
      abort() {}
    },
  );
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  const speak = vi.fn();
  vi.stubGlobal("speechSynthesis", { cancel: vi.fn(), speak });
  render(
    <SessionProvider>
      <VoicePage />
    </SessionProvider>,
  );
  fireEvent.click(screen.getByText("Voice test"));
  fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
  act(() =>
    recognition?.onresult?.({
      results: [{ isFinal: true, 0: { transcript: "Rx pricing disclaimer" } }],
    }),
  );
  act(() => recognition?.onend?.());
  await waitFor(() =>
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Rx pricing disclaimer",
        input_mode: "voice",
        channel: "voice",
      }),
    ),
  );
  const text = mockSearch({
    query: "Rx pricing disclaimer",
    role: "pharmacy_advocate",
    channel: "voice",
  }).parts[0]?.text;
  await waitFor(() => expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text })));
});
