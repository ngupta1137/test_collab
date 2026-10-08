# Verity: Foundations (v0.3)
*One approved truth, in every channel.*
*Governed knowledge and search for health-plan contact centers. Concept by Nitin Gupta. All data synthetic. Figures marked (illustrative) are placeholders, not facts.*

---

## 0. Name and logo
**Verity** (concept codename). Leads with authority: trust this answer because it is approved, current, applicable and cited. The tagline carries consistency across channels. Considered: Unison (harmony over authority), KDP (names search, which is downstream).

**Logo:** the "Lineage V": one approved source (bright green dot) fans out into three channel lines.

## 1. Thesis
**Every channel says the approved thing, and when the approved thing changes, every channel changes with it.**

Search is downstream. What makes an answer trustworthy is everything upstream of it: a source someone owns, a unit someone approved, a scope someone is entitled to, and a check that the answer still applies.

**Relevance is not authority, and authority is not applicability.** Most of Verity's design follows from that sentence.

## 2. Problem brief

**Primary pain (the one we optimize first):** compliance findings caused by advocates reading wrong or outdated legal verbatim on recorded calls. It is already measured today by call QA, so improvement is provable.

**The moment it hurts.** A pharmacy advocate searches "Rx pricing disclaimer" on a live, recorded call. Three documents come back with three wordings. She reads the one she recognizes. Weeks later, call QA flags it as a finding, because it was the outdated version.

**Secondary benefits (measured, not optimized first):** advocate search time, duplicated authoring and review effort, and speed of launching new AI channels on approved knowledge.

**Why now.**
1. A health plan builds voice, chat, advocate assist and digital channels on the same knowledge; each is only as correct as that knowledge.
2. Retrieval over an unstructured document pile returns inconsistent and sometimes non-compliant answers; the knowledge layer is the dependency under every other AI use case.
3. Models can now do the heavy reading (extraction, change detection, query understanding) while humans keep publication rights.

## 3. Scope: build now vs. not now

| Build now (prototype and first 6 months) | Not now, and why |
|---|---|
| Contact-center pharmacy and shared call scripts | **Medical policy** (NCD, LCD, MCG): higher consequence of error; prove the governance and eval architecture on lower-risk content first |
| Governed knowledge units, approval, versioning, retirement | **Autonomous authoring or publishing:** extraction is probabilistic; publication of regulated text is authoritative |
| Advocate search: scoped, cited, with abstention | **Member-facing chatbot as a product:** member chat appears only to prove one unit serves two channels |
| Golden-set evals and release gates | **Conversational voice agent:** voice appears only as a channel reading approved units |
| Gap capture into an author queue | **Enterprise search** over drives and mail; **migration of every repository** |
| | **Supervisor or planner agent** (see section 11) |

**First user for 6 months:** the pharmacy advocate (Priya). Second: the Legal approver (Rob), whose review load must go down, not up.

## 4. Personas (synthetic)

| Persona | Role | Goal | Today's pain |
|---|---|---|---|
| **Priya** (main character) | Pharmacy advocate, 8 months tenure | Say the right thing, fast, on a recorded call | Several tools; conflicting wording; relies on memory |
| **Marcus** | Insurance advocate | ID card and PCP answers quickly | Sees content he doesn't need; can't tell what's current |
| **Dana** | Knowledge Ops author | Keep content accurate without rewriting everything | Same text copied into many documents |
| **Rob** | Legal / Compliance approver | Approve verbatim once and trust it's used exactly | Reviews the same disclaimer repeatedly |
| **Eleanor, 72** | Member using chat and phone | A clear, consistent answer | Hears different things on different channels |

## 5. Journeys

