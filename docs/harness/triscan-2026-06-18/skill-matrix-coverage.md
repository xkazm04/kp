# Skill Matrix & Coverage — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 2 High / 3 Medium / 0 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. Min-fit floor (or family filter) can empty the grid with no empty-state
- **Lens**: 🎨 UI Perfectionist (primary) · 🐛 Bug Hunter
- **Severity**: High
- **Category**: empty-state / loading-empty-error
- **Value**: impact 7/10 · effort 2/10 · risk 1/10
- **File**: `app/features/sub_matrix/MatrixTab.tsx:556`
- **Scenario**: On a realistic pool (mostly weak cells) the recruiter sets Min fit `≥70`, or picks a role family no strong candidate matches. `rows` becomes `[]`. The branch at line 556 only guards `data.candidates.length === 0 || data.positions.length === 0` — both are non-zero — so it renders the full table with sticky headers, the per-column histograms, and the legend, but a `<tbody>` with zero `<tr>`. The user sees a header strip floating over blank space and no explanation.
- **Root cause**: The "empty" decision keys off raw `data.candidates.length`, not the post-filter `rows.length`. The count line already computes `t("ofCount", { shown: rows.length, … })`, so the data is known; only the render branch ignores it.
- **Impact**: Looks broken on exactly the action that's supposed to help (declutter a noisy grid); the recruiter can't tell "no one clears this bar" from "the app failed." Export/shortlist buttons already correctly hide on `rows.length > 0` (line 409), so the surface is half-aware of the case.
- **Fix sketch**: Add a branch before the table: `rows.length === 0` → a small inline panel (`t("noRowsAfterFilter")`) with a "Lower the fit floor" / "Show all families" reset that calls `setMinFit(0)` / `setFamily("all")`. Reuse the amber-note styling already in the file.

## 2. Histogram bars lose their height encoding at large counts (visual saturation)
- **Lens**: 🎨 UI Perfectionist (primary) — data viz
- **Severity**: Medium
- **Category**: data-viz legibility
- **File**: `app/features/sub_matrix/MatrixShared.tsx:48`
- **Scenario**: The per-column mini-histogram normalizes each bar to `(n / maxBucket) * 20px`, `maxBucket = Math.max(...s.buckets, 1)`. With the 200-candidate pool, a column where one band holds 120 and another holds 8 renders the 8 as `Math.round(8/120*20)=1` → clamped to the 2px floor. Two visually identical 2px stubs can represent counts that differ by 4–6×, so the "deep bench vs one lucky hit" read the strip promises (file header, line 30) collapses precisely when the pool is large enough to matter.
- **Root cause**: Linear normalization against the single tallest bucket, plus a hard 2px floor that swallows the low end. No count labels on the bars (only best/median/strong text below), so the eye has nothing to recover the magnitude from.
- **Impact**: The headline at-a-glance signal of the MAT2 strip is unreliable on real data; recruiters mis-read distribution shape. Low effort, contained to one component.
- **Fix sketch**: Use `Math.sqrt`/log scaling for bar height, or annotate the tallest bucket with its count; keep the 2px floor only for truly-zero-but-present visual parity. Add `title`/`aria` per bar with the band label + count so the data is recoverable on hover and to SR.

## 3. Strong/good bands separated only by opacity — weak color-encoding & colorblind risk
- **Lens**: 🎨 UI Perfectionist (primary) — color encoding / a11y
- **Severity**: Medium
- **Category**: color contrast / colorblind safety
- **File**: `app/features/sub_matrix/matrix-stats.ts:16`
- **Scenario**: The two upper bands are `bg-moss/20 text-moss` (60–71) and `bg-moss/40 text-ink` (72–84), with `bg-moss/70 text-white` (85+) — three steps of the SAME hue distinguished mostly by alpha over a white grid. The whole scale is also a coral→amber→moss (red→amber→green) ramp, the canonical deuteranopia/protanopia confusion axis. A colorblind recruiter can't reliably separate "fair" from "strong," and the 60–71 vs 72–84 step (which straddles `STRONG_THRESHOLD`, the most decision-relevant edge) is the faintest.
- **Root cause**: Color is the sole carrier of band identity in the cell; the number is present but bands rely on hue+opacity alone. No redundant non-color channel (border, glyph, or pattern) except for blocked cells (which DO get a hatch — line 10 of MatrixShared, a good pattern to extend).
- **Impact**: The matrix's core job is "find the green cell"; for ~8% of male users that read is degraded. The strong-fit `★` badge on the row header partly mitigates per-candidate, but the cell grid itself doesn't.
- **Fix sketch**: Add a redundant encoding at/above `STRONG_THRESHOLD` — e.g. a subtle inset border or a small corner glyph on band-3/4 cells, mirroring the blocked-cell hatch idea. Verify the moss/20 vs moss/40 luminance step meets a perceptible delta in both light and dark themes (dark moss is `#84b27a`).

