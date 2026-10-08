# Eval report: run-2026-10-08T17-15-16-706Z

Set: `data/holdout_set.json`

Engine `baseline-deterministic-0.1` · as-of 2026-10-06 · 15 serving cases, 5 authoring cases · synthetic data · smoke test, not a launch gate.

**Release: BLOCKED**

| Gate | Result |
| --- | --- |
| zero critical failures | **FAIL** |
| zero permission leaks | pass |
| verbatim 100 | **FAIL** |
| zero retired exposure | pass |
| verbatim drift flag recall 100 | pass |

## Metrics

| Metric | Value |
| --- | --- |
| critical failures | 2 |
| outcome accuracy per part pct | 66.7 |
| case accuracy pct | 66.7 |
| unit recall at 1 pct | 40 |
| unit recall at 3 pct | 60 |
| unit recall at 5 pct | 80 |
| mrr | 0.54 |
| citation accuracy pct | 100 |
| claim support pct | n/a: baseline composes extractively (unit text only); measured once a model composes |
| verbatim exact typed pct | n/a |
| verbatim exact spoken pct | n/a |
| permission leaks | 0 |
| abstention accuracy pct | 80 |
| abstention precision pct | 76.9 |
| abstention recall pct | 100 |
| retired exposures | 0 |
| phi redaction pct | n/a |
| authoring flag recall pct | 100 |
| authoring verbatim flag recall pct | 100 |
| authoring flag precision pct | 100 |
| authoring kind accuracy pct | 100 |
| authoring impact accuracy pct heuristic | 100 |
| latency ms p50 | 0 |
| latency ms p95 | 8 |

## By slice

| Slice | Cases | Correct | Critical failures |
| --- | --- | --- | --- |
| answerable | 5 | 2 | 0 |
| applicability | 2 | 2 | 0 |
| cross_team | 2 | 1 | 1 |
| decline | 7 | 7 | 0 |
| lob | 1 | 1 | 0 |
| low_keyword_overlap | 1 | 0 | 0 |
| near_topic | 1 | 1 | 0 |
| no_source | 5 | 5 | 0 |
| permissions_denied | 2 | 1 | 1 |
| plain_language | 1 | 1 | 0 |
| shared_vocabulary | 1 | 1 | 0 |
| shorthand | 1 | 0 | 0 |
| stale | 1 | 0 | 1 |
| state | 1 | 1 | 0 |
| synonym | 2 | 1 | 0 |

## By domain

| Domain | Scope | Cases | Parts correct | Critical | Leaks | Should decline | Abstention | Recall@3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Insurance advocate | KB-INS, KB-SHARED | 5 | 4/5 (80%) | 1 | 0 | 3 | 66.7% | 100% |
| Pharmacy advocate | KB-PHARM, KB-SHARED | 10 | 6/10 (60%) | 1 | 0 | 7 | 85.7% | 33.3% |

## By expected outcome

| Outcome | Cases | Correct |
| --- | --- | --- |
| answer | 5 | 2 |
| insufficient_evidence | 7 | 7 |
| not_authorized | 2 | 1 |
| stale | 1 | 0 |

## Failing serving cases

- **H01** (major) "how many days til mo shows up" as pharmacy_advocate/advocate_view: expected answer [U-PH-006], got insufficient_evidence []
- **H03** (major) "walk me through setting up home delivery" as pharmacy_advocate/advocate_view: expected answer [U-PH-005], got insufficient_evidence []
- **H05** (major) "what do i say to someone who wants to keep using their corner drug store" as pharmacy_advocate/advocate_view: expected answer [U-PH-009], got insufficient_evidence []
- **H13** (critical, CRITICAL) "is there a charge for shipping on mail order" as pharmacy_advocate/advocate_view: expected stale [], got stale [U-PH-008]
- **H15** (critical, CRITICAL) "what do i confirm with the member before we talk about their prescriptions" as insurance_advocate/advocate_view: expected not_authorized [], got insufficient_evidence []

## Authoring cases

| Case | Flag (exp/got) | Kind (exp/got) | Impact (exp/got, heuristic) | Diff |
| --- | --- | --- | --- | --- |
| A01 | true/true | near_duplicate/near_duplicate | equivalent_wording/equivalent_wording | share->give you; may->might; when->once |
| A02 | true/true | drift/drift | contradiction/contradiction | may->will not |
| A03 | false/false | formatting_only/formatting_only | none/none |  |
| A04 | true/true | drift/drift | narrowing_scope/narrowing_scope | +except in puerto rico |
| A05 | true/true | semantic_duplicate/semantic_duplicate | equivalent_meaning/equivalent_meaning | +most; prescriptions typically arrive within->orders get to members in about; after->once the doctor sends; -is received from the doctor |
