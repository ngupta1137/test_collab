# Hybrid ranking: building the vectors on your own machine

The engine ranks by keyword and lexicon today. The embedding half is built and switched off until `data/embeddings.json` exists. It only re-orders candidates the caller is already entitled to see. Answer and decline gates still come from the keyword side, so a vector can never open an answer or reach a model out of scope.

## Build (once, about a minute)
```
npm install --no-save @huggingface/transformers
npm run embed
```
Needs internet once to download `Xenova/all-MiniLM-L6-v2` (about 25 MB). The model then runs locally; no key, no data leaves the machine.

## Measure honestly
```
VERITY_NO_VECTORS=1 npm run eval          # keyword baseline
npm run eval                              # hybrid ranking (uses data/embeddings.json when present)
VERITY_SEMANTIC_GATE=0.45 npm run eval    # experimental gate
VERITY_NO_VECTORS=1 node evals/run.ts --set data/blind_set.json --label blind-kw
node evals/run.ts --set data/blind_set.json --label blind-hybrid
```
Keep hybrid only if the golden set still passes with 0 critical failures and the blind set does not get worse. `VERITY_HYBRID_WEIGHT` (default 0.5) sets the share of rank given to meaning. If a number gets worse, log it in `evals/FAILURES.md`.

## Measured result (MiniLM vectors, 14 units, synthetic data)
| Setting | Golden parts | Golden critical | Blind parts | Blind critical | Blind recall@3 |
|---|---|---|---|---|---|
| Keyword only | 96.4% | 0 | 51.5% | 5 | 76.5% |
| Hybrid ranking only | 96.4% | 0 | 51.5% | 5 | 82.4% |
| Hybrid + semantic gate 0.45 (experimental) | 96.4% | 0 | 60.6% | 2 | 82.4% |
| Hybrid + semantic gate 0.35 (experimental) | 92.9% | 0 | 66.7% | 2 | 82.4% |

- Ranking alone improves where the right unit lands in the top three but does not change any answer or decline, because the answer gates still come from keyword coverage.
- The semantic gate (`VERITY_SEMANTIC_GATE=0.45`, margin `VERITY_SEMANTIC_MARGIN`) lets meaning alone qualify the single clearly closest entitled unit. At 0.35 it starts answering questions it should decline (golden abstention falls from 100% to 91.7%), so it is not safe that low.
- Caution: the thresholds were swept on the same 57 cases they are scored on, so these numbers are optimistic. The gate stays off by default until it passes a fresh set of unseen cases.

## Hold-out result (15 unseen cases, run once, nothing tuned)
Keyword, hybrid ranking and the gate at 0.45 all scored 66.7% outcome accuracy, 2 critical failures (F13 and F14, both unrelated to meaning-based matching), 80% abstention.
- The gate did no harm: all five should-decline cases that share vocabulary with approved units still declined, and two cases where it qualified Kentucky-only content for a Texas or PDP member (H11, H12) were stopped by the deterministic applicability step.
- The gate did no good: the two rescuable answers (H03, H05) scored 0.38 and 0.35 against the 0.45 threshold, and a third (H01) had the wrong unit narrowly ahead.
- So the 9-point blind-set gain did not replicate. It was partly fitted to the set it was tuned on, as flagged above. The gate stays off. Lowering it to the 0.35 to 0.38 band would rescue those two but sits within 0.01 to 0.03 of declined cases (H07, H09), so it needs more cases before anyone trusts it.

## Limits
- Vectors cover units and the queries in the golden set, blind set and search log. An unseen query falls back to keyword ranking (the offline demo behaves the same way as the model cache).
- A unit edited after the build is detected by hash and ranked by keyword until you rebuild.