## 4. 200×N grid renders every cell as a focusable button — no virtualization
- **Lens**: 🐛 Bug Hunter (primary) — perf
- **Severity**: Medium
- **Category**: large-matrix performance
- **File**: `app/features/sub_matrix/MatrixTab.tsx:591`
- **Scenario**: `listMatrixProfiles(200, …)` (route.ts:42) caps the pool at 200 candidates. With the family filter on "all" and a broad corpus (say 25 positions), `rows.map(...).cols.map(...)` mounts 200×25 = 5,000 `<button>` cells, each with computed `title`, `aria-label`, multiple `t(...)` interpolations, placement lookups, and per-cell class strings — plus 200 row-header archetype lookups. Every sort toggle, min-fit change, family switch, or select-mode entry re-runs the full render. No `react-window`/windowing, no `React.memo` on the cell.
- **Root cause**: Flat full-grid render; the `rows`/`cols`/`colScores`/`rowStrong` memos are correct but the JSX fan-out underneath them is O(rows×cols) per interaction, with heavy per-cell i18n string building.
- **Impact**: On the largest supported pool, sort/filter interactions can jank (hundreds of ms) and select-mode toggling re-renders all 5k cells. It's bounded (cap 200) so not catastrophic, but it's the perf ceiling of the feature and degrades the headline interactions.
- **Fix sketch**: Memoize the cell into a `React.memo` component keyed on its stable inputs; defer `title`/`aria-label` string construction to a hover/focus handler instead of building all 5k up front. If pools grow past the 200 cap, add row virtualization (`overflow-auto` container already exists at line 558).

## 5. About/coverage rail is read-only — no path from "this is what we do" to "show me on MY data"
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: value communication / coverage clarity
- **File**: `app/features/sub_about/AboutTab.tsx:88`
- **Scenario**: The About tab is an excellent feature-to-pipeline map (24 capability cards across v1/v2/early-career, each with a focused PlantUML diagram). The `matching-engine` card even names "Surfaced in the Match tab and the Matrix" (AboutCoverageData.ts:333) and the early-career thesis is genuinely differentiating. But every card is terminal: the only outbound actions are the global `/diagrams` link and "Run the tour" (lines 33–48). A card that describes the Matrix, Decisions, or Students mechanic gives the reader no button to jump to that surface with their own data. Student-mode positioning, the strongest narrative, lives behind a left-rail item a first-time recruiter may never click.
- **Root cause**: `CoverageItem` carries `slug/title/lead/body` only — no optional `{ tab, label }` deep-link (the matrix already has `buildUrl({ tab, … })` and `ChainEmptyState` uses tab links, so the primitive exists). The rail explains capabilities but never converts attention into a guided first action.
- **Impact**: The page that should sell the platform (and the student thesis that differentiates it) dead-ends. A "see this on your pipeline" CTA per relevant card turns the explainer into an activation funnel — high business value, the diagrams already did the hard part.
- **Fix sketch**: Add optional `cta?: { tab: string; label: string }` to `CoverageItem`; render it as a footer link in the `<article>` (and StudentsAbout) using the existing `buildUrl`/Link pattern. Wire the matching-engine card → Matrix, student cards → Decisions/Match, pipeline card → Pipeline. Optionally surface the Students group with a small "new" affordance so the differentiator isn't buried.
