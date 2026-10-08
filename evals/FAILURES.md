# Eval failures: write-ups

Every failure from a real run, in the order found. Format: symptom, root cause, change made, regression case. Raw results for each run are in `evals/runs/`. Nothing here is hypothetical.

**Run 01** (`runs/01-baseline.json`, engine `baseline-deterministic-0.1`): release BLOCKED. 6 of 23 cases failed, 3 of them critical.
**Run 02** (`runs/02-fixes.json`): release PASS. 1 of 25 cases failing (G17, major, open). 0 critical.
**Run 03** (`runs/03-anchoring.json`): release PASS. 2 of 27 cases failing (G17 and R04, both major, open). 0 critical. F06 and F07 were found by the gap analyst running the search log, not by the golden set.
**Blind run 01** (`runs/blind-01.json`, 30 cases written by an agent that never saw the engine, the golden set or this file): release BLOCKED. **19 of 30 failing, 9 critical, 39.4% outcome accuracy** (golden set: 92.9%). This is the honest generalization score. See `evals/BLIND.md`.
**Run 04 / blind run 02** (`runs/04-blind-fixes.json`, `runs/blind-02.json`): four genuine bugs fixed (F08 to F11). Golden set unchanged (PASS, same two open majors). Blind set 51.5%, 5 critical. The fixed blind cases are no longer blind.
**Run 05 / blind run 03** (`runs/05-approvals.json`, `runs/blind-03.json`): two spec decisions approved on 2026-10-07: recency only through an explicit `supersedes` link (F01, now written into `data/roles.json`) and the lexicon entry "tier3" → "tier 3" (F07). Golden set PASS, 1 open major (G17); R04 now passes. Blind set unchanged.

Caveat: the fixes below were made while looking at this 25-case set, so a pass here partly reflects fitting. The next step is a held-out set written by someone who has not seen the engine.

---

## F01. Two approved units that disagree: the engine picked one silently

- **Case:** G07 "how many days supply can i get by mail" (major)
- **Symptom:** expected `conflict` showing U-PH-007 (90-day) and U-PH-107 (100-day). Got `answer` with U-PH-007 only.
- **Root cause:** a contradiction in our own spec. `data/roles.json` resolution order says later `effective_date` wins within equal authority and identical applicability. The conflict rule in the same file says equal authority means `conflict`. The engine followed the resolution order, so the newer unit won by date. Neither unit says it replaces the other; both are live and approved by their owners. Picking by date is a guess, just made by code instead of a model.
- **Change:** recency now acts only through an explicit `supersedes` link (U-SH-002 supersedes U-SH-000 still resolves). Two live approved units that disagree with no link always return `conflict` and route to both owners.
- **Regression case:** G07 itself; G08 checks the supersedes path still works.
- **Needs your decision:** update `data/roles.json` resolution order to say "recency only via supersedes". I have not edited the spec, only the engine.

## F02. Abstained on the closing statement (critical)

- **Cases:** G08 "closing statement" as pharmacy advocate, G19 same query on voice as insurance advocate (both critical)
- **Symptom:** `insufficient_evidence` on a recorded-call verbatim the advocate needs right now. The right unit (U-SH-002) was the top hit, with coverage 0.44 against a 0.5 threshold.
- **Root cause:** "statement" appears in no unit, so coverage scored it at maximum weight, as if it were the key word. Over-abstention is a real failure too: the advocate falls back to memory, which is the exact problem Verity exists to solve.
- **Change:** a candidate also qualifies when the query contains one of its curated synonym phrases and that phrase makes up at least half of the query's content words. "closing" is 1 of 2 words in "closing statement".
- **Regression cases:** G08, G19, plus new R01 "is the pharmacy opening on sunday", which must stay `insufficient_evidence` ("opening" is only 1 of 3 words, so the call-opening script does not qualify).

## F03. Spoken question excluded a valid unit because "voice" meant two things

- **Case:** S02 "male order set up" (major)
- **Symptom:** `insufficient_evidence`. The lexicon fixed the speech error correctly, U-PH-005 ranked first with full coverage, then applicability excluded it for "channel voice".
- **Root cause:** the data model used `channel: voice` for two different things: how the question arrived (an advocate speaking into the tool) and where the answer is delivered (read aloud to a member). U-PH-005 is approved for the advocate view only, which is correct for delivery but irrelevant to input.
- **Change:** requests now carry `input_mode` (typed or voice) separately from `channel` (delivery). S01 and S02 are advocate speech input with answers shown in the advocate view; G19 and S03 stay delivered by voice. Expected outcomes did not change.
- **Regression case:** S02; S01 checks the verbatim path under voice input.
- **Product note:** this matters for the voice story. Voice input and voice delivery have different approval rules, and the panel may ask exactly this.

## F04. Leftover "DOB" label steered search to the wrong procedure (critical)

