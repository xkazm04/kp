---
kind: task
status: done
opened: 2026-10-06
charter: codebase-static-analysis-sweep
branch: autopilot/codebase-static-analysis-sweep-a8bed556
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: failing files of `KP_FLAKE_RERUN=0 npm run test:unit` in a linked worktree. Before: 8. After: 0 (12651/12651 tests).
---

# Unit-suite triage — 8 red files to 0

Method as in `2026-10-06-static-analysis-sweep.md`: measure the whole suite, find the
commit that turned each file red, classify it, fix it by class, one commit per cause.
Measured in the linked worktree at `2ef749b3a` (`node_modules` is a junction, so
`scripts/test-alias-loader.mjs` routes `next/server` to the shim).

## Before / after

| Run | tests | pass | fail | failing files |
| --- | --- | --- | --- | --- |
| before (`KP_FLAKE_RERUN=0 npm run test:unit`) | 12648 | 12638 | 10 | 8 |
| after, same command | 12651 | 12651 | 0 | 0 |

The brief listed 7 files red on main; the 8th, the one that fails only in a linked
worktree, is `app/_lib/jobseeker/enabled.test.ts` (3 tests).

## Per file

### erasure-full-scrub.test.ts — class (a), resolved as an exemption with a pin, not a scrub gap

```
these tenancy-manifest tables hold per-tenant data but erasure neither scrubs nor exempts them: job_golive_receipts
```

Cause: `dfabbdbe3` (2026-10-05, "persist go-live receipts …") added `job_golive_receipts` to
`TENANCY_SCOPED_TABLES` without classifying it for Art. 17 erasure.

Treated as a candidate-data defect until proven otherwise. The DDL
(`app/_lib/golive-receipt-store.ts:48`) is `job_id, workspace_id, attempt, state, sourced,
skipped, silver_medalists, failure_code, started_at, finished_at`: keyed to a job, no entry
id, no person column; `sourced` / `skipped` / `silver_medalists` are counts. The scrub is
entry-keyed (`scrubEntryLinkedPii`), so it has no path to the row and nothing in the row
identifies anyone. That is the same class as `interview_kits` and `job_postings`.

Fix (3f8f58313): an `ERASURE_EXEMPT` entry with that reason, and a column-set pin in
`golive-receipt-tenancy.test.ts` (new test, `PRAGMA table_info`), so a candidate-keyed
column added later fails there rather than becoming undeletable. The test's assertion was
not weakened. Doc: `docs/features/jobs/README.md` (926ed7520).

### task-outcome-summary.test.ts — class (a), product bug

```
APPLIED_VALUES covers the vocabulary automation-run.ts actually emits  →  [ 'skipped_gate_closed' ]
```

