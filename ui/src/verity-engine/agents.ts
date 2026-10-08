// Server-only agent console: the four MCP tools, run through the same store,
// entitlement and outcomes as the Ask page. The role comes from the selected
// connection, never from a tool argument. Mirrors mcp/server.ts in the verity
// repo, which wraps the same rules for real MCP clients.
import { AS_OF, callLog, getStore, logCall, serveEngine } from "./server.ts";
import type { AgentTool, CallLogRow, ToolCallRequest, ToolCallResult } from "../services/agents.ts";

const ROLES = new Set(["pharmacy_advocate", "insurance_advocate", "member_chat"]);
const CHANNEL: Record<string, string> = { pharmacy_advocate: "advocate_view", insurance_advocate: "advocate_view", member_chat: "member_chat" };
const PRINCIPAL = "agent:agent-assist-demo";
const gapReports: { at: string; role: string; query: string }[] = [];

export function callLogRows(): CallLogRow[] {
  return callLog.slice(-40).reverse().map((c) => ({ ...c, at: c.at.slice(11, 19) }));
}

function getUnit(role: string, unitId: string) {
  const s = getStore();
  const kbs = s.access()[role]?.knowledge_bases ?? [];
  const u = s.units().find((x) => x.unit_id === unitId);
  if (!u || u.status === "duplicate_candidate" || u.status === "in_review") return { status: "not_found", unit_id: unitId };
  if (u.status === "retired") return { status: "retired", unit_id: u.unit_id, note: "Retired units are never served." };
  if (!kbs.includes(u.knowledge_base))
    return { status: "not_authorized", unit_id: u.unit_id, title: u.title, owner: u.owner, knowledge_base: u.knowledge_base };
  return {
    status: u.review_date < AS_OF ? "stale" : "ok",
    unit_id: u.unit_id, version: u.version, title: u.title, type: u.type, verbatim: u.verbatim,
    body: u.body, owner: u.owner, approved_by: u.approved_by, effective_date: u.effective_date, review_date: u.review_date,
  };
}

function listChanges(role: string, since: string) {
  const s = getStore();
  const kbs = s.access()[role]?.knowledge_bases ?? [];
  const changes = s
    .units()
    .filter((u) => kbs.includes(u.knowledge_base) && u.status !== "duplicate_candidate" && (u.effective_date >= since || (u.status === "retired" && u.review_date >= since)))
    .map((u) => ({ unit_id: u.unit_id, title: u.title, version: u.version, status: u.status, effective_date: u.effective_date }));
  return { since, count: changes.length, changes };
}

export function callTool(req: ToolCallRequest): ToolCallResult {
  const role = String(req.role ?? "");
  const tool = String(req.tool ?? "") as AgentTool;
  try {
    if (!ROLES.has(role)) throw new Error(`unknown connection role ${role}`);
    let outcome = "";
    let result: unknown;
    if (tool === "search_knowledge") {
      const q = String(req.query ?? "").trim();
      if (!q) throw new Error("query is required");
      const r = serveEngine({ query: q, role, channel: CHANNEL[role] ?? "advocate_view", lob: "MAPD", state: null } as never, { iface: "MCP", principal: PRINCIPAL });
      outcome = r.outcome;
      result = { outcome: r.outcome, parts: r.parts, engine: r.engine };
    } else if (tool === "get_unit") {
      const id = String(req.unit_id ?? "").trim().toUpperCase();
      if (!id) throw new Error("unit_id is required");
      const r = getUnit(role, id);
      outcome = r.status;
      result = r;
      logCall({ iface: "MCP", principal: PRINCIPAL, role, tool: `get_unit ${id}`, outcome });
    } else if (tool === "report_gap") {
      const q = String(req.query ?? "").trim();
      if (!q) throw new Error("query is required");
      gapReports.push({ at: new Date().toISOString(), role, query: q.slice(0, 300) });
      outcome = "logged";
      result = { status: "logged", note: "Sent to the knowledge team's gap queue. Nothing is published automatically.", open_reports: gapReports.length };
      logCall({ iface: "MCP", principal: PRINCIPAL, role, tool: `report_gap "${q.slice(0, 60)}"`, outcome });
    } else if (tool === "list_changes") {
      const since = String(req.since ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("since must be YYYY-MM-DD");
      const r = listChanges(role, since);
      outcome = `${r.count} change${r.count === 1 ? "" : "s"}`;
      result = r;
      logCall({ iface: "MCP", principal: PRINCIPAL, role, tool: `list_changes ${since}`, outcome });
    } else {
      throw new Error(`unknown tool ${tool}`);
    }
    return { ok: true, outcome, result_json: JSON.stringify(result, null, 2), error: null, log: callLogRows() };
  } catch (e) {
    return { ok: false, outcome: "error", result_json: "", error: (e as Error).message, log: callLogRows() };
  }
}

export function resetAgentState(): void {
  gapReports.length = 0;
}
