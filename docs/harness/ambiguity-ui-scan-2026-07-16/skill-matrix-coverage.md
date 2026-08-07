# Skill Matrix & Coverage — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. The matrix silently caps the candidate pool at 200 — contradicting its own "never quietly omit a row" contract
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-truncation
- **File**: `app/api/matrix/route.ts:42`
- **Scenario**: A workspace with 250 active candidates opens the Fit Matrix. `listMatrixProfiles(200, ws)` returns only the first 200; the other 50 never enter the grid. The count line renders `250 candidates`? No — it renders `data.candidates.length`, which is already the capped 200, so the recruiter sees "200 candidates" and believes that is the whole pool.
- **Root cause**: The `200` is a bare positional magic number with no accompanying "total vs shown" signal. The route goes to great lengths to surface `missing` (unscorable positions) and `missingCandidates` (profiles that failed validation) so "the grid never quietly omits a row" (its own comments, lines 20-22 / 30-33), yet the hard pool cap is the one omission it stays silent about.
- **Impact**: A strong candidate ranked 201st in ingestion order is invisible to coverage analysis and shortlisting, with zero indication anyone is missing. Directly undermines the "talent-intelligence / coverage" value prop the context is named for.
- **Fix sketch**: Have `listMatrixProfiles` also return the unclamped total (or a `truncated` flag), thread it through `MatrixOut`, and render a banner like "Showing 200 of 250 candidates" alongside the existing `missing` banners. At minimum, extract the `200` to a named constant with a comment justifying the ceiling.

## 2. Per-candidate "★ strong fit" badge counts blocked cells; the per-column ★ / coverage gap does not
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-metric-definition
- **File**: `app/features/sub_matrix/MatrixTab.tsx:259`
- **Scenario**: A candidate is knock-out-blocked (language/seniority) on two roles where their raw fit still computed ≥72. The grid renders both cells as blocked "–", but the row header shows a green "2★" versatility badge claiming two strong fits.
- **Root cause**: `rowStrong` reads `data.cells[ri]?.[ci]?.score` and counts `score >= STRONG_THRESHOLD` with **no `!blocked` guard**, whereas `colScores` (line 277) and therefore the column ★ stat and the coverage-gap rollup explicitly require `!c.blocked && c.score != null`. The `Cell` type permits `{ score: number, blocked: true }`, and `cellClass` defensively handles exactly that pair — so a blocked-but-scored cell is a real shape, not impossible.
- **Impact**: The row badge and the column/coverage numbers can disagree for the same cell, and the badge can over-state a candidate as broadly strong when every "strong" cell is actually a hard reject. Misleads the versatile-vs-niche read the badge exists to give.
- **Fix sketch**: Add the same `!c.blocked` guard to the `rowStrong` loop (mirror the `colScores` predicate) so "strong fit" means one thing everywhere. Ideally factor the "is this cell a countable strong fit" test into one shared helper used by both rollups.

## 3. Min-fit floor levels (55, 70) are magic numbers unaligned with the single-sourced score bands
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-numbers
- **File**: `app/features/sub_matrix/MatrixTab.tsx:451`
- **Scenario**: A recruiter filters to "≥70" expecting to see only strong candidates, but the grid's own "strong" threshold (`STRONG_THRESHOLD`) is 72 and the moss/strong band starts at 72. So a 70 or 71 row survives the filter yet renders in the 60–71 (non-strong) band with no ★ — the floor and the color scale tell different stories.
- **Root cause**: `[0, 55, 70]` are hardcoded inline literals with no relationship to `MATRIX_BANDS`, whose edges are the deliberately single-sourced 45/60/72/85 (matrix-stats.ts). 55 lands mid-amber-band, 70 lands mid-"60–71" band; neither is a band boundary the rest of the matrix is built from.
- **Impact**: The filter thresholds don't map to any visible band or to "strong," so the floor's mental model silently conflicts with the heatmap the recruiter is reading. Re-banding the heatmap (a "one-place edit" per the comment) would leave these floors stale and even more misaligned.
- **Fix sketch**: Derive the offered floors from `MATRIX_BANDS` (e.g. the "fair" floor 45 and `STRONG_THRESHOLD` 72), or at least name them as constants next to the bands with a comment stating they intentionally differ. Aligning "≥strong" with 72 makes the floor and the ★/color scale agree.