Cause: `a474100ec` (2026-10-05, "commit voice scorecard attach, gate check and approval
atomically") made the scorecard task return `applied: "skipped_gate_closed"`
(`automation-run.ts:684`), but `APPLIED_VALUES` never learned it, so the Activity ledger
rendered no outcome line for that run. The test is right.

Fix (168c354e4): add the value to `APPLIED_VALUES` and a `tasks.outcome.value.skipped_gate_closed`
entry in all four catalogs (the drawer's `pipeline.applied` copy already existed).
`npm run i18n:check` passes.

### jobseeker/enabled.test.ts — class (d), worktree only

```
error: 'NextResponse.rewrite is not a function'      (x2)
ON: module paths pass through exactly as before      expected true, actual false
```

Cause: `proxy.ts` (`8023c4699`, `04b459639`) returns `NextResponse.rewrite(...)` and the test
reads `x-middleware-rewrite` / `x-middleware-next` back. The shim had `json/redirect/next`
only, and its `next()` set no marker header. CI runs the real module, so it passes there.

Fix (88fa6a41c, in `app/_lib/testing/`): `rewrite()`, the marker headers, and the
request-header override encoding; a test in `next-server-shim.test.ts` pins them.

### unit-db.test.ts — class (b), stale test setup

```
_lib\gigs\report\report.test.ts:252: const outside = path.join(tmpdir(), `kp-outside-${process.pid}.html`);
```

Cause: `712d5b0c9` built a temp file name from `process.pid`, which the class guard in
`unit-db.test.ts` bans (pids are recycled). Not a DB, but the same hazard. Fix (50201649f):
a `mkdtemp` directory, removed in `finally`. No assertion changed; the guard is untouched.

### analyzeCvIntake.test.ts — class (b), stale test

```
the form uses the shared codec and the documented key — /restoreDraftValue\(prev, jd\)/ no match
```

Cause: `bead7bfa7` (2026-10-05, "keep picked role linked through edits, files and tab
switches") made the JD a tagged source restored via `restoreJdSource` and the reducer's
`restore` action; `restoreDraftValue(prev, jd)` is gone from `useAnalyzeForm.ts`. The
company and GitHub fields still use it.

Fix (9897aea51): assert the new call sites, keep the company/github assertions, and add a
test for what the removed line stood for (a restore fills only an empty JD source).

### loading-gap-debt.test.ts — class (c), ratchet rise

`undeclared features/hiring/decisions/docket/DocketSurface.tsx blockGap=1`. Cause:
`fd59b3b35` (The Docket). Fix (ed674f83f): the loading box is `<LoadingGap className="min-h-[24rem]" />`
(same `reveal-quiet` box, now `role="status"` with a label). Ceiling file untouched.

### recipes-literals.test.ts — class (c)

`undeclared features/library/jobs/JobsPostingModalFooter.tsx noticeAmber=1`. Cause:
`dfabbdbe3`'s Finish-sourcing button typed `border-amber-300 bg-amber-50`. Fix (f2520c208):
`BTN_SECONDARY h-9 gap-1.5 px-3 text-meta`. The button is now neutral rather than amber.
This also brought the footer's style-debt counts back to their ceilings.

### style-debt.test.ts — class (c), 7 files, 21 findings

| File | Cause commit | Fix |
| --- | --- | --- |
| `decisions/ledger/SelectCell.tsx` | `fd59b3b35` | `BTN_GHOST` on the checkbox button (also removes the bare `rounded`) |
| `hiring/schedule/ScheduleInterviewTranscriptModal.tsx` | `3b5640565` | `NOTICE()` for the unscored banner, `BTN_SECONDARY` for Re-score, `text-dial-amber` icon, below-floor `text-xs` gone |
| `hiring/schedule/ScheduleTabInterviewedList.tsx` | `3b5640565` | two chips to `rounded-md bg-dial-amber/20 text-ink`, Re-score to `BTN_SECONDARY` |
| `tools/analyze/AnalyzePriorRunsStrip.tsx` | `5866f4220` | `text-xs` / `text-sm` to `text-micro` (7 sites) |
| `tools/analyze/AnalyzeSavedJdPicker.tsx` | `bead7bfa7` | edited label to a dial-amber chip, Revert to `BTN_GHOST` |
| `tools/devcases/DevSourcePreview.tsx` | `47da85b93` | 5 buttons to `BTN_PRIMARY` / `BTN_GHOST` / `BTN_SECONDARY`, `rounded-md`, `text-micro`, amber to dial-amber / ink |
| `_components/voice/TtsComparePanel.tsx` | `3041ddf9d`, `a5ce80792` | Continue to `BTN_GHOST`, language caveat to `NOTICE()` |

Commits: 74835f5c1, 50ca3984a, 226b874db, d033baa04 (split by feature area; the test is one
file and goes green with the last). 7 product files, under the 15-file bound. No ceiling
raised; `style-debt.test.ts --tighten` found nothing to lower, so `style-debt.json` is
unchanged. Visual consequences, since nothing here was seen in a browser: the three amber
buttons are neutral, the amber chips are a dial-amber wash with ink text, and `text-xs`
text is now 14px (the floor).

## Not done, recorded

- Not verified in a browser, either theme: the restyled controls above.
- `npm run lint` prints 49 warnings (0 errors); none in a file this branch touched. The
  prior sweep's item 7 lists the app-scope ones.
- `npm run typecheck` rewrote the three `*.generated.ts` with CRLF only; restored with
  `git restore`.
- No file was quarantined, no ceiling or allowlist raised, `app/_lib/auth/` and
  `app/api/auth/` not touched.

## Acceptance

| Check | Result |
| --- | --- |
| `KP_FLAKE_RERUN=0 npm run test:unit` | 12651 tests, 0 fail, 0 cancelled, 0 skipped |
| `npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'` | 2111 tests, 0 fail |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 errors |
| `npm run i18n:check` | OK |
| `npm run docs:check:diff -- --base 2ef749b3a --head HEAD` | OK |
| `npm run commit:check` | OK |
