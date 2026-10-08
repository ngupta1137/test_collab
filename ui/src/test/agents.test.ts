// Agent console: same rules as the Ask page; role comes from the connection.
import { beforeEach, describe, expect, it } from "vitest";
import { callTool } from "../verity-engine/agents";
import { resetDemo } from "../verity-engine/authoring";
import { serveEngine } from "../verity-engine/server";

const call = (role: string, tool: "search_knowledge" | "get_unit" | "report_gap" | "list_changes", a: { query?: string; unit_id?: string; since?: string } = {}) =>
  callTool({ role, tool, query: a.query ?? null, unit_id: a.unit_id ?? null, since: a.since ?? null });

describe("agent console", () => {
  beforeEach(() => resetDemo());

  it("search_knowledge returns the verbatim disclaimer and logs an MCP call", () => {
    const r = call("pharmacy_advocate", "search_knowledge", { query: "Rx pricing disclaimer I have to read on this call" });
    expect(r.outcome).toBe("answer");
    expect(r.result_json).toContain("may change");
    expect(r.log[0]).toMatchObject({ iface: "MCP", principal: "agent:agent-assist-demo", role: "pharmacy_advocate" });
  });

  it("get_unit outside the role returns owner only, no body", () => {
    const r = call("pharmacy_advocate", "get_unit", { unit_id: "U-IN-002" });
    expect(r.outcome).toBe("not_authorized");
    expect(r.result_json).toContain("Member Services");
    expect(r.result_json).not.toContain("in network");
    expect(call("insurance_advocate", "get_unit", { unit_id: "U-IN-002" }).result_json).toContain("in network");
    expect(call("pharmacy_advocate", "get_unit", { unit_id: "U-SH-000" }).outcome).toBe("retired");
  });

  it("conflict, list_changes scoped to the role, report_gap, and input validation", () => {
    expect(call("pharmacy_advocate", "search_knowledge", { query: "how many days supply can a member get by mail" }).outcome).toBe("conflict");
    const ch = JSON.parse(call("insurance_advocate", "list_changes", { since: "2026-01-01" }).result_json);
    expect(ch.changes.every((c: { unit_id: string }) => !c.unit_id.startsWith("U-PH"))).toBe(true);
    expect(call("member_chat", "report_gap", { query: "shingles vaccine at the pharmacy" }).outcome).toBe("logged");
    expect(call("pharmacy_advocate", "list_changes", { since: "last week" }).ok).toBe(false);
    expect(call("admin", "get_unit", { unit_id: "U-PH-003" }).ok).toBe(false);
  });

  it("Ask page searches appear in the same log as REST calls", () => {
    serveEngine({ query: "closing statement", role: "pharmacy_advocate", channel: "advocate_view", lob: "MAPD", state: null } as never);
    const r = call("pharmacy_advocate", "get_unit", { unit_id: "U-PH-003" });
    expect(r.log.map((x) => x.iface)).toEqual(["MCP", "REST"]);
  });
});

describe("next step when Verity cannot answer", () => {
  const ask = (q: string, role = "pharmacy_advocate") =>
    serveEngine({ query: q, role, channel: role === "member_chat" ? "member_chat" : "advocate_view", lob: "MAPD", state: null } as never).parts[0]!;
  it("gives a recovery path for refusals and none for answers", () => {
    expect(ask("Rx pricing disclaimer").next_step).toBeNull();
    expect(ask("how do i file a pharmacy grievance").next_step).toMatch(/Do not answer from memory/);
    expect(ask("how many days supply can I get by mail").next_step).toMatch(/Do not state either version as current/);
    expect(ask("how do I change a member primary care provider").next_step).toMatch(/Warm-transfer to Member Services/);
    expect(ask("how do i file a pharmacy grievance", "member_chat").next_step).toMatch(/connect the member with an advocate/i);
  });
});
