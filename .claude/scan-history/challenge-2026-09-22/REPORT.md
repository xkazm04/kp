# /scan-sweep 3.4.0 `--challenge` — kp, 2026-09-22

Method: full (strategy: challenge, cohort 6, lenses architecture-challenger + ux-elevation).
Registry: software-engineering + recruiting subjects read per scout (named on each card).
Deck approval: in advance (operator asked for execution). Excluded: none.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1 (independent, never saw scout reasoning).

## Scores

| | |
| --- | --- |
| idea_score (critic, 12 cards) | ambition **3.75** / grounding **4.83** / falsifiability **4.25** |
| premise false / void / revise | 0 / 0 / 2 |
| execution_score = flawless / approved | **7 / 12** (5 / 12 strict — see below) |
| landed / partial / demoted / reverted | 11 / 1 / 0 / 0 |
| acceptance cases | 97 written, 94 red before, 97 green after |
| integration failures / coordinator fix commits | 6 / 5 |
| lines changed (builders' own count) | 6,138 over 160 file-touches; tree diff 125 files +5,478 / -582 |
| tokens | scouts 1.33M, critic 0.23M, builders 2.28M |
| wall clock | ~118 min (21:25 overlay commit -> 23:23 last integration commit) |

Strict vs lenient flawless: calendar-scheduling/A (2) and candidate-apply-api/B (1) wrote
no-regression guard cases that were green before by design. Counting them against
"every case red-before" gives 5/12; counting only cases that assert NEW behaviour gives 7/12.

## Cards

| Card | Result | Cases | Integration |
| --- | --- | --- | --- |
| calendar-scheduling/A real-duration overlap in the tx | landed | 9/11 red -> 11 | clean |
| calendar-scheduling/B revoked grant -> Reconnect | landed | 8/8 -> 8 | clean |
| candidate-apply-api/A one filing core | **partial** — CV door only | 7/7 -> 7 | clean |
| candidate-apply-api/B link recovery to address on file | landed | 6/7 red -> 7 | clean |
| candidate-channels-ui/A live relay capability | landed | 10/10 -> 10 | clean |
| candidate-channels-ui/B receiver health + pull editor | landed | 8/8 -> 8 | fix: re-typed recipe (ICON_TILE) |
| matrix-grid/A shared tier scale + per-cell band | landed | 8/8 -> 8 | clean |
| matrix-grid/B per-role slate proposal | landed | 8/8 -> 8 | clean (raised page KB ceiling itself, with why) |
| shared-api-utilities/A throwable Refusal + answerFailure | landed | 8/8 -> 8 | fix: devcase source guard pinned old expression |
| shared-api-utilities/B Retry-After from the window | landed | 7/7 -> 7 | clean |
| task-automation-engine/A TASK_KINDS vocabulary | landed | 7/7 -> 7 | fix: @ts-expect-error breached ts-debt ratchet |
| task-automation-engine/B per-candidate outcomes + scoped retry | landed | 8/8 -> 8 | fix: page.tsx KB budget |

Plus one combined-growth fix: interview-kit route KB budget (five cards' additions, no module added).

## What the six integration breaks had in common

Every one was a guard that lives OUTSIDE the folder it guards — a repo-wide ratchet
(ts-debt, recipe literals), a source-guard test in another feature folder, or an import-graph
budget measured on the whole shell. Builders ran their own folders' tests green; the combined
tree was red. The builder brief was tightened after wave 2 (full test:unit + test:perf before
the last commit); wave 3 then produced 0 test failures and 2 budget overages, both of which
the builders had reported rather than hidden.

## Perf ceilings moved by this run (each with its why in perf-budget.json)

`app/page.tsx` KB 8700 -> 8730 (three steps), `interview-kit` route KB 3000 -> 3010 and modules
225 -> 227, lifecycle approve route KB 3000 -> 3002, and named per-route module overrides for
`refusal.ts` (shared-api-utilities/A). No module ceiling on `app/page.tsx` moved. The two
pre-existing overages (llm-config 322/320, job-ingest 403/400) were red before the run and remain.

## Not verified

- UI checked by headless screenshot only (Channels in Spark Dark, Matrix in Studio Light on the
  operator's :3001 dev server; no page errors). The new receiver editor, Reconnect state, slate
  panel and scoped-retry buttons were not driven interactively.
- `npm run build` not run (the operator's dev servers hold `.next`).

## Open

- candidate-apply-api/A: the apply, quick and lead doors are not yet on `application-filing.ts`.
  The card's cases 4/6/7 contradict `apply-intake-scope.test.ts`; that is an owner call.
  Registered in `open-backlogs.jsonl` as `challenge-2026-09-22`.
