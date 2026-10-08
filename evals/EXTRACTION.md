# Extraction check

Extractor `rules-v0` (rules baseline; the model extraction agent plugs in behind the same function and must beat this). Match threshold 0.4 on content-word overlap, chosen once on these three synthetic documents, not tuned per case.

**Unit recall: 11 of 13 approved units recovered from their source documents (85%).** 16 candidates, 3 proposed as new, 2 lines skipped (coaching tips, retirement notes, fragments).

| Document | Candidates | Unchanged | Changed (flagged) | New | Approved units recovered | Missed |
| --- | --- | --- | --- | --- | --- | --- |
| KB-INS-0057 | 2 | 1 | 1 | 0 | 2 of 2 | none |
| KB-PHARM-0098 | 5 | 2 | 1 | 2 | 1 of 1 | none |
| KB-PHARM-0142 | 9 | 3 | 5 | 1 | 8 of 10 | none |

**With reviewer suggestions: 13 of 13.** The remaining units are found as merge or split suggestions a reviewer accepts in the queue: U-PH-002 via merge, U-PH-007 via split.

Misses are units whose approved wording was rewritten at authoring time (for example U-PH-002, identity verification), so the source line overlaps too little to link, and U-PH-007 (90-day supply), which is one clause inside a longer source line that the rules extractor keeps whole (it links to U-PH-004). The rules extractor proposes the first as new and misses the second; a reviewer would catch both. This is the case the model extraction agent is for.

Re-ingesting an unchanged document raises no flags (the store keeps a per-section snapshot of each source), and one edited line raises exactly one flag routed to its owner (`tests/workflow.test.ts`).
