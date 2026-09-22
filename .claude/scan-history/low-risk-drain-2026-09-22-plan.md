# Low-risk backlog drain — 2026-09-22

Source: [`leftover-develop-2026-09-17.jsonl`](./leftover-develop-2026-09-17.jsonl),
registered in [`open-backlogs.jsonl`](./open-backlogs.jsonl). The companion
[`risk-sorted.csv`](./leftover-develop-2026-09-17-risk-sorted.csv) is the full
710-item order, with the original source line retained for stable lookup.

| Risk | Findings |
| ---: | ---: |
| 1 | 185 |
| 2 | 377 |
| 3 | 99 |
| 4 | 30 |
| 5 | 12 |
| 6 | 7 |

Order: ascending risk, then `gate: none` before items needing a contract or
policy decision, then S before M before L, then descending impact, then original
source line. Risk 1 contains 175 `gate: none` items, enough to select 100
without spending a decision reserved for the operator.

Execution plan:

1. Audit each candidate against the current tree. A previously implemented or
   invalid finding is recorded as stale/descoped and does **not** count toward
   the 100 requested fixes.
2. For each genuine finding, add the smallest behavior change and evidence that
   distinguishes before from after. Follow the repo's doc-sync and locale rules.
3. Make one pathspec-only commit per finding. Run focused checks after each,
   then the available repository gates after the batch.
4. Record built, stale, and deferred dispositions beside the source backlog,
   reconcile the open-backlog register, and leave higher-risk work open.

The sorted file is a **priority index**, not a promise that every earlier row
is still actionable. The execution count advances only for verified changes.
