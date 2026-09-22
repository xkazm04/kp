# Low-risk backlog drain, wave 2 — 2026-09-22

Source: [`leftover-develop-2026-09-17.jsonl`](./leftover-develop-2026-09-17.jsonl), using the full [`risk-sorted.csv`](./leftover-develop-2026-09-17-risk-sorted.csv) priority index and the first-wave [`results.jsonl`](./low-risk-drain-2026-09-22-results.jsonl) ledger.

At the start of this wave, 576 findings remain open. The source has 51 risk-1 entries not yet built or descoped (46 `gate: none`, five `contract`); one of the 46 is already deferred until a risk-2 board projection is available. The next eligible cohort is therefore the remaining risk-1 findings, then risk-2 `gate: none` entries in index order. The target is 100 **additional distinct built findings**. Items already implemented, duplicates, unverifiable contracts, and dependencies are recorded separately and do not advance that count.

Execution:

1. Recheck the finding against the current tree and source line before editing.
2. Apply and verify one finding at a time, with one pathspec-only commit per genuine finding. Keep the four concurrent work areas disjoint; coordinate shared catalogs.
3. Log built, descoped, and deferred dispositions beside the source backlog. Reconcile the register from actual ledger counts, then run the available repository gates.

Pre-existing workspace state to preserve: modified `next-env.d.ts` and untracked `kpi-sim/`. The latter is included by root TypeScript and ESLint scans and already makes those whole-tree gates red. The first wave also observed unrelated failures in `i18n:check`, `guidance:check`, and the full unit suite; focused checks remain required for each fix.
