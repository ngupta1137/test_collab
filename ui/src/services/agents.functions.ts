// Server functions for the Agents page: run a tool as an agent connection, read the live call log.
import { createServerFn } from "@tanstack/react-start";
import type { CallLogRow, ToolCallRequest, ToolCallResult } from "./agents";

export const callToolFn = createServerFn({ method: "POST" })
  .validator((d: ToolCallRequest) => d)
  .handler(async ({ data }): Promise<ToolCallResult> => {
    const { callTool } = await import("../verity-engine/agents.ts");
    return callTool(data);
  });

export const getCallLog = createServerFn({ method: "GET" }).handler(async (): Promise<CallLogRow[]> => {
  const { callLogRows } = await import("../verity-engine/agents.ts");
  return callLogRows();
});
