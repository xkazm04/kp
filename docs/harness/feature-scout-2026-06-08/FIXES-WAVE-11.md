# Feature Scout Fix Wave 11 — Bulk-shortlist from the Fit Matrix (MAT3 matrix half)

> 1 commit — completes MAT3 (the Match-results half shipped in Wave 1). First wave committed directly on `main` (post-merge).
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `f8c61b8` | **MAT3** (matrix half) — bulk-shortlist from the Fit Matrix | `MatrixTab.tsx` |

## What was shipped

The matrix could only navigate to a single match per cell — no way to act on the
cross-tab read of a whole pool. Adds a **"Shortlist" mode**: in it a cell click
toggles selection (coral ring + check) instead of navigating, and an action bar
files every selected (candidate → that position) into the pipeline at Screened in
one pass — sequentially, reusing the canonical `postPipelineAdd` so the matrix add
can't drift from the Match-side one. Only scored, not-already-in-pipeline cells are
selectable; successes ring locally (the matrix doesn't refetch placements), failures
stay selected for a one-click retry, and an aria-live region announces the outcome.

This closes MAT3 across both surfaces (Match results, Wave 1 `6995bba` + Fit Matrix,
here) — the same `postPipelineAdd` powers all four add surfaces now (recruiter
candidates, rediscovery, match results, matrix).

## Verification

| Gate | Baseline | After Wave 11 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## What remains (matrix follow-ups)

- **MAT4 (matrix half)** — CSV export of the fit matrix (the Match-results CSV shipped
  in Wave 3).
- **MAT6** — dimension-sort + minimum-fit filter (Low).
- **MAT2 row counterpart** — how many roles a candidate is strong for.

## Session-wide remaining

- Heavyweight: **VOX2** (live co-pilot).
- Cross-surface: human scorecards → Decisions/compare grids (PREP1 follow-up).
- Med/Low config + polish: PIPE4, SCH4, DEC5, VOX5, PREP4, PREP5, PIPE5, JOB5, MAT6,
  DEC6, dedup-by-email, matrix-CSV, all-tabs PDF, VOX4.

## Branch / merge note

Committed on `main` (the Feature Scout branch was merged before this wave). `main` is
now 40 commits ahead of `origin/main` — unpushed. The pre-existing idea-batch WIP
remains uncommitted in the tree, untouched.
