import { useEffect, useState } from "react";
import { search, type SearchResponse } from "@/services/verity";

const CHANNELS: { id: string; label: string; note: string }[] = [
  { id: "advocate_view", label: "Advocate guidance", note: "What the advocate sees on screen" },
  { id: "member_chat", label: "Member chat", note: "What a member reads in chat" },
  { id: "voice", label: "Voice script", note: "What is read aloud on a call" },
];

/** The same question, the same role, asked on three channels. The point: one approved source, different delivery. */
export function ChannelCompare({ query, role, lob, state, requestId }: { query: string; role: string; lob: string; state: string | null; requestId: string }) {
  const [rows, setRows] = useState<Record<string, SearchResponse> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(null), [requestId]);
  const load = async () => {
    setBusy(true);
    try {
      const out: Record<string, SearchResponse> = {};
      for (const c of CHANNELS) out[c.id] = await search({ query, role, channel: c.id, input_mode: c.id === "voice" ? "voice" : "typed", lob, state });
      setRows(out);
    } finally {
      setBusy(false);
    }
  };
  if (!rows)
    return (
      <button type="button" disabled={busy} onClick={load} className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold hover:bg-surface-alt">
        {busy ? "Checking each channel..." : "Show this answer on every channel"}
      </button>
    );
  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="font-semibold">One approved source, three deliveries</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {CHANNELS.map((c) => {
          const part = rows[c.id]?.parts[0];
          return (
            <div key={c.id} className="space-y-1 rounded-md bg-surface-alt p-3 text-sm">
              <p className="font-semibold">{c.label}</p>
              <p className="text-xs text-ink-muted">{c.note}</p>
              <p className="whitespace-pre-wrap">{part?.text ?? part?.message ?? "No answer on this channel"}</p>
              <p className="font-mono text-xs text-ink-muted">{part?.outcome} · {part?.citations.map((x) => x.unit_id).join(", ") || "no unit"}</p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">Legal wording is identical on every channel. Only non-legal units get a spoken version for voice.</p>
    </div>
  );
}