## 4. Worked-example `total` is a hand-entered literal, not derived from the shown scores × weights
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: derivable-constant-drift
- **File**: `app/features/sub_about/StudentsAbout.tsx:92`
- **Scenario**: A maintainer tweaks one illustrative score (say Adéla's skills 82 → 90) to freshen the About example. The per-axis contribution cells recompute live via `((score * weight) / 100)` (line 196), but the `total` field (line 92, rendered at line 206) stays `75`. A reader who sums the three visible `+contribution` values now gets a number that doesn't equal the displayed total.
- **Root cause**: `total` is stored as a constant on each `ExampleStudent` alongside the `scores`/`weights` it is supposed to be the weighted sum of, so the invariant `total === Σ(score·weight/100)` is enforced only by hand.
- **Impact**: The whole point of this tab is to make the scoring mechanic legible and trustworthy; a total that visibly doesn't add up quietly does the opposite. It is a latent inconsistency waiting on the next content edit.
- **Fix sketch**: Compute `total` from `scores`/`weights` (round once) instead of storing it, so the row can never disagree with the contributions above it. If a hand-chosen total is intended, add an assertion/test that it matches the derived sum.

## 5. Both early-career capability items share one identical tabbed body, and the active tab persists across the switch
- **Severity**: Medium
- **Lens**: ui
- **Category**: navigation-feedback
- **File**: `app/features/sub_about/StudentsAbout.tsx:21`
- **Scenario**: In the About rail the user selects "Students: how the mechanic works", clicks the "Example scoring" tab, then selects the sibling item "Students: what we honestly believe". Because `StudentsAbout` is rendered at the same JSX position for both `GROUP_EARLY` items, React preserves its `tab` state, so the view stays on "Example scoring" — and that tab shows the exact same synthetic `STUDENTS` table for either item. Only the title/lead change; the visible body looks unchanged, reading as "the nav click did nothing."
- **Root cause**: The Example-scoring and Interview-script tabs are global illustrations of the early-career approach, not per-item content, but they live inside a component whose internal tab state survives an `item` prop change.
- **Impact**: Selecting the second early-career item appears inert whenever the user isn't on the Overview tab — a confusing dead-click that undercuts the rail's affordance that each item is a distinct page.
- **Fix sketch**: Reset to the Overview tab when `item.slug` changes (e.g. `useEffect(() => setTab("Overview"), [item.slug])`, or key the component on `item.slug`). Alternatively merge the two early-career rail entries into one, since their non-Overview tabs are identical.

## 6. Matrix grid cells are themed for light mode only, yet carry dark-mode-only hover animations
- **Severity**: Low
- **Lens**: ui
- **Category**: incomplete-theming
- **File**: `app/features/sub_matrix/MatrixShared.tsx:10`
- **Scenario**: In the app's dark ("Spark Dark") register — which the code clearly targets, see the `dark:hover:z-10 dark:hover:-rotate-2 dark:hover:shadow-sticker-xs` cell treatment at MatrixTab.tsx:775 — the grid container (`bg-white`, MatrixTab.tsx:680/717) and every cell fill render in light colors. `BLOCKED_CELL` even hardcodes a literal `#d6d3d1` hatch, and the band classes (`bg-coral/15`, `bg-amber-100`, …) have no `dark:` variants.
- **Root cause**: The interactive hover polish was given a dark variant but the underlying surfaces/fills were not, so the matrix is half-themed: a bright white table that nonetheless does a dark-mode "peeled sticker" tilt on hover.
- **Impact**: In dark mode the whole grid reads as a jarring light block, and the fixed `#d6d3d1` hatch has no relationship to a dark background — a visible theming seam on the context's primary surface.
- **Fix sketch**: Add `dark:` variants for the grid container, header (`bg-paper`), and the band/`BLOCKED_CELL` classes (drive the hatch color from a CSS var so it flips with theme), or, if the matrix is deliberately light-only, drop the dark-only hover rules so the surface is consistently single-theme.
