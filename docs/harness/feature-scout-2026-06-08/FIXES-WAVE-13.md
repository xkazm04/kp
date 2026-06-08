# Feature Scout Fix Wave 13 — Export the Fit Matrix as CSV (MAT4 matrix half)

> 1 commit on `main`. Closes MAT4 and the Fit Matrix's scan opportunities entirely.
> Baseline preserved: tsc 0 → 0 · unit 635 → 635 · python 490 → 490 · next build ✓.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `321a16f` | **MAT4** (matrix half) — export the fit matrix as CSV | `MatrixTab.tsx` |

## What was shipped

The matrix couldn't leave the app — sharing the grid meant a screenshot. An
"Export CSV" button downloads the grid **as shown**: the visible columns × the
filtered+sorted rows (honoring the family filter, min-fit floor, and active sort),
candidate label + per-position score, blocked/unscored cells as "–". Reuses the
shared `toCsv`/`downloadFile` from `export-utils` (Wave 3) — no backend. Filename
reflects a scoped view (`fit-<role>.csv`) vs the full grid (`fit-matrix.csv`).

## Verification

| Gate | Baseline | After Wave 13 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 635 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Fit Matrix — COMPLETE

Every Fit-Matrix opportunity from the scan is now shipped:
- **MAT2** — column distribution (W7) + per-candidate row strong-count (W12)
- **MAT3** — bulk-shortlist, both halves (W1 Match + W11 Matrix)
- **MAT4** — CSV export, both halves (W3 Match + W13 Matrix)
- **MAT6** — min-fit filter + sort-by-column (W12)

(MAT1 recruiter weighting and MAT5 compare-jobs-for-one-candidate live on the Match
tab, not the Matrix; MAT1 shipped W6, MAT5 remains a Med follow-up.)

## Session-wide remaining

- Heavyweight: **VOX2** (live co-pilot — needs in-flight transcript streaming).
- Cross-surface: human scorecards → Decisions/compare grids (PREP1 follow-up).
- Med/Low: PIPE4, SCH4, DEC5, VOX5, PREP4, PREP5, PIPE5, JOB5, DEC6, MAT5,
  dedup-by-email, all-tabs PDF, VOX4.

## Branch / merge note

Committed on `main` (post-merge). `main` now 44 commits ahead of `origin/main`,
unpushed. Pre-existing idea-batch WIP untouched.
