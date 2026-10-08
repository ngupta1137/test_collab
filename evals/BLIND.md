# Blind evaluation

**Why:** the golden set and the engine were written by the same hands, and every fix in `FAILURES.md` F01 to F07 was made while looking at it. A 93% pass there proves less than it seems. So a separate agent wrote 30 new cases from the spec and the knowledge data alone. It had no access to the engine code, the golden set, the failure write-ups or any eval output. Its file is `data/blind_set.json` (author field says so). One disclosure: its brief included the F01 rule (recency only through an explicit supersedes link), which is a pending spec change.

## Result

| Run | Engine change | Golden set accuracy | Blind accuracy | Blind critical failures |
| --- | --- | --- | --- | --- |
| blind-01 | none (true blind score) | 92.9% | **39.4%** | **9** |
| blind-02 | F08 to F11 (genuine bugs only) | 92.9% | 51.5% | 5 |

Blind-02 is no longer a blind score for the cases that informed F08 to F11.

## What the failures say

| Cause | Cases after fixes | What fixes it |
| --- | --- | --- |
| Conversational phrasing defeats the keyword relevance gate; right unit often ranked first anyway | B02, B03, B04, B05, B07, B09, B10, B12, B13, B18, B19, B23 | Embeddings in the search step + model query agent (F12) |
| Routing index misses a paraphrased restricted topic ("primary doctor", "script your agents read") | B20, B21 | Same: semantic match on the routing index |
| Case ambiguity: voice channel, engine cited U-PH-004 (also says 90 days) instead of U-PH-007 | B11 | Blind author noted U-PH-004 is acceptable; left as a failure, not edited |

Nothing failed in the dangerous direction: no permission leaks, no retired or duplicate unit served, no answer where the case expected abstention. The engine fails safe, by declining.

## Threshold sweep: why this isn't a tuning problem

| Coverage gate | Golden accuracy | Golden critical | Blind accuracy | Blind critical | Answered when it should have abstained (golden + blind) |
| --- | --- | --- | --- | --- | --- |
| 0.50 (current) | 92.9% | 0 | 51.5% | 5 | 0 |
| 0.40 | 92.9% | 0 | 54.5% | 4 | 0 |
| 0.30 | 89.3% | 0 | 63.6% | 3 | 3 |
| 0.20 | 82.1% | 1 | 63.6% | 3 | 4 |
| 0.15 | 82.1% | 1 | 69.7% | 2 | 5 |

Lowering the gate buys blind accuracy by answering questions that should be declined. No setting reaches zero critical failures on the blind set. The gate stays at 0.5, because declining is the safe failure for a compliance product.

## What this means for the deck

The deterministic baseline is the floor: safe, auditable and offline, but brittle on real phrasing. That is exactly where the model steps sit in the architecture (step 4 query understanding, and embeddings in step 6), and this set is now their acceptance test. Once it has been used to tune them, a fresh blind set gets written.
