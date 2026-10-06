---
kind: task
status: done
opened: 2026-10-07
charter: codebase-security-scan
branch: autopilot/codebase-security-scan-ea6fb1db
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: a machine never counts an AI agent as a hire (scan fixes 1-4).
---

# A machine never counts an AI agent as a hire

Reconcile: `git log 557c9bf5c..HEAD` was empty, so nothing was narrowed.
`check-budget.mjs --json` read 0 findings before and after.

## What changed

- **Predicate (core.ts).** `isAgentPopulation(entry)` and `notAgentSql(alias?)`
  beside `coerceSlatePopulation`. Every site below uses one of them.
- **Fix 2 — `placeAgentOnBoard`** passes `population: 'agent'`. Boot fixup in
  core.ts beside the `approval_detail` UPDATE sets `population='agent'` for
  `source_channel='agent-bridge' AND candidate_id LIKE 'agent-%'`. `candidateId`
  unchanged; no merge with the `agent-fit-<jobId>` entry (later increment).
- **Fix 1 — `runRoleFillHook`** skips an agent with the new reason
  `agent_population`. `listJobPipelineStats` counts no agent in `hired`; `total`
  and `reachedInterview` are deliberately unchanged (the agent IS on the role's
  board and past screening; only "hired" is a claim about a person).
- **Fix 3 — `listActiveEntriesForAutomation`** SELECTs `population`
  (`rowToEntry` already maps it).
- **Analytics.** `notAgentSql()` on every `pipeline_entries` read feeding the
  cohort (the three `ROW_COLUMNS` reads, the prior-window cap read, the source /
  decision joins) and on both `hiresClosedInWindow` queries (the event-only one
  via an `entry_id IN (SELECT id ...)` subquery). So `hired`, `hiresClosedInWindow`,
  time-to-hire, `costPerHireCzk` and the per-role funnel count no agent.
- **Fix 4 — `listWorkspaceHires`** excludes agent rows (no hire count, no rating queue).
- Doc: one subsection in `docs/features/pipeline/README.md`. No ADR touched.

## Tests, red first (source reverted, tests run, source restored)

Red then green: `an agent on the terminal column is not a hire`,
`a human hire beside an agent on the terminal column closes the role at the right count`
(stage-hooks-role-fill); `placeAgentOnBoard files the card as an agent on both moves, and it has no mailbox`
(lifecycle); `an agent on the terminal column does not move hired …` (pipeline-job-stats);
`the projection carries population …` (pipeline-automation-input);
`an agent on the terminal column moves neither hired nor hiresClosedInWindow`
(analytics-hire-basis); `listWorkspaceHires: an agent on the terminal column is not a hire …`
(outcomes-route). **Boot fixup: no test** — no existing fixup has one (the boot
path is only exercised by the child-process `core-empty-boot.test.ts`).

## Perf

`node scripts/perf/check-budget.mjs --json`: 0 findings before; 0 after, in the
worktree. `perf-budget.json` unchanged. `npm run test:perf` green.

## Gates

typecheck, lint (0 errors), docs:check, test:perf pass; the acceptance unit
globs pass (3041/3041). `schemas:gen` rewrote three `*.generated.ts`; restored.

## Remaining from the scan (untouched)

- Fix 5 — the interview/homework arrival hooks park an agent as `unaddressable`.
- Fix 6 — `candidate-next-action-server.ts` drops `population` (narrow param type).
- Fix 7 — `AtsCandidateRecord` has no population field (owner call: field vs refuse).
- Adjacent defect: `listJobPipelineStats` has no `status` filter, so a rejected
  or withdrawn human on the terminal column still counts as `hired` there (the
  hook guards its own arriving entry, the roll-up does not).
