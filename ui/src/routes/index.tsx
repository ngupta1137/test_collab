import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutcomeCard } from "@/components/ask/OutcomeCard";
import { TraceDrawer } from "@/components/ask/TraceDrawer";
import { OutcomePill } from "@/components/ask/outcomeMeta";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { PERSONAS, useSession } from "@/lib/session";
import { useBrowserVoice } from "@/hooks/use-browser-voice";
import { ChannelCompare } from "@/components/ask/ChannelCompare";
import { search, type Outcome, type SearchResponse } from "@/services/verity";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ask — Verity" },
      {
        name: "description",
        content: "Ask Verity for approved answers in advocate view, member chat, or voice.",
      },
      { property: "og:title", content: "Ask — Verity" },
      { property: "og:description", content: "One approved truth, in every channel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AskPage,
});

const EXAMPLES = [
  "Rx pricing disclaimer",
  "closing statement",
  "how many days supply can I get by mail",
  "is there a copay assistance program",
  "is there a shipping fee for mail order",
  "I have chest pain, can you rush my heart pills",
];
interface HistoryItem {
  id: string;
  query: string;
  personaId: string;
  personaName: string;
  outcome: Outcome;
}
interface Answer {
  res: SearchResponse;
  channel: string;
}
interface ChatTurn {
  id: string;
  question: string;
  personaId: string;
  answer: Answer | null;
}

