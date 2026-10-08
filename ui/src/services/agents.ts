// Agent console contract (browser-safe types). The tools run on the server
// through the same enforcement as the Ask page; see src/verity-engine/agents.ts.

export type AgentTool = "search_knowledge" | "get_unit" | "report_gap" | "list_changes";

export interface ToolCallRequest {
  role: string; // bound by the connection, not a tool argument
  tool: AgentTool;
  query: string | null;
  unit_id: string | null;
  since: string | null;
}

export interface CallLogRow {
  at: string;
  iface: "REST" | "MCP";
  principal: string;
  role: string;
  tool: string;
  outcome: string;
}

export interface ToolCallResult {
  ok: boolean;
  outcome: string;
  result_json: string; // pretty-printed tool result, as the agent receives it
  error: string | null;
  log: CallLogRow[];
}