### Knowledge journey (source document to usable answer)
| Step | Today | Future |
|---|---|---|
| Create | Author edits a long document | Author uploads; AI proposes units, tags and applicability |
| Change check | None; copies multiply | Every textual change to verbatim is flagged; AI classifies impact |
| Approve | Legal reviews whole documents, repeatedly | Legal approves one unit once |
| Publish | Each channel copies text into its own system | One approved, versioned unit served everywhere |
| Change | Nobody finds every copy | New version propagates; old one retired everywhere |
| Keep current | Stale content lingers | Review dates and drift alerts |

### Finding journey (advocate or assistant locates an answer)
| Step | Today | Future |
|---|---|---|
| Ask | Keyword search in several tools | One box, typed or voice; organization jargon understood |
| Results | Documents, different per tool | One answer, cited to unit, version and source passage |
| Scope | Everything or nothing | Only what the role may read; restricted topics route to the owning team |
| Applicability | Unclear | Asks for state or plan when it matters |
| No answer | Silent or a guess | Says so; logs a gap for an author |

## 6. Knowledge unit (the atomic object)
**System of record:** Verity is **not** the source of legal or business truth. Source documents and their owners are. Verity is the governed serving layer derived from them. If Verity and the source disagree, the source wins and the unit is flagged for review.

| Field | Purpose |
|---|---|
| unit_id, title, type | Identity; type is verbatim / procedure / fact / faq. Titles must be safe to expose (used by the routing index) |
| body | The approved text |
| verbatim | If true: locked, inserted by reference, never generated or paraphrased |
| spoken_version | Approved voice-friendly text for non-verbatim units only |
| knowledge_base, audience, channels | Entitlement and channel eligibility |
| **applies_to** (lob, states, plan_year) | **Applicability**, checked before authority |
| authority_level | legal_approved > policy > knowledge_article |
| source_doc, source_section | Lineage to the authoritative passage |
| effective_date, review_date | Currency |
| version, status, supersedes | draft / in_review / approved / retired / duplicate_candidate |
| synonyms, owner, approved_by | Findability and accountability |

## 7. Runtime trace: what happens to one query
D = deterministic, P = probabilistic (model), H = human.

| # | Step | Type | If it fails or is uncertain | Logged |
|---|---|---|---|---|
| 1 | Authenticate caller; resolve role and entitlements | D | Deny; no search | identity, role, entitlement version |
| 2 | Redact PHI/PII from query text | D | Block query from model; manual search only | redaction applied (not the PHI) |
| 3 | Safety pre-check (crisis or urgent clinical language) | D + P | Outcome safety_escalation; no retrieval | trigger |
| 4 | Query understanding: intent, spelling, acronyms, speech errors, split multi-part questions | P | Low confidence: needs_clarification | normalized query, parts |
| 5 | Hard partitions: tenant, environment, line of business, state | D | Missing state or plan when a candidate depends on it: needs_clarification | partition keys |
| 6 | Search body index (entitlement-filtered) and routing index (title and owner only) | D + embeddings | Restricted best match: not_authorized with owning team | candidate ids, scores |
| 7 | Eligibility: approved, not retired, within dates | D | Past review date: stale | exclusions with reason |
| 8 | Applicability: lob, state, plan year, audience, channel | D | Relevant but not applicable: insufficient_evidence | exclusions with reason |
| 9 | Authority, then recency; equal and disagreeing: conflict | D | conflict, routed to both owners | resolution path |
| 10 | Compose answer from eligible units only; verbatim inserted by unit_id | P (+ D for verbatim) | Composition error: fall back to showing the unit text | prompt version, model, unit versions |
| 11 | Verify: every claim supported by cited units; verbatim exact match; no unit outside scope | D + P | Any failure: do not show the composed answer; show the cited unit text or abstain | verification result per claim |
| 12 | Return outcome per part | D | | outcome, latency |
| 13 | Persist reproducibility record; failures and gaps feed the golden set and author queue | D | | full record (section 16) |

**What prevents a bad answer reaching the advocate:** steps 7 to 9 decide what is allowed as evidence before any generation, and step 11 can only block or downgrade an answer, never upgrade one.

