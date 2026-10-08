---
name: unit-authoring
description: Rules for turning a source document into Verity knowledge units. Used by the extraction agent (model) and mirrored by the rules baseline in src/engine/extract.ts. Read before proposing, reviewing or editing units.
---

# Unit authoring

A knowledge unit is the smallest piece of approved content that can be cited on its own. The extraction step only **proposes** units. A named person approves them in the review queue (src/engine/workflow.ts); nothing here publishes.

## One unit is

- **One statement or one procedure.** A fact that can change on its own is its own unit. Numbered steps that only make sense together stay one procedure.
- **Typed:** `verbatim` (read exactly), `procedure` (ordered steps) or `fact`.
- **Traceable:** `source_doc` and `source_section` point at the passage it came from.
- **Owned:** `owner` is the team that keeps it true. Verbatim is owned by Compliance and approved by Legal.
- **Scoped:** `knowledge_base` decides who can search it. Openings and closings go to KB-SHARED; everything else stays in the source document's knowledge base.
- **Dated:** `effective_date`, and a `review_date` (a review note in the source wins; otherwise one year).
- **Applicable:** `applies_to` (line of business, states, plan year). Never widen applicability beyond what the source says. The extractor proposes a `tags` suggestion only when the text names a line of business, state or plan year, plus lexicon shorthand as synonyms; the author accepts it at approval or keeps the default.

## Verbatim

- Anything the source marks `Verbatim (Legal)` or `read as written` is verbatim. Copy the quoted text **exactly**: no fixing typos, punctuation or tone.
- Never paraphrase, shorten, merge or split verbatim. Legal decides wording as a whole.
- Any textual difference from an approved verbatim unit is a drift flag for Legal, whatever the similarity.

## Not units

- Coaching tips ("smile, members can hear it") and personal notes.
- Lifecycle notes ("RETIRED, do not use"): send to the owner as a possible retirement, do not extract.
- Fragments too short to stand alone.

## Compare before proposing

1. Same section of the same document as last time, unchanged: nothing to review.
2. Same section, changed text: propose a **revision** of the unit it feeds, with the word diff.
3. Matches an approved unit exactly: link it, nothing to review.
4. Close to an approved unit (same topic, reworded): propose a revision or suggest a **merge**; do not create a second unit.
5. Packs several statements, one of which is already its own unit: suggest a **split**.
6. Otherwise: propose a **new** unit.

## Never

- Invent content the source does not say, including for gaps. The gap analyst groups questions; a person writes the answer.
- Approve, reject, merge, split or change access. Agents and models propose; people decide.
- Put PHI or member details in a unit. Units are about plans and processes, never about a person.
