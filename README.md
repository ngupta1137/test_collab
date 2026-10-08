# Verity
*One approved truth, in every channel.*
**Thesis:** every channel says the approved thing, and when the approved thing changes, every channel changes with it.

- `docs/diagrams/`: architecture diagram
- `docs/FOUNDATIONS.md`: thesis, problem brief, personas, journeys, knowledge unit design, outcomes, golden set, assumptions, decision log
- `data/`: synthetic source documents, seed units, roles, lexicon, search log, golden set
- `src/theme/tokens.css`: design tokens
- `brand/`: official logo `verity_logo_mark` (icon) and `verity_logo_lockup` (icon + wordmark + tagline), SVG and PNG. The "Lineage V": one approved source fans out to every channel.
- `src/engine/`: deterministic reference engine (13-step pipeline, two indexes, resolution, PHI and safety guards, drift detector)
- `src/gateway/`, `src/agents/`: provider-agnostic model gateway (off by default, response cache for offline replay) and the model-backed query agent. How to run it for real: `docs/MODEL_RUN.md`
- `src/service/`: one policy-enforcement layer that both interfaces call
- `rest/`: REST API for channels (`npm run rest`)
- `mcp/`: MCP adapter for agents (`npm run mcp`), see `mcp/README.md`
- `analyst/`: offline gap analyst and its latest report (`npm run gaps`)
- `tests/`: interface tests, including MCP parity with the engine on every golden case (`npm test`)
- `evals/`: eval runner, latest report, archived runs and failure write-ups (`npm run eval`)
- `CLAUDE.md`: build rules for Claude Code

## Quick start

Node 22.18 or later. `npm install`, then `npm test` and `npm run eval`. The engine runs with no model and no API key by default.

Concept prototype by Nitin Gupta. All data is synthetic.
