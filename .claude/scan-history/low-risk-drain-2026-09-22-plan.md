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

## Drain result

The companion [`results.jsonl`](./low-risk-drain-2026-09-22-results.jsonl)
records each disposition by original source line. This drain built 103 distinct
risk-1 findings: 100 with `gate: none` and three with contract or policy gates.
It descoped 30 findings already implemented before the drain and one duplicate.
One salary-hint
finding remains open because the board-entry projection lacks job seniority;
adding it depends on a risk-2 contract change. The backlog register now reads
348 built, 31 descoped, and 576 open out of 955 total.
