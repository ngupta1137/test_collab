# Verity: instructions for Claude Code
Product: Verity (concept codename). Tagline: "One approved truth, in every channel." Official logo: brand/verity_logo_mark.svg (icon, use as favicon and in the app header) and brand/verity_logo_lockup.svg.

Concept prototype: governed knowledge and search for health-plan contact centers. Synthetic data only. Concept by Nitin Gupta.

## Architecture rules (do not break)
- GenAI only at: extraction agent, query agent, answer composer, gap analyst. Everything else is deterministic.
- Legal verbatim is NEVER generated. Store approved text; insert by unit_id; the verifier checks an exact string match.
- Permissions are applied BEFORE retrieval (data/roles.json). Out-of-scope units never enter model context.
- Every search returns one of: answer | needs_clarification | insufficient_evidence | conflict | stale | not_authorized | safety_escalation (docs/FOUNDATIONS.md section 8). Multi-part questions are answered and scored per part.
- Follow the 13-step runtime trace in docs/FOUNDATIONS.md section 7 exactly; steps 7 to 9 are deterministic and run before any generation.
- Resolution order (data/roles.json): eligible, then applicable (applies_to: lob, states, plan_year), then authority, then recency; still tied and disagreeing returns conflict. The model never picks.
- Two indexes: body index filtered by entitlement inside the search query (only this reaches the model); routing index of unit_id, title, knowledge_base, owner only, used to return not_authorized with the owning team.
- Redact PHI/PII from queries before any model call and before logging. Safety pre-check runs before retrieval.
- Dedup/drift: normalize and hash; any textual change to a verbatim unit is flagged; a model may classify impact but never clears a flag (FOUNDATIONS section 10). Evaluate on data/authoring_cases.json.
- Write a reproducibility record for every request (FOUNDATIONS section 16).
- Channels use a REST API; the MCP server is an adapter over the same enforcement layer.
- Retired units are never returned. Units past review_date return stale (as-of date in data/golden_set.json).
- All model calls go through one gateway module (provider-agnostic). Default: Sonnet for extraction and answers, Haiku for query understanding and the judge. Cache every model response to /cache for offline demo fallback.
- API keys only in server environment variables. Never in client code or Git.
- UI colors and fonts only from src/theme/tokens.css. Every outcome uses color + icon + text label.

## Tasks, in order (commit after each)
1. Load data/units_seed.json, roles.json, lexicon.json.
2. Retrieval: role scoping first, then hybrid (keyword + embedding) ranking over approved units.
3. Agents via the gateway: extraction (from data/source_docs), query understanding (lexicon-aware, speech-error tolerant), answer composer + verifier.
4. Eval runner over data/golden_set.json and data/authoring_cases.json, writing evals/results.json with every metric in docs/FOUNDATIONS.md section 13, reported per slice. Critical failures block. For every failure, append a write-up to evals/FAILURES.md: symptom, root cause, change made, regression case. Never fabricate results.
5. MCP-style tool interface: search_knowledge(query, role, channel), get_unit(unit_id, version), report_gap(query, context), list_changes(since), with a visible call log.
6. Gap analyst: cluster unanswered queries from data/search_log.json; propose draft units and lexicon additions.

## Boundaries
- Do not add real company data, logos, or member information.
