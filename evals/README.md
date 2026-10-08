# Evals

```
node evals/run.ts --label <name>     # Node 22.18+ runs the TypeScript directly, no install
```

Runs the golden set (`data/golden_set.json`, serving) and the authoring set (`data/authoring_cases.json`, dedup and drift) against the engine in `src/engine/`, then writes:

- `evals/results.json`: every metric from FOUNDATIONS section 13, per slice and per expected outcome, plus each case with its full 13-step trace
- `evals/REPORT.md`: the same, readable
- `evals/runs/<label>.json`: an archived copy, so every run in `FAILURES.md` can be checked

The process exits with code 1 when a release gate fails: any critical failure, any permission leak, verbatim below 100% (typed or spoken), any retired unit cited, or verbatim drift flag recall below 100%.

## Rules

- Results are whatever the engine produced. Never edit them by hand.
- Every failure gets a write-up in `FAILURES.md`: symptom, root cause, change, regression case.
- A fix that only makes one case pass, with no evidence beyond it, stays open (see F05).
- A model replaces a baseline step only if it passes the same sets with no new critical failures.
- 25 serving cases is a smoke test. A production gate needs 300 to 500 stratified cases, including a held-out set written by someone who has not seen the engine.

## What the baseline is

`baseline-deterministic-0.1` has no model calls. Query understanding is the lexicon plus a rule-based split, safety is a pattern list, and composition is extractive (unit text only). That makes it the floor that model-backed steps have to beat, and it keeps the demo running offline.
