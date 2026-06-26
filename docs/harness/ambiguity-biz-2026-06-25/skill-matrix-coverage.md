# Skill Matrix & Coverage — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H4/M1/L0

## 1. The "coverage gap" the matrix is named for is computed but never surfaced
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / talent intelligence
- **File**: app/features/sub_matrix/MatrixTab.tsx:192 (rowStrong) + matrix-stats.ts:3
- **Observation**: `matrix-stats.ts` opens by framing the whole value prop — *"is a role deep-benched or a one-lucky-hit?"* (lines 3-4) — and the engine already computes per-column `strong` counts (`columnStats`) and per-row `rowStrong`. But nothing aggregates across the grid. The single most actionable talent-intelligence question — *"which open roles have ZERO strong candidates?"* — is computable from `colScores` (MatrixTab.tsx:210) yet a recruiter must eyeball every column header to answer it. The context is literally called "Skill Matrix & **Coverage**," but coverage is never rolled up.
- **Why it matters**: "Uncovered roles" (0 fits ≥72) is the headline sourcing signal and the classic monetizable analytics upsell — kp's known dark-capability pattern. Surfacing "3 of 8 open roles have no strong fit — source for these" turns a lookup grid into a talent-gap dashboard. The data is already on the client; this is pure presentation.
- **Recommendation**: Add a "Coverage" banner/strip above the grid: count roles with `strong === 0`, list them, and link to sourcing. Reuse the existing `colScores`/`STRONG_THRESHOLD` — no new compute. Optionally gate richer rollups (trend over time, per-family coverage) behind a paid analytics tier.
- **Effort**: S

## 2. Matrix mixes workspace-scoped candidates with un-scoped positions & placements
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented tenancy assumption / silent wrong data
- **File**: app/api/matrix/route.ts:42 + app/_lib/db/profiles.ts:152
- **Observation**: `listMatrixProfiles(200, await currentWorkspace())` is workspace-scoped, but `listOpenPositions()` (profiles.ts:152) and `pipelinePlacements()` (profiles.ts:176) take **no** workspace argument — they read every row of `pipeline_entries` globally. So a recruiter in workspace A sees A's candidates scored against **every workspace's** open roles, with **other workspaces' placements** overlaid as "in pipeline" rings. The asymmetry is silent; the only nearby note (route.ts:35) says "kp runs one server process," which is about process count, not tenancy.
- **Why it matters**: If multi-workspace is real, this is cross-tenant data bleed and mis-marked cells (a candidate rings as "Hired" for a role they were never in) — i.e., silent wrong hiring context. If single-tenant is the intent, that decision is undocumented and a landmine for whoever next enables workspaces.
- **Recommendation**: Either thread `workspaceId` through `listOpenPositions`/`pipelinePlacements` (and the cache key), or add an explicit comment + assertion that the matrix is single-workspace by design. Make the assumption loud, not implicit.
- **Effort**: M

## 3. The 200-candidate cap is silent AND keeps the oldest, dropping the newest applicants
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic number / hidden truncation / happy-path
- **File**: app/_lib/db/profiles.ts:141 (called at app/api/matrix/route.ts:42)
- **Observation**: `listMatrixProfiles(200, …)` runs `… ORDER BY created_at ASC LIMIT 200`. Two undocumented hazards: (a) the cap is invisible — the header `countLine` (MatrixTab.tsx:364) prints `data.candidates.length`, which is *already* the capped 200, so it reads as "you have 200 candidates" with no "200 of N" truth; (b) `ASC` keeps the **oldest** 200 and silently drops the **newest** — exactly backwards for recruiting, where recent applicants matter most. Past 200 candidates, fresh applicants never appear in the matrix and no one is told.
- **Why it matters**: A growing pool silently loses its most relevant rows; recruiters make "who fits?" decisions on a quietly stale, truncated set. The bare `200` carries no recorded reasoning (perf? Python payload size?).
- **Recommendation**: Flip to `created_at DESC` (newest-first) and surface truncation ("showing 200 of 340 — refine by role family"), mirroring the existing `missing`/`missingCandidates` honesty banners. Document why 200.
- **Effort**: S

## 4. Min-fit quick-filter presets (55/70) contradict the single-sourced band scale (72 = strong)
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / internal inconsistency
- **File**: app/features/sub_matrix/MatrixTab.tsx:374
- **Observation**: `MATRIX_BANDS` and `STRONG_THRESHOLD` are single-sourced with great care (matrix-stats.ts:13-22; edges 45/60/72/85, strong = 72) precisely so "the legend can never claim an edge the grid doesn't use." Yet the min-fit floor hardcodes `[0, 55, 70]` — values that match **no** band edge. "≥70" sits one point below strong (72): it admits 70-71 rows that the moss legend and the `N★` strong badge (which uses 72) both call *not* strong. The view now speaks two different "good enough" thresholds with no recorded rationale.
- **Why it matters**: A recruiter clicking "≥70" to "show me the strong ones" gets near-strong noise, while the star badge disagrees in the same row — eroding trust in the scale the rest of the tab works hard to keep coherent.
- **Recommendation**: Derive presets from band floors, e.g. `[0, MATRIX_BANDS[2].min /*60*/, STRONG_THRESHOLD /*72*/]`, so the filter, legend, and star all agree. Label the top one "Strong."
- **Effort**: S

## 5. The matrix can only score roles already in the pipeline — no proactive pre-screen against new reqs
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: capability gap / value left on the table
- **File**: app/_lib/db/profiles.ts:151 (listOpenPositions docstring)
- **Observation**: Columns come exclusively from `listOpenPositions` = *"jobs that appear in the pipeline"* (profiles.ts:151). A brand-new open role — one you're about to post but haven't started a pipeline for — has no column, so the matrix cannot answer the single most valuable sourcing question: *"who in my existing pool fits this NEW role?"* The tool is reactive (roles you've already begun hiring for) rather than proactive (your full job catalog / a pasted JD).
- **Why it matters**: Pre-screening a warm pool against an unposted req is exactly the "talent rediscovery" wedge recruiting platforms monetize. The scorer is deterministic and already accepts arbitrary job records (`--jobs-json`, route.ts:55), so the engine can do this today — only the column source is artificially narrowed.
- **Recommendation**: Let the matrix union pipeline roles with the job corpus (or a "score against this JD" input), so recruiters can rank the pool against a role before opening a single pipeline entry. Natural premium/"sourcing" feature.
- **Effort**: M