## 8. Outcomes
| Outcome | When | Next |
|---|---|---|
| **answer** | Eligible, applicable, authoritative unit supports it | Answer + citation; verbatim exact |
| **needs_clarification** | Answer depends on missing context (state, plan, line of business) | Ask one question |
| **insufficient_evidence** | No eligible and applicable unit supports it | Say so; log a gap |
| **conflict** | Equal authority and applicability, units disagree | Show both; route to owners; model never picks |
| **stale** | Matching unit past its review date | Flag; do not present as current; notify owner |
| **not_authorized** | Best match is outside the caller's entitlement | Name the owning team; body never retrieved into context |
| **safety_escalation** | Urgent or crisis language | Urgent-help message and human handoff; no retrieval |

**Multi-part questions** are scored and answered per part, so a partly answerable question is not forced into all-or-nothing.

## 9. Permission enforcement (where exactly)
Identity → entitlements → **filter inside the search query** on the body index → retrieval → generation.

I don't treat redaction after generation as a security boundary: once restricted text is in the model's context, control of that information is already lost.

A separate **routing index** (unit_id, title, knowledge base, owner team; no body) is searched across all units. That avoids a quiet failure of pure pre-filtering: telling an advocate "nothing exists" when the answer exists but belongs to another team. The cost is that titles become visible, so titles are written to be safe to expose.

## 10. Authoring: dedup and drift (the algorithm)
1. **Normalize** (case, whitespace, quote styles, punctuation spacing) and **hash**. Identical after normalization: no flag. This removes formatting noise that would waste Legal's time.
2. **Word-level diff** against the current approved unit. **Any** remaining textual change to a verbatim unit is flagged, whatever its similarity score. A one-word change ("may change" to "will not change") scores very high on similarity and can reverse the meaning, which is exactly why similarity is never used to dismiss a change.
3. **Candidate matching for non-verbatim text:** embeddings propose possible semantic duplicates (rephrased facts).
4. **Impact classification (model):** labels each flagged change as equivalent wording, narrowing scope, broadening scope, or contradiction, to prioritize the review queue. **The model can raise priority but can never clear a flag.**

