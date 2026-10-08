# Verity
*One approved truth, in every channel.*
**Thesis:** every channel says the approved thing, and when the approved thing changes, every channel changes with it.

- `docs/FOUNDATIONS.md`: thesis, problem brief, personas, journeys, knowledge unit design, outcomes, golden set, assumptions, decision log
- `data/`: synthetic source documents, seed units, roles, lexicon, search log, golden set
- `src/theme/tokens.css`: design tokens
- `brand/`: official logo `verity_logo_mark` (icon) and `verity_logo_lockup` (icon + wordmark + tagline), SVG and PNG. Option A "Lineage V": one approved source fans out to every channel.
- `src/engine/`: deterministic reference engine (13-step pipeline, two indexes, resolution, PHI and safety guards, drift detector), source-to-units extractor (`extract.ts`, check with `npm run eval:extraction`) and the approval workflow (`workflow.ts`: Legal and author gates, versioned publishing, audit log)
- `src/gateway/`, `src/agents/`: provider-agnostic model gateway (off by default, response cache for offline replay) and the model-backed query agent. How to run it for real: `docs/MODEL_RUN.md`
- `src/service/`: one policy-enforcement layer that both interfaces call
- `rest/`: REST API for channels (`npm run rest`)
- `mcp/`: MCP adapter for agents (`npm run mcp`), see `mcp/README.md`
- `analyst/`: offline gap analyst and its latest report (`npm run gaps`)
- `tests/`: interface tests, including MCP parity with the engine on every golden case (`npm test`)
- `evals/`: eval runner, latest report, archived runs and failure write-ups (`npm run eval`)
- `skills/unit-authoring/SKILL.md`: the rules for turning a source into units (extraction agent and rules baseline)
- `docs/EMBEDDINGS.md`: how the embedding re-rank was built, measured on a hold-out set, and why the semantic gate stays off
- `CLAUDE.md`: build rules for Claude Code

Concept prototype by Nitin Gupta. All data is synthetic.
