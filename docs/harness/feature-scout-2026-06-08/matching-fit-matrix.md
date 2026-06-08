# Feature Scout — Candidate-Job Matching & Fit Matrix (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~16

Context scanned: the Match tab (candidate → many jobs, KO-filter + multi-factor
scorer + per-match LLM reasoning) and the Fit Matrix (every candidate × every open
position, color-coded cells, click-through to a full match). The Python scorer
(`matching.py`) is unusually capable — it already carries bounded **dynamic
weighting**, a **fairness matrix**, confidence bands, and score breakdowns — but
most of that power is only surfaced in the *Decisions* group-eval, not in the Match
or Matrix surfaces a recruiter actually ranks a pool in. The opportunities below
close that gap and add the workflow verbs (shortlist, export, compare) that turn a
read-only grid into a working tool.

## 1. Recruiter-adjustable match weighting in the Match tab + Matrix
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_match/MatchTab.tsx:99` (the source/candidate controls row) and `pipeline/jobfit/matching.py:568` (`score_job(..., weights=)`)
- **Gap**: `score_job` already accepts a resolved `weights` vector, and `resolve_weights`/`weight_bounds` (`matching.py:447-488`) enforce a fair bounded simplex — yet `match_cli.py` and `matrix_cli.py` never pass weights, and `/api/match` (`route.ts:38`) only forwards `--limit`. The only weighting a user ever sees is *auto-proposed* (deterministic rule or LLM) and *read-only*, buried in Decisions group-eval (`group-eval-run.ts:181`). A recruiter cannot say "for this role I care more about skills than career history" and re-rank.
- **Opportunity**: A small "Emphasis" control on the Match tab (and Matrix) — three bounded sliders or presets (Balanced / Skills-first / Potential-first) — that feeds a `weights` vector through `/api/match` into `score_job`, re-ranking live. Reuse `weight_bounds` so a slider can never erase or let a dimension dominate.
- **Why it matters**: Different roles legitimately weight skills vs. career vs. fit differently; a fixed archetype weighting forces every role through one lens. The math is already built and bounded — this is wiring, not invention.
- **Sketch**: Add `--weights skills,career,personal` to `match_cli`/`matrix_cli` → `resolve_weights` → `score_job(weights=...)`. Thread an optional `weights` field through `MatchInputBody`/`/api/match`. UI presets map to vectors; "custom" exposes the three bounded sliders.

## 2. Per-role score distribution + summary stats in the Fit Matrix
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_matrix/MatrixTab.tsx:236` (the column header row) and `app/features/sub_matrix/MatrixShared.tsx:19` (`MatrixLegend`)
- **Gap**: The matrix renders each cell's color but says nothing about the *shape* of a column — no mean, no spread, no count of strong fits, no mini-histogram. (The assignment even references an `app/_lib/distribution.ts` for "score distribution" — it does not exist; the only `distribution.ts` in the repo is the channel adapter.) A recruiter scanning a column can't tell "deep bench" from "one lucky hit."
- **Opportunity**: A compact stats strip under each position header — best score, median, count ≥ strong-threshold, and a tiny sparkline/histogram of that column's non-blocked scores. Optionally a row-level counterpart (how many roles this candidate is strong for).
- **Why it matters**: Turns the grid from "find the green cell" into a portfolio read: which roles are well-served by the pool vs. starved, and which candidates are versatile vs. niche — the core question a cross-tab matrix is supposed to answer.
- **Sketch**: Compute distribution client-side from `data.cells` (scores already present), or add a `columnStats`/`rowStats` block to `matrix_cli.py` output. Render a 6-bar inline histogram + 2-3 numbers per header; reuse `cellClass` hues for bar fill.

