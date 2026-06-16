# Code Refactor — Fix Wave 9: TS logic/dedup tail

> 12 atomic commits, 12 findings closed (Theme E/H tail — money/fairness/decision/pipeline logic dedup).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 (stable). Behavior-preserving; money/fairness paths byte-identical.
> NOTE: the implementer subagent was rate-limited on its final reply after 10 commits; the last two findings (pipeline #3, voice #3) were finished + committed directly by the orchestrator.

## Commits

| Commit | Finding | What |
|---|---|---|
| `6b2cc55` | analysis #2 | score-component descriptor derived from canonical `SCORE_COMPONENT_KEYS` (was declared 3×) |
| `d4b265b` | analytics #4 | single-sourced the diagram status→color tokens (was triplicated) |
| `3fccedc` | automation #1 | `applyFairnessVerdict` — fairness downgrade computed once for dry-run AND commit (preview provably == commit) |
| `47cd806` | automation #2 | single-sourced the stale-CAS skip handling |
| `426a7f8` | billing #2 | `splitSpend` — the included-then-credits arithmetic shared by read + write (money path identical) |
| `8b54c2d` | billing #3 | `meterGate` reads billing state once (was double-read) |
| `8be4a96` | demo-sim #3 | single-sourced the sim job-scoped cohort selection |
| `062fd44` | dev-case-orch #2 | shared submission-intake + lifecycle-resume (inbound token-auth kept) |
| `e286d47` | dev-case-orch #3 | single-sourced the promote-floor resolution |
| `daadd11` | dev-case-orch #4 | single-sourced the review-gate stage predicate |
| `19c02cb` | pipeline #3 | `entryLaneKey()` — lane count + membership keyed identically (fixed a both-fields-null lane bug) |
| `b74f37f` | voice #3 | `pickDefaultProvider()` — create + simulate share the default-provider policy |

## What was fixed

The high-value items here removed **drift between a preview and its commit** (`applyFairnessVerdict`: the dry-run and the real auto-reject pass now run the identical fairness math) and **drift on a money path** (`splitSpend`: what the Billing UI shows as remaining and what `recordMeterUsage` actually debits are now one function). `pipeline #3` also closed a latent correctness bug: the board's lane *membership* filter used a 2-way fallback while the lane *count* used 3-way, so a both-fields-null entry was counted under "?" but rendered in no lane — now both use `entryLaneKey`.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 | 849 / 0 fail (stable across 3 clean runs) |

**Pre-existing flakiness observed (NOT introduced):** one full-suite run reported 6 transient failures; 3 subsequent clean runs were 849/0. A small set of tests (the implementers earlier flagged `billing-gate.test.ts`) appears to share DB state / be timing-sensitive under parallel `node --test`. Worth a dedicated test-isolation follow-up — unrelated to these refactors (all isolated dedups, tsc 0).

## Patterns established (catalogue item 10)

10. **A preview/commit pair (dry-run vs commit, UI-remaining vs debit) MUST share one function.** When the same decision is computed in two code paths, they WILL drift — and on fairness/money paths that drift is a correctness bug, not just maintenance debt. Extract the shared computation so the preview is provably the commit.

## What remains

Final cleanup wave (Wave 10): remaining TS/Python small dedups + stale comments/over-exports, plus documenting the items the subagents flagged as intentional or not-safe-to-change.