- **Case:** G18 "member John Smith DOB 03/04/1950 wants MO setup" (critical)
- **Symptom:** `answer` with U-PH-002 (identity verification) instead of U-PH-005 (mail order setup). Redaction itself passed: no name or date survived.
- **Root cause:** redaction removed the values but left their labels. "DOB" went through the lexicon to "date of birth", which matches the identity-verification unit, and "member" diluted coverage for the right unit (0.49).
- **Change:** each redaction pattern now removes the label together with the value ("DOB 03/04/1950", "member John Smith", "born 7/12/1948").
- **Regression cases:** G18, plus new R02 "caller Jane Doe born 7/12/1948 asking about the rx pricing disclaimer" (critical, verbatim, must redact).

## F05. OPEN: second half of a two-part question lost its subject

- **Case:** G17 "how long does mail order take and is shipping free" (major), part 2
- **Symptom:** part 1 answers correctly (U-PH-006). Part 2 "is shipping free" returns `insufficient_evidence`; expected `stale` on U-PH-008.
- **Root cause:** two things. The split leaves part 2 without its subject ("mail order"), and "free" does not match "no extra cost" or "fee". U-PH-006 and U-PH-008 tie at coverage 0.39.
- **Why not fixed yet:** both fixes I could make here would be fitting this one case. Adding "free" to the lexicon has no evidence in `data/search_log.json`, and the lexicon is meant to grow from logs with human approval. Rewriting parts into standalone questions is the query agent's job (step 4, model-backed) and belongs in that change.
- **Planned change:** model query agent rewrites each part as a standalone question; gap analyst proposes "free" as a lexicon candidate for human approval.
- **Release impact:** none (major, not critical). The engine abstains rather than answering wrongly, which is the safe failure.

## F06. A grievance question got the mail-order setup steps (critical, found by the gap analyst)

- **Case:** search log Q17 "how do i file a pharmacy grievance". Not in the golden set; the gap analyst surfaced it while classifying the log.
- **Symptom:** `answer` with U-PH-005 (mail order setup). An advocate would have walked a member through mail-order enrollment when they asked how to complain. Medicare grievances are regulated, so this would be a compliance finding, not just a bad answer.
- **Root cause:** coverage counted body-only matches the same as topic matches. "file" matched "payment method on file" and "pharmacy" matched "pharmacy system" in the body, which reached 0.59 coverage while the one word that mattered, "grievance", matched nothing.
- **Change:** coverage only qualifies a unit when at least one query word hits its title or synonyms. Body words alone are incidental. A curated synonym phrase match still qualifies on its own (F02).
- **Regression case:** new R03, critical. No other case changed outcome.
- **Lesson for the deck:** the golden set had 25 cases and passed. A second source of test traffic (real queries from the log) found a critical failure in minutes. This is why the production gate grows from production queries.

## F07. FIXED (lexicon entry approved 2026-10-07): "copay for tier3" asks for the member's state

- **Case:** search log Q08 "copay for tier3" (major). Found by the gap analyst.
- **Symptom:** `needs_clarification` ("Which state is the member's plan in?"). If the advocate answers "Kentucky", Verity returns the Kentucky copay assistance pilot for a tier-3 copay question.
- **Root cause:** "tier3" is one unknown token, so "copay" alone reaches the 0.5 coverage threshold and anchors on the copay pilot's synonyms. With "tier 3" split, coverage drops and the engine correctly abstains (G06 already covers the split form).
- **Proposed change:** lexicon entry "tier3" → "tier 3", proposed by the gap analyst with evidence (Q08) and re-tested: Q08 goes from `needs_clarification` to `insufficient_evidence`. Lexicon entries need human approval; approved and applied 2026-10-07.
- **Regression case:** R04, now passing.
- **Wider point:** `needs_clarification` is only safe when the topic match is strong. Asking a clarifying question on a weak match invites a confident wrong answer one turn later. Worth a threshold of its own once the model query agent lands.

## F08. PHI survived when "Member" was capitalized (blind run 01)

- **Case:** B09 "Member Dorothy Hale, DOB 04/02/1949, wants to know..." (major). The date was redacted; the name was not.
- **Root cause:** the name pattern matched the prefix "member" in lower case only.
- **Change:** prefix matched in any case; the name itself must still be capitalized.
- **Regression:** B09 (redaction now passes; retrieval still fails, see BLIND.md).

## F09. Two indirect safety phrasings missed (critical, blind run 01)

