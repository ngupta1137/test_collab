# Verity MCP adapter

Lets an AI agent (Agent Assist, a member-chat agent, Claude Desktop) query Verity through the same enforcement layer as the REST API.

## Tools

| Tool | What it does |
| --- | --- |
| `search_knowledge(query, channel, input_mode?, lob?, state?)` | Returns one outcome per question part, with citations. Verbatim text comes back exact and is marked `verbatim: true`. |
| `get_unit(unit_id, version?)` | Fetches one approved unit, for insertion by reference. Out-of-scope units return `not_authorized` with the owning team only. Retired units are never served. |
| `report_gap(query, context?)` | Logs an unanswered question to the author queue. PHI is redacted first. |
| `list_changes(since)` | Units in scope that became effective, were replaced or were retired since a date. |

## Identity is not a tool argument

The agent's role comes from the connection (`VERITY_ROLE`, standing in for the agent's OAuth identity), never from a parameter. An agent cannot ask for broader access by passing a different role. `tests/interfaces.test.ts` checks that no tool exposes a `role` input, and that every golden case returns the same outcome through MCP as through the engine.

## Run it

- **Demo runbook:** `mcp/DEMO.md` (terminal demo and Claude Desktop setup, prompts, troubleshooting).
- **Prebuilt server:** `mcp/dist/verity-mcp.mjs` is a single file that runs on Node 18 or later with no `npm install`. Rebuild after code changes with `npm run build:mcp` (`npm test` rebuilds and tests the bundle).
- **From source (Node 22.18+, after `npm install`):** `npm run mcp`.

Every call is written to `runtime/calls.jsonl` with PHI redacted; the REST endpoint `GET /v1/calls` shows the same log for the UI.
