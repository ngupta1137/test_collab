# Running the query agent for real (about 10 minutes, a few cents)

The engine runs without any model by default. This turns on the model-backed query agent (runtime step 4) and measures it on the blind set, which is its acceptance test (evals/BLIND.md, F12).

## What it does and doesn't do

- Rewrites each question into standalone parts, fixes speech-to-text errors and internal jargon, and **proposes** candidate units from a catalog of titles and synonyms.
- Never answers. Never sees a unit body or any PHI (both are tested in `tests/agents.test.ts`).
- Its proposals are only nominations: eligibility, applicability, authority and conflict rules still decide, deterministically. A hallucinated or out-of-scope id is dropped before the engine sees it.
- Its "urgent" flag can add a safety escalation, never remove one.

## Steps (Windows PowerShell)

1. `node -v` must print v22.18 or later (the eval runner is TypeScript run directly by Node). If not, install Node 22 LTS from nodejs.org.
2. In the repo folder:
   ```
   cd "C:\path\to\verity"
   git pull
   npm install
   ```
3. Set the key **for this window only** (it disappears when you close it, and it never touches the terminal you use for Claude Code). Use a key from your Claude API credits:
   ```
   $env:VERITY_ANTHROPIC_KEY = "sk-ant-..."
   ```
4. Run both sets:
   ```
   npm run eval:model:blind
   npm run eval:model:golden
   ```
5. Send me `evals/REPORT_blind_set.md` and `evals/REPORT.md` (or paste the "Release" and "Failing" lines). I'll write every failure up as F13 onward and tune the prompt, then we write a fresh blind set.

**Cost:** about 60 calls to the Haiku-class model, roughly 2,000 tokens each. Well under $1 at list prices.

**Models:** query agent defaults to `claude-haiku-4-5`. Override with `$env:VERITY_MODEL_QUERY = "..."` to compare models on the same sets; the swap rule is the same eval gate.

## Offline replay for the demo

Every live reply is saved in `cache/` (not committed). To make the MCP server or REST API replay those answers with no network:

```
$env:VERITY_MODEL_MODE = "cache-only"
```

A question that was not in the run falls back to the deterministic baseline, so nothing breaks; it is just answered without the agent. For Claude Desktop, add `"VERITY_MODEL_MODE": "cache-only"` to the `env` block in `mcp/DEMO.md` (rebuild with `npm run build:mcp` first so the bundle includes the gateway; `npm test` does this).