Evaluated on data/authoring_cases.json: flag recall (no meaningful change missed, target 100% for verbatim) and flag precision (Legal's time not wasted).

## 11. Orchestration
**Deterministic workflow orchestration with selective model calls.** Model calls sit only at steps that need judgment: extraction, query understanding, composition, impact classification, gap clustering.

**The counterargument, considered:** a supervisor agent could decide dynamically whether to retrieve, ask a clarifying question, resolve a conflict or hand off to a human. In this product, those transitions are known and must be auditable; a planner would add variable paths, latency and a new failure surface, and would make "why did the system do that" harder to answer for compliance. **Where agentic behavior does earn its place:** the offline gap analyst, which explores clusters of unanswered questions and drafts proposals for a human, where flexibility helps and nothing is published automatically.

## 12. Interfaces and model-agnostic boundaries
**System API: REST/OpenAPI** for channels (advocate desktop, CRM, telephony integration, chat), with OAuth/JWT identity propagation, tracing and standard enterprise controls.
**MCP adapter** over the same service for AI agents (for example Agent Assist or future agents), enforcing the same identity and scoping. Both call one policy-enforcement layer.

Separated layers, each replaceable: knowledge store, retrieval, policy enforcement, orchestration, model gateway, eval harness. A model is swapped only when it passes the same golden set and authoring set.

## 13. Evals
**Prototype sets:** 23 serving cases (data/golden_set.json) and 5 authoring cases (data/authoring_cases.json). These are a **smoke test**, not a launch gate. A production gate needs 300 to 500 stratified, versioned cases across channels, roles, lines of business and states, grown from production failures.

| Metric | Target |
|---|---|
| **Critical failure rate** (any critical-severity case wrong: verbatim mismatch, permission leak, wrong applicability, unsupported coverage statement, safety miss) | **0, release-blocking** |
| Outcome accuracy (per part) | high; reviewed per slice |
| Unit recall@3 | high |
| Citation accuracy; claim support of composed text | 100% claim support |
| Verbatim exactness, typed and spoken | 100% |
| Permission leakage into model context | 0 |
| Abstention accuracy (no answers from model memory) | high |
| Retired-content exposure | 0 |
| Dedup/drift flag recall (verbatim) / precision | 100% / high |
| Latency p95 | to agree with contact-center ops (illustrative: advocate 2.5 s, voice first audio 1.5 s) |

Metrics are reported per slice, never only as averages. Every eval failure is written up as: symptom, root cause, change made, regression case added.

## 14. Release gates and data we refuse
- No provenance, owner or entitlement: the unit is not retrievable.
- Any critical failure, permission leak or verbatim mismatch: release blocked.
- Retirement must propagate to every channel before a replacement is announced.
- PHI never stored in units, prompts or logs.

## 15. Proving value (pilot design)
Baseline before pilot, then pilot advocates vs. a matched control group (illustrative metrics):
- Verbatim-related QA findings per 1,000 calls (**primary**)
- Median seconds to an approved answer
- Share of searches ending in a cited answer vs. abandoned
- Time from a Legal change to all channels updated
- Legal review hours per unit; duplicate unit count
- Gap backlog closed per week

## 16. Audit and privacy
Every request writes a reproducibility record: query (redacted), caller role and entitlement version, partition keys, candidate and selected unit ids with versions, policy and resolution path, model and prompt versions, verification results, outcome, latency. This lets anyone replay why a given answer was shown, which matters when a compliance finding or complaint is investigated.

## 17. Assumptions
- Roles and entitlements exist in an identity system; Verity consumes them.
- Legal owns verbatim; Verity never creates or edits legal text without approval.
- Initial scope: pharmacy and shared contact-center scripts. Medical policy is a later, regulated domain.
- Line of business, state and plan year are available from the call or chat context, or can be asked.
- All data synthetic; numbers illustrative.

## 18. Decision log
| # | Decision | Alternative | Why | Notes |
|---|---|---|---|---|
| D1 | Build the knowledge layer first | Prior authorization decision support | Prior auth at scale depends on governed, versioned policy knowledge; build the layer first | |
| D2 | Governed units, not document retrieval | RAG over raw documents | Raw retrieval returns inconsistent and non-compliant answers; a unit carries authority, applicability and lifecycle | |
| D3 | Verbatim never generated | Let the model answer with the disclaimer | A paraphrased disclaimer is the compliance failure itself, not a cosmetic issue | |
| D4 | Entitlement filter inside the search query, plus routing index | Hide restricted results after generation | Post-generation redaction is not a security boundary; routing index avoids false "doesn't exist" | |
| D5 | Any verbatim text change flagged; model only classifies impact | Similarity threshold or LLM judgment decides | One word can reverse meaning at 0.98 similarity; the model may raise priority, never clear a flag | |
| D6 | Workflow orchestration, agentic only offline | Supervisor agent | Known, auditable transitions; planner adds failure surface without value here | |
| D7 | Voice as a channel | Conversational voice agent | Voice bot is a separate product; the platform serves it | |
| D8 | Golden set before UI | UI first, evals later | Evals define what "good" means | |
| D9 | Applicability before authority | Authority hierarchy alone | Relevance is not authority, and authority is not applicability | |
| D10 | REST system API, MCP adapter for agents | MCP as the only interface | Channels need enterprise transport controls; agents benefit from MCP | |
| D11 | Primary metric: verbatim QA findings | Five equal value claims | One measurable pain a small team can move | |

## 19. Still open
- Production eval set size and stratification plan.
- Latency targets with contact-center operations.