export function AskPage() {
  const { persona, channel, setPersona } = useSession();
  const [query, setQuery] = useState("");
  const [lob, setLob] = useState("MAPD");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState("");
  const scope = `${persona.id}:${channel}`;
  const voice = useBrowserVoice(scope);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const pending = useRef(false);
  const isChat = persona.id === "eleanor" && channel === "member_chat";
  useEffect(() => {
    setAnswer(null);
    setLoading(false);
    pending.current = false;
    setError("");
  }, [scope]);

  const run = async (q: string, p = persona, inputMode: "typed" | "voice" = "typed") => {
    if (!q.trim() || pending.current) return;
    voice.stopReading();
    const requestScope = scopeRef.current;
    const requestChannel =
      p.role === "member_chat" && channel === "advocate_view" ? "member_chat" : channel;
    const id = crypto.randomUUID();
    setLastQuery(q);
    pending.current = true;
    setLoading(true);
    setError("");
    if (isChat) {
      setTurns((items) => [...items, { id, question: q, personaId: p.id, answer: null }]);
      setQuery("");
    }
    try {
      const res = await search({
        query: q,
        role: p.role,
        channel: requestChannel,
        input_mode: inputMode,
        lob,
        state: state || null,
      });
      if (scopeRef.current !== requestScope) return;
      const next = { res, channel: requestChannel };
      setAnswer(next);
      if (isChat)
        setTurns((items) =>
          items.map((turn) => (turn.id === id ? { ...turn, answer: next } : turn)),
        );
      setHistory((items) =>
        [
          {
            id: res.request_id,
            query: q,
            personaId: p.id,
            personaName: p.name,
            outcome: res.outcome,
          },
          ...items,
        ].slice(0, 8),
      );
      if (requestChannel === "voice")
        voice.read(res.parts.map((part) => ({ key: `${res.request_id}:${part.part}`, part })));
    } catch {
      if (scopeRef.current === requestScope) {
        setError("Verity could not check this question. Please try again.");
        setTurns((items) => items.filter((turn) => turn.id !== id));
      }
    } finally {
      if (scopeRef.current === requestScope) {
        pending.current = false;
        setLoading(false);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(query);
  };
  const safety = answer?.res.outcome === "safety_escalation";
  const clarify = answer?.res.outcome === "needs_clarification";
  const renderAnswer = (item: Answer, compact = false) => (
    <>
      {item.res.parts.map((part) => {
        const key = `${item.res.request_id}:${part.part}`;
        return (
          <OutcomeCard
            key={key}
            part={part}
            channel={item.channel}
            compact={compact}
            speechSupported={voice.speechSupported}
            speaking={voice.speakingKey === key}
            onRead={() => voice.read([{ key, part }])}
            onStop={voice.stopReading}
          />
        );
      })}
      <TraceDrawer res={item.res} compact={compact} />
    </>
  );

  return (
    <div
      className={isChat ? "mx-auto max-w-3xl" : "grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]"}
    >
      <section className="min-w-0">
        {isChat && (
          <>
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3">
              <h1 className="text-2xl font-semibold">Verity</h1>
              <span className="text-sm text-ink-muted">Member chat · Eleanor</span>
            </div>
            <Conversation className="h-[28rem] max-h-[55vh] min-h-48">
              <ConversationContent className="gap-5 px-0 py-3">
                {turns
                  .filter((turn) => turn.personaId === persona.id)
                  .map((turn) => (
                    <div key={turn.id} className="space-y-4">
                      <Message from="user">
                        <MessageContent className="group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground text-lg leading-relaxed">
                          <p className="whitespace-pre-wrap break-words">{turn.question}</p>
                        </MessageContent>
                      </Message>
                      <Message from="assistant" className="max-w-full">
                        <span className="text-sm font-semibold text-brand-green-dark">Verity</span>
                        <MessageContent className="w-full overflow-visible text-lg">
                          {turn.answer ? (
                            renderAnswer(turn.answer, true)
                          ) : (
                            <Shimmer>Checking...</Shimmer>
                          )}
                        </MessageContent>
                      </Message>
                    </div>
                  ))}
              </ConversationContent>
              <ConversationScrollButton aria-label="Latest messages" />
            </Conversation>
          </>
        )}

        {isChat ? (
          <PromptInput onSubmit={() => run(query)} className="mt-4">
            <PromptInputTextarea
              aria-label="Ask Verity"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask Verity..."
              className="min-h-20 text-lg md:text-lg"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                status={loading ? "submitted" : "ready"}
                disabled={loading || !query.trim()}
                aria-label="Send question"
                title="Send question"
                className="h-10 w-10"
              />
            </PromptInputFooter>
          </PromptInput>
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <label htmlFor="ask" className="sr-only">
              Ask Verity
            </label>
            <input
              id="ask"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask Verity..."
              className="h-14 min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {channel === "voice" && (
              <Button
                type="button"
                size="icon"
                aria-label={voice.listening ? "Stop listening" : "Start voice input"}
                title={voice.listening ? "Stop listening" : "Start voice input"}
                aria-pressed={voice.listening}
                disabled={!voice.supported || loading}
                onClick={() =>
                  voice.listening
                    ? voice.stopListening()
                    : voice.startListening(setQuery, (text) => {
                        void run(text, persona, "voice");
                      })
                }
                className={`h-16 w-16 shrink-0 rounded-full [&_svg]:size-7 ${voice.listening ? "bg-destructive text-destructive-foreground motion-safe:animate-pulse" : ""}`}
              >
                {voice.listening ? <Square /> : <Mic />}
              </Button>
            )}
            <Button
              type="submit"
              size="lg"
              className="h-14 shrink-0 px-4 sm:px-6"
              disabled={loading || voice.listening || !query.trim()}
            >
              Ask <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        )}

        {channel === "voice" && (
          <div role="status" className="mt-3 text-sm text-ink-muted">
            {!voice.supported && <p>Voice input needs Chrome</p>}
            {voice.listening && <p className="font-semibold text-outcome-safety">Listening...</p>}
            {voice.transcript && <p className="mt-1 break-words">{voice.transcript}</p>}
          </div>
        )}
        {(voice.error || error) && (
          <p role="alert" className="mt-3 text-sm text-outcome-safety">
            {voice.error || error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-ink-muted">
            Line of business
            <select
              className="field-select"
              value={lob}
              onChange={(event) => setLob(event.target.value)}
            >
              <option value="MAPD">MAPD</option>
              <option value="PDP">PDP</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-ink-muted">
            State
            <select
              className={`field-select ${clarify ? "ring-2 ring-outcome-clarify border-outcome-clarify" : ""}`}
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="">Unknown</option>
              <option value="KY">KY</option>
              <option value="FL">FL</option>
              <option value="OH">OH</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <Button
              key={ex}
              type="button"
              variant="outline"
              onClick={() => setQuery(ex)}
              className="h-auto whitespace-normal rounded-full bg-surface-alt px-3 py-1 text-left text-sm font-normal"
            >
              {ex}
            </Button>
          ))}
        </div>
        {!isChat && (
          <div className="mt-10 space-y-4" aria-live="polite">
            {loading && <Shimmer>Checking...</Shimmer>}
            {!loading && answer && renderAnswer(answer)}
            {!loading && answer?.res.outcome === "answer" && lastQuery && (
              <ChannelCompare query={lastQuery} role={persona.role} lob={lob} state={state || null} requestId={answer.res.request_id} />
            )}
          </div>
        )}
      </section>
      {!isChat && !safety && (
        <aside>
          <h2 className="text-sm font-semibold text-ink-muted">Session history</h2>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No questions yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {history.map((item) => (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPersona(item.personaId);
                      setQuery(item.query);
                      void run(
                        item.query,
                        PERSONAS.find((p) => p.id === item.personaId) ?? persona,
                      );
                    }}
                    className="h-auto w-full flex-col items-stretch gap-1 p-3 text-left"
                  >
                    <p className="truncate text-sm font-semibold">{item.query}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-muted">{item.personaName}</span>
                      <OutcomePill outcome={item.outcome} size="sm" />
                    </div>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </div>
  );
}
