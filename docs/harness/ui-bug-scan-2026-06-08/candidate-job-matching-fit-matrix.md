# Candidate-Job Matching & Fit Matrix — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 1 med / 1 low)
> Group: Matching & Decisions | Lens mix: 2 bug / 2 ui | Files read: 13

## 1. Re-weighting blanks the whole result to the empty placeholder (no loading state)
- **Severity**: High
- **Lens**: 🎨 UI / 🐛 Bug (silent state loss)
- **Category**: Missing loading state / state thrash on common path
- **File**: `app/features/sub_match/MatchTab.tsx:52` (setResult(null)) + `app/features/sub_match/MatchTab.tsx:164-178` (render gate)
- **Scenario**: Recruiter runs a match, opens "Adjust weighting", drags a slider, clicks "Apply & re-rank". `onReweight` → `runMatchFor(matchRef, w)` which immediately runs `setResult(null)` (line 52). The parent's render is `error ? … : result ? <Results/> : <placeholder>`, so with `result === null` the entire `<Results>` subtree — including the `WeightsPanel` the user is interacting with — UNMOUNTS and is replaced by the static "Pick a candidate and run matching…" placeholder until the fetch returns.
- **Root cause**: `runMatchFor` clears `result` for every call (fresh run AND re-weight), but the JSX has no `loading` branch. The `loading` prop dutifully threaded into `<Results loading={loading} …>` (line 171) is therefore unreachable during the only window it matters — Results isn't mounted while loading is true. The same flash hits the deep-link auto-run.
- **Impact**: On a re-rank the panel the recruiter just used vanishes, the page jumps to an "empty" message that reads like the match was lost, then snaps back. Looks like a bug/data-loss; the carefully-built skeleton/`loading` plumbing never shows.
- **Fix sketch**: Add a loading branch to the gate: `loading ? <Skeleton/Results loading/> : error ? … : result ? …`. Or keep the prior `result` mounted during a re-run (don't `setResult(null)` when `result` already exists — overlay a busy state) so `<Results loading>` actually renders its in-place busy UI and `WeightsPanel` stays put.

## 2. Fit Matrix data table has no header/cell association (scope/th)
- **Severity**: High
- **Lens**: 🎨 UI (accessibility)
- **Category**: A11y — data table semantics
- **File**: `app/features/sub_matrix/MatrixTab.tsx:456` (corner `<th>`), `:460` (column `<th>` no `scope`), `:488` (row label is `<td>`, not `<th scope="row">`)
- **Scenario**: A screen-reader user lands on the core cross-tab. The column headers are `<th>` without `scope="col"`, and each candidate-row label cell is a plain `<td>` rather than `<th scope="row">`. When the user navigates into a score cell (a `<button>` inside `<td>`), the assistive tech cannot announce which candidate × which position it belongs to from table structure.
- **Root cause**: The grid is built as a visual table but skips table-header semantics. Per-cell `aria-label` (line 530) does carry "{cand} to {title}: match N" — so individual cells are partly rescued — but the column header buttons, the corner cell, and row navigation rely on missing `scope`/`th`, and the `ColumnStats` distribution strip (the MAT2 feature) is `aria-hidden` with only a `title`, so its data never reaches a screen reader at all.
- **Impact**: The headline comparison surface is largely unusable structurally for AT users; column/row context is lost on a grid whose entire value is cross-referencing rows against columns.
- **Fix sketch**: Add `scope="col"` to the position `<th>` (line 460), change the candidate label `<td>` (line 488) to `<th scope="row">`, and surface a concise textual summary of `ColumnStats` (e.g. an `sr-only` "best X, median Y, Z strong") instead of relying solely on the `title` on an `aria-hidden` strip.

## 3. Bulk "Add selected" lookups can target the wrong candidate/position on duplicate ids
- **Severity**: Medium
- **Lens**: 🐛 Bug (data integrity / ambiguous lookup)
- **File**: `app/features/sub_matrix/MatrixTab.tsx:199-207`
- **Scenario**: In matrix select-mode, `addSelected` splits each cell key `candId|posId` and resolves the cell score with `data.candidates.find(...)` / `data.positions.find(...)` AND separately `findIndex(...)` to index back into `data.cells[ri][ci]`. Two independent `find`/`findIndex` passes are used to get the same row/column; if the candidate/position arrays ever contain a duplicate id (a real risk: matrix profiles come from `listMatrixProfiles` and positions from pipeline entries that "can reference DB-ingested jobs absent from the static corpus" per the route comment), `find` and `findIndex` agree but the *cell grid* is keyed by the producer's ordering — and a `score` of `null`/blocked is silently coerced to `matchScore: null` and filed into the pipeline anyway.
- **Root cause**: The score handed to `postPipelineAdd` is recomputed by index lookup (`data.cells[ri]?.[ci]?.score ?? null`) at add time instead of being captured from the cell the user actually clicked. A blocked cell can't be selected (guarded by `selectable`), but the `?? null` fallback means any lookup miss writes a null match score rather than failing the add.
- **Impact**: Edge-case duplicate ids → wrong/blank `matchScore` persisted to a pipeline entry; the recruiter sees a candidate filed with no/incorrect fit score. Degraded data, not a crash.
- **Fix sketch**: Carry the `{candId, posId, score}` snapshot in the selection set (or look it up once via the same index used for selection), and treat a `null` score lookup as a failure (`failed.add(key)`) rather than persisting `matchScore: null`.

## 4. Even-count median can land between legend bands; "best" picks an unsorted-edge value safely but median rounding under-reports
- **Severity**: Low
- **Lens**: 🐛 Bug (stats edge) / 🎨 polish
- **File**: `app/features/sub_matrix/matrix-stats.ts:36-38`
- **Scenario**: For an even number of scored cells, `median = Math.round((sorted[mid-1] + sorted[mid]) / 2)`. With two scores like `71` and `72`, the median rounds to `72` and the strip shows "~72" with a moss tint, implying the column clears the STRONG_THRESHOLD (72) at its midpoint when in fact only half the pool is strong. The rounded median can also disagree with which histogram band the true 50th-percentile sits in.
- **Root cause**: Midpoint averaging + `Math.round` collapses a band-straddling pair to a single (sometimes up-rounded) integer, with no tie/half handling, so the at-a-glance "median" can cross the strong line the buckets don't actually support. (Empty-column and divide-by-zero paths are correctly guarded by the early `scores.length === 0` return and `Math.max(...buckets, 1)` in the renderer — verified, not a bug.)
- **Impact**: Cosmetic-to-mild misread of pool depth on small even columns; no crash, numbers are internally close. Low because the histogram + strong-count beside it give the honest picture.
- **Fix sketch**: Either floor the even-count median (report the lower of the two midpoints) or surface it as a non-rounded one-decimal value so it can't silently cross STRONG_THRESHOLD; optionally tint the median chip by `cellClass`-equivalent band of the raw value rather than the rounded one.
