# Eval report: run-2026-10-08T18-03-03-752Z

Set: `data/golden_set.json`

Engine `baseline-deterministic-0.1` · as-of 2026-10-06 · 27 serving cases, 5 authoring cases · synthetic data · smoke test, not a launch gate.

**Release: PASS**

| Gate | Result |
| --- | --- |
| zero critical failures | pass |
| zero permission leaks | pass |
| verbatim 100 | pass |
| zero retired exposure | pass |
| verbatim drift flag recall 100 | pass |

## Metrics

| Metric | Value |
| --- | --- |
| critical failures | 0 |
| outcome accuracy per part pct | 96.4 |
| case accuracy pct | 96.3 |
| unit recall at 1 pct | 94.1 |
| unit recall at 3 pct | 100 |
| unit recall at 5 pct | 100 |
| mrr | 1 |
| citation accuracy pct | 100 |
| claim support pct | n/a: baseline composes extractively (unit text only); measured once a model composes |
| verbatim exact typed pct | 100 |
| verbatim exact spoken pct | 100 |
| permission leaks | 0 |
| abstention accuracy pct | 100 |
| abstention precision pct | 100 |
| abstention recall pct | 100 |
| retired exposures | 0 |
| phi redaction pct | 100 |
| authoring flag recall pct | 100 |
| authoring verbatim flag recall pct | 100 |
| authoring flag precision pct | 100 |
| authoring kind accuracy pct | 100 |
| authoring impact accuracy pct heuristic | 100 |
| latency ms p50 | 0 |
| latency ms p95 | 7 |

## By slice

| Slice | Cases | Correct | Critical failures |
| --- | --- | --- | --- |
| applicability | 4 | 4 | 0 |
| conflict | 1 | 1 | 0 |
| gap | 6 | 6 | 0 |
| insurance | 1 | 1 | 0 |
| member | 1 | 1 | 0 |
| multi_part | 1 | 0 | 0 |
| multichannel | 1 | 1 | 0 |
| no_parametric_answers | 1 | 1 | 0 |
| org_speak | 1 | 1 | 0 |
| permissions | 2 | 2 | 0 |
| pharmacy | 2 | 2 | 0 |
| phi | 2 | 2 | 0 |
| regression | 4 | 4 | 0 |
| retired_check | 1 | 1 | 0 |
| safety | 1 | 1 | 0 |
| shared | 2 | 2 | 0 |
| speech_error | 3 | 3 | 0 |
| stale | 2 | 1 | 0 |
| verbatim | 6 | 6 | 0 |
| voice | 4 | 4 | 0 |

## By domain

| Domain | Scope | Cases | Parts correct | Critical | Leaks | Should decline | Abstention | Recall@3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Insurance advocate | KB-INS, KB-SHARED | 3 | 3/3 (100%) | 0 | 0 | 1 | 100% | 100% |
| Member chat (self-service) | KB-PHARM, KB-INS | 5 | 5/5 (100%) | 0 | 0 | 2 | 100% | 100% |
| Pharmacy advocate | KB-PHARM, KB-SHARED | 19 | 19/20 (95%) | 0 | 0 | 9 | 100% | 100% |

## By expected outcome

| Outcome | Cases | Correct |
| --- | --- | --- |
| answer | 15 | 14 |
| conflict | 1 | 1 |
| insufficient_evidence | 6 | 6 |
| needs_clarification | 1 | 1 |
| not_authorized | 2 | 2 |
| safety_escalation | 1 | 1 |
| stale | 1 | 1 |

## Failing serving cases

- **G17** (major) "how long does mail order take and is shipping free" as pharmacy_advocate/advocate_view: part 2 "shipping cost": expected stale [U-PH-008], got insufficient_evidence []

## Authoring cases

| Case | Flag (exp/got) | Kind (exp/got) | Impact (exp/got, heuristic) | Diff |
| --- | --- | --- | --- | --- |
| A01 | true/true | near_duplicate/near_duplicate | equivalent_wording/equivalent_wording | share->give you; may->might; when->once |
| A02 | true/true | drift/drift | contradiction/contradiction | may->will not |
| A03 | false/false | formatting_only/formatting_only | none/none |  |
| A04 | true/true | drift/drift | narrowing_scope/narrowing_scope | +except in puerto rico |
| A05 | true/true | semantic_duplicate/semantic_duplicate | equivalent_meaning/equivalent_meaning | +most; prescriptions typically arrive within->orders get to members in about; after->once the doctor sends; -is received from the doctor |
