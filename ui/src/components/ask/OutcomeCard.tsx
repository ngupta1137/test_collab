import { useState } from "react";
import { ArrowRightCircle, Check, Copy, Lock, Phone, Volume2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Citation, Part } from "@/services/verity";
import { OutcomePill } from "./outcomeMeta";
import { CHANNELS } from "@/lib/session";
import { MessageResponse } from "@/components/ai-elements/message";

function CitationLine({ c }: { c: Citation }) {
  return (
    <p className="mt-3 text-sm text-ink-muted">
      {c.title} · {c.owner} · v{c.version} · effective {c.effective_date} · <span className="whitespace-nowrap">{c.unit_id}</span>
    </p>
  );
}

function VerbatimBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-md border-2 border-brand-green-dark">
      <div className="flex items-center justify-between border-b border-border bg-surface-alt px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-brand-green-dark">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> VERBATIM · read exactly
        </span>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="select-all px-4 py-4 text-xl leading-relaxed">{text}</p>
    </div>
  );
}

function NextStep({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-surface-alt px-3 py-2.5 text-sm">
      <ArrowRightCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
      <p>
        <span className="font-semibold">Next step: </span>
        {text}
      </p>
    </div>
  );
}

function Body({ part, compact }: { part: Part; compact: boolean }) {
  const c0 = part.citations[0];
  switch (part.outcome) {
    case "answer":
      return (
        <>
          {c0?.verbatim && part.text ? (
            <VerbatimBox text={part.text} />
          ) : compact ? (
            <MessageResponse className="text-lg leading-relaxed">{part.text ?? ""}</MessageResponse>
          ) : (
            <p className="text-xl leading-relaxed">{part.text}</p>
          )}
          {c0 && <CitationLine c={c0} />}
        </>
      );
    case "needs_clarification":
      return (
        <>
          <p className="text-xl font-semibold">{part.message}</p>
          <p className="mt-2 text-sm text-outcome-clarify">Pick the state and ask again.</p>
        </>
      );
    case "insufficient_evidence":
      return (
        <>
          <p className="text-lg">{part.message}</p>
          <p className="mt-2 text-sm text-ink-muted">
            Verity does not answer from general knowledge.
          </p>
          <span className="mt-3 inline-block rounded border border-border bg-surface-alt px-2 py-0.5 text-xs font-semibold text-ink-muted">
            Gap logged
          </span>
        </>
      );
    case "conflict":
      return (
        <>
          <p className="text-lg">{part.message}</p>
          <p className="mt-4 text-sm font-semibold">
            Verity will not pick. Both owners have been notified.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {part.citations.map((c) => (
              <div key={c.unit_id} className="rounded-md border border-border p-4">
                <p className="font-semibold">{c.title}</p>
                <p className="text-sm text-ink-muted">
                  {c.owner} · v{c.version} · effective {c.effective_date} · <span className="whitespace-nowrap">{c.unit_id}</span>
                </p>
                <p className="mt-3">{c.text}</p>
              </div>
            ))}
          </div>
        </>
      );
    case "stale":
      return (
        <>
          <div className="mb-3 rounded border border-outcome-stale bg-outcome-stale/10 px-3 py-2 text-sm font-semibold text-outcome-stale">
            Past review date
          </div>
          <p className="text-lg text-ink-muted line-through decoration-outcome-stale/40">
            {part.text}
          </p>
          <p className="mt-2 text-sm">{part.message}</p>
          {c0 && <CitationLine c={c0} />}
        </>
      );
    case "not_authorized":
      return (
        <>
          <p className="text-2xl font-semibold">Owned by {part.owner_team}</p>
          <p className="mt-2">{part.message}</p>
          <Button variant="outline" className="mt-4">
            Transfer to team
          </Button>
        </>
      );
    case "safety_escalation":
      return (
        <div className="flex flex-col gap-5 md:flex-row md:items-center">
          <Phone className="h-10 w-10 shrink-0 text-outcome-safety" aria-hidden="true" />
          <p className="flex-1 text-xl font-semibold leading-relaxed">{part.text}</p>
          <Button size="lg" variant="destructive">
            Connect to a person now
          </Button>
        </div>
      );
  }
}

export function OutcomeCard({
  part,
  channel,
  compact = false,
  speaking = false,
  speechSupported = true,
  onRead,
  onStop,
}: {
  part: Part;
  channel: string;
  compact?: boolean;
  speaking?: boolean;
  speechSupported?: boolean;
  onRead?: () => void;
  onStop?: () => void;
}) {
  const safety = part.outcome === "safety_escalation";
  return (
    <article
      className={`rounded-lg bg-surface ${compact ? "p-4 text-lg [&_p.text-xl]:text-lg [&_p.text-2xl]:text-lg" : "p-6"} ${safety ? "border-2 border-outcome-safety" : "border border-border"}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <OutcomePill outcome={part.outcome} />
        <span className="rounded-full border border-border bg-surface-alt px-2 py-1 text-xs text-ink-muted">
          Channel · {CHANNELS.find((c) => c.id === channel)?.label ?? channel}
        </span>
      </div>
      <Body part={part} compact={compact} />
      {part.next_step && <NextStep text={part.next_step} />}
      {onRead && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={speaking ? onStop : onRead}
            disabled={!speechSupported}
          >
            {speaking ? <Square /> : <Volume2 />} {speaking ? "Stop reading" : "Read aloud"}
          </Button>
          {speaking && (
            <span role="status" className="text-sm text-brand-green-dark">
              {part.citations.some((c) => c.verbatim)
                ? "Reading approved verbatim exactly"
                : "Reading aloud..."}
            </span>
          )}
          {!speechSupported && (
            <span className="text-sm text-ink-muted">
              Read aloud is unavailable in this browser.
            </span>
          )}
        </div>
      )}
    </article>
  );
}
