# Feature Scout Fix Wave 12 — Matrix navigation: min-fit + sort-by-column + strong-count (MAT6, MAT2 row)

> 1 commit on `main`. Closes MAT6 and the MAT2 row counterpart.
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `244c133` | **MAT6** (min-fit filter + sort-by-column) + **MAT2 row counterpart** (per-candidate strong-count) | `MatrixTab.tsx` |

## What was shipped

- **MAT6 — min-fit filter + sort-by-column.** The matrix sorted only by best-overall
  fit / A–Z and showed every candidate regardless of score. Adds a **"Min fit" floor**
  (Off / ≥55 / ≥70) that hides rows whose best *visible* score is below it (the count
  chip shows "N of M"), and **clickable column headers** to rank candidates by their
  fit for that specific role (click again to clear; the fit/A–Z toggle also clears it,
  and a column sort is ignored if a family filter hides that column). On a real pool
  the grid is mostly weak cells — these make the promising rows jump out.
- **MAT2 row counterpart.** Each candidate's name cell carries an "N★" pill — how many
  *visible* roles they're a strong fit for (`>= STRONG_THRESHOLD`, the same bar the
  per-column histogram uses) — a versatile-vs-niche read per candidate, mirroring the
  column distribution shipped in Wave 7.

All client-side over on-screen data — no schema, no Python.

## Verification

| Gate | Baseline | After Wave 12 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Matrix status

The Fit Matrix is now substantially complete: MAT2 (column distribution, W7) + MAT2
row counterpart (W12) + MAT3 (bulk-shortlist, both halves: W1 + W11) + MAT6 (W12). The
**lone matrix follow-up** left is **MAT4-matrix** — CSV export of the grid (the
Match-results CSV shipped in Wave 3); `toCsv`/`downloadFile` already exist in
`export-utils`, so it's a small wiring job.

## Session-wide remaining

- Heavyweight: **VOX2** (live co-pilot).
- Cross-surface: human scorecards → Decisions/compare grids (PREP1 follow-up).
- Med/Low: PIPE4, SCH4, DEC5, VOX5, PREP4, PREP5, PIPE5, JOB5, DEC6, MAT4-matrix,
  dedup-by-email, all-tabs PDF, VOX4, MAT5 (compare-jobs-for-one-candidate).

## Branch / merge note

Committed on `main` (post-merge). `main` now 41 commits ahead of `origin/main`,
unpushed. Pre-existing idea-batch WIP untouched.
