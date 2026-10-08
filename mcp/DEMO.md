# MCP demo: runbook

The point to land: **an AI agent gets exactly the same rules as a person.** Same entitlements, same verbatim, same "I don't know". About 60 to 90 seconds, during slide 8.

There are two ways to show it. Set up both. Use Claude Desktop if the rehearsal goes cleanly; otherwise use the terminal version, which needs nothing but Node.

## What has been tested, and what hasn't

Tested automatically (`npm test`, 5 of 5 pass) against the bundled server `mcp/dist/verity-mcp.mjs`:
- Every golden-set case gives the same outcome through MCP as through the engine.
- No tool lets the agent choose its role; restricted and retired units never return a body; no PHI in any log.
- Runs on Node 18 and Node 22, from a folder path with spaces, started from a different working directory, with no `npm install`.
- A wrong role fails at startup with a readable error.

**Not tested: Claude Desktop itself on your Windows laptop**, and how Claude words its answer. That's why the 10-minute rehearsal below is required.

## Option A: terminal (zero setup, fully tested)

```
cd "C:\Users\nitin\Desktop\FracsNet\Claude Projects\verity-foundations\verity"
node mcp\dist\verity-mcp-demo.mjs
```

An "Agent Assist" client connects over MCP as a pharmacy advocate and runs five calls: the verbatim disclaimer, an insurance-only unit (not authorized, owner named, no body), the 90 vs 100 day conflict with both texts, an unanswerable question (gap logged), and recent changes. Make the terminal font large before the session.

## Option B: Claude Desktop (rehearse first)

**Setup, once (about 10 minutes):**

1. Check Node: `node -v` should print v18 or later. If not, install the LTS from nodejs.org.
2. In Claude Desktop: **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`.
3. Add this (keep any servers already there, inside the same `mcpServers` block). Use forward slashes in the path:

```json
{
  "mcpServers": {
    "verity": {
      "command": "node",
      "args": ["C:/Users/nitin/Desktop/FracsNet/Claude Projects/verity-foundations/verity/mcp/dist/verity-mcp.mjs"],
      "env": { "VERITY_ROLE": "pharmacy_advocate", "VERITY_PRINCIPAL": "agent:claude-desktop-demo" }
    }
  }
}
```

4. Quit Claude Desktop completely (right-click the tray icon → Quit), then reopen it.
5. Start a new chat and open the tools menu: **verity** should be listed with 4 tools.

**Demo prompts, in order:**

| Say | Expect | The point |
| --- | --- | --- |
| "Use Verity to get the Rx pricing disclaimer I have to read on this call." | Calls `search_knowledge`; returns the disclaimer word for word, citing U-PH-003 | Verbatim comes from the approved unit, not the model. Expand the tool result to show the exact text. |
| "Pull unit U-IN-002 from Verity." | `get_unit` returns not_authorized, owned by Member Services, no text | The agent can't read outside its role, and it can't ask for a different role: the role is set by the connection. |
| "Using Verity, how many days supply can a member get by mail?" | `search_knowledge` returns conflict with both texts (90 and 100 days) | The agent is told not to pick. Watch that Claude shows both. |

**If Claude answers without calling the tool**, say "Use the Verity tool for that." If it still paraphrases the disclaimer, expand the tool result and read it from there: that is the point anyway (the source of truth is the tool, not the chat text).

**Troubleshooting:**

| Symptom | Fix |
| --- | --- |
| verity not in the tools menu | Config JSON invalid (missing comma or brace), or Desktop not fully restarted from the tray |
| "Server disconnected" | Run the same command in a terminal: `node "C:/Users/.../mcp/dist/verity-mcp.mjs"`. It should sit silently waiting; any error prints there |
| `'node' is not recognized` | Put the full path in `"command"`: `"C:/Program Files/nodejs/node.exe"` |
| `Verity data not found` | The bundle must stay inside the repo folder, or add `"VERITY_ROOT": "C:/.../verity"` to `env` |
| `unknown role` | `VERITY_ROLE` must be pharmacy_advocate, insurance_advocate or member_chat |

**Rehearsal checklist (do it twice, once on presentation Wi-Fi if possible):** all three prompts behave as in the table · tool results expand cleanly · font size readable from the back of the room · Option A runs too, as the fallback.

Every call either way lands in `runtime/calls.jsonl`, with PHI redacted.
