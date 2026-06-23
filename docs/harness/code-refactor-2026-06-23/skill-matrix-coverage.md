> Total: 5 findings (0c critical, 0h high, 1m medium, 4l low)

## 1. `salaryBand` flows end-to-end through /api/matrix but is never consumed by the client
- **Severity**: Low
- **Category**: dead-code
- **File**: app/api/matrix/route.ts:16
- **Scenario**: The route's `MatrixOut.positions` type declares `salaryBand: number[]`, and `pipeline/jobfit/matrix_cli.py:111` actively emits it (`"salaryBand": list(j.salary_band or [])`), so the field is computed by Python, deserialized, and serialized in the JSON response. But the client never reads it: `MatrixTab.tsx:21` defines `type Position = { id; title; seniority; roleFamily }` with NO `salaryBand`, and `grep -rn "salaryBand" app/features/sub_matrix/` returns zero hits. The salary band IS used elsewhere (Match tab, Jobs, decisions) but not in the matrix grid.
- **Root cause**: A position field carried over from the broader job shape that the matrix UI never grew a column/use for.
- **Impact**: Dead payload travelling browser↔server↔Python on every (non-cached) matrix build; a misleading type that suggests the matrix uses salary data when it does not. Minor — number arrays are small.
- **Fix sketch**: Either drop `salaryBand` from `MatrixOut.positions` (route.ts:16) and stop emitting it in matrix_cli.py:111, or — if a salary column is intended — add it to the client `Position` type and render it. Prefer removal unless there's a planned use.

## 2. `cellKey()` helper bypassed by 4 inline `${candId}|${posId}` literals
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_matrix/MatrixTab.tsx:259
- **Scenario**: `const cellKey = (candId, posId) => `${candId}|${posId}`` is defined at line 259 but used at only ONE call site (line 262). The identical composite-key format is rebuilt inline as a template literal at lines 228, 638, 643, and read at 743, plus decomposed via `key.split("|")` in `addSelected` (line 280). `grep` confirms 5 separate constructions of the same `candId|posId` key.
- **Root cause**: Helper introduced but adoption was partial; later cells/popover/reasoning code reached for inline literals.
- **Impact**: The "|"-delimited key contract is the data structure behind selection, "added", reasoning cache, and placements lookups — repeating it 5 ways means a format change (or an id that contains "|") must be found in 5 places. No active bug today.
- **Fix sketch**: Route all key construction (lines 228, 638, 643, 743) and the `split("|")` in `addSelected` through `cellKey`/a matching `parseCellKey`, so the delimiter lives in one place.

## 3. Repeated per-column score-shaping logic across `colScores`, `rowStrong`, and `columnStats`
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_matrix/MatrixTab.tsx:192
- **Scenario**: Three blocks walk the same `data.cells[ri]?.[ci]` grid with near-identical guards: `colScores` (lines 210-222) collects per-column non-blocked scores; `rowStrong` (lines 192-205) counts `score >= STRONG_THRESHOLD` per row; and `matrix-stats.ts columnStats` (already imported) re-derives `strong`/`count` per column from those same scores. The `score != null && score >= STRONG_THRESHOLD` strong-count test appears in both `rowStrong` (line 200) and `columnStats` (matrix-stats.ts:44). Confirmed by reading all three; `columnStats` is the tested, single-source aggregator the column strip already uses.
- **Root cause**: `rowStrong` is the row-axis mirror of the column strong-count but was written as a fresh loop instead of reusing the shared aggregator.
- **Impact**: The "strong fit" definition is encoded twice (component + lib); a change to what "strong" means or how nulls/blocked cells are handled must be kept in sync manually. The matrix-stats test suite covers `columnStats` but not the inline `rowStrong`/`colScores` loops.
- **Fix sketch**: Extract a tiny `gridScores(cells, rowIdx, colIdxs)` (or reuse `columnStats`) so both axes funnel through one place: `colScores[i] = scores`, and `rowStrong[ri] = columnStats(rowScores).strong`. Keeps the strong-threshold logic single-sourced and unit-tested.

## 4. `archStyle` comment claims a registry-driven fallback the code doesn't implement
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_matrix/MatrixTab.tsx:39
- **Scenario**: The block comment (lines 35-38) states dot colours come "from the shared registry (ARCHETYPE_BADGE — the same source the Match tab uses), so a newly added archetype renders with its OWN label". But `ARCH_DOT` (lines 39-43) is a hand-maintained literal `{ bau, student, career_switcher }` with no import of `ARCHETYPE_BADGE`; `grep` for `ARCHETYPE_BADGE` in this file returns nothing. The *label* is registry-driven (via `useEnumLabel`), but the *colour map* is local and static — the comment overstates the wiring.
- **Root cause**: Comment drifted from implementation, likely describing an intended/earlier design where the dot map was derived from the registry.
- **Impact**: Misleading documentation — a reader trusts that adding an archetype auto-colours the dot, when it actually falls back to `ARCH_DOT_FALLBACK` (grey) until `ARCH_DOT` is edited. No runtime bug.
- **Fix sketch**: Trim the comment to describe reality: labels come from the registry via `useEnumLabel`; dot colours are an intentional local presentation map with a neutral fallback. (Or actually derive `ARCH_DOT` from the registry if that was the goal.)

## 5. `CoverageGroup` type and `GROUP_V1` export are thin/effectively-internal exports
- **Severity**: Low
- **Category**: dead-code
- **File**: app/features/sub_about/AboutCoverageData.ts:604
- **Scenario**: `export type CoverageGroup` (line 604) is referenced only within AboutCoverageData.ts itself (the `coverageGroups` annotation, line 606) — `grep -rn "CoverageGroup"` shows no external importer. Likewise `export const GROUP_V1` (line 12) is used only inside this same file (lines 602, 609); only `GROUP_EARLY` is imported externally (AboutTab.tsx:9). `GROUP_V2` is used purely as inline `group:` values inside the file. So three of the module's `export` keywords confer no cross-module value.
- **Root cause**: Defensive/uniform exporting of all group constants and the group type when only `GROUP_EARLY`, `coverageGroups`, `allCoverageItems`, and `CoverageItem` are actually consumed by AboutTab/StudentsAbout.
- **Impact**: API-surface noise — the module looks like it offers a group taxonomy for reuse that nobody uses. Trivial; harmless.
- **Fix sketch**: Drop `export` from `CoverageGroup`, `GROUP_V1`, and `GROUP_V2` (keep `GROUP_EARLY` exported, it's imported by AboutTab). Leave `coverageGroups`/`allCoverageItems`/`CoverageItem` exported.