## 3. Bulk shortlist → pipeline from the Matrix and Match results
- **Value**: High
- **Category**: automation
- **Effort**: M
- **Where it slots in**: `app/features/sub_matrix/MatrixTab.tsx:268` (per-cell button) and `app/features/sub_match/Results.tsx:23` (`addToPipeline`, one job at a time)
- **Gap**: Adding candidates to the pipeline is strictly one-at-a-time: a matrix cell only navigates to the single match (`open()`, `MatrixTab.tsx:111`), and match results add each card individually. There is no select-many, no "add the top N", no multi-cell action — `useAddToPipeline.ts` exists but only ever fires per-candidate.
- **Opportunity**: Selection on both surfaces — checkboxes on match cards (or a "Shortlist top 5") and cell/row multi-select in the matrix — with a single "Add N to pipeline" action that POSTs the batch to `/api/pipeline` (stage Screened), reusing the existing optimistic add flow.
- **Why it matters**: Ranking a pool and then clicking "add" twenty separate times is the manual drudgery the matrix was meant to eliminate; bulk shortlisting is table-stakes for an ATS.
- **Sketch**: Track a `Set<cellKey|jobId>` of selections; a sticky action bar runs `postPipelineAdd` (`useAddToPipeline.ts:57`) sequentially/throttled with per-item success/failure, mirroring the existing `added`/`adding`/`errors` state in `Results.tsx`.

## 4. Export ranked matches and the fit matrix (CSV / copy)
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where it slots in**: `app/features/sub_match/Results.tsx:66` (results header chips) and `app/features/sub_matrix/MatrixTab.tsx:127` (matrix toolbar)
- **Gap**: Neither surface can leave the app — no CSV, no copy-to-clipboard, no download. A recruiter who wants to share a ranking with a hiring manager has nothing but a screenshot. (Grep confirms no `download`/`csv`/`clipboard` in `sub_match` or `sub_matrix`.)
- **Opportunity**: An "Export CSV" / "Copy" button on both. For matches: rank, title, total, confidence band, fit tier, matched/missing skills. For the matrix: candidates × positions score grid (blocked cells as "–").
- **Why it matters**: Hiring decisions happen in meetings and email threads outside the tool; an un-exportable ranking dies in the tab. Cheap, high-utility, fully client-side from data already on screen.
- **Sketch**: Build a CSV string from `result.matches` / `data.cells`, `Blob` + `URL.createObjectURL` for download (or `navigator.clipboard.writeText`). No backend change.

## 5. Compare-jobs view for one candidate (roles side-by-side)
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_match/Results.tsx:98` (the ranked `<ol>` of `MatchCard`s)
- **Gap**: Decisions group-eval compares many *candidates* for one role (`group-eval-run.ts`), but nothing compares many *roles* for one candidate. The match list is a vertical scroll of cards; you can't put two roles' score breakdowns and skill gaps next to each other to advise a candidate "apply to A, not B."
- **Opportunity**: Select 2-3 match cards → a side-by-side panel aligning their `scoreBreakdown` dimensions, matched/missing skills, salary band, and confidence band — the role-for-candidate mirror of the existing candidate-for-role compare.
- **Why it matters**: Recruiters and candidates both need "which of these roles fits best, and why" at a glance; today that means eyeballing cards one above another. All the data per card already exists.
- **Sketch**: Add a "compare" checkbox to `MatchCard`; render a transposed table of the selected `MatchResult`s reusing `ScoreBreakdown` rows aligned by `dim.key`. Pure client; no new endpoint.

## 6. Dimension-sort and minimum-fit filter in the Matrix
- **Value**: Low
- **Category**: functionality
- **Effort**: S
- **Where it slots in**: `app/features/sub_matrix/MatrixTab.tsx:99` (`rows` sort uses only `best()`) and `MatrixTab.tsx:134` (the lone "best fit / A–Z" toggle)
- **Gap**: The matrix sorts rows only by best *overall* fit or alphabetically, and shows every candidate regardless of score. There's no way to sort by a single dimension (skills) or hide the noise below a fit floor — so a 40-row grid stays 40 rows even when only 8 clear "promising."
- **Opportunity**: A "min fit" threshold control (e.g. ≥55 / ≥70) that dims or hides sub-threshold rows, plus a sort that ranks rows by a chosen column's score. Optionally collapse fully-blocked rows.
- **Why it matters**: On a real pool the grid is mostly weak cells; a fit floor + targeted sort makes the strong candidates jump out instead of forcing a manual scan. Small, contained change to existing memoized `rows`.
- **Sketch**: Add a `minFit` state and an optional `sortCol`; extend the `rows` memo (`MatrixTab.tsx:99`) to filter on the row's best visible score and to sort by `cells[ri][sortCol]` when set. Reuse the existing toolbar styling.
