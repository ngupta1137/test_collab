import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Info, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { callToolFn, getCallLog } from "@/services/agents.functions";
import type { AgentTool, CallLogRow, ToolCallResult } from "@/services/agents";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agents — Verity" },
      { name: "description", content: "Same rules for agents: Verity MCP tools and call log." },
      { property: "og:title", content: "Agents — Verity" },
      { property: "og:description", content: "Same rules for agents: Verity MCP tools and call log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentsPage,
});

const TOOLS = [
  { name: "search_knowledge", desc: "Ask a question and get the same governed outcome a human advocate gets." },
  { name: "get_unit", desc: "Fetch one approved knowledge unit by ID, if the caller's role allows it." },
  { name: "report_gap", desc: "Log a question Verity could not answer for the knowledge team." },
  { name: "list_changes", desc: "List units that changed, were retired or flagged since a given time." },
];

const CONNECTIONS = [
  { role: "pharmacy_advocate", label: "Agent Assist for pharmacy advocates" },
  { role: "insurance_advocate", label: "Agent Assist for insurance advocates" },
  { role: "member_chat", label: "Member chat assistant" },
];

const PRESETS: { label: string; tool: AgentTool; query?: string; unit_id?: string; since?: string }[] = [
  { label: "Disclaimer, word for word", tool: "search_knowledge", query: "Rx pricing disclaimer I have to read on this call" },
  { label: "Unit outside my role", tool: "get_unit", unit_id: "U-IN-002" },
  { label: "Two sources disagree", tool: "search_knowledge", query: "how many days supply can a member get by mail" },
  { label: "What changed lately", tool: "list_changes", since: "2026-02-01" },
  { label: "Report a gap", tool: "report_gap", query: "does the member's plan cover a shingles vaccine at the pharmacy" },
];

const OUTCOME_CLS: Record<string, string> = {
  answer: "text-outcome-answer", ok: "text-outcome-answer", conflict: "text-outcome-conflict", not_authorized: "text-outcome-unauthorized",
  insufficient_evidence: "text-outcome-insufficient", needs_clarification: "text-outcome-clarify", stale: "text-outcome-stale",
  safety_escalation: "text-outcome-safety", retired: "text-outcome-stale", error: "text-destructive",
};

function AgentsPage() {
  const [role, setRole] = useState("pharmacy_advocate");
  const [tool, setTool] = useState<AgentTool>("search_knowledge");
  const [query, setQuery] = useState(PRESETS[0]!.query ?? "");
  const [unitId, setUnitId] = useState("U-IN-002");
  const [since, setSince] = useState("2026-02-01");
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [log, setLog] = useState<CallLogRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => getCallLog().then(setLog).catch(() => {});
  useEffect(() => { void refresh(); }, []);

  async function run(t: AgentTool, args: { query?: string; unit_id?: string; since?: string }) {
    setBusy(true);
    try {
      const r = await callToolFn({ data: { role, tool: t, query: args.query ?? null, unit_id: args.unit_id ?? null, since: args.since ?? null } });
      setResult(r);
      setLog(r.log);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Same rules for agents (MCP)</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => (
          <div key={t.name} className="rounded-lg border border-border p-4">
            <p className="font-mono font-semibold text-brand-green-dark">{t.name}</p>
            <p className="mt-2 text-sm text-ink-muted">{t.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border p-4">
        <h2 className="font-semibold">Try it as an agent</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Calls run on the server through the same entitlement, rules and outcomes as the Ask page. The role belongs to the connection; no tool argument can change it.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Connection (sets the role)</span>
            <select className="rounded-md border border-border bg-surface px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
              {CONNECTIONS.map((c) => <option key={c.role} value={c.role}>{c.label} · {c.role}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">Tool</span>
            <select className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm" value={tool} onChange={(e) => setTool(e.target.value as AgentTool)}>
              {TOOLS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block text-xs font-semibold text-ink-muted">{tool === "get_unit" ? "unit_id" : tool === "list_changes" ? "since (YYYY-MM-DD)" : "query"}</span>
            {tool === "get_unit" ? (
              <input aria-label="unit_id" className="w-full rounded-md border border-border px-3 py-2 font-mono text-sm" value={unitId} onChange={(e) => setUnitId(e.target.value)} />
            ) : tool === "list_changes" ? (
              <input aria-label="since" className="w-full rounded-md border border-border px-3 py-2 font-mono text-sm" value={since} onChange={(e) => setSince(e.target.value)} />
            ) : (
              <input aria-label="query" className="w-full rounded-md border border-border px-3 py-2 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} />
            )}
          </label>
          <Button disabled={busy} onClick={() => run(tool, { query, unit_id: unitId, since })}>
            <Play className="h-4 w-4" /> Call tool
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setTool(p.tool);
                if (p.query) setQuery(p.query);
                if (p.unit_id) setUnitId(p.unit_id);
                if (p.since) setSince(p.since);
                void run(p.tool, p);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {result && (
          <div className="mt-4 space-y-2">
            <p className="text-sm">
              Outcome: <span className={`font-semibold ${OUTCOME_CLS[result.outcome.split(",")[0]!.trim()] ?? ""}`}>{result.outcome.replace(/_/g, " ")}</span>
              {result.error && <span className="ml-2 text-destructive">{result.error}</span>}
            </p>
            {result.result_json && (
              <pre aria-label="Tool result" className="max-h-80 overflow-auto rounded-md bg-surface-alt p-3 text-xs">{result.result_json}</pre>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">Call log (this session, live)</h2>
          <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-alt text-ink-muted">
            <tr>{["Time", "Interface", "Principal", "Role", "Tool", "Outcome"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={`${r.at}-${i}`} className="border-t border-border">
                <td className="px-4 py-2 font-mono">{r.at}</td>
                <td className="px-4 py-2">{r.iface}</td>
                <td className="px-4 py-2 font-mono">{r.principal}</td>
                <td className="px-4 py-2">{r.role}</td>
                <td className="px-4 py-2 font-mono">{r.tool}</td>
                <td className={`px-4 py-2 font-semibold ${OUTCOME_CLS[r.outcome.split(",")[0]!.trim()] ?? ""}`}>{r.outcome.replace(/_/g, " ")}</td>
              </tr>
            ))}
            {log.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-4 text-ink-muted">No calls yet. Ask something on the Ask page, or call a tool above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-2 rounded-md bg-surface-alt p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        The agent's role comes from its connection, never from a tool argument. PHI is redacted before anything is logged. The same tools are served to real MCP clients such as Claude Desktop by the Verity MCP server.
      </p>
    </section>
  );
}
