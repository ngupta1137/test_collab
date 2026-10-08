import { ChevronDown } from "lucide-react";
import type { SearchResponse } from "@/services/verity";

const TAG_CLASS: Record<string, string> = {
  D: "text-ink border-ink",
  P: "text-brand-green-dark border-brand-green-dark",
  H: "text-outcome-conflict border-outcome-conflict",
  "D+P": "text-brand-green-dark border-ink",
};

function parse(step: string) {
  const m = step.match(/^(\d+)\.\s*(.*?)\s*\[([^\]]+)\]:\s*(.*)$/);
  return m
    ? { n: m[1], title: m[2], tag: m[3], detail: m[4] }
    : { n: "", title: step, tag: "", detail: "" };
}

export function TraceDrawer({ res, compact = false }: { res: SearchResponse; compact?: boolean }) {
  return (
    <details className={`group ${compact ? "" : "rounded-lg border border-border bg-surface-alt"}`}>
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 text-sm ${compact ? "py-2 text-brand-green-dark underline underline-offset-4" : "justify-between px-5 py-3 font-semibold"}`}
      >
        {compact ? "How Verity checked this" : "Why this answer"}
        <ChevronDown
          className="h-4 w-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ol className="space-y-3 border-t border-border px-5 py-4">
        {res.trace.map((s) => {
          const t = parse(s);
          return (
            <li key={s} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold">
                {t.n}
              </span>
              <div>
                <span className="font-semibold">{t.title}</span>{" "}
                {t.tag && (
                  <span
                    className={`ml-1 rounded border px-1.5 text-xs font-bold ${TAG_CLASS[t.tag] ?? TAG_CLASS["D"]}`}
                  >
                    {t.tag}
                  </span>
                )}
                <p className="text-ink-muted">{t.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-border px-5 py-2 text-xs text-ink-muted">
        {res.request_id} · {res.engine}
      </p>
    </details>
  );
}
