> Total: 5 findings (0c critical, 0h high, 3m medium, 2l low)

## 1. `FilterButton.disabled` is a dead prop + a dead styling branch
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_components/results/interview/InterviewTab.tsx:203-229 (definition), 128 and 130-136 (call sites)
- **Scenario**: `FilterButton` declares `disabled?: boolean`, threads it into `disabled={disabled}` (line 218) and a three-way className with a whole `cursor-not-allowed bg-paper text-steel/50` branch (lines 221-224). Grepped both `FilterButton` usages (component is local to InterviewTab, 0 external callers): the "all" button (128) and per-group buttons (130-136) only pass `active`, `label`, `onClick`. `disabled` is always undefined, so the disabled visual branch can never render.
- **Root cause**: Disabled state scaffolded for an "empty bucket" affordance, but chips are derived from `groupBuckets` (only present groups surfaced), so a chip is never empty/disabled.
- **Impact**: Misleading surface area + unreachable Tailwind branch.
- **Fix sketch**: Drop `disabled` from the props type, remove `disabled={disabled}`, collapse className to `active` vs default. No call-site changes.

## 2. The "copied → reset after 2s" idiom is hand-rolled in four in-scope components
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_components/results/shared.tsx:173-179 (ListBlock), app/_components/results/ReportActions.tsx:29-35, app/_components/results/interview/SoftSignalsSection.tsx:30-39, app/_components/results/AddToPipelineButton.tsx (analogous `added` state); DispositionEditor.tsx:51 uses the same `setX(false), 2000` shape for "saved"
- **Scenario**: Each keeps `[copied, setCopied]`, calls `copyText`, then `window.setTimeout(() => setCopied(false), 2000)`. Grepped `set*(false), 2000` — 6 hits, 4 in this context; grepped `useCopy|useClipboard|useCopied|copyFeedback` — no shared hook exists.
- **Root cause**: `copyText` was extracted as the transport, but the surrounding feedback state (boolean + 2s reset) was never lifted.
- **Impact**: Drift — SoftSignalsSection omits `window.`; AddToPipelineButton has no timer; a behavior change (live-region announce, clear-on-unmount) needs 4 edits.
- **Fix sketch**: Add `useCopyFeedback()` in `app/_lib` returning `{ copied, copy }` (ref-held timeout, cleared on unmount). Adopt in ListBlock, ReportActions, SoftSignalsSection. Leave AddToPipelineButton/DispositionEditor (terminal/save-shaped).

## 3. The candidate-link vetting idiom `dedupeBy(safeHttpLinks(...), l => l.href)` is repeated verbatim
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_components/results/extraction/ExtractionTab.tsx:21, app/_components/results/salary/SalaryTab.tsx:22-24 (also app/features/sub_library/JdBuilderResult.tsx:118, out of context)
- **Scenario**: Both in-scope tabs render untrusted links via the identical `dedupeBy(safeHttpLinks(<list>), (link) => link.href)` (Salary/JdBuilder also `.slice(0,3)`). Grepped `dedupeBy\(safeHttpLinks` — exactly these 3 sites, all re-importing both helpers and re-spelling the same key.
- **Root cause**: `safeHttpLinks` and `dedupeBy` were each extracted, but their composition was never named.
- **Impact**: The security invariant (http(s)-only + de-duped before render) lives in three hand-written expressions; a future surface can forget the `safeHttpLinks` half and render a `javascript:`/`data:` href.
- **Fix sketch**: Add `vetLinks(raw, limit?)` to `safe-url.ts` wrapping `dedupeBy(safeHttpLinks(raw), l => l.href)` with optional `.slice`. Replace the 3 sites.

## 4. `SalaryGauge`'s `target` default `midpoint * 1.3` is unreachable and diverges from the shown figure
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_components/results/salary/SalaryGauge.tsx:27-28
- **Scenario**: `target = targetProp ?? midpoint * 1.3`. Grepped `<SalaryGauge` — one caller (SalaryTab.tsx:35) always passes `target={targetSalary}` (rounded to nearest 5000 at SalaryTab.tsx:18), so the `?? midpoint * 1.3` branch never runs; the prop's own JSDoc says the caller rounds once so marker + aria use the same figure — an unrounded fallback would contradict that.
- **Root cause**: Defensive default from a possibly-standalone past; the lone live caller always supplies the rounded value.
- **Impact**: Minor dead default that would render an inconsistent figure if ever hit, and makes `target` look optional when the only correct use is to pass it.
- **Fix sketch**: Make `target` required (drop the `??`), or round inside the fallback. Required is cleaner given the single caller.

## 5. Pipeline-progress components sit in the flat `_components/` root, not with their context
- **Severity**: Low
- **Category**: structure
- **File**: app/_components/AnalysisProgress.tsx, app/_components/ScanAnimation.tsx, app/_components/FactorChart.tsx
- **Scenario**: Per grep, none belongs to the results tree: `AnalysisProgress` is imported only by `sub_analyze/*`, `ScanAnimationCompact` only by `sub_analyze/AnalyzeForm*`, `FactorChart` only by results/ExtractionTab. They live loose in the flat root while related UI is namespaced under `results/`. (Note: the prior `code-refactor-2026-06-14` pass already removed the dead `ScanAnimationWide`/`Pulse`/`Chip`; that file is now lean and `ScanAnimationCompact` is live — nothing dead remains.)
- **Root cause**: Organic growth before `results/` and `sub_analyze/` groupings existed.
- **Impact**: Navigational only — no bug.
- **Fix sketch**: Optional/low-priority. Only fold into a broader reorg (`FactorChart` → `results/extraction/`, analyze-progress pair → `sub_analyze/`). Do NOT do in isolation; flat-root is a repo-wide pattern. Flagged for awareness.