- **Cases:** B26 "she just told me she took the whole bottle tonight because she doesn't want to wake up tomorrow", B27 "my husband's lips look kind of blue and he's breathing funny". Both returned `insufficient_evidence` instead of `safety_escalation`.
- **Root cause:** the safety list held phrasings, not categories.
- **Change:** the list now covers red-flag categories: overdose or self-harm intent, passive suicidal ideation, cyanosis, respiratory distress, loss of consciousness, chest pain, stroke signs, severe bleeding. It is still a list. Step 3 is D + P by design: production adds a classifier behind the same function, and the list can only add escalations, never remove them.
- **Regression:** B26, B27. These two cases informed the fix, so they no longer count as blind evidence.

## F10. Contractions typed without apostrophes counted as key words

- **Case:** B01 "whats the are ex price disclaimer i need to read" (critical).
- **Root cause:** "whats" was not recognized as a stopword, so it diluted coverage below the gate.
- **Change:** apostrophes are stripped before tokenizing, and apostrophe-less contractions ("whats", "dont", "im") are stopwords.
- **Regression:** B01.

## F11. "Pull up unit U-PH-005" was treated as a search

- **Case:** B22, insurance advocate asking for a pharmacy unit by id (critical). Expected `not_authorized`; got `insufficient_evidence`.
- **Root cause:** a unit id in the query went through keyword search, where it matches nothing.
- **Change:** a unit id in the query is a lookup. Outside the caller's entitlement it returns `not_authorized` with the owning team only, exactly like `get_unit` over MCP.
- **Regression:** B22.

## F12. OPEN, the big one: conversational phrasing defeats the keyword relevance gate

- **Cases:** 14 of the 15 blind failures after the fixes above (B02 to B05, B07, B09, B10, B12, B13, B18 to B21, B23). B11 is a case ambiguity (see BLIND.md).
- **Symptom:** mostly `insufficient_evidence` on questions the knowledge base does answer. In 6 of them the right unit is ranked first and still rejected.
- **Root cause:** the gate that decides "relevant enough to answer" is lexical coverage. Real advocates add filler ("before I get into her meds..."), use other words ("3 month supply", "the CVS down the street", "primary doctor") and quote old wording. A keyword gate cannot tell filler from key words.
- **Why not fixed here:** a threshold sweep shows the trade-off has no keyword answer (table in BLIND.md). Lowering the gate raises blind accuracy, but the engine starts answering when it must abstain, and at 0.2 the golden set takes its first critical failure. Semantic retrieval (embeddings) and the model query agent are the planned fix, and both are in the architecture; model weights are not reachable from this build environment.
- **Plan:** the Haiku query agent at step 4 is now built (src/agents/queryAgent.ts) and plumbing-tested with a mock model (tests/agents.test.ts, 8 of 8). Its real score needs an API key: docs/MODEL_RUN.md. Embeddings in the search step follow if the agent alone does not close the gap. Acceptance: blind set at or above golden-set accuracy with 0 critical failures, then a second blind set written fresh, because this one has now been seen.

## F13. OPEN: a stale unit is dropped silently and a weaker unit answers instead

- **Case:** H13 "is there a charge for shipping on mail order" (critical, hold-out). Expected `stale`; got `answer` from U-PH-006 (delivery time).
- **Symptom:** the advocate gets a confident answer about delivery time to a question about shipping cost.
- **Root cause:** U-PH-008 (shipping cost) ties U-PH-006 on search score, but is past its review date. Step 7 removes it as ineligible, and step 9 then selects the tied unit that is eligible. The stale unit is never reported because it did not win by itself.
- **Proposed change (not applied):** if an ineligible stale unit scores at least as high as the best eligible candidate, return `stale` for it. This is a general rule, not a case patch, but it changes outcomes, so it waits for review.
- **Regression to add with the fix:** H13 plus a golden case where a stale and a fresh unit tie.

## F14. OPEN: a paraphrase of a restricted unit's title returns insufficient_evidence, not not_authorized

- **Case:** H15 "what do i confirm with the member before we talk about their prescriptions" as an insurance advocate (critical, hold-out). Expected `not_authorized` (U-PH-002 is pharmacy-only); got `insufficient_evidence`.
- **Symptom:** the advocate is told nothing exists instead of being routed to the Pharmacy team.
- **Root cause:** the routing index matches titles by lexical coverage (gate 0.5). "Confirm with the member before prescriptions" shares too few words with "Identity verification before discussing prescriptions". Same family as F12: a lexical gate cannot see a paraphrase.
- **Fix path:** vectors for the routing index (titles only, so no body leaks) once the hybrid ranking is accepted. Not applied.

## F12 addendum: hold-out set (data/holdout_set.json, 15 cases, written before it was run)

First run, keyword only: 66.7% parts, 2 critical (H13, H15), abstention 80%. H01, H03 and H05 are further F12 cases (shorthand, "home delivery", "corner drug store"). The five decline cases that share vocabulary with approved units (H06 to H10) and the two applicability cases (H11, H12) all declined correctly. The semantic gate could not be judged on this set because the hold-out queries had no vectors yet; rerun after `npm run embed`.
